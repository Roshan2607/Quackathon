import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { app, setServerTestOverrides, resetServerTestOverrides } from '../server.ts';
import {
  runBoundedGitHubEnrichmentDraft,
  extractPublicEventPreview,
} from '../src/services/adapters.ts';

let serverInstance: http.Server;
let baseUrl = '';

function createBase64UrlJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = Buffer.from('mock_signature').toString('base64url');
  return `${header}.${body}.${sig}`;
}

test.before(async () => {
  await new Promise<void>((resolve) => {
    serverInstance = app.listen(0, '127.0.0.1', () => {
      const addr = serverInstance.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

test.after(async () => {
  resetServerTestOverrides();
  await new Promise<void>((resolve) => {
    serverInstance.close(() => resolve());
  });
  try {
    const { pool } = await import('../src/db/index.ts');
    await pool.end();
  } catch {
    // ignore pool shutdown errors
  }
});

test('1. Missing OAuth client ID returns 400 MISSING_CONFIG and stages.configuration = missing_client_id', async () => {
  resetServerTestOverrides();
  const prevClientId = process.env.PESU_OAUTH_CLIENT_ID;
  delete process.env.PESU_OAUTH_CLIENT_ID;

  setServerTestOverrides({
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          issuer: 'https://oauth.pesu.mock',
          authorization_endpoint: 'https://oauth.pesu.mock/authorize',
          token_endpoint: 'https://oauth.pesu.mock/token',
          scopes_supported: ['openid', 'profile', 'email'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
  });

  try {
    const res = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile`);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.ok, false);
    assert.equal(data.errorCategory, 'MISSING_CONFIG');
    assert.equal(data.stages.configuration, 'missing_client_id');
  } finally {
    if (prevClientId !== undefined) process.env.PESU_OAUTH_CLIENT_ID = prevClientId;
  }
});

test('2. OAuth URL & scope parameter consistency (both scope and scopes supported, unsupported scope rejected)', async () => {
  process.env.PESU_OAUTH_CLIENT_ID = 'test_pesu_client_123';
  process.env.PESU_OAUTH_ISSUER_URL = 'https://oauth.pesu.mock';

  setServerTestOverrides({
    fetchFn: async (input) => {
      const url = String(input);
      if (url.includes('/.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: 'https://oauth.pesu.mock',
            authorization_endpoint: 'https://oauth.pesu.mock/authorize',
            token_endpoint: 'https://oauth.pesu.mock/token',
            userinfo_endpoint: 'https://oauth.pesu.mock/userinfo',
            scopes_supported: ['openid', 'profile', 'email', 'announcements:read'],
            code_challenge_methods_supported: ['S256'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    },
  });

  // Test with ?scopes=...
  const resScopes = await fetch(
    `${baseUrl}/api/pesu-oauth/url?scopes=${encodeURIComponent('openid profile announcements:read')}`
  );
  const dataScopes = await resScopes.json();
  assert.equal(resScopes.status, 200);
  assert.equal(dataScopes.ok, true);
  assert.ok(dataScopes.authorizationUrl?.startsWith('https://oauth.pesu.mock/authorize?'));
  assert.equal(dataScopes.authorizationUrl, dataScopes.authUrl);
  assert.deepEqual(dataScopes.scopes, ['openid', 'profile', 'announcements:read']);

  // Test with ?scope=...
  const resScope = await fetch(
    `${baseUrl}/api/pesu-oauth/url?scope=${encodeURIComponent('openid email')}`
  );
  const dataScope = await resScope.json();
  assert.equal(resScope.status, 200);
  assert.equal(dataScope.ok, true);
  assert.deepEqual(dataScope.scopes, ['openid', 'email']);

  // Test unsupported scope rejection
  const resBadScope = await fetch(
    `${baseUrl}/api/pesu-oauth/url?scope=${encodeURIComponent('openid superadmin:write')}`
  );
  const dataBadScope = await resBadScope.json();
  assert.equal(resBadScope.status, 400);
  assert.equal(dataBadScope.ok, false);
  assert.equal(dataBadScope.errorCategory, 'OAUTH_SCOPE_REJECTED');
});

test('3. OAuth exact redirect URI validation rejects unregistered callback URLs', async () => {
  process.env.PESU_OAUTH_CLIENT_ID = 'test_pesu_client_123';
  const res = await fetch(
    `${baseUrl}/api/pesu-oauth/url?scope=openid&redirect_uri=${encodeURIComponent('https://evil.example.com/callback')}`
  );
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.ok, false);
  assert.equal(data.errorCategory, 'OAUTH_REDIRECT_URI_MISMATCH');
  assert.equal(data.stages.redirectUriValidation, 'mismatch');
});

test('4. Unavailable OAuth provider returns 502 with providerDiscovery = unreachable', async () => {
  setServerTestOverrides({
    fetchFn: async () => {
      throw new Error('ECONNREFUSED simulated provider outage');
    },
  });

  const res = await fetch(`${baseUrl}/api/pesu-oauth/discovery`);
  const data = await res.json();
  assert.equal(res.status, 502);
  assert.equal(data.ok, false);
  assert.equal(data.stages.providerDiscovery, 'unreachable');
});

test('5. Invalid or missing OAuth state is rejected on callback with 400 OAUTH_STATE_INVALID', async () => {
  const res = await fetch(`${baseUrl}/auth/pesu/callback?code=fake_code&state=non_existent_state`);
  const html = await res.text();
  assert.equal(res.status, 400);
  assert.ok(html.includes('OAUTH_STATE_INVALID'));
  assert.ok(html.includes('PESU_OAUTH_RESULT'));
  assert.ok(!html.includes("'*'"), 'Callback must never postMessage to wildcard origin');
});

test('6. End-to-end PKCE S256 token exchange & popup callback messaging with mock OAuth provider', async () => {
  process.env.PESU_OAUTH_CLIENT_ID = 'test_pesu_client_123';
  process.env.PESU_OAUTH_CLIENT_SECRET = 'super_secret_do_not_leak';
  process.env.PESU_OAUTH_ISSUER_URL = 'https://oauth.pesu.mock';

  let capturedCodeVerifier = '';

  setServerTestOverrides({
    fetchFn: async (input, init) => {
      const url = String(input);
      if (url.includes('/.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: 'https://oauth.pesu.mock',
            authorization_endpoint: 'https://oauth.pesu.mock/authorize',
            token_endpoint: 'https://oauth.pesu.mock/token',
            userinfo_endpoint: 'https://oauth.pesu.mock/userinfo',
            scopes_supported: ['openid', 'profile', 'email'],
            code_challenge_methods_supported: ['S256'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === 'https://oauth.pesu.mock/token') {
        const bodyParams = new URLSearchParams(String(init?.body ?? ''));
        capturedCodeVerifier = bodyParams.get('code_verifier') ?? '';
        const idToken = createBase64UrlJwt({
          iss: 'https://oauth.pesu.mock',
          aud: 'test_pesu_client_123',
          sub: 'pesu_student_007',
          name: 'Roshan Builder',
          email: 'roshan@pesu.pes.edu',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });

        return new Response(
          JSON.stringify({
            access_token: 'secret_access_token_xyz_999',
            refresh_token: 'secret_refresh_token_xyz_999',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid profile email',
            id_token: idToken,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === 'https://oauth.pesu.mock/userinfo') {
        return new Response(
          JSON.stringify({
            sub: 'pesu_student_007',
            name: 'Roshan Builder',
            email: 'roshan@pesu.pes.edu',
            preferred_username: 'PES1UG23CS999',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not found', { status: 404 });
    },
  });

  // Step 1: Request authorization URL and capture session cookie + PKCE challenge
  const urlRes = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email`);
  const setCookieHeader = urlRes.headers.get('set-cookie') ?? '';
  const cookiePair = setCookieHeader.split(';')[0];
  const urlData = await urlRes.json();

  assert.equal(urlRes.status, 200);
  assert.equal(urlData.ok, true);
  assert.ok(urlData.state);

  const parsedAuthUrl = new URL(urlData.authorizationUrl);
  const codeChallenge = parsedAuthUrl.searchParams.get('code_challenge');
  assert.equal(parsedAuthUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(codeChallenge);

  // Step 2: Simulate provider callback with authorization code and session cookie
  const cbRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=valid_auth_code_456&state=${encodeURIComponent(urlData.state)}`,
    {
      headers: { Cookie: cookiePair },
    }
  );
  const cbHtml = await cbRes.text();
  assert.equal(cbRes.status, 200);

  // Verify PKCE S256 math: SHA256(capturedCodeVerifier) === codeChallenge
  const expectedChallenge = crypto
    .createHash('sha256')
    .update(capturedCodeVerifier)
    .digest('base64url');
  assert.equal(expectedChallenge, codeChallenge);

  // Verify postMessage contract and that secrets/tokens are NEVER leaked in HTML
  assert.ok(cbHtml.includes('PESU_OAUTH_RESULT'));
  assert.ok(!cbHtml.includes('secret_access_token_xyz_999'));
  assert.ok(!cbHtml.includes('super_secret_do_not_leak'));
  assert.ok(!cbHtml.includes('valid_auth_code_456'));

  // Step 3: Verify server-side session endpoint reports verified identity
  const sessionRes = await fetch(`${baseUrl}/api/pesu-oauth/session`, {
    headers: { Cookie: cookiePair },
  });
  const sessionData = await sessionRes.json();
  assert.equal(sessionData.authenticated, true);
  assert.equal(sessionData.stages.tokenExchange, 'succeeded');
  assert.equal(sessionData.stages.verifiedIdentity, 'verified');
  assert.equal(sessionData.identity.sub, 'pesu_student_007');
  assert.equal(sessionData.identity.email, 'roshan@pesu.pes.edu');

  // Step 4: Verify provider error callback handling
  const urlRes2 = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid`, {
    headers: { Cookie: cookiePair },
  });
  const urlData2 = await urlRes2.json();
  const errCbRes = await fetch(
    `${baseUrl}/auth/pesu/callback?error=access_denied&error_description=User+denied+consent&state=${encodeURIComponent(urlData2.state)}`,
    {
      headers: { Cookie: cookiePair },
    }
  );
  const errCbHtml = await errCbRes.text();
  assert.equal(errCbRes.status, 400);
  assert.ok(errCbHtml.includes('OAUTH_CONSENT_ERROR'));
  assert.ok(errCbHtml.includes('PESU_OAUTH_RESULT'));
});

test('7. Gemini 503 followed by successful retry recovers automatically and records retryAttempts', async () => {
  process.env.GEMINI_API_KEY = 'mock_gemini_key_for_test';
  let callCount = 0;

  setServerTestOverrides({
    sleepFn: async () => {},
    geminiListModelsFn: async () => ['gemini-2.5-flash', 'gemini-2.0-flash'],
    geminiGenerateFn: async ({ model }) => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('503 UNAVAILABLE — This model is currently experiencing high demand.') as Error & {
          status?: number;
        };
        err.status = 503;
        throw err;
      }
      return {
        text: JSON.stringify({
          title: 'PES Quantum AI Hackathon 2026',
          organizer: 'PES CSE Club',
          eventType: 'hackathon',
          description: '24-hour AI sprint',
          campus: 'RR Campus',
          venueName: 'MRD Auditorium',
          format: 'onsite',
          startAt: '2026-12-27',
          endAt: '2026-12-28',
          registrationDeadline: '2026-12-23',
          minTeamSize: 2,
          maxTeamSize: 4,
          eligibilityNotes: 'Open to all engineering students',
          themes: ['Applied AI/ML'],
          extractedTextEvidence: `Recovered on attempt ${callCount} with ${model}`,
        }),
        requestId: 'req_recovered_503',
      };
    },
  });

  const res = await fetch(`${baseUrl}/api/events/extract-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: 'poster.png',
      mimeType: 'image/png',
      base64Data: Buffer.from('fake_png_bytes').toString('base64'),
    }),
  });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.data.title, 'PES Quantum AI Hackathon 2026');
  assert.ok(data.diagnostics.retryAttempts >= 1);
  assert.equal(data.diagnostics.httpStatus, 200);
});

test('8. Gemini 503 after retry exhaustion returns 503, fileAccepted=true, friendly message, and diagnostics', async () => {
  process.env.GEMINI_API_KEY = 'mock_gemini_key_for_test';

  setServerTestOverrides({
    sleepFn: async () => {},
    geminiListModelsFn: async () => ['gemini-2.5-flash', 'gemini-2.0-flash'],
    geminiGenerateFn: async () => {
      const err = new Error('503 UNAVAILABLE — This model is currently experiencing high demand.') as Error & {
        status?: number;
        requestId?: string;
      };
      err.status = 503;
      err.requestId = 'req_exhausted_503';
      throw err;
    },
  });

  const res = await fetch(`${baseUrl}/api/events/extract-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: 'poster.png',
      mimeType: 'image/png',
      base64Data: Buffer.from('fake_png_bytes').toString('base64'),
    }),
  });
  const data = await res.json();

  assert.equal(res.status, 503);
  assert.equal(data.ok, false);
  assert.equal(data.fileAccepted, true);
  assert.equal(
    data.userMessage,
    "AI extraction is temporarily unavailable. Your poster was accepted, but its details couldn't be extracted. Retry extraction or enter the information manually."
  );
  assert.equal(data.diagnostics.httpStatus, 503);
  assert.equal(data.diagnostics.errorCategory, 'TRANSIENT_UNAVAILABLE');
  assert.ok(data.diagnostics.retryAttempts >= 1);
});

test('9. Gemini 429 rate limiting classifies as RATE_LIMITED and respects Retry-After', async () => {
  process.env.GEMINI_API_KEY = 'mock_gemini_key_for_test';
  const sleepDelays: number[] = [];

  setServerTestOverrides({
    sleepFn: async (ms) => {
      sleepDelays.push(ms);
    },
    geminiListModelsFn: async () => ['gemini-2.5-flash'],
    geminiGenerateFn: async () => {
      const err = new Error('429 Too Many Requests: Quota exceeded') as Error & {
        status?: number;
        retryAfterMs?: number;
      };
      err.status = 429;
      err.retryAfterMs = 1500;
      throw err;
    },
  });

  const res = await fetch(`${baseUrl}/api/events/extract-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: 'poster.png',
      mimeType: 'image/png',
      base64Data: Buffer.from('fake_png_bytes').toString('base64'),
    }),
  });
  const data = await res.json();

  assert.equal(res.status, 429);
  assert.equal(data.ok, false);
  assert.equal(data.errorCategory, 'RATE_LIMITED');
  assert.equal(data.diagnostics.errorCategory, 'RATE_LIMITED');
  assert.ok(sleepDelays.some((d) => d >= 1500));
});

test('10. Deterministic PDF text extraction succeeds with 0 Gemini calls when selectable text is present', async () => {
  let geminiCalled = 0;
  setServerTestOverrides({
    geminiGenerateFn: async () => {
      geminiCalled++;
      throw new Error('Gemini should not be called for selectable PDF text');
    },
  });

  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
4 0 obj
<< /Length 300 >>
stream
BT
(Event Title: PES Deterministic Brochure Hackathon 2026) Tj
(Organizer: PES Systems Club) Tj
(Start Date: 2026-10-14) Tj
(End Date: 2026-10-15) Tj
(Venue: MRD Auditorium, RR Campus) Tj
(Team Size: 2 to 4 members) Tj
(Official Website: https://events.pes.edu/11515/) Tj
ET
endstream
endobj
%%EOF`;

  const res = await fetch(`${baseUrl}/api/events/extract-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: 'brochure.pdf',
      mimeType: 'application/pdf',
      base64Data: Buffer.from(pdfContent, 'latin1').toString('base64'),
    }),
  });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(geminiCalled, 0);
  assert.equal(data.diagnostics.extractionMethod, 'pdf_text_parser');
  assert.equal(data.data.title, 'PES Deterministic Brochure Hackathon 2026');
  assert.equal(data.data.minTeamSize, 2);
  assert.equal(data.data.maxTeamSize, 4);
});

test('11. Unsupported file types return 415 UNSUPPORTED_MEDIA_TYPE', async () => {
  const res = await fetch(`${baseUrl}/api/events/extract-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: 'malicious.exe',
      mimeType: 'application/x-msdownload',
      base64Data: Buffer.from('MZ').toString('base64'),
    }),
  });
  const data = await res.json();
  assert.equal(res.status, 415);
  assert.equal(data.ok, false);
  assert.equal(data.errorCategory, 'UNSUPPORTED_MEDIA_TYPE');
});

test('12. Event URL verification contract returns reconciled status and canonicalUrl/verifiedCanonicalUrl/finalUrl', async () => {
  setServerTestOverrides({
    fetchFn: async (input) => {
      const url = String(input);
      if (url === 'https://events.pes.edu/11515/') {
        const html = `<html><head><link rel="canonical" href="https://events.pes.edu/11515/canonical" /><title>PES Hackathon</title></head><body></body></html>`;
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      if (url === 'https://events.pes.edu/broken-404') {
        return new Response('Not Found', { status: 404 });
      }
      return new Response('OK', { status: 200 });
    },
  });

  // Valid URL with canonical tag
  const validRes = await fetch(`${baseUrl}/api/events/verify-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://events.pes.edu/11515/' }),
  });
  const validData = await validRes.json();
  assert.equal(validRes.status, 200);
  assert.equal(validData.ok, true);
  assert.equal(validData.status, 'verified');
  assert.equal(validData.canonicalUrl, 'https://events.pes.edu/11515/canonical');
  assert.equal(validData.verifiedCanonicalUrl, 'https://events.pes.edu/11515/canonical');
  assert.ok(validData.finalUrl);

  // Broken 404 URL
  const brokenRes = await fetch(`${baseUrl}/api/events/verify-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://events.pes.edu/broken-404' }),
  });
  const brokenData = await brokenRes.json();
  assert.equal(brokenData.ok, false);
  assert.equal(brokenData.status, 'broken');
  assert.equal(brokenData.httpStatus, 404);
  assert.equal(brokenData.verifiedCanonicalUrl, null);

  // SSRF Blocked URL
  const ssrfRes = await fetch(`${baseUrl}/api/events/verify-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' }),
  });
  const ssrfData = await ssrfRes.json();
  assert.equal(ssrfRes.status, 403);
  assert.equal(ssrfData.ok, false);
  assert.equal(ssrfData.status, 'blocked_policy');
});

test('13. Simulated Demo Mode helpers never report isLiveApiResult = true', () => {
  const ghDraft = runBoundedGitHubEnrichmentDraft({
    uid: 'u_solo_arjun',
    githubUsername: 'octocat',
  });
  assert.equal(ghDraft.isLiveApiResult, false);

  const eventPreview = extractPublicEventPreview('https://events.pes.edu/11515/');
  assert.equal(eventPreview.isLiveApiResult, false);
});

test('14. PESU OIDC discovery parses valid JSON metadata and returns requestedUrl, httpStatus, contentType, and endpoints', async () => {
  process.env.PESU_OAUTH_ISSUER_URL = 'https://pesu-oauth2.onrender.com';
  setServerTestOverrides({
    fetchFn: async (input) => {
      const url = String(input);
      assert.equal(url, 'https://pesu-oauth2.onrender.com/.well-known/openid-configuration');
      return new Response(
        JSON.stringify({
          issuer: 'https://pesu-oauth2.onrender.com',
          authorization_endpoint: 'https://pesu-oauth2.onrender.com/oauth2/authorize',
          token_endpoint: 'https://pesu-oauth2.onrender.com/oauth2/token',
          userinfo_endpoint: 'https://pesu-oauth2.onrender.com/api/v1/userinfo',
          jwks_uri: 'https://pesu-oauth2.onrender.com/jwks.json',
          revocation_endpoint: 'https://pesu-oauth2.onrender.com/oauth2/revoke',
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          scopes_supported: ['openid', 'profile', 'email', 'phone', 'offline_access'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    },
  });

  const res = await fetch(`${baseUrl}/api/pesu-oauth/discovery`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.oidcDiscoveryAvailable, true);
  assert.equal(data.requestedUrl, 'https://pesu-oauth2.onrender.com/.well-known/openid-configuration');
  assert.equal(data.httpStatus, 200);
  assert.equal(data.contentType, 'application/json; charset=utf-8');
  assert.equal(data.issuer, 'https://pesu-oauth2.onrender.com');
  assert.equal(data.authorizationEndpoint, 'https://pesu-oauth2.onrender.com/oauth2/authorize');
  assert.equal(data.tokenEndpoint, 'https://pesu-oauth2.onrender.com/oauth2/token');
  assert.equal(data.userinfoEndpoint, 'https://pesu-oauth2.onrender.com/api/v1/userinfo');
  assert.equal(data.jwksUri, 'https://pesu-oauth2.onrender.com/jwks.json');
  assert.equal(data.stages.providerDiscovery, 'ok');
  assert.deepEqual(data.supportedScopes, ['openid', 'profile', 'email', 'phone', 'offline_access']);
});

test('15. PESU OIDC discovery gracefully handles unexpected HTML response without throwing JSON parse error', async () => {
  process.env.PESU_OAUTH_ISSUER_URL = 'https://pesu-oauth2.onrender.com';
  setServerTestOverrides({
    fetchFn: async () => {
      return new Response(
        '<!doctype html><html lang="en"><head><title>Quackathon SPA Fallback</title></head><body><div id="root"></div></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    },
  });

  const res = await fetch(`${baseUrl}/api/pesu-oauth/discovery`);
  const data = await res.json();
  assert.equal(res.status, 502);
  assert.equal(data.ok, false);
  assert.equal(data.oidcDiscoveryAvailable, false);
  assert.equal(data.errorCategory, 'INVALID_DISCOVERY_HTML');
  assert.equal(data.stages.providerDiscovery, 'invalid_response');
  assert.equal(data.httpStatus, 200);
  assert.equal(data.contentType, 'text/html; charset=utf-8');
  assert.equal(data.authorizationEndpoint, null);
  assert.equal(data.tokenEndpoint, null);
  assert.ok(data.diagnosticSnippet.includes('<!doctype html>'));
  assert.ok(!data.note.includes('Unexpected token'));
});

test('16. PESU OIDC discovery detects and normalizes PESU_OAUTH_ISSUER_URL misconfigured as callback URL', async () => {
  process.env.PESU_OAUTH_ISSUER_URL = `${baseUrl}/auth/pesu/callback`;
  let capturedDiscoveryUrl = '';

  setServerTestOverrides({
    fetchFn: async (input) => {
      capturedDiscoveryUrl = String(input);
      return new Response(
        JSON.stringify({
          issuer: 'https://pesu-oauth2.onrender.com',
          authorization_endpoint: 'https://pesu-oauth2.onrender.com/oauth2/authorize',
          token_endpoint: 'https://pesu-oauth2.onrender.com/oauth2/token',
          userinfo_endpoint: 'https://pesu-oauth2.onrender.com/api/v1/userinfo',
          scopes_supported: ['openid', 'profile', 'email'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });

  const res = await fetch(`${baseUrl}/api/pesu-oauth/discovery`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(capturedDiscoveryUrl, 'https://pesu-oauth2.onrender.com/.well-known/openid-configuration');
  assert.equal(data.ok, true);
  assert.equal(data.oidcDiscoveryAvailable, true);
  assert.equal(data.issuer, 'https://pesu-oauth2.onrender.com');
  assert.ok(data.configWarning.includes('PESU_OAUTH_ISSUER_URL'));
  assert.deepEqual(data.allowedRedirectUris, [`${baseUrl}/auth/pesu/callback`]);
  process.env.PESU_OAUTH_ISSUER_URL = 'https://pesu-oauth2.onrender.com';
});

test('17. PESU OIDC discovery rejects incomplete OIDC JSON metadata and /api catch-all returns JSON 404', async () => {
  process.env.PESU_OAUTH_ISSUER_URL = 'https://pesu-oauth2.onrender.com';
  setServerTestOverrides({
    fetchFn: async () => {
      return new Response(
        JSON.stringify({
          issuer: 'https://pesu-oauth2.onrender.com',
          // missing authorization_endpoint and token_endpoint
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });

  const res = await fetch(`${baseUrl}/api/pesu-oauth/discovery`);
  const data = await res.json();
  assert.equal(res.status, 502);
  assert.equal(data.ok, false);
  assert.equal(data.oidcDiscoveryAvailable, false);
  assert.equal(data.errorCategory, 'INVALID_DISCOVERY_METADATA');
  assert.equal(data.stages.providerDiscovery, 'invalid_response');

  // Verify unknown /api/* route returns JSON 404, never HTML
  const unknownApiRes = await fetch(`${baseUrl}/api/non-existent-endpoint`);
  const unknownApiData = await unknownApiRes.json();
  assert.equal(unknownApiRes.status, 404);
  assert.equal(unknownApiData.ok, false);
});

test('18. GET /api/health returns 200 JSON and /api/bootstrap contains zero synthetic SEED_* records', async () => {
  const healthRes = await fetch(`${baseUrl}/api/health`);
  const contentType = healthRes.headers.get('content-type') ?? '';
  assert.equal(healthRes.status, 200);
  assert.ok(contentType.includes('application/json'));
  const healthData = await healthRes.json();
  assert.equal(healthData.ok, true);
  assert.equal(healthData.status, 'healthy');

  const bootRes = await fetch(`${baseUrl}/api/bootstrap`);
  assert.equal(bootRes.status, 200);
  const bootData = await bootRes.json();
  assert.equal(bootData.ok, true);
  // Ensure no synthetic seed IDs exist in the live PostgreSQL database
  assert.ok(!bootData.users.some((u: { uid: string }) => u.uid === 'u_solo_arjun'));
  assert.ok(!bootData.hackathons.some((h: { id: string }) => h.id === 'hack_terrapthon_26'));
});

test('19. Deterministic GitHub enrichment requires 0 Gemini calls and starts all skills/projects with approved = false', async () => {
  const { buildDeterministicGitHubDraft } = await import('../src/services/adapters.ts');
  const draft = buildDeterministicGitHubDraft({
    uid: 'pesu_pesu_student_007',
    githubUsername: 'Roshan2607',
    ghJson: {
      ok: true,
      live: true,
      repositories: [
        {
          name: 'Quackathon',
          url: 'https://github.com/Roshan2607/Quackathon',
          description: 'PES University Hackathon Team Finder',
          language: 'TypeScript',
          topics: ['react', 'postgresql'],
          stars: 0,
          updatedAt: '2026-11-13T00:00:00Z',
        },
      ],
    },
  });

  assert.equal(draft.isLiveApiResult, true);
  assert.ok(draft.suggestedSkills.length >= 2);
  assert.ok(draft.suggestedSkills.every((s) => s.approved === false));
  assert.ok(draft.suggestedProjects && draft.suggestedProjects.length === 1);
  assert.equal(draft.suggestedProjects![0].approved, false);
  assert.equal(draft.suggestedProject?.approved, false);
});

test('20. Event URL extraction does not fabricate missing team size or misclassify workshops as hackathons', async () => {
  setServerTestOverrides({
    fetchFn: async () => {
      const html = `<!doctype html><html><head><title>Intro to Rust Programming Seminar</title><meta name="description" content="A 2-hour seminar on Rust ownership and borrowing." /></head><body><h1>Intro to Rust Programming Seminar</h1><p>Organizer: PES Open Source Society</p></body></html>`;
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    },
  });

  const res = await fetch(`${baseUrl}/api/events/extract-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://events.pes.edu/rust-seminar',
      useGeminiFallback: false,
    }),
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.data.minTeamSize, null);
  assert.equal(data.data.maxTeamSize, null);
  assert.notEqual(data.data.eventType, 'hackathon');
});

test('21. Multi-user PostgreSQL persistence: PESU session restoration, profile update, event publishing, team creation, join request, and mutual matching + messaging', async () => {
  const { upsertUserAndProfile, createOAuthSessionRecord } = await import(
    '../src/db/repository.ts'
  );

  // Create 3 real users in PostgreSQL (Admin/User A, User B, User C)
  const uidA = `pesu_test_a_${Date.now()}`;
  const uidB = `pesu_test_b_${Date.now()}`;
  const uidC = `pesu_test_c_${Date.now()}`;

  await upsertUserAndProfile({
    uid: uidA,
    email: 'alice@pesu.pes.edu',
    displayName: 'Alice PES',
    pesuOidcSub: 'PES1UG23CS101',
    isAdmin: true,
  });
  await upsertUserAndProfile({
    uid: uidB,
    email: 'bob@pesu.pes.edu',
    displayName: 'Bob PES',
    pesuOidcSub: 'PES1UG23CS102',
    isAdmin: false,
  });
  await upsertUserAndProfile({
    uid: uidC,
    email: 'charlie@pesu.pes.edu',
    displayName: 'Charlie PES',
    pesuOidcSub: 'PES1UG23CS103',
    isAdmin: false,
  });

  const tokenA = `pesu_tok_a_${Date.now()}`;
  const tokenB = `pesu_tok_b_${Date.now()}`;
  const tokenC = `pesu_tok_c_${Date.now()}`;

  const expiresAt = new Date(Date.now() + 3600_000);
  await createOAuthSessionRecord({
    sessionToken: tokenA,
    uid: uidA,
    pesuSub: 'PES1UG23CS101',
    accessToken: 'acc_a',
    refreshToken: null,
    scopes: ['openid', 'profile', 'email'],
    expiresAt,
  });
  await createOAuthSessionRecord({
    sessionToken: tokenB,
    uid: uidB,
    pesuSub: 'PES1UG23CS102',
    accessToken: 'acc_b',
    refreshToken: null,
    scopes: ['openid', 'profile', 'email'],
    expiresAt,
  });
  await createOAuthSessionRecord({
    sessionToken: tokenC,
    uid: uidC,
    pesuSub: 'PES1UG23CS103',
    accessToken: 'acc_c',
    refreshToken: null,
    scopes: ['openid', 'profile', 'email'],
    expiresAt,
  });

  // 1. Verify /api/auth/session restores User A
  const sessRes = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const sessData = await sessRes.json();
  assert.equal(sessData.authenticated, true);
  assert.equal(sessData.user.uid, uidA);

  // 2. Update User A profile via PUT /api/profile
  const profRes = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      profile: {
        headline: 'Distributed Systems & Rust Builder',
        skillTags: ['Rust', 'TypeScript', 'PostgreSQL'],
        preferredRoles: ['Backend / APIs'],
      },
    }),
  });
  const profData = await profRes.json();
  assert.equal(profRes.status, 200);
  assert.equal(profData.profile.headline, 'Distributed Systems & Rust Builder');

  // 3. Submit an event candidate & approve it as Admin User A (maxTeamSize = 2)
  const candRes = await fetch(`${baseUrl}/api/hackathons/candidates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({
      source: 'submitted_public_url',
      sourceUrl: 'https://events.pes.edu/real-hack-2026',
      originalSubmissionUrl: 'https://events.pes.edu/real-hack-2026',
      verifiedCanonicalUrl: 'https://events.pes.edu/real-hack-2026',
      sourceUrlStatus: 'verified',
      externalFingerprint: `pes__real_hack_2026__${Date.now()}`,
      title: 'PES Real Systems Hackathon 2026',
      organizer: 'PES Innovation Lab',
      eventType: 'hackathon',
      matchable: true,
      themes: ['Systems & Cloud'],
      description: '24-hour systems hackathon.',
      startAt: '2026-12-20',
      endAt: '2026-12-21',
      registrationDeadline: '2026-12-18',
      timezone: 'Asia/Kolkata',
      venue: { campus: 'RR Campus', name: 'MRD Auditorium' },
      format: 'onsite',
      teamSize: { min: 1, max: 2 },
      registrationUrl: 'https://events.pes.edu/real-hack-2026',
      eligibilityNotes: 'Verified PES students',
      fieldEvidence: {},
      classification: {
        ruleGatePassed: true,
        mlScore: 1,
        reason: 'Verified hackathon',
      },
      warnings: [],
    }),
  });
  const candData = await candRes.json();
  assert.equal(candRes.status, 201);
  const candidateUid = candData.candidate.id;

  // Non-admin User B cannot approve candidate
  const unauthApprove = await fetch(
    `${baseUrl}/api/admin/candidates/${candidateUid}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({}),
    }
  );
  assert.equal(unauthApprove.status, 403);

  // Admin User A approves candidate -> publishes Hackathon with maxTeamSize = 2
  const approveRes = await fetch(
    `${baseUrl}/api/admin/candidates/${candidateUid}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        minTeamSize: 1,
        maxTeamSize: 2,
        eventType: 'hackathon',
        matchable: true,
        campus: 'RR Campus',
      }),
    }
  );
  const approveData = await approveRes.json();
  assert.equal(approveRes.status, 200);
  const hackathonSlug = approveData.hackathon.id;

  // 4. Mutual Tinder swipe between User A and User B creates a direct_match conversation
  const swipe1 = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      hackathonId: hackathonSlug,
      targetType: 'user',
      targetId: uidB,
      decision: 'interested',
    }),
  });
  const swipe1Data = await swipe1.json();
  assert.equal(swipe1.status, 200);
  assert.equal(swipe1Data.matchedConversation, undefined);

  const swipe2 = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({
      hackathonId: hackathonSlug,
      targetType: 'user',
      targetId: uidA,
      decision: 'interested',
      customNote: 'Hey Alice, let us build together!',
    }),
  });
  const swipe2Data = await swipe2.json();
  assert.equal(swipe2.status, 200);
  assert.ok(swipe2Data.matchedConversation);
  const matchConvId = swipe2Data.matchedConversation.id;

  // 5. Messaging in matched conversation succeeds for participant and returns 403 for non-participant User C
  const msgRes = await fetch(
    `${baseUrl}/api/conversations/${matchConvId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ body: 'Awesome, let us create a team!' }),
    }
  );
  assert.equal(msgRes.status, 201);

  const forbiddenMsgRes = await fetch(
    `${baseUrl}/api/conversations/${matchConvId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenC}`,
      },
      body: JSON.stringify({ body: 'Intruder message' }),
    }
  );
  assert.equal(forbiddenMsgRes.status, 403);

  // 6. User A creates a team (targetSize 2), User B and User C apply, User A accepts User B -> team becomes full (2/2) and User C's request auto-expires
  const teamRes = await fetch(`${baseUrl}/api/teams`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      hackathonId: hackathonSlug,
      name: 'KernelBuilders',
      pitch: 'Building a zero-copy telemetry engine',
      rolesNeeded: ['Backend / APIs'],
      targetSize: 2,
    }),
  });
  const teamData = await teamRes.json();
  assert.equal(teamRes.status, 201);
  const teamId = teamData.team.id;

  // Duplicate team creation by User A in same hackathon is rejected with 409
  const dupTeamRes = await fetch(`${baseUrl}/api/teams`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      hackathonId: hackathonSlug,
      name: 'SecondTeam',
      pitch: 'Should fail',
      rolesNeeded: ['Backend / APIs'],
      targetSize: 2,
    }),
  });
  assert.equal(dupTeamRes.status, 409);

  // User B and User C swipe right on teamId -> creates join requests
  const reqBRes = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({
      hackathonId: hackathonSlug,
      targetType: 'team',
      targetId: teamId,
      decision: 'interested',
      proposedRole: 'Backend / APIs',
    }),
  });
  const reqBData = await reqBRes.json();
  const reqBId = reqBData.createdJoinRequest.id;

  const reqCRes = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenC}`,
    },
    body: JSON.stringify({
      hackathonId: hackathonSlug,
      targetType: 'team',
      targetId: teamId,
      decision: 'interested',
      proposedRole: 'Frontend / UI',
    }),
  });
  const reqCData = await reqCRes.json();
  const reqCId = reqCData.createdJoinRequest.id;

  // Leader User A accepts User B -> team reaches capacity (2/2)
  const acceptB = await fetch(
    `${baseUrl}/api/join-requests/${reqBId}/resolve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ decision: 'accept' }),
    }
  );
  const acceptBData = await acceptB.json();
  assert.equal(acceptB.status, 200);
  assert.equal(acceptBData.becomesFull, true);
  assert.equal(acceptBData.newMemberCount, 2);

  // Attempting to accept User C now fails because team is full / request auto-expired
  const acceptC = await fetch(
    `${baseUrl}/api/join-requests/${reqCId}/resolve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ decision: 'accept' }),
    }
  );
  assert.equal(acceptC.status, 404);

  // Clean up test records from PostgreSQL so live state stays pristine
  const { db } = await import('../src/db/index.ts');
  const {
    users,
    profiles,
    oauthSessions,
    hackathons,
    eventCandidates,
    teams,
    memberships,
    swipes,
    joinRequests,
    conversations,
    messages,
  } = await import('../src/db/schema.ts');
  const { eq, inArray } = await import('drizzle-orm');

  await db.delete(messages).where(eq(messages.conversationUid, matchConvId));
  await db.delete(conversations).where(eq(conversations.hackathonSlug, hackathonSlug));
  await db.delete(joinRequests).where(eq(joinRequests.hackathonSlug, hackathonSlug));
  await db.delete(swipes).where(eq(swipes.hackathonSlug, hackathonSlug));
  await db.delete(memberships).where(eq(memberships.hackathonSlug, hackathonSlug));
  await db.delete(teams).where(eq(teams.hackathonSlug, hackathonSlug));
  await db.delete(hackathons).where(eq(hackathons.slug, hackathonSlug));
  await db.delete(eventCandidates).where(eq(eventCandidates.candidateUid, candidateUid));
  await db.delete(oauthSessions).where(inArray(oauthSessions.uid, [uidA, uidB, uidC]));
  await db.delete(profiles).where(inArray(profiles.uid, [uidA, uidB, uidC]));
  await db.delete(users).where(inArray(users.uid, [uidA, uidB, uidC]));
});

test('22. Profile detail fields (domains, topics to explore, goals, portfolio links) persist in PostgreSQL', async () => {
  const {
    upsertUserAndProfile,
    createOAuthSessionRecord,
    getUserAndProfileByUid,
  } = await import('../src/db/repository.ts');
  const { db } = await import('../src/db/index.ts');
  const { users, profiles, oauthSessions } = await import('../src/db/schema.ts');
  const { eq, inArray } = await import('drizzle-orm');

  const uid = `pesu_test_profile_${Date.now()}`;
  const token = `pesu_tok_profile_${Date.now()}`;

  const { profile: createdProfile } = await upsertUserAndProfile({
    uid,
    email: 'profile@pesu.pes.edu',
    displayName: 'Profile Person',
    pesuOidcSub: 'PES1UG23CS900',
  });

  // New accounts start from the interest-based defaults.
  assert.deepEqual(createdProfile.projectDomains, [
    'Applied AI/ML',
    'Developer Tools',
  ]);
  assert.deepEqual(createdProfile.topicsToExplore, []);
  assert.deepEqual(createdProfile.hackathonGoals, []);
  assert.deepEqual(createdProfile.portfolioLinks, []);

  await createOAuthSessionRecord({
    sessionToken: token,
    uid,
    pesuSub: 'PES1UG23CS900',
    accessToken: null,
    refreshToken: null,
    scopes: ['openid', 'profile'],
    expiresAt: new Date(Date.now() + 3600_000),
  });

  const updated = {
    ...createdProfile,
    projectDomains: ['Transit telemetry', 'Edge vision'],
    topicsToExplore: ['Rust', 'LLM evaluation'],
    hackathonGoals: ['Ship a usable app'],
    portfolioLinks: [
      { label: 'GitHub', url: 'https://github.com/example' },
      { label: 'Portfolio', url: 'https://example.dev' },
    ],
  };

  const putRes = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ profile: updated }),
  });
  assert.equal(putRes.status, 200);
  const putData = await putRes.json();
  assert.deepEqual(putData.profile.projectDomains, [
    'Transit telemetry',
    'Edge vision',
  ]);
  assert.deepEqual(putData.profile.topicsToExplore, ['Rust', 'LLM evaluation']);
  assert.deepEqual(putData.profile.hackathonGoals, ['Ship a usable app']);
  assert.equal(putData.profile.portfolioLinks.length, 2);

  // Read back from PostgreSQL (not from the HTTP response).
  const stored = await getUserAndProfileByUid(uid);
  assert.deepEqual(stored?.profile.projectDomains, [
    'Transit telemetry',
    'Edge vision',
  ]);
  assert.deepEqual(stored?.profile.topicsToExplore, ['Rust', 'LLM evaluation']);
  assert.deepEqual(stored?.profile.hackathonGoals, ['Ship a usable app']);
  assert.deepEqual(stored?.profile.portfolioLinks, [
    { label: 'GitHub', url: 'https://github.com/example' },
    { label: 'Portfolio', url: 'https://example.dev' },
  ]);

  // A client that omits the new fields must not wipe the stored values.
  const partialRes = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      profile: (() => {
        // Omit the detail fields entirely (not just send defaults) so this
        // really exercises "client that does not know the new fields".
        const {
          projectDomains: _pd,
          topicsToExplore: _te,
          hackathonGoals: _hg,
          portfolioLinks: _pl,
          ...withoutDetailFields
        } = createdProfile;
        return { ...withoutDetailFields, headline: 'Updated headline only' };
      })(),
    }),
  });
  assert.equal(partialRes.status, 200);
  const afterPartial = await getUserAndProfileByUid(uid);
  assert.equal(afterPartial?.profile.headline, 'Updated headline only');
  assert.deepEqual(afterPartial?.profile.projectDomains, [
    'Transit telemetry',
    'Edge vision',
  ]);
  assert.deepEqual(afterPartial?.profile.hackathonGoals, [
    'Ship a usable app',
  ]);

  await db.delete(oauthSessions).where(inArray(oauthSessions.uid, [uid]));
  await db.delete(profiles).where(inArray(profiles.uid, [uid]));
  await db.delete(users).where(inArray(users.uid, [uid]));
});

test('23. Concurrent team accepts cannot exceed the maximum team size', async () => {
  const {
    upsertUserAndProfile,
    createOAuthSessionRecord,
    createPublishedHackathonDirect,
  } = await import('../src/db/repository.ts');
  const { db } = await import('../src/db/index.ts');
  const {
    users,
    profiles,
    oauthSessions,
    hackathons,
    teams,
    memberships,
    swipes,
    joinRequests,
    conversations,
    messages,
  } = await import('../src/db/schema.ts');
  const { eq, inArray } = await import('drizzle-orm');

  const stamp = Date.now();
  const uidLeader = `pesu_conc_leader_${stamp}`;
  const uidB = `pesu_conc_b_${stamp}`;
  const uidC = `pesu_conc_c_${stamp}`;
  const uids = [uidLeader, uidB, uidC];

  const createUser = async (uid: string, name: string, sub: string) => {
    await upsertUserAndProfile({
      uid,
      email: `${uid}@pesu.pes.edu`,
      displayName: name,
      pesuOidcSub: sub,
      isAdmin: false,
    });
    const token = `pesu_tok_${uid}_${stamp}`;
    await createOAuthSessionRecord({
      sessionToken: token,
      uid,
      pesuSub: sub,
      accessToken: null,
      refreshToken: null,
      scopes: ['openid'],
      expiresAt: new Date(Date.now() + 3600_000),
    });
    return token;
  };

  const tokenLeader = await createUser(uidLeader, 'Leader PES', 'PES1UG23CS200');
  const tokenB = await createUser(uidB, 'Racer One', 'PES1UG23CS201');
  const tokenC = await createUser(uidC, 'Racer Two', 'PES1UG23CS202');

  const hackathon = await createPublishedHackathonDirect({
    name: 'Concurrency Systems Hackathon',
    organizer: 'PES Innovation Lab',
    description: 'Capacity enforcement test event.',
    eventType: 'hackathon',
    matchable: true,
    themes: ['Systems/Cloud'],
    campus: 'RR Campus',
    venueName: null,
    format: 'onsite',
    startAt: '2026-12-20',
    endAt: '2026-12-21',
    registrationDeadline: null,
    minTeamSize: 2,
    maxTeamSize: 2,
    registrationUrl: null,
    verifiedCanonicalUrl: null,
    sourceUrlStatus: 'verified',
    createdByUid: uidLeader,
  });

  // Leader opens a team with exactly one free slot.
  const teamRes = await fetch(`${baseUrl}/api/teams`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenLeader}`,
    },
    body: JSON.stringify({
      hackathonId: hackathon.id,
      name: 'CapacityTestTeam',
      pitch: 'Verifying that a full team stays full.',
      rolesNeeded: ['Backend / APIs'],
      targetSize: 2,
    }),
  });
  assert.equal(teamRes.status, 201);
  const teamData = await teamRes.json();
  const teamId = teamData.team.id;

  // Two students apply for the single remaining slot.
  const apply = async (token: string) => {
    const res = await fetch(`${baseUrl}/api/swipes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        hackathonId: hackathon.id,
        targetType: 'team',
        targetId: teamId,
        decision: 'interested',
        proposedRole: 'Backend / APIs',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    return data.createdJoinRequest.id as string;
  };

  const requestB = await apply(tokenB);
  const requestC = await apply(tokenC);

  // Both leaders accept at the same time.
  const resolve = async (requestUid: string) => {
    const res = await fetch(
      `${baseUrl}/api/join-requests/${encodeURIComponent(requestUid)}/resolve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenLeader}`,
        },
        body: JSON.stringify({ decision: 'accept' }),
      }
    );
    return res.status;
  };

  const [statusB, statusC] = await Promise.all([
    resolve(requestB),
    resolve(requestC),
  ]);

  const statuses = [statusB, statusC].sort();
  assert.equal(statuses[0], 200, 'exactly one accept must succeed');
  assert.ok(
    statuses[1] === 409 || statuses[1] === 404,
    `the second accept must be rejected, got HTTP ${statuses[1]}`
  );

  // The team must never exceed its capacity.
  const teamRows = await db
    .select()
    .from(teams)
    .where(eq(teams.teamSlug, teamId));
  assert.equal(teamRows[0].memberCount, 2);
  assert.equal(teamRows[0].status, 'full');

  const membershipRows = await db
    .select()
    .from(memberships)
    .where(eq(memberships.teamSlug, teamId));
  assert.equal(membershipRows.length, 2);

  // Cleanup
  await db.delete(messages).where(
    eq(messages.conversationUid, `team_roster_${teamId}`)
  );
  await db.delete(conversations).where(
    eq(conversations.hackathonSlug, hackathon.id)
  );
  await db.delete(joinRequests).where(eq(joinRequests.hackathonSlug, hackathon.id));
  await db.delete(swipes).where(eq(swipes.hackathonSlug, hackathon.id));
  await db.delete(memberships).where(eq(memberships.teamSlug, teamId));
  await db.delete(teams).where(eq(teams.hackathonSlug, hackathon.id));
  await db.delete(hackathons).where(eq(hackathons.slug, hackathon.id));
  await db.delete(oauthSessions).where(inArray(oauthSessions.uid, uids));
  await db.delete(profiles).where(inArray(profiles.uid, uids));
  await db.delete(users).where(inArray(users.uid, uids));
});

test('24. OAuth state persists in PostgreSQL across server restarts / multi-instance callbacks, enforces single-use replay & expiry protection, and never leaks tokens in postMessage', async () => {
  const { clearInMemoryOAuthStoresForTest } = await import('../server.ts');
  const { createOAuthTransactionRecord } = await import('../src/db/repository.ts');
  const { db } = await import('../src/db/index.ts');
  const { users, profiles, oauthSessions, oauthTransactions } = await import(
    '../src/db/schema.ts'
  );
  const { eq } = await import('drizzle-orm');

  process.env.PESU_OAUTH_CLIENT_ID = 'test_pesu_client_multi';
  process.env.PESU_OAUTH_CLIENT_SECRET = 'secret_multi_instance_key';
  process.env.PESU_OAUTH_ISSUER_URL = 'https://oauth.pesu.mock';

  setServerTestOverrides({
    fetchFn: async (input) => {
      const url = String(input);
      if (url.includes('/.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: 'https://oauth.pesu.mock',
            authorization_endpoint: 'https://oauth.pesu.mock/authorize',
            token_endpoint: 'https://oauth.pesu.mock/token',
            userinfo_endpoint: 'https://oauth.pesu.mock/userinfo',
            scopes_supported: ['openid', 'profile', 'email'],
            code_challenge_methods_supported: ['S256'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === 'https://oauth.pesu.mock/token') {
        const idToken = createBase64UrlJwt({
          iss: 'https://oauth.pesu.mock',
          aud: 'test_pesu_client_multi',
          sub: 'pesu_multi_inst_user',
          name: 'Multi Instance Student',
          email: 'multi@pesu.pes.edu',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        return new Response(
          JSON.stringify({
            access_token: 'provider_access_token_never_leak',
            refresh_token: 'provider_refresh_token_never_leak',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid profile email',
            id_token: idToken,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === 'https://oauth.pesu.mock/userinfo') {
        return new Response(
          JSON.stringify({
            sub: 'pesu_multi_inst_user',
            name: 'Multi Instance Student',
            email: 'multi@pesu.pes.edu',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not found', { status: 404 });
    },
  });

  // 1. Start OAuth flow on Instance 1
  const urlRes = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email`);
  const setCookieHeader = urlRes.headers.get('set-cookie') ?? '';
  const sidCookie = setCookieHeader.split(';')[0];
  const urlData = await urlRes.json();
  assert.equal(urlRes.status, 200);
  assert.ok(urlData.state);

  // 2. Simulate server restart / callback arriving on Instance 2 with empty in-memory maps
  clearInMemoryOAuthStoresForTest();

  // 3. Callback still succeeds because transaction is stored in PostgreSQL and session cookie matches
  const cbRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=auth_code_multi_1&state=${encodeURIComponent(
      urlData.state
    )}`,
    { headers: { Cookie: sidCookie } }
  );
  const cbHtml = await cbRes.text();
  assert.equal(cbRes.status, 200);
  assert.ok(cbHtml.includes('"status":"success"'));
  assert.ok(cbHtml.includes('"ok":true'));
  assert.ok(!cbHtml.includes('sessionToken'), 'Bearer sessionToken must never be sent via postMessage');
  assert.ok(!cbHtml.includes('provider_access_token_never_leak'));
  assert.ok(!cbHtml.includes('provider_refresh_token_never_leak'));

  // 4. Verify initiating window with only quackathon_sid cookie restores authenticated session from PostgreSQL
  clearInMemoryOAuthStoresForTest();
  const authSessRes = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: sidCookie },
  });
  const authSessData = await authSessRes.json();
  assert.equal(authSessData.authenticated, true);
  assert.equal(authSessData.user.uid, 'pesu_pesu_multi_inst_user');
  assert.equal(authSessData.sessionToken, undefined);

  // 5. Replaying the same state parameter a second time is rejected (one-time consumption)
  const replayRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=auth_code_multi_1&state=${encodeURIComponent(
      urlData.state
    )}`
  );
  const replayHtml = await replayRes.text();
  assert.equal(replayRes.status, 400);
  assert.ok(replayHtml.includes('OAUTH_STATE_INVALID'));
  assert.ok(replayHtml.includes('"status":"error"'));

  // 6. Expired state parameter in PostgreSQL is rejected with 400 OAUTH_STATE_INVALID
  const expiredState = `expired_state_${Date.now()}`;
  await createOAuthTransactionRecord({
    state: expiredState,
    sessionId: 'sess_expired_test',
    codeVerifier: 'verifier_expired_test_1234567890',
    redirectUri: `${baseUrl}/auth/pesu/callback`,
    clientOrigin: baseUrl,
    scopes: ['openid', 'profile'],
    issuer: 'https://oauth.pesu.mock',
    authorizationEndpoint: 'https://oauth.pesu.mock/authorize',
    tokenEndpoint: 'https://oauth.pesu.mock/token',
    userinfoEndpoint: null,
    expiresAt: new Date(Date.now() - 60_000), // Already expired 1 minute ago
  });

  const expRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=some_code&state=${encodeURIComponent(expiredState)}`
  );
  const expHtml = await expRes.text();
  assert.equal(expRes.status, 400);
  assert.ok(expHtml.includes('OAUTH_STATE_INVALID'));

  // Cleanup
  await db
    .delete(oauthSessions)
    .where(eq(oauthSessions.uid, 'pesu_pesu_multi_inst_user'));
  await db.delete(profiles).where(eq(profiles.uid, 'pesu_pesu_multi_inst_user'));
  await db.delete(users).where(eq(users.uid, 'pesu_pesu_multi_inst_user'));
  await db.delete(oauthTransactions);
});

test('25. GitHub fetch paginates across multiple pages (> 100 repos), excludes forks by default, supports includeForks, and makes 0 upfront README calls', async () => {
  let readmeCalls = 0;
  const pageUrlsRequested: string[] = [];

  // Create 100 repos on page 1 (95 original, 5 forks) and 35 repos on page 2 (30 original, 5 forks) = 135 total
  const page1Repos = Array.from({ length: 100 }, (_, i) => ({
    name: `repo-p1-${i + 1}`,
    html_url: `https://github.com/manyrepos/repo-p1-${i + 1}`,
    description: `Description for repo p1 ${i + 1}`,
    language: i % 2 === 0 ? 'TypeScript' : 'Python',
    topics: ['hackathon', 'pesu'],
    stargazers_count: i,
    fork: i >= 95, // 5 forks on page 1
    updated_at: '2026-11-14T00:00:00Z',
  }));

  const page2Repos = Array.from({ length: 35 }, (_, i) => ({
    name: `repo-p2-${i + 1}`,
    html_url: `https://github.com/manyrepos/repo-p2-${i + 1}`,
    description: `Description for repo p2 ${i + 1}`,
    language: 'Rust',
    topics: ['systems'],
    stargazers_count: 10,
    fork: i >= 30, // 5 forks on page 2
    updated_at: '2026-11-14T00:00:00Z',
  }));

  setServerTestOverrides({
    fetchFn: async (input) => {
      const url = String(input);
      if (url.includes('/readme')) {
        readmeCalls++;
        return new Response('Should not be called', { status: 500 });
      }
      if (url === 'https://api.github.com/users/manyrepos') {
        return new Response(
          JSON.stringify({
            login: 'manyrepos',
            name: 'Many Repos Builder',
            bio: 'I have 135 public repositories',
            public_repos: 135,
            html_url: 'https://github.com/manyrepos',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/users/manyrepos/repos')) {
        pageUrlsRequested.push(url);
        const parsed = new URL(url);
        const pageParam = parsed.searchParams.get('page');
        if (pageParam === '1') {
          return new Response(JSON.stringify(page1Repos), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              Link: '<https://api.github.com/user/1/repos?page=2>; rel="next"',
            },
          });
        }
        if (pageParam === '2') {
          return new Response(JSON.stringify(page2Repos), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return new Response('Not found', { status: 404 });
    },
  });

  // 1. Default fetch (includeForks = false): returns 125 original repos + allRepositories (135)
  const resDefault = await fetch(`${baseUrl}/api/github/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'manyrepos' }),
  });
  const dataDefault = await resDefault.json();
  assert.equal(resDefault.status, 200);
  assert.equal(dataDefault.ok, true);
  assert.equal(readmeCalls, 0, 'Must make 0 upfront README calls during repository listing');
  assert.equal(pageUrlsRequested.length, 2, 'Must paginate across both pages');
  assert.equal(dataDefault.totalFetchedCount, 135);
  assert.equal(dataDefault.originalCount, 125);
  assert.equal(dataDefault.forkCount, 10);
  assert.equal(dataDefault.repositories.length, 125);
  assert.equal(dataDefault.allRepositories.length, 135);
  assert.ok(dataDefault.repositories.every((r: { fork: boolean }) => !r.fork));

  // 2. Fetch with includeForks = true: returns all 135 repos in repositories
  const resWithForks = await fetch(`${baseUrl}/api/github/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'manyrepos', includeForks: true }),
  });
  const dataWithForks = await resWithForks.json();
  assert.equal(resWithForks.status, 200);
  assert.equal(dataWithForks.repositories.length, 135);
});

test('26. Gemini profile extraction accepts selectedRepositories subset and returns polished summaries + suggestedBio', async () => {
  process.env.GEMINI_API_KEY = 'mock_gemini_key_for_test';
  let capturedPrompt = '';

  setServerTestOverrides({
    geminiGenerateFn: async ({ contents }) => {
      capturedPrompt = String(contents);
      return {
        text: JSON.stringify({
          suggestedSkills: [
            {
              name: 'TypeScript',
              category: 'frontend',
              confidence: 'high',
              reason: 'Used in Quackathon',
            },
          ],
          projectSummaries: [
            {
              title: 'Quackathon',
              description:
                'Full-stack hackathon team finder built with React, Express, and PostgreSQL.',
              sourceUrl: 'https://github.com/Roshan2607/Quackathon',
              tags: ['TypeScript', 'PostgreSQL'],
            },
          ],
          suggestedBio:
            'Full-stack builder focused on TypeScript and PostgreSQL systems.',
          icebreaker: 'Want to pair on the API layer or frontend UX?',
          warnings: [],
        }),
      };
    },
  });

  const res = await fetch(`${baseUrl}/api/gemini/extract-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selectedRepositories: [
        {
          name: 'Quackathon',
          url: 'https://github.com/Roshan2607/Quackathon',
          description: 'Hackathon team finder',
          language: 'TypeScript',
          topics: ['react', 'postgresql'],
        },
      ],
    }),
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.ok(capturedPrompt.includes('selectedRepositories'));
  assert.equal(data.data.projectSummaries.length, 1);
  assert.equal(data.data.projectSummaries[0].title, 'Quackathon');
  assert.ok(data.data.suggestedBio.includes('TypeScript'));
});

test('27. OAuth transaction lifecycle: pending -> processing -> completed/failed/expired, concurrent duplicate callbacks, same-session idempotency, session mismatch guard, and failed token exchange non-reuse', async () => {
  const { clearInMemoryOAuthStoresForTest } = await import('../server.ts');
  const { db } = await import('../src/db/index.ts');
  const { users, profiles, oauthSessions, oauthTransactions } = await import(
    '../src/db/schema.ts'
  );
  const { eq } = await import('drizzle-orm');

  process.env.PESU_OAUTH_CLIENT_ID = 'test_pesu_lifecycle_client';
  process.env.PESU_OAUTH_CLIENT_SECRET = 'secret_lifecycle_key';
  process.env.PESU_OAUTH_ISSUER_URL = 'https://oauth.pesu.mock';

  let tokenExchangeCallCount = 0;
  let shouldFailTokenExchange = false;

  setServerTestOverrides({
    fetchFn: async (input) => {
      const url = String(input);
      if (url.includes('/.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: 'https://oauth.pesu.mock',
            authorization_endpoint: 'https://oauth.pesu.mock/authorize',
            token_endpoint: 'https://oauth.pesu.mock/token',
            userinfo_endpoint: 'https://oauth.pesu.mock/userinfo',
            scopes_supported: ['openid', 'profile', 'email'],
            code_challenge_methods_supported: ['S256'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === 'https://oauth.pesu.mock/token') {
        tokenExchangeCallCount += 1;
        // Simulate network latency so concurrent requests overlap while status='processing'
        await new Promise((resolve) => setTimeout(resolve, 60));

        if (shouldFailTokenExchange) {
          return new Response(
            JSON.stringify({
              error: 'invalid_client',
              error_description: 'Invalid client credentials',
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const idToken = createBase64UrlJwt({
          iss: 'https://oauth.pesu.mock',
          aud: 'test_pesu_lifecycle_client',
          sub: 'pesu_lifecycle_user',
          name: 'Lifecycle Student',
          email: 'lifecycle@pesu.pes.edu',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        return new Response(
          JSON.stringify({
            access_token: 'provider_access_token_secret',
            refresh_token: 'provider_refresh_token_secret',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid profile email',
            id_token: idToken,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === 'https://oauth.pesu.mock/userinfo') {
        return new Response(
          JSON.stringify({
            sub: 'pesu_lifecycle_user',
            name: 'Lifecycle Student',
            email: 'lifecycle@pesu.pes.edu',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not found', { status: 404 });
    },
  });

  // Scenario A (1, 2, 7, 9): Fresh authorization + concurrent duplicate callbacks across instances
  const urlResA = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email`);
  const sidCookieA = (urlResA.headers.get('set-cookie') ?? '').split(';')[0];
  const urlDataA = await urlResA.json();
  assert.equal(urlResA.status, 200);
  assert.ok(urlDataA.state);
  assert.ok(sidCookieA.startsWith('quackathon_sid='));

  // Simulate another backend instance handling callbacks
  clearInMemoryOAuthStoresForTest();

  const callbackUrlA = `${baseUrl}/auth/pesu/callback?code=concurrent_code_1&state=${encodeURIComponent(
    urlDataA.state
  )}`;

  // Fire two concurrent callbacks with the exact same state & code
  const [cbRes1, cbRes2] = await Promise.all([
    fetch(callbackUrlA, { headers: { Cookie: sidCookieA } }),
    fetch(callbackUrlA, { headers: { Cookie: sidCookieA } }),
  ]);
  const [cbHtml1, cbHtml2] = await Promise.all([cbRes1.text(), cbRes2.text()]);

  assert.equal(cbRes1.status, 200, 'First concurrent callback should succeed');
  assert.equal(cbRes2.status, 200, 'Second concurrent callback should join and succeed');
  assert.equal(
    tokenExchangeCallCount,
    1,
    'Provider /token endpoint must be called exactly ONCE for concurrent callbacks'
  );
  assert.ok(cbHtml1.includes('"type":"PESU_OAUTH_RESULT"'));
  assert.ok(cbHtml1.includes('"status":"success"'));
  assert.ok(cbHtml2.includes('"status":"success"'));
  assert.ok(
    cbHtml1.includes('"duplicateCallback":true') || cbHtml2.includes('"duplicateCallback":true'),
    'One of the concurrent callbacks must be marked duplicateCallback: true'
  );
  assert.ok(cbHtml1.includes('BroadcastChannel'), 'Callback HTML should include BroadcastChannel delivery');
  assert.ok(!cbHtml1.includes('provider_access_token_secret'));

  // Scenario B (3): Callback after a successful login from the SAME authenticated session
  const sameSessionDupRes = await fetch(callbackUrlA, {
    headers: { Cookie: sidCookieA },
  });
  const sameSessionDupHtml = await sameSessionDupRes.text();
  assert.equal(
    sameSessionDupRes.status,
    200,
    'Duplicate callback from the same authenticated session should return 200 safely'
  );
  assert.ok(sameSessionDupHtml.includes('"status":"success"'));
  assert.ok(sameSessionDupHtml.includes('"duplicateCallback":true'));
  assert.ok(sameSessionDupHtml.includes('"callbackOutcome":"duplicate_completed_reused"'));
  assert.equal(
    tokenExchangeCallCount,
    1,
    'Same-session completed callback must not repeat token exchange'
  );

  // Scenario C (3): Unauthenticated replay OR replay with different code is rejected
  const unauthReplayRes = await fetch(callbackUrlA); // No session cookie
  const unauthReplayHtml = await unauthReplayRes.text();
  assert.equal(unauthReplayRes.status, 400);
  assert.ok(unauthReplayHtml.includes('OAUTH_STATE_INVALID'));

  const differentCodeReplayRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=different_code_attack&state=${encodeURIComponent(
      urlDataA.state
    )}`,
    { headers: { Cookie: sidCookieA } }
  );
  assert.equal(differentCodeReplayRes.status, 400);

  // Scenario D (8): Session restoration after refresh
  clearInMemoryOAuthStoresForTest();
  const restoredAuthRes = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: sidCookieA },
  });
  const restoredAuthData = await restoredAuthRes.json();
  assert.equal(restoredAuthData.authenticated, true);
  assert.equal(restoredAuthData.user.uid, 'pesu_pesu_lifecycle_user');

  // Scenario E (5): State belonging to another session is rejected WITHOUT consuming the owner's pending state
  const urlResOwner = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email`);
  const sidCookieOwner = (urlResOwner.headers.get('set-cookie') ?? '').split(';')[0];
  const urlDataOwner = await urlResOwner.json();

  const urlResOther = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email`);
  const sidCookieOther = (urlResOther.headers.get('set-cookie') ?? '').split(';')[0];

  // Unrelated session (sidCookieOther) attempts to use urlDataOwner.state
  const mismatchRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=owner_code_1&state=${encodeURIComponent(
      urlDataOwner.state
    )}`,
    { headers: { Cookie: sidCookieOther } }
  );
  const mismatchHtml = await mismatchRes.text();
  assert.equal(mismatchRes.status, 400);
  assert.ok(mismatchHtml.includes('OAUTH_STATE_INVALID'));
  assert.ok(mismatchHtml.includes('"callbackOutcome":"rejected_session_mismatch"'));

  // Owner session (sidCookieOwner) can still complete login with urlDataOwner.state!
  const ownerSuccessRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=owner_code_1&state=${encodeURIComponent(
      urlDataOwner.state
    )}`,
    { headers: { Cookie: sidCookieOwner } }
  );
  assert.equal(ownerSuccessRes.status, 200);
  assert.equal(tokenExchangeCallCount, 2);

  // Scenario F (6): Failed token exchange marks transaction failed and rejects subsequent reuse
  shouldFailTokenExchange = true;
  const urlResFail = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email`);
  const sidCookieFail = (urlResFail.headers.get('set-cookie') ?? '').split(';')[0];
  const urlDataFail = await urlResFail.json();

  const failCbUrl = `${baseUrl}/auth/pesu/callback?code=fail_code_1&state=${encodeURIComponent(
    urlDataFail.state
  )}`;
  const failRes1 = await fetch(failCbUrl, { headers: { Cookie: sidCookieFail } });
  const failHtml1 = await failRes1.text();
  assert.equal(failRes1.status, 502);
  assert.ok(failHtml1.includes('OAUTH_TOKEN_EXCHANGE_FAILED'));
  assert.ok(failHtml1.includes('Invalid client credentials'));
  assert.equal(tokenExchangeCallCount, 3);

  // Reusing the failed state/code is rejected with 400 and does NOT call /token again
  const failRes2 = await fetch(failCbUrl, { headers: { Cookie: sidCookieFail } });
  const failHtml2 = await failRes2.text();
  assert.equal(failRes2.status, 400);
  assert.ok(failHtml2.includes('OAUTH_STATE_INVALID'));
  assert.ok(failHtml2.includes('"callbackOutcome":"rejected_failed_previously"'));
  assert.equal(
    tokenExchangeCallCount,
    3,
    'Failed transaction must not reuse the authorization code on retry'
  );

  // Cleanup
  await db
    .delete(oauthSessions)
    .where(eq(oauthSessions.uid, 'pesu_pesu_lifecycle_user'));
  await db.delete(profiles).where(eq(profiles.uid, 'pesu_pesu_lifecycle_user'));
  await db.delete(users).where(eq(users.uid, 'pesu_pesu_lifecycle_user'));
  await db.delete(oauthTransactions);
});

test('28. OAuth browser session & origin consistency: top-level continuity, cross-origin preview rejection, missing/invalid/mismatched cookie diagnostics, and unpartitioned cookie flags', async () => {
  const { clearInMemoryOAuthStoresForTest } = await import('../server.ts');
  const { db } = await import('../src/db/index.ts');
  const { users, profiles, oauthSessions, oauthTransactions } = await import(
    '../src/db/schema.ts'
  );
  const { eq } = await import('drizzle-orm');

  process.env.PESU_OAUTH_CLIENT_ID = 'test_pesu_session_consistency';
  process.env.PESU_OAUTH_CLIENT_SECRET = 'secret_session_consistency_key';
  process.env.PESU_OAUTH_ISSUER_URL = 'https://oauth.pesu.mock';

  let capturedTokenAuthHeader = '';
  let capturedCodeVerifier = '';

  setServerTestOverrides({
    fetchFn: async (input, init) => {
      const url = String(input);
      if (url.includes('/.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: 'https://oauth.pesu.mock',
            authorization_endpoint: 'https://oauth.pesu.mock/authorize',
            token_endpoint: 'https://oauth.pesu.mock/token',
            userinfo_endpoint: 'https://oauth.pesu.mock/userinfo',
            scopes_supported: ['openid', 'profile', 'email'],
            code_challenge_methods_supported: ['S256'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === 'https://oauth.pesu.mock/token') {
        const hdrs = (init?.headers ?? {}) as Record<string, string>;
        capturedTokenAuthHeader = hdrs.Authorization || '';
        const bodyParams = new URLSearchParams(String(init?.body ?? ''));
        capturedCodeVerifier = bodyParams.get('code_verifier') ?? '';

        const idToken = createBase64UrlJwt({
          iss: 'https://oauth.pesu.mock',
          aud: 'test_pesu_session_consistency',
          sub: 'pesu_session_verified_student',
          name: 'Session Verified Student',
          email: 'session.student@pesu.pes.edu',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        return new Response(
          JSON.stringify({
            access_token: 'provider_access_token_session_test',
            refresh_token: 'provider_refresh_token_session_test',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid profile email',
            id_token: idToken,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === 'https://oauth.pesu.mock/userinfo') {
        return new Response(
          JSON.stringify({
            sub: 'pesu_session_verified_student',
            name: 'Session Verified Student',
            email: 'session.student@pesu.pes.edu',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not found', { status: 404 });
    },
  });

  // 1. Fresh top-level browser tab initializes session cookie via /api/auth/session
  const initSessRes = await fetch(`${baseUrl}/api/auth/session`);
  const initSetCookie = initSessRes.headers.get('set-cookie') ?? '';
  assert.ok(
    !initSetCookie.includes('Partitioned'),
    'Session cookie must not include Partitioned attribute that splits iframe and popup cookie jars'
  );
  const topLevelSidCookie = initSetCookie.split(';')[0];
  assert.ok(topLevelSidCookie.startsWith('quackathon_sid='));

  // 2. OAuth initiation with existing session cookie reports initiationCookieStatus = 'existing' and matching origins
  const urlRes = await fetch(
    `${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email&mode=redirect`,
    {
      headers: {
        Cookie: topLevelSidCookie,
        'X-Client-Origin': baseUrl,
      },
    }
  );
  const urlData = await urlRes.json();
  assert.equal(urlRes.status, 200);
  assert.equal(urlData.ok, true);
  assert.equal(urlData.initiationCookieStatus, 'existing');
  assert.equal(urlData.initiatingOrigin, baseUrl);
  assert.equal(urlData.configuredCallbackOrigin, baseUrl);
  assert.equal(urlData.diagnostics.initiationCookieStatus, 'existing');
  assert.equal(urlData.diagnostics.initiatingOrigin, baseUrl);
  assert.equal(urlData.diagnostics.configuredCallbackOrigin, baseUrl);

  // 3. Cross-origin preview initiation (e.g. from another preview hostname) is rejected with 400 OAUTH_REDIRECT_URI_MISMATCH
  const crossOriginRes = await fetch(
    `${baseUrl}/api/pesu-oauth/url?scope=openid%20profile`,
    {
      headers: {
        Cookie: topLevelSidCookie,
        'X-Client-Origin': 'https://mismatch-preview.example.run.app',
      },
    }
  );
  const crossOriginData = await crossOriginRes.json();
  assert.equal(crossOriginRes.status, 400);
  assert.equal(crossOriginData.ok, false);
  assert.equal(crossOriginData.errorCategory, 'OAUTH_REDIRECT_URI_MISMATCH');
  assert.equal(
    crossOriginData.diagnostics.callbackOutcome,
    'rejected_origin_mismatch'
  );
  assert.equal(
    crossOriginData.diagnostics.initiatingOrigin,
    'https://mismatch-preview.example.run.app'
  );
  assert.equal(crossOriginData.diagnostics.configuredCallbackOrigin, baseUrl);

  // 4. Reject callback when session cookie is missing (without consuming transaction or minting a new cookie)
  const missingCookieCbRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=valid_code_session_1&state=${encodeURIComponent(
      urlData.state
    )}`
  );
  const missingCookieHtml = await missingCookieCbRes.text();
  assert.equal(missingCookieCbRes.status, 400);
  assert.equal(
    missingCookieCbRes.headers.get('set-cookie'),
    null,
    'Rejected callback must not mint a new quackathon_sid cookie'
  );
  assert.ok(missingCookieHtml.includes('"callbackCookieStatus":"missing"'));
  assert.ok(
    missingCookieHtml.includes(
      '"callbackOutcome":"rejected_missing_session_cookie"'
    )
  );
  assert.ok(missingCookieHtml.includes('"sessionBindingMatched":false'));

  // 5. Reject callback when session cookie signature is invalid
  const invalidSigCbRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=valid_code_session_1&state=${encodeURIComponent(
      urlData.state
    )}`,
    {
      headers: {
        Cookie: 'quackathon_sid=tampered_session_id.invalid_hmac_signature',
      },
    }
  );
  const invalidSigHtml = await invalidSigCbRes.text();
  assert.equal(invalidSigCbRes.status, 400);
  assert.ok(
    invalidSigHtml.includes('"callbackCookieStatus":"invalid_signature"')
  );
  assert.ok(
    invalidSigHtml.includes(
      '"callbackOutcome":"rejected_invalid_session_cookie"'
    )
  );
  assert.ok(invalidSigHtml.includes('"sessionBindingMatched":false'));

  // 6. Reject callback when session cookie belongs to a different browser session
  const otherTabUrlRes = await fetch(
    `${baseUrl}/api/pesu-oauth/url?scope=openid%20profile`
  );
  const otherTabCookie = (otherTabUrlRes.headers.get('set-cookie') ?? '').split(
    ';'
  )[0];
  const mismatchCbRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=valid_code_session_1&state=${encodeURIComponent(
      urlData.state
    )}`,
    {
      headers: { Cookie: otherTabCookie },
    }
  );
  const mismatchCbHtml = await mismatchCbRes.text();
  assert.equal(mismatchCbRes.status, 400);
  assert.ok(mismatchCbHtml.includes('"callbackCookieStatus":"valid"'));
  assert.ok(
    mismatchCbHtml.includes('"callbackOutcome":"rejected_session_mismatch"')
  );
  assert.ok(mismatchCbHtml.includes('"sessionBindingMatched":false'));

  // 7. Simulate callback reaching another backend instance (clearInMemoryOAuthStoresForTest)
  // and verify multi-cookie header resilience (legacy cookie + valid initiating cookie)
  clearInMemoryOAuthStoresForTest();
  const validCbRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=valid_code_session_1&state=${encodeURIComponent(
      urlData.state
    )}`,
    {
      headers: {
        Cookie: `${otherTabCookie}; ${topLevelSidCookie}`,
      },
    }
  );
  const validCbHtml = await validCbRes.text();
  assert.equal(validCbRes.status, 200);
  assert.ok(validCbHtml.includes('"status":"success"'));
  assert.ok(validCbHtml.includes('"callbackCookieStatus":"valid"'));
  assert.ok(validCbHtml.includes('"sessionBindingMatched":true'));
  assert.ok(validCbHtml.includes('"handledByDifferentInstance":true'));
  assert.ok(capturedTokenAuthHeader.startsWith('Basic '));
  assert.ok(capturedCodeVerifier.length >= 32);

  // 8. Verify PostgreSQL user persistence & session restoration after refresh
  clearInMemoryOAuthStoresForTest();
  const restoredRes = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: topLevelSidCookie },
  });
  const restoredData = await restoredRes.json();
  assert.equal(restoredRes.status, 200);
  assert.equal(restoredData.authenticated, true);
  assert.equal(
    restoredData.user.uid,
    'pesu_pesu_session_verified_student'
  );
  assert.equal(restoredData.user.verificationStatus, 'verified_pesu_oidc');

  // Cleanup
  await db
    .delete(oauthSessions)
    .where(eq(oauthSessions.uid, 'pesu_pesu_session_verified_student'));
  await db
    .delete(profiles)
    .where(eq(profiles.uid, 'pesu_pesu_session_verified_student'));
  await db
    .delete(users)
    .where(eq(users.uid, 'pesu_pesu_session_verified_student'));
  await db.delete(oauthTransactions);
});

test('29. PESU Academy announcements: { resource, data, fetched_at } normalization, empty feed, missing announcements:read scope, delegated consent_required, expired token, malformed fields, and strict privacy isolation', async () => {
  const { db } = await import('../src/db/index.ts');
  const { users, profiles, oauthSessions } = await import(
    '../src/db/schema.ts'
  );
  const { createOAuthSessionRecord, upsertUserAndProfile, updateUserProfileAndPrivacy } =
    await import('../src/db/repository.ts');
  const { signSessionId } = await import('../src/lib/crypto.ts');
  const { eq } = await import('drizzle-orm');

  const testUid = 'pesu_ann_test_student_1';
  const otherUid = 'pesu_ann_other_student_2';

  await db.delete(oauthSessions).where(eq(oauthSessions.uid, testUid));
  await db.delete(oauthSessions).where(eq(oauthSessions.uid, otherUid));
  await db.delete(profiles).where(eq(profiles.uid, testUid));
  await db.delete(users).where(eq(users.uid, testUid));
  await db.delete(profiles).where(eq(profiles.uid, otherUid));
  await db.delete(users).where(eq(users.uid, otherUid));

  const { profile } = await upsertUserAndProfile({
    uid: testUid,
    email: 'ann.student@pesu.pes.edu',
    displayName: 'Announcement Student',
    campus: 'RR Campus',
    verified: true,
    verificationStatus: 'verified_pesu_oidc',
  });

  await upsertUserAndProfile({
    uid: otherUid,
    email: 'other.student@pesu.pes.edu',
    displayName: 'Other Student',
    campus: 'EC Campus',
    verified: true,
    verificationStatus: 'verified_pesu_oidc',
  });

  // 1. Opt-in disabled by default -> 403 OPT_IN_REQUIRED (never "0 announcements")
  const sessionNoOptIn = await createOAuthSessionRecord({
    sessionToken: `raw_session_token_ann_1_${Date.now()}`,
    uid: testUid,
    pesuSub: 'sub_ann_1',
    scopes: ['openid', 'profile', 'email'],
    accessToken: 'provider_token_identity_only',
    refreshToken: null,
    expiresAt: new Date(Date.now() + 3600_000),
    initiatingSessionId: 'browser_sid_ann_1',
  });
  void sessionNoOptIn;

  const cookieAnn1 = `quackathon_sid=${encodeURIComponent(
    signSessionId('browser_sid_ann_1')
  )}`;

  const resOptInOff = await fetch(`${baseUrl}/api/pesu/announcements`, {
    headers: { Cookie: cookieAnn1 },
  });
  const dataOptInOff = await resOptInOff.json();
  assert.equal(resOptInOff.status, 403);
  assert.equal(dataOptInOff.ok, false);
  assert.equal(dataOptInOff.errorCode, 'OPT_IN_REQUIRED');
  assert.equal(dataOptInOff.requiresOptIn, true);
  assert.equal(dataOptInOff.announcements, undefined);

  // Enable explicit student opt-in
  await updateUserProfileAndPrivacy({
    uid: testUid,
    profile,
    privacyPreferences: {
      profileVisible: true,
      githubConsent: false,
      aiEnrichmentConsent: false,
      academyAnnouncementsOptIn: true,
      academyTimetableOptIn: false,
    },
  });

  // 2. Missing `announcements:read` scope -> 403 MISSING_ANNOUNCEMENTS_SCOPE (never reported as 0 announcements)
  const resMissingScope = await fetch(`${baseUrl}/api/pesu/announcements`, {
    headers: { Cookie: cookieAnn1 },
  });
  const dataMissingScope = await resMissingScope.json();
  assert.equal(resMissingScope.status, 403);
  assert.equal(dataMissingScope.ok, false);
  assert.equal(dataMissingScope.errorCode, 'MISSING_ANNOUNCEMENTS_SCOPE');
  assert.equal(dataMissingScope.requiresScopeGrant, true);
  assert.deepEqual(dataMissingScope.grantedScopes, [
    'openid',
    'profile',
    'email',
  ]);

  // 3. Upgrade session to include `announcements:read`
  await createOAuthSessionRecord({
    sessionToken: `raw_session_token_ann_with_scope_${Date.now()}`,
    uid: testUid,
    pesuSub: 'sub_ann_1',
    scopes: ['openid', 'profile', 'email', 'announcements:read'],
    accessToken: 'provider_token_with_announcements_read',
    refreshToken: null,
    expiresAt: new Date(Date.now() + 3600_000),
    initiatingSessionId: 'browser_sid_ann_scoped',
  });
  const cookieScoped = `quackathon_sid=${encodeURIComponent(
    signSessionId('browser_sid_ann_scoped')
  )}`;

  // 4. Test valid `{ resource: "announcements", data: [...], fetched_at }` payload + malformed record resilience
  let mockScenario:
    | 'valid_envelope'
    | 'empty_envelope'
    | 'expired_token'
    | 'consent_required'
    | 'malformed_envelope' = 'valid_envelope';

  setServerTestOverrides({
    fetchFn: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/announcements')) {
        const authHdr =
          ((init?.headers as Record<string, string>) ?? {}).Authorization || '';
        assert.equal(
          authHdr,
          'Bearer provider_token_with_announcements_read'
        );

        if (mockScenario === 'expired_token') {
          return new Response(
            JSON.stringify({
              error: 'invalid_token',
              error_description: 'Access token has expired',
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (mockScenario === 'consent_required') {
          return new Response(
            JSON.stringify({
              error: 'consent_required',
              error_description:
                'Stored PESU Academy credentials are missing; ask the student to sign in again',
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (mockScenario === 'malformed_envelope') {
          return new Response(
            JSON.stringify({
              unexpected_key: 'not_an_array',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (mockScenario === 'empty_envelope') {
          return new Response(
            JSON.stringify({
              resource: 'announcements',
              data: [],
              fetched_at: '2026-11-15T10:00:00.000Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            resource: 'announcements',
            data: [
              {
                id: 901,
                title: '<b>HackPES 2026: 24-Hour AI &amp; Systems Hackathon</b>',
                date: '2026-11-10',
                description:
                  '<p>Hosted by Department of CSE at MRD Auditorium, RR Campus. Event dates: 07 Nov 2026 – 08 Nov 2026. Teams of 2 to 4 students. Register at https://events.pes.edu/11629/ before deadline: 05 Nov 2026.</p>',
                image: 'https://events.pes.edu/static/hackpes.png',
                attachments: 2,
              },
              {
                id: '902',
                title: 'Malformed Date & Attachment Announcement',
                date: 'not-a-valid-date',
                description: null,
                image: 'javascript:alert(1)',
                attachments: ['file1.pdf', 'file2.pdf', 'file3.pdf'],
              },
              null,
              { id: 903, title: '', description: '' }, // Empty record skipped gracefully
            ],
            fetched_at: '2026-11-15T11:30:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    },
  });

  const resValid = await fetch(`${baseUrl}/api/pesu/announcements?refresh=true`, {
    headers: { Cookie: cookieScoped },
  });
  const dataValid = await resValid.json();
  assert.equal(resValid.status, 200);
  assert.equal(dataValid.ok, true);
  assert.equal(dataValid.resource, 'announcements');
  assert.equal(dataValid.fetchedAt, '2026-11-15T11:30:00.000Z');
  assert.equal(dataValid.announcements.length, 2);

  // Verify announcement 1 fields
  const ann1 = dataValid.announcements[0];
  assert.equal(ann1.id, '901');
  assert.equal(ann1.title, 'HackPES 2026: 24-Hour AI & Systems Hackathon');
  assert.equal(
    ann1.date,
    '2026-11-10',
    'Must preserve original announcement publication date'
  );
  assert.ok(ann1.description.includes('MRD Auditorium'));
  assert.equal(ann1.image, 'https://events.pes.edu/static/hackpes.png');
  assert.equal(ann1.attachments, 2);

  // Verify announcement 2 graceful handling of malformed date, unsafe image scheme, and array attachments
  const ann2 = dataValid.announcements[1];
  assert.equal(ann2.id, '902');
  assert.equal(
    ann2.date,
    null,
    'Malformed publication date must become null, never today'
  );
  assert.equal(ann2.description, '');
  assert.equal(ann2.image, null, 'Unsafe image URL scheme must be rejected');
  assert.equal(ann2.attachments, 3);

  // Never leaks provider access token in response
  assert.ok(!JSON.stringify(dataValid).includes('provider_token_with_announcements_read'));

  // 5. Empty PESU announcements response
  mockScenario = 'empty_envelope';
  const resEmpty = await fetch(`${baseUrl}/api/pesu/announcements?refresh=true`, {
    headers: { Cookie: cookieScoped },
  });
  const dataEmpty = await resEmpty.json();
  assert.equal(resEmpty.status, 200);
  assert.equal(dataEmpty.ok, true);
  assert.deepEqual(dataEmpty.announcements, []);

  // 6. Expired or invalid OAuth token -> 401 TOKEN_EXPIRED_OR_REVOKED (not "0 announcements")
  mockScenario = 'expired_token';
  const resExpired = await fetch(
    `${baseUrl}/api/pesu/announcements?refresh=true`,
    {
      headers: { Cookie: cookieScoped },
    }
  );
  const dataExpired = await resExpired.json();
  assert.equal(resExpired.status, 401);
  assert.equal(dataExpired.ok, false);
  assert.equal(dataExpired.errorCode, 'TOKEN_EXPIRED_OR_REVOKED');
  assert.equal(dataExpired.requiresReauth, true);

  // 7. Delegated PESU Academy credentials missing on provider -> 403 DELEGATED_CREDENTIALS_REQUIRED
  mockScenario = 'consent_required';
  const resConsentReq = await fetch(
    `${baseUrl}/api/pesu/announcements?refresh=true`,
    {
      headers: { Cookie: cookieScoped },
    }
  );
  const dataConsentReq = await resConsentReq.json();
  assert.equal(resConsentReq.status, 403);
  assert.equal(dataConsentReq.ok, false);
  assert.equal(dataConsentReq.errorCode, 'DELEGATED_CREDENTIALS_REQUIRED');
  assert.equal(dataConsentReq.requiresScopeGrant, true);

  // 8. Malformed provider envelope -> 502 MALFORMED_PROVIDER_PAYLOAD
  mockScenario = 'malformed_envelope';
  const resMalformed = await fetch(
    `${baseUrl}/api/pesu/announcements?refresh=true`,
    {
      headers: { Cookie: cookieScoped },
    }
  );
  const dataMalformed = await resMalformed.json();
  assert.equal(resMalformed.status, 502);
  assert.equal(dataMalformed.ok, false);
  assert.equal(dataMalformed.errorCode, 'MALFORMED_PROVIDER_PAYLOAD');

  // Cleanup
  await db.delete(oauthSessions).where(eq(oauthSessions.uid, testUid));
  await db.delete(profiles).where(eq(profiles.uid, testUid));
  await db.delete(users).where(eq(users.uid, testUid));
  await db.delete(profiles).where(eq(profiles.uid, otherUid));
  await db.delete(users).where(eq(users.uid, otherUid));
});

test('30. Public PESU events (events.pes.edu): HTML listing & detail extraction, workshop/talk vs hackathon classification, and graceful handling of unreachable pages', async () => {
  const { db } = await import('../src/db/index.ts');
  const { hackathons, eventCandidates } = await import('../src/db/schema.ts');
  const { eq } = await import('drizzle-orm');

  const mockBrowseHackathonHtml = `
    <div class="tickets-grid">
      <div class="ticket grid-ticket" data-href="/11629/">
        <div class="ticket-status status-upcoming">Upcoming</div>
        <div class="ticket-tags"><span>#Hackathon</span><span>#Technical</span></div>
        <h3>Kodikon 5.0 — 24-Hour National Hackathon</h3>
        <p>Annual 24-hour national level hackathon at PES University RR Campus.</p>
        <div class="ticket-facts"><span><b>Sat, 07 Nov 2026</b></span></div>
      </div>
      <div class="ticket grid-ticket" data-href="/11632/">
        <div class="ticket-status status-upcoming">Upcoming</div>
        <div class="ticket-tags"><span>#Talks</span><span>#InfoSession</span></div>
        <h3>Expert Talk on Quantum Cryptography &amp; Career Pathways</h3>
        <p>Guest lecture and speaker session for undergraduate students.</p>
        <div class="ticket-facts"><span><b>Tue, 10 Nov 2026</b></span></div>
      </div>
    </div>
  `;

  const mockDetail11629Html = `
    <html>
      <head>
        <title>Kodikon 5.0 — 24-Hour National Hackathon | PES Events</title>
        <link rel="canonical" href="https://events.pes.edu/11629/" />
      </head>
      <body>
        <h1 class="bt-title">Kodikon 5.0 — 24-Hour National Hackathon</h1>
        <div class="bt-campus-name">PESU RR Campus</div>
        <div class="bt-fact-label">Date</div>
        <div class="bt-fact-value">Sat, 07 Nov 2026 – 08 Nov 2026</div>
        <div class="bt-fact-label">Venue</div>
        <div class="bt-fact-value">MRD Auditorium</div>
        <div class="bt-fact-label">Hosted by</div>
        <div class="bt-fact-value">Embrione &amp; Department of CSE</div>
        <div id="eventBody">
          <div class="rich-text">
            Join Kodikon 5.0 for a 24-hour build sprint! Teams of 3 to 4 students are eligible.
            Registration deadline: 04 Nov 2026.
            <a href="https://unstop.com/hackathons/kodikon-5-pes-university">Register Here</a>
          </div>
        </div>
      </body>
    </html>
  `;

  const mockDetail11632Html = `
    <html>
      <head><title>Expert Talk on Quantum Cryptography | PES Events</title></head>
      <body>
        <h1 class="bt-title">Expert Talk on Quantum Cryptography &amp; Career Pathways</h1>
        <div class="bt-campus-name">PESU EC Campus</div>
        <div class="bt-fact-label">Date</div>
        <div class="bt-fact-value">Tue, 10 Nov 2026</div>
        <div class="bt-fact-label">Venue</div>
        <div class="bt-fact-value">Seminar Hall 1</div>
        <div class="bt-fact-label">Hosted by</div>
        <div class="bt-fact-value">Department of ECE</div>
        <div id="eventBody">
          <div class="rich-text">
            An interactive speaker session and guest lecture on post-quantum cryptography.
          </div>
        </div>
      </body>
    </html>
  `;

  let simulateUnreachable = false;

  setServerTestOverrides({
    fetchFn: async (input) => {
      const url = String(input);
      if (simulateUnreachable) {
        return new Response('Bad Gateway', { status: 502 });
      }
      if (url.startsWith('https://events.pes.edu/browse/')) {
        return new Response(mockBrowseHackathonHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      if (url === 'https://events.pes.edu/11629/') {
        return new Response(mockDetail11629Html, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      if (url === 'https://events.pes.edu/11632/') {
        return new Response(mockDetail11632Html, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  });

  // 1. Test direct URL extraction on events.pes.edu/11629/
  const extractRes = await fetch(`${baseUrl}/api/events/extract-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://events.pes.edu/11629/' }),
  });
  const extractData = await extractRes.json();
  assert.equal(extractRes.status, 200);
  assert.equal(extractData.ok, true);
  assert.equal(
    extractData.data.title,
    'Kodikon 5.0 — 24-Hour National Hackathon'
  );
  assert.equal(extractData.data.organizer, 'Embrione & Department of CSE');
  assert.equal(extractData.data.eventType, 'hackathon');
  assert.equal(extractData.data.startAt, '2026-11-07');
  assert.equal(extractData.data.endAt, '2026-11-08');
  assert.equal(extractData.data.registrationDeadline, '2026-11-04');
  assert.equal(extractData.data.venueName, 'MRD Auditorium');
  assert.equal(extractData.data.campus, 'RR Campus');
  assert.equal(extractData.data.minTeamSize, 3);
  assert.equal(extractData.data.maxTeamSize, 4);
  assert.equal(
    extractData.data.registrationUrl,
    'https://unstop.com/hackathons/kodikon-5-pes-university'
  );

  // 2. Test sync-pesu-public endpoint
  const syncRes = await fetch(`${baseUrl}/api/events/sync-pesu-public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forceRefresh: true }),
  });
  const syncData = await syncRes.json();
  assert.equal(syncRes.status, 200);
  assert.equal(syncData.ok, true);
  assert.equal(syncData.discoveredCount, 2);
  assert.equal(syncData.publishedOrUpdatedCount, 2);

  const syncedKodikon = syncData.hackathons.find(
    (h: { id: string }) => h.id === 'pes_event_11629'
  );
  const syncedTalk = syncData.hackathons.find(
    (h: { id: string }) => h.id === 'pes_event_11632'
  );

  assert.ok(syncedKodikon, 'Kodikon hackathon should be published');
  assert.equal(syncedKodikon.sourceType, 'pes_public_events');
  assert.equal(syncedKodikon.eventType, 'hackathon');
  assert.equal(syncedKodikon.matchable, true);
  assert.equal(syncedKodikon.startAt, '2026-11-07');
  assert.equal(syncedKodikon.endAt, '2026-11-08');

  assert.ok(syncedTalk, 'Expert Talk should be recorded with accurate classification');
  assert.equal(syncedTalk.sourceType, 'pes_public_events');
  assert.equal(
    syncedTalk.eventType,
    'tech_talk',
    'Expert Talk with #Talks/#InfoSession must NEVER be classified as a hackathon'
  );
  assert.equal(
    syncedTalk.matchable,
    false,
    'Talks must have matchable = false'
  );

  // 3. Test unreachable events.pes.edu handling (never fabricates fake events)
  simulateUnreachable = true;
  const unreachableRes = await fetch(`${baseUrl}/api/events/sync-pesu-public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forceRefresh: true }),
  });
  const unreachableData = await unreachableRes.json();
  assert.equal(unreachableRes.status, 502);
  assert.equal(unreachableData.ok, false);
  assert.equal(unreachableData.reachablePagesCount, 0);
  assert.equal(unreachableData.discoveredCount, 0);

  // Cleanup
  await db
    .delete(hackathons)
    .where(eq(hackathons.slug, 'pes_event_11629'));
  await db
    .delete(hackathons)
    .where(eq(hackathons.slug, 'pes_event_11632'));
  await db
    .delete(eventCandidates)
    .where(eq(eventCandidates.candidateUid, 'cand_pes_public_11629'));
  await db
    .delete(eventCandidates)
    .where(eq(eventCandidates.candidateUid, 'cand_pes_public_11632'));
});

test('31. Cross-source duplicate & update detection + announcement-to-candidate privacy sanitization & admin approval workflow', async () => {
  const { db } = await import('../src/db/index.ts');
  const { users, profiles, hackathons, eventCandidates, oauthSessions } =
    await import('../src/db/schema.ts');
  const { createOAuthSessionRecord, upsertUserAndProfile } = await import(
    '../src/db/repository.ts'
  );
  const {
    detectTechnicalEventFromAnnouncement,
    buildSanitizedCandidateDraftFromAnnouncement,
  } = await import('../src/lib/eventsAndAnnouncements.ts');
  const { eq } = await import('drizzle-orm');

  await upsertUserAndProfile({
    uid: 'student_submitter_dup_test',
    email: 'submitter@pesu.pes.edu',
    displayName: 'Submitter Student',
    campus: 'RR Campus',
    verified: true,
    verificationStatus: 'verified_pesu_oidc',
  });

  await upsertUserAndProfile({
    uid: 'admin_reviewer_dup_test',
    email: 'admin.dup@pes.edu',
    displayName: 'Moderator Admin',
    campus: 'RR Campus',
    verified: true,
    verificationStatus: 'verified_pesu_oidc',
    isAdmin: true,
  });

  await createOAuthSessionRecord({
    sessionToken: 'pesu_tok_student_submitter',
    uid: 'student_submitter_dup_test',
    pesuSub: 'sub_student_dup',
    accessToken: 'acc_student_dup',
    refreshToken: null,
    scopes: ['openid', 'profile', 'email'],
    expiresAt: new Date(Date.now() + 3600_000),
  });

  await createOAuthSessionRecord({
    sessionToken: 'pesu_tok_admin_reviewer',
    uid: 'admin_reviewer_dup_test',
    pesuSub: 'sub_admin_dup',
    accessToken: 'acc_admin_dup',
    refreshToken: null,
    scopes: ['openid', 'profile', 'email'],
    expiresAt: new Date(Date.now() + 3600_000),
  });

  setServerTestOverrides({
    fetchFn: async () => new Response('OK', { status: 200 }),
  });

  // 1. Detect technical event from a PESU Academy announcement containing personal student info
  //    and verify publication date (2026-10-01) is NEVER mistaken for event startAt!
  const privateAnnouncement = {
    id: 'ann_priv_501',
    title: 'Aegis Cyber CTF & Security Hackathon 2026',
    date: '2026-10-01', // Announcement publication date
    description:
      'Dear PES1UG23CS999 (student.private@pesu.pes.edu, +91 9876543210), register for Aegis Cyber CTF & Security Hackathon 2026 organized by CyberSec Club PESU. Event dates: 21 Nov 2026 – 22 Nov 2026. Teams of 2 to 4 students.',
    image: null,
    attachments: 1,
  };

  const detected = detectTechnicalEventFromAnnouncement(privateAnnouncement);
  assert.ok(detected, 'Should detect CTF/Hackathon from announcement');
  assert.equal(
    detected!.startAt,
    '2026-11-21',
    'Must extract stated event start date (2026-11-21) and NEVER copy announcement publication date (2026-10-01)'
  );
  assert.equal(detected!.endAt, '2026-11-22');
  assert.equal(detected!.minTeamSize, 2);
  assert.equal(detected!.maxTeamSize, 4);

  // Also test announcement where no event date is mentioned -> startAt must be null ("Date TBA"), NEVER publication date!
  const undatedAnnouncement = {
    id: 'ann_priv_502',
    title: 'PESU Open Source Buildathon — Registrations Opening Soon',
    date: '2026-10-05', // Publication date
    description:
      'Get ready for the annual PESU Open Source Buildathon! Venue and exact dates will be announced next week.',
    image: null,
    attachments: 0,
  };
  const detectedUndated =
    detectTechnicalEventFromAnnouncement(undatedAnnouncement);
  assert.ok(detectedUndated);
  assert.equal(
    detectedUndated!.startAt,
    null,
    'When announcement does not state an event date, startAt must be null ("Date TBA"), never the publication date'
  );

  // 2. Sanitize candidate draft from announcement (strips SRN, email, phone, and raw private prose)
  const draft = buildSanitizedCandidateDraftFromAnnouncement({
    announcement: privateAnnouncement,
    detected: detected!,
    includeSanitizedSummary: false,
  });
  assert.ok(!JSON.stringify(draft).includes('PES1UG23CS999'));
  assert.ok(!JSON.stringify(draft).includes('student.private@pesu.pes.edu'));
  assert.ok(!JSON.stringify(draft).includes('9876543210'));

  // 3. Submit Source 1 (Announcement Hint) -> Staged for review, NOT in public hackathons list
  const resCand1 = await fetch(`${baseUrl}/api/hackathons/candidates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer pesu_tok_student_submitter',
    },
    body: JSON.stringify({
      candidate: {
        ...draft,
        id: 'cand_src1_ann_aegis',
        externalFingerprint: 'fp_aegis_src1',
        title: 'Aegis Cyber CTF & Security Hackathon 2026',
        organizer: 'CyberSec Club PESU',
      },
    }),
  });
  const dataCand1 = await resCand1.json();
  assert.equal(resCand1.status, 201);
  assert.equal(dataCand1.ok, true);

  // Verify unreviewed candidate is NOT visible in public `/api/bootstrap` hackathons
  const bootUnauth = await (await fetch(`${baseUrl}/api/bootstrap`)).json();
  assert.ok(
    !bootUnauth.hackathons.some((h: { name: string }) =>
      h.name.includes('Aegis Cyber CTF')
    ),
    'Unreviewed candidate must never appear in public event list before admin approval'
  );

  // 4. Submit Source 2 (Student Public URL submission for the SAME event with newly discovered venue & link)
  //    Should consolidate with the existing pending candidate instead of creating a 2nd candidate card!
  const resCand2 = await fetch(`${baseUrl}/api/hackathons/candidates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer pesu_tok_student_submitter',
    },
    body: JSON.stringify({
      candidate: {
        id: 'cand_src2_url_aegis',
        source: 'submitted_public_url',
        sourceUrl: 'https://events.pes.edu/99901/',
        originalSubmissionUrl: 'https://events.pes.edu/99901/',
        verifiedCanonicalUrl: 'https://events.pes.edu/99901/',
        sourceUrlStatus: 'verified',
        externalFingerprint: 'fp_aegis_src2',
        title: 'Aegis Cyber CTF & Security Hackathon 2026',
        organizer: 'CyberSec Club PESU',
        eventType: 'ctf',
        matchable: true,
        themes: ['Cybersecurity'],
        description: 'Official public page for Aegis Cyber CTF.',
        startAt: '2026-11-21',
        endAt: '2026-11-22',
        registrationDeadline: '2026-11-19',
        timezone: 'Asia/Kolkata',
        venue: { campus: 'RR Campus', name: 'GJBC Seminar Hall 2' },
        format: 'onsite',
        teamSize: { min: 2, max: 4 },
        registrationUrl: 'https://events.pes.edu/99901/',
        fieldEvidence: {},
        classification: {
          ruleGatePassed: true,
          mlScore: 1,
          reason: 'Verified CTF.',
        },
        reviewStatus: 'new',
      },
    }),
  });
  const dataCand2 = await resCand2.json();
  assert.equal(resCand2.status, 201);
  assert.equal(
    dataCand2.candidate.id,
    dataCand1.candidate.id,
    'Same event from second source must consolidate into the existing pending candidate'
  );
  assert.equal(dataCand2.candidate.venue.name, 'GJBC Seminar Hall 2');

  // 5. Admin approves the candidate -> Published as 1 Hackathon card
  const approveRes = await fetch(
    `${baseUrl}/api/admin/candidates/${dataCand1.candidate.id}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer pesu_tok_admin_reviewer',
      },
      body: JSON.stringify({}),
    }
  );
  const approveData = await approveRes.json();
  assert.equal(approveRes.status, 200);
  assert.equal(approveData.ok, true);
  const publishedSlug = approveData.hackathon.id;

  // 6. Submit Source 3 (Updated registration deadline from organizer for the already-published event)
  //    Should detect `updatesExistingHackathonId = publishedSlug` with `proposedDiffs`!
  const resCand3 = await fetch(`${baseUrl}/api/hackathons/candidates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer pesu_tok_student_submitter',
    },
    body: JSON.stringify({
      candidate: {
        id: 'cand_src3_update_aegis',
        source: 'approved_organizer',
        sourceUrl: 'https://events.pes.edu/99901/',
        originalSubmissionUrl: 'https://events.pes.edu/99901/',
        verifiedCanonicalUrl: 'https://events.pes.edu/99901/',
        sourceUrlStatus: 'verified',
        externalFingerprint: 'fp_aegis_src3',
        title: 'Aegis Cyber CTF & Security Hackathon 2026',
        organizer: 'CyberSec Club PESU',
        eventType: 'ctf',
        matchable: true,
        themes: ['Cybersecurity'],
        description: 'Extended deadline for Aegis Cyber CTF.',
        startAt: '2026-11-21',
        endAt: '2026-11-22',
        registrationDeadline: '2026-11-20', // Extended from 2026-11-19 to 2026-11-20
        timezone: 'Asia/Kolkata',
        venue: { campus: 'RR Campus', name: 'MRD Main Auditorium' }, // Updated venue
        format: 'onsite',
        teamSize: { min: 2, max: 4 },
        registrationUrl: 'https://events.pes.edu/99901/',
        fieldEvidence: {},
        classification: {
          ruleGatePassed: true,
          mlScore: 1,
          reason: 'Verified CTF.',
        },
        reviewStatus: 'needs_confirmation',
      },
    }),
  });
  const dataCand3 = await resCand3.json();
  assert.equal(resCand3.status, 201);
  assert.equal(
    dataCand3.candidate.updatesExistingHackathonId,
    publishedSlug,
    'Third source with updated fields must link to existing published hackathon via updatesExistingHackathonId'
  );
  assert.ok(
    Array.isArray(dataCand3.candidate.proposedDiffs) &&
      dataCand3.candidate.proposedDiffs.length >= 1,
    'Must record proposedDiffs for registrationDeadline and venue'
  );

  // Admin approves Source 3 update -> Updates the existing hackathon in-place without creating a duplicate card!
  const approveUpdateRes = await fetch(
    `${baseUrl}/api/admin/candidates/${dataCand3.candidate.id}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer pesu_tok_admin_reviewer',
      },
      body: JSON.stringify({}),
    }
  );
  const approveUpdateData = await approveUpdateRes.json();
  assert.equal(approveUpdateRes.status, 200);
  assert.equal(
    approveUpdateData.hackathon.id,
    publishedSlug,
    'Approving an update candidate must update the existing hackathon rather than creating a duplicate card'
  );
  assert.equal(approveUpdateData.hackathon.venue.name, 'MRD Main Auditorium');
  assert.equal(
    approveUpdateData.hackathon.registrationDeadline,
    '2026-11-20'
  );

  const bootAfter = await (await fetch(`${baseUrl}/api/bootstrap`)).json();
  const aegisCards = bootAfter.hackathons.filter((h: { name: string }) =>
    h.name.includes('Aegis Cyber CTF')
  );
  assert.equal(
    aegisCards.length,
    1,
    'Same event from 3 sources must result in exactly 1 published card'
  );

  // Cleanup
  await db.delete(hackathons).where(eq(hackathons.slug, publishedSlug));
  await db
    .delete(eventCandidates)
    .where(eq(eventCandidates.candidateUid, dataCand1.candidate.id));
  await db
    .delete(eventCandidates)
    .where(eq(eventCandidates.candidateUid, dataCand3.candidate.id));
  await db
    .delete(oauthSessions)
    .where(eq(oauthSessions.uid, 'student_submitter_dup_test'));
  await db
    .delete(oauthSessions)
    .where(eq(oauthSessions.uid, 'admin_reviewer_dup_test'));
  await db
    .delete(profiles)
    .where(eq(profiles.uid, 'student_submitter_dup_test'));
  await db.delete(users).where(eq(users.uid, 'student_submitter_dup_test'));
  await db
    .delete(profiles)
    .where(eq(profiles.uid, 'admin_reviewer_dup_test'));
  await db.delete(users).where(eq(users.uid, 'admin_reviewer_dup_test'));
});

test('32. IST (Asia/Kolkata) Date & Time Filtering: Upcoming vs Past, chronological sorting, multi-day overlap with This Week / This Month / Custom Range, and undated Date TBA preservation', async () => {
  const {
    filterAndSortEventsByTime,
    filterAnnouncementsByPublicationDate,
    formatEventDateDisplayIST,
    getWeekBoundsIST,
    getMonthBoundsIST,
  } = await import('../src/lib/eventsAndAnnouncements.ts');

  // Reference date: Wednesday, 18 Nov 2026 in Asia/Kolkata (IST)
  // Week bounds (Mon–Sun): 2026-11-16 to 2026-11-22
  // Month bounds: 2026-11-01 to 2026-11-30
  const referenceDate = new Date('2026-11-18T10:00:00+05:30');
  const weekBounds = getWeekBoundsIST('2026-11-18');
  assert.equal(weekBounds.weekStart, '2026-11-16');
  assert.equal(weekBounds.weekEnd, '2026-11-22');

  const monthBounds = getMonthBoundsIST('2026-11-18');
  assert.equal(monthBounds.monthStart, '2026-11-01');
  assert.equal(monthBounds.monthEnd, '2026-11-30');

  const sampleEvents = [
    {
      id: 'ev_past_oct',
      title: 'October Legacy Hackathon',
      startAt: '2026-10-10',
      endAt: '2026-10-11',
      registrationDeadline: '2026-10-08',
    },
    {
      id: 'ev_past_early_nov',
      title: 'Early November Sprint',
      startAt: '2026-11-05',
      endAt: '2026-11-06',
      registrationDeadline: '2026-11-03',
    },
    {
      id: 'ev_multiday_spanning_week_start',
      title: 'Multi-Day Buildathon Overlapping Week Start',
      startAt: '2026-11-14', // Started Saturday last week
      endAt: '2026-11-17', // Ends Tuesday this week (overlaps This Week!)
      registrationDeadline: '2026-11-12',
    },
    {
      id: 'ev_ongoing_today',
      title: 'Ongoing Mid-Week Hackathon',
      startAt: '2026-11-17',
      endAt: '2026-11-19', // Ongoing on 2026-11-18
      registrationDeadline: '2026-11-16',
    },
    {
      id: 'ev_this_weekend',
      title: 'Weekend AI Ideathon',
      startAt: '2026-11-21',
      endAt: '2026-11-22',
      registrationDeadline: '2026-11-20',
    },
    {
      id: 'ev_late_nov_this_month',
      title: 'Late November Systems Jam',
      startAt: '2026-11-28',
      endAt: '2026-11-29',
      registrationDeadline: '2026-11-25',
    },
    {
      id: 'ev_dec_future',
      title: 'December Winter Championship',
      startAt: '2026-12-12',
      endAt: '2026-12-13',
      registrationDeadline: '2026-12-05',
    },
    {
      id: 'ev_undated_tba',
      title: 'Undated Mystery Hackathon (Date TBA)',
      startAt: null,
      endAt: null,
      registrationDeadline: null,
    },
  ];

  // 1. UPCOMING (default): includes ongoing (endAt >= 2026-11-18) and future events, sorted nearest startAt first
  const upcoming = filterAndSortEventsByTime(sampleEvents, {
    preset: 'UPCOMING',
    referenceDate,
  });
  assert.deepEqual(
    upcoming.map((e) => e.id),
    [
      'ev_ongoing_today',
      'ev_this_weekend',
      'ev_late_nov_this_month',
      'ev_dec_future',
    ],
    'UPCOMING must include ongoing and future events sorted chronologically nearest first, and exclude past and undated events'
  );

  // 2. THIS_WEEK (2026-11-16 to 2026-11-22): must include multi-day event starting 2026-11-14 and ending 2026-11-17!
  const thisWeek = filterAndSortEventsByTime(sampleEvents, {
    preset: 'THIS_WEEK',
    referenceDate,
  });
  assert.deepEqual(
    thisWeek.map((e) => e.id),
    [
      'ev_multiday_spanning_week_start',
      'ev_ongoing_today',
      'ev_this_weekend',
    ],
    'THIS_WEEK must include multi-day events whose date range overlaps [weekStart, weekEnd]'
  );

  // 3. THIS_MONTH (2026-11-01 to 2026-11-30)
  const thisMonth = filterAndSortEventsByTime(sampleEvents, {
    preset: 'THIS_MONTH',
    referenceDate,
  });
  assert.deepEqual(
    thisMonth.map((e) => e.id),
    [
      'ev_past_early_nov',
      'ev_multiday_spanning_week_start',
      'ev_ongoing_today',
      'ev_this_weekend',
      'ev_late_nov_this_month',
    ]
  );

  // 4. PAST: events with endAt < 2026-11-18, sorted most recent first
  const past = filterAndSortEventsByTime(sampleEvents, {
    preset: 'PAST',
    referenceDate,
  });
  assert.deepEqual(
    past.map((e) => e.id),
    [
      'ev_multiday_spanning_week_start',
      'ev_past_early_nov',
      'ev_past_oct',
    ],
    'PAST must sort most recently ended events first'
  );

  // 5. ALL: includes undated "Date TBA" events without fabricating fallback dates
  const allEvents = filterAndSortEventsByTime(sampleEvents, {
    preset: 'ALL',
    referenceDate,
  });
  assert.equal(allEvents.length, sampleEvents.length);
  const tbaEvent = allEvents.find((e) => e.id === 'ev_undated_tba')!;
  assert.equal(tbaEvent.startAt, null);
  assert.equal(formatEventDateDisplayIST(tbaEvent), 'Date TBA');

  // 6. CUSTOM range overlap (2026-11-25 to 2026-12-15)
  const customRange = filterAndSortEventsByTime(sampleEvents, {
    preset: 'CUSTOM',
    customStart: '2026-11-25',
    customEnd: '2026-12-15',
    referenceDate,
  });
  assert.deepEqual(
    customRange.map((e) => e.id),
    ['ev_late_nov_this_month', 'ev_dec_future']
  );

  // 7. Announcements filtered strictly by publication date
  const sampleAnns = [
    {
      id: 'a1',
      title: 'Published This Week',
      date: '2026-11-17',
      description: 'Event is in December 2026-12-20',
      image: null,
      attachments: 0,
    },
    {
      id: 'a2',
      title: 'Published Last Month',
      date: '2026-10-15',
      description: 'Event is this week 2026-11-19',
      image: null,
      attachments: 0,
    },
  ];
  const annsThisWeek = filterAnnouncementsByPublicationDate(sampleAnns, {
    preset: 'THIS_WEEK',
    referenceDate,
  });
  assert.deepEqual(
    annsThisWeek.map((a) => a.id),
    ['a1'],
    'Announcements must be filtered strictly by their publication date, never by dates mentioned in description'
  );
});

test('33. Unified Student-Only Discovery & Explainable Recommendation Scoring (45% skill complementarity, 35% shared interests, 20% past swipe affinity, cold-start redistribution, and block/privacy filtering)', async () => {
  const { rankStudentsForHackathon } = await import(
    '../src/services/matchingEngine.ts'
  );

  const sampleHackathon = {
    id: 'hack_scoring_test',
    name: 'PES AI & Systems Hackathon 2026',
    organizer: 'PES Innovation Lab',
    eventType: 'hackathon' as const,
    matchable: true,
    themes: ['AI / ML', 'Distributed Systems'],
    description: 'Build production AI systems with FastAPI, React, and PyTorch.',
    startAt: '2026-12-10',
    endAt: '2026-12-11',
    registrationDeadline: '2026-12-08',
    timezone: 'Asia/Kolkata',
    venue: { campus: 'RR Campus' as const, name: 'MRD Auditorium' },
    format: 'onsite' as const,
    minTeamSize: 2,
    maxTeamSize: 4,
    registrationUrl: 'https://events.pes.edu/ai-systems-2026',
    eligibilityNotes: 'Verified PES students',
    sourceProvenance: 'verified_public_url' as const,
    sourceUrl: 'https://events.pes.edu/ai-systems-2026',
    verificationConfidence: 1,
    createdAt: new Date().toISOString(),
  } as unknown as import('../src/types/domain.ts').Hackathon;

  const makeUser = (uid: string, name: string) => ({
    uid,
    displayName: name,
    personaLabel: 'CSE · 2027',
    campus: 'RR Campus' as const,
    program: 'B.Tech CSE',
    graduationYear: 2027,
    verificationStatus: 'verified_pesu_oidc' as const,
    pesuOidcSub: `SUB_${uid}`,
    isAdmin: false,
    createdAt: new Date().toISOString(),
    accountStatus: 'active' as const,
    privacyPreferences: {
      profileVisible: true,
      githubConsent: true,
      aiEnrichmentConsent: false,
      academyAnnouncementsOptIn: false,
      academyTimetableOptIn: false,
    },
  });

  const userViewer = makeUser('u_viewer', 'Viewer Backend');
  const userComplementary = makeUser('u_comp', 'Complementary Frontend ML');
  const userRedundant = makeUser('u_redundant', 'Redundant Backend');
  const userBlocked = makeUser('u_blocked', 'Blocked Student');

  const profilesMap = {
    u_viewer: {
      uid: 'u_viewer',
      headline: 'Backend Engineer',
      about: 'Building APIs and databases',
      interestTags: ['AI / ML', 'Distributed Systems'],
      skillTags: ['Node.js', 'PostgreSQL', 'Docker'],
      projectDomains: ['Developer Tools', 'AI Agents'],
      topicsToExplore: ['Vector Search'],
      preferredRoles: ['Backend / APIs'],
      rolesWantToLearn: [],
      workingStyleTags: ['Fast prototyping'],
      hackathonGoals: ['Ship a complete MVP'],
      portfolioLinks: [],
      featuredProjects: [],
      visibility: 'public_verified_students' as const,
      updatedAt: new Date().toISOString(),
    },
    u_comp: {
      uid: 'u_comp',
      headline: 'Frontend & PyTorch Builder',
      about: 'React UI + ML inference pipelines',
      interestTags: ['AI / ML', 'Distributed Systems'],
      skillTags: ['React', 'TypeScript', 'PyTorch', 'Figma'],
      projectDomains: ['AI Agents', 'Developer Tools'],
      topicsToExplore: ['Vector Search'],
      preferredRoles: ['Frontend / UI', 'ML / AI'],
      rolesWantToLearn: [],
      workingStyleTags: ['Fast prototyping'],
      hackathonGoals: ['Ship a complete MVP'],
      portfolioLinks: [],
      featuredProjects: [],
      visibility: 'public_verified_students' as const,
      updatedAt: new Date().toISOString(),
    },
    u_redundant: {
      uid: 'u_redundant',
      headline: 'Backend Developer',
      about: 'Only Node.js and PostgreSQL',
      interestTags: ['Gaming'],
      skillTags: ['Node.js', 'PostgreSQL'],
      projectDomains: ['Arcade Games'],
      topicsToExplore: ['Game Physics'],
      preferredRoles: ['Backend / APIs'],
      rolesWantToLearn: [],
      workingStyleTags: [],
      hackathonGoals: [],
      portfolioLinks: [],
      featuredProjects: [],
      visibility: 'public_verified_students' as const,
      updatedAt: new Date().toISOString(),
    },
    u_blocked: {
      uid: 'u_blocked',
      headline: 'Should be filtered out',
      about: '',
      interestTags: ['AI / ML'],
      skillTags: ['React', 'PyTorch'],
      projectDomains: [],
      topicsToExplore: [],
      preferredRoles: ['Frontend / UI'],
      rolesWantToLearn: [],
      workingStyleTags: [],
      hackathonGoals: [],
      portfolioLinks: [],
      featuredProjects: [],
      visibility: 'public_verified_students' as const,
      updatedAt: new Date().toISOString(),
    },
  };

  // 1. Cold-start ranking (no prior swipes) excludes self and blocked users, and ranks complementary student higher
  const coldStartRanked = rankStudentsForHackathon({
    currentUser: userViewer,
    currentProfile: profilesMap.u_viewer,
    hackathon: sampleHackathon,
    allUsers: [userViewer, userComplementary, userRedundant, userBlocked],
    allProfiles: profilesMap,
    participations: [],
    teams: [],
    memberships: [],
    existingInterests: [],
    blocks: [
      {
        id: 'b1',
        blockerUid: 'u_viewer',
        blockedUid: 'u_blocked',
        createdAt: new Date().toISOString(),
      },
    ],
  });

  assert.equal(coldStartRanked.length, 2, 'Must exclude viewer and blocked user');
  assert.equal(
    coldStartRanked[0].id,
    'u_comp',
    'Complementary student with missing Frontend + ML roles and shared AI themes must rank #1'
  );
  assert.ok(
    coldStartRanked[0].overallScore > coldStartRanked[1].overallScore,
    'Complementary candidate score must exceed redundant candidate score'
  );
  assert.ok(
    coldStartRanked[0].reasons.length >= 1 && coldStartRanked[0].reasons.length <= 2,
    'Each card must display 1-2 grounded recommendation reasons'
  );

  // 2. When viewer is in a 3-person team (A + B + C), skill complementarity is computed against combined team skills
  const userFrontendTeammate = makeUser('u_teammate_fe', 'Teammate Frontend');
  const userDataTeammate = makeUser('u_teammate_ml', 'Teammate ML');
  const userSystemsCandidate = makeUser('u_cand_sys', 'Candidate Cloud & Pitch');

  const extendedProfiles = {
    ...profilesMap,
    u_teammate_fe: {
      ...profilesMap.u_comp,
      uid: 'u_teammate_fe',
      skillTags: ['React', 'TypeScript', 'Tailwind'],
      preferredRoles: ['Frontend / UI'],
    },
    u_teammate_ml: {
      ...profilesMap.u_comp,
      uid: 'u_teammate_ml',
      skillTags: ['Python', 'PyTorch'],
      preferredRoles: ['ML / AI'],
    },
    u_cand_sys: {
      ...profilesMap.u_comp,
      uid: 'u_cand_sys',
      skillTags: ['Kubernetes', 'AWS', 'Figma', 'Product Pitch'],
      preferredRoles: ['Product / Pitch', 'Systems / Embedded'],
    },
  };

  const team3Members = {
    id: 'team_3p',
    hackathonId: 'hack_scoring_test',
    name: 'Trio Builders',
    leaderId: 'u_viewer',
    pitch: 'Building AI infra',
    projectIdea: 'Agentic observability',
    rolesNeeded: ['Product / Pitch', 'Systems / Embedded'],
    customSpecializations: [],
    targetSize: 4,
    memberCount: 3,
    status: 'open' as const,
    createdAt: new Date().toISOString(),
  } as unknown as import('../src/types/domain.ts').Team;

  const memberships3 = [
    {
      id: 'm1',
      hackathonId: 'hack_scoring_test',
      teamId: 'team_3p',
      uid: 'u_viewer',
      role: 'Backend / APIs',
      status: 'active' as const,
      joinedAt: new Date().toISOString(),
    },
    {
      id: 'm2',
      hackathonId: 'hack_scoring_test',
      teamId: 'team_3p',
      uid: 'u_teammate_fe',
      role: 'Frontend / UI',
      status: 'active' as const,
      joinedAt: new Date().toISOString(),
    },
    {
      id: 'm3',
      hackathonId: 'hack_scoring_test',
      teamId: 'team_3p',
      uid: 'u_teammate_ml',
      role: 'ML / AI',
      status: 'active' as const,
      joinedAt: new Date().toISOString(),
    },
  ];

  const teamContextRanked = rankStudentsForHackathon({
    currentUser: userViewer,
    currentProfile: extendedProfiles.u_viewer,
    hackathon: sampleHackathon,
    allUsers: [
      userViewer,
      userFrontendTeammate,
      userDataTeammate,
      userComplementary,
      userSystemsCandidate,
    ],
    allProfiles: extendedProfiles,
    participations: [],
    teams: [team3Members],
    memberships: memberships3,
    existingInterests: [],
    blocks: [],
  });

  // Teammates on the same team must be excluded from swipe feed
  assert.ok(
    !teamContextRanked.some(
      (c) => c.id === 'u_teammate_fe' || c.id === 'u_teammate_ml'
    ),
    'Existing teammates must not appear in student discovery feed'
  );
  // Candidate with Product/Pitch + Systems/Cloud skills (which the 3-person team still lacks) should score higher complementarity than another Frontend/ML candidate whose skills the team already has
  const sysCand = teamContextRanked.find((c) => c.id === 'u_cand_sys')!;
  const dupFeMlCand = teamContextRanked.find((c) => c.id === 'u_comp')!;
  assert.ok(
    (sysCand.featureBreakdown.skillComplementarity ?? 0) >
      (dupFeMlCand.featureBreakdown.skillComplementarity ?? 0),
    '3-member team complementarity must evaluate against combined roster (A+B+C) and favor missing Product/Pitch & Cloud capabilities'
  );
});

test('34. End-to-End Student Matching, Automatic 2-Person Team Creation, Unanimous Team Growth (2->3->4), Full Capacity Lock, Team Chat, Registration Lock, and Leave Team', async () => {
  const { upsertUserAndProfile, createOAuthSessionRecord } = await import(
    '../src/db/repository.ts'
  );

  const ts = Date.now();
  const uidA = `stu_a_${ts}`;
  const uidB = `stu_b_${ts}`;
  const uidC = `stu_c_${ts}`;
  const uidD = `stu_d_${ts}`;
  const uidE = `stu_e_${ts}`;

  const tokA = `pesu_tok_a_${ts}`;
  const tokB = `pesu_tok_b_${ts}`;
  const tokC = `pesu_tok_c_${ts}`;
  const tokD = `pesu_tok_d_${ts}`;
  const tokE = `pesu_tok_e_${ts}`;
  const expiresAt = new Date(Date.now() + 3600_000);

  const students = [
    { uid: uidA, tok: tokA, name: 'Aarav Backend', sub: `PES_A_${ts}`, isAdmin: true },
    { uid: uidB, tok: tokB, name: 'Bhavya Frontend', sub: `PES_B_${ts}`, isAdmin: false },
    { uid: uidC, tok: tokC, name: 'Chirag ML', sub: `PES_C_${ts}`, isAdmin: false },
    { uid: uidD, tok: tokD, name: 'Divya Systems', sub: `PES_D_${ts}`, isAdmin: false },
    { uid: uidE, tok: tokE, name: 'Eshan Extra', sub: `PES_E_${ts}`, isAdmin: false },
  ];

  for (const s of students) {
    await upsertUserAndProfile({
      uid: s.uid,
      email: `${s.uid}@pesu.pes.edu`,
      displayName: s.name,
      pesuOidcSub: s.sub,
      isAdmin: s.isAdmin,
    });
    await createOAuthSessionRecord({
      sessionToken: s.tok,
      uid: s.uid,
      pesuSub: s.sub,
      accessToken: `acc_${s.uid}`,
      refreshToken: null,
      scopes: ['openid', 'profile', 'email'],
      expiresAt,
    });
  }

  // Publish a hackathon with minTeamSize = 2, maxTeamSize = 4
  const candRes = await fetch(`${baseUrl}/api/hackathons/candidates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokA}`,
    },
    body: JSON.stringify({
      source: 'submitted_public_url',
      sourceUrl: `https://events.pes.edu/quack-overhaul-${ts}`,
      originalSubmissionUrl: `https://events.pes.edu/quack-overhaul-${ts}`,
      verifiedCanonicalUrl: `https://events.pes.edu/quack-overhaul-${ts}`,
      sourceUrlStatus: 'verified',
      externalFingerprint: `pes__quack_overhaul_${ts}`,
      title: `PES Flagship Hackathon ${ts}`,
      organizer: 'PES Innovation Lab',
      eventType: 'hackathon',
      matchable: true,
      themes: ['AI & Systems'],
      description: '36-hour flagship buildathon.',
      startAt: '2026-12-22',
      endAt: '2026-12-23',
      registrationDeadline: '2026-12-20',
      timezone: 'Asia/Kolkata',
      venue: { campus: 'RR Campus', name: 'MRD Auditorium' },
      format: 'onsite',
      teamSize: { min: 2, max: 4 },
      registrationUrl: `https://events.pes.edu/quack-overhaul-${ts}/register`,
      eligibilityNotes: '2 to 4 students per team',
      fieldEvidence: {},
      classification: { ruleGatePassed: true, mlScore: 1, reason: 'Hackathon' },
      warnings: [],
    }),
  });
  const candData = await candRes.json();
  assert.equal(candRes.status, 201);

  const approveRes = await fetch(
    `${baseUrl}/api/admin/candidates/${candData.candidate.id}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokA}`,
      },
      body: JSON.stringify({
        minTeamSize: 2,
        maxTeamSize: 4,
        eventType: 'hackathon',
        matchable: true,
        campus: 'RR Campus',
      }),
    }
  );
  const approveData = await approveRes.json();
  assert.equal(approveRes.status, 200);
  const hackathonId = approveData.hackathon.id;

  // 1. Verify GET /api/discovery/students returns only student profiles (never teams)
  const discRes = await fetch(
    `${baseUrl}/api/discovery/students?hackathonId=${encodeURIComponent(hackathonId)}`,
    { headers: { Authorization: `Bearer ${tokA}` } }
  );
  const discData = await discRes.json();
  assert.equal(discRes.status, 200);
  assert.equal(discData.ok, true);
  assert.ok(Array.isArray(discData.students));
  assert.ok(discData.students.every((c: { type: string }) => c.type === 'person'));
  assert.ok(!discData.students.some((c: { id: string }) => c.id === uidA));

  // 2. Student A swipes right on Student B -> added to A's shortlist ("Interested"), no team yet
  const swipeAB = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokA}`,
    },
    body: JSON.stringify({
      hackathonId,
      targetType: 'user',
      targetId: uidB,
      decision: 'interested',
      proposedRole: 'Frontend / UI',
    }),
  });
  const swipeABData = await swipeAB.json();
  assert.equal(swipeAB.status, 200);
  assert.equal(swipeABData.autoCreatedTeam, undefined);

  // Check B's shortlist -> A appears under "incomingInterested" (Interested in You)
  const shortlistB1 = await fetch(
    `${baseUrl}/api/swipes/shortlist?hackathonId=${encodeURIComponent(hackathonId)}`,
    { headers: { Authorization: `Bearer ${tokB}` } }
  );
  const shortlistB1Data = await shortlistB1.json();
  assert.equal(shortlistB1.status, 200);
  assert.ok(
    shortlistB1Data.shortlist.incomingInterested.some(
      (e: { uid: string }) => e.uid === uidA
    ),
    'Student A must appear in Student B incomingInterested shortlist'
  );

  // 3. Student B swipes right on Student A -> Mutual Match automatically creates a 2-person team!
  const swipeBA = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokB}`,
    },
    body: JSON.stringify({
      hackathonId,
      targetType: 'user',
      targetId: uidA,
      decision: 'interested',
      proposedRole: 'Backend / APIs',
    }),
  });
  const swipeBAData = await swipeBA.json();
  assert.equal(swipeBA.status, 200);
  assert.ok(
    swipeBAData.autoCreatedTeam,
    'Mutual right-swipe between two solo students must automatically create a 2-person team'
  );
  assert.equal(swipeBAData.autoCreatedTeam.memberCount, 2);
  assert.equal(swipeBAData.autoCreatedTeam.targetSize, 4);
  assert.equal(swipeBAData.autoCreatedMemberships.length, 2);
  assert.ok(swipeBAData.matchedConversation);
  assert.ok(swipeBAData.teamRosterConversation);

  const autoTeamId = swipeBAData.autoCreatedTeam.id;

  // Verify GET /api/teams/me returns the newly formed 2-person team for both A and B
  const myTeamARes = await fetch(
    `${baseUrl}/api/teams/me?hackathonId=${encodeURIComponent(hackathonId)}`,
    { headers: { Authorization: `Bearer ${tokA}` } }
  );
  const myTeamAData = await myTeamARes.json();
  assert.equal(myTeamARes.status, 200);
  assert.equal(myTeamAData.teams.length, 1);
  assert.equal(myTeamAData.teams[0].team.id, autoTeamId);
  assert.equal(myTeamAData.teams[0].members.length, 2);
  assert.equal(
    myTeamAData.teams[0].registration.registrationStatus,
    'ready_to_register',
    '2-person team meets minTeamSize=2 and should be ready_to_register'
  );

  // 4. Growing the existing 2-person team (A + B) to 3 members (adding C) via unanimous vote + candidate consent
  // Member A swipes right on Student C
  const swipeAC = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokA}`,
    },
    body: JSON.stringify({
      hackathonId,
      targetType: 'user',
      targetId: uidC,
      decision: 'interested',
      proposedRole: 'ML / AI',
    }),
  });
  assert.equal(swipeAC.status, 200);

  // Student C swipes right on Member A -> creates a team_proposal (status: 'pending_team_vote' because B hasn't voted yet)
  const swipeCA = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokC}`,
    },
    body: JSON.stringify({
      hackathonId,
      targetType: 'user',
      targetId: uidA,
      decision: 'interested',
      proposedRole: 'Backend / APIs',
    }),
  });
  const swipeCAData = await swipeCA.json();
  assert.equal(swipeCA.status, 200);
  assert.ok(
    swipeCAData.teamProposal,
    'Mutual interest with a student already in a team must create a team_proposal'
  );
  assert.equal(swipeCAData.teamProposal.status, 'pending_votes');
  assert.equal(swipeCAData.teamProposal.candidateUid, uidC);
  const proposalCId = swipeCAData.teamProposal.id;

  // Candidate C CANNOT accept the proposal before all current team members (A and B) approve
  const prematureAccept = await fetch(
    `${baseUrl}/api/teams/proposals/${proposalCId}/accept`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokC}`,
      },
      body: JSON.stringify({ decision: 'accept' }),
    }
  );
  assert.equal(
    prematureAccept.status,
    409,
    'Candidate cannot accept before unanimous approval from all current team members'
  );

  // Teammate B votes to approve C -> unanimous approval achieved! Proposal transitions to 'invited'
  const voteBForC = await fetch(
    `${baseUrl}/api/teams/proposals/${proposalCId}/vote`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokB}`,
      },
      body: JSON.stringify({ vote: 'approve' }),
    }
  );
  const voteBForCData = await voteBForC.json();
  assert.equal(voteBForC.status, 200);
  assert.equal(voteBForCData.unanimouslyApproved, true);
  assert.equal(voteBForCData.proposal.status, 'invited');

  // Candidate C now accepts the invitation -> joins team (3/4 members)
  const acceptC = await fetch(
    `${baseUrl}/api/teams/proposals/${proposalCId}/accept`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokC}`,
      },
      body: JSON.stringify({ decision: 'accept' }),
    }
  );
  const acceptCData = await acceptC.json();
  assert.equal(acceptC.status, 200);
  assert.equal(acceptCData.proposal.status, 'accepted');
  assert.equal(acceptCData.team.memberCount, 3);
  assert.equal(acceptCData.team.status, 'open');

  // 5. Grow from 3/4 to 4/4 (adding D) and verify full capacity lock + pending proposal expiration
  // First create a pending proposal for Student E as well so we can verify it auto-expires when D fills the 4th slot
  await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokA}`,
    },
    body: JSON.stringify({
      hackathonId,
      targetType: 'user',
      targetId: uidE,
      decision: 'interested',
    }),
  });
  const swipeEA = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokE}`,
    },
    body: JSON.stringify({
      hackathonId,
      targetType: 'user',
      targetId: uidA,
      decision: 'interested',
    }),
  });
  const swipeEAData = await swipeEA.json();
  const proposalEId = swipeEAData.teamProposal.id;

  // Now A and D match -> B and C both vote approve -> D accepts -> team reaches 4/4!
  await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokA}`,
    },
    body: JSON.stringify({
      hackathonId,
      targetType: 'user',
      targetId: uidD,
      decision: 'interested',
    }),
  });
  const swipeDA = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokD}`,
    },
    body: JSON.stringify({
      hackathonId,
      targetType: 'user',
      targetId: uidA,
      decision: 'interested',
    }),
  });
  const swipeDAData = await swipeDA.json();
  const proposalDId = swipeDAData.teamProposal.id;

  // B votes approve (still waiting on C since team has 3 members: A, B, C)
  const voteBForD = await fetch(
    `${baseUrl}/api/teams/proposals/${proposalDId}/vote`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokB}`,
      },
      body: JSON.stringify({ vote: 'approve' }),
    }
  );
  const voteBForDData = await voteBForD.json();
  assert.equal(
    voteBForDData.unanimouslyApproved,
    false,
    'With 3 current team members (A, B, C), B voting alone is not yet unanimous'
  );

  // C votes approve -> now all 3 members (A, B, C) have approved!
  const voteCForD = await fetch(
    `${baseUrl}/api/teams/proposals/${proposalDId}/vote`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokC}`,
      },
      body: JSON.stringify({ vote: 'approve' }),
    }
  );
  const voteCForDData = await voteCForD.json();
  assert.equal(voteCForDData.unanimouslyApproved, true);
  assert.equal(voteCForDData.proposal.status, 'invited');

  // D accepts -> team reaches 4/4 ('full') and proposalE auto-expires!
  const acceptD = await fetch(
    `${baseUrl}/api/teams/proposals/${proposalDId}/accept`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokD}`,
      },
      body: JSON.stringify({ decision: 'accept' }),
    }
  );
  const acceptDData = await acceptD.json();
  assert.equal(acceptD.status, 200);
  assert.equal(acceptDData.team.memberCount, 4);
  assert.equal(acceptDData.team.status, 'full');

  // Verify proposalE was automatically expired when team reached 4/4
  const teamDetailsFull = await fetch(`${baseUrl}/api/teams/${autoTeamId}`, {
    headers: { Authorization: `Bearer ${tokA}` },
  });
  const teamDetailsFullData = await teamDetailsFull.json();
  const expiredPropE = teamDetailsFullData.proposals.find(
    (p: { id: string }) => p.id === proposalEId
  );
  assert.equal(
    expiredPropE.status,
    'expired',
    'Pending proposals must auto-expire when team reaches max capacity (4/4)'
  );

  // 6. Team Chat: members can post and read messages; non-member E gets 403
  const postChatRes = await fetch(
    `${baseUrl}/api/teams/${autoTeamId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokC}`,
      },
      body: JSON.stringify({
        body: 'Hey team, excited to build together as a 4-person squad!',
      }),
    }
  );
  assert.equal(postChatRes.status, 201);

  const getChatRes = await fetch(
    `${baseUrl}/api/teams/${autoTeamId}/messages`,
    { headers: { Authorization: `Bearer ${tokA}` } }
  );
  const getChatData = await getChatRes.json();
  assert.equal(getChatRes.status, 200);
  assert.ok(
    getChatData.messages.some(
      (m: { senderUid: string; body: string }) =>
        m.senderUid === uidC && m.body.includes('4-person squad')
    )
  );

  const nonMemberChatRes = await fetch(
    `${baseUrl}/api/teams/${autoTeamId}/messages`,
    { headers: { Authorization: `Bearer ${tokE}` } }
  );
  assert.equal(
    nonMemberChatRes.status,
    403,
    'Non-member must receive 403 when accessing team chat'
  );

  // 7. Hackathon Registration: mark team as 'registered' with reference ID -> blocks silent roster changes
  const regRes = await fetch(
    `${baseUrl}/api/teams/${autoTeamId}/registration`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokA}`,
      },
      body: JSON.stringify({
        registrationStatus: 'registered',
        externalRegistrationReference: 'PES-REG-9988',
        confirmationNotes: 'Submitted on official PES portal',
      }),
    }
  );
  const regData = await regRes.json();
  assert.equal(regRes.status, 200);
  assert.equal(regData.registration.registrationStatus, 'registered');
  assert.equal(
    regData.registration.externalRegistrationReference,
    'PES-REG-9988'
  );

  // Leaving a registered team is blocked with 409 until registration status is amended
  const blockedLeaveRes = await fetch(
    `${baseUrl}/api/teams/${autoTeamId}/leave`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokD}` },
    }
  );
  assert.equal(
    blockedLeaveRes.status,
    409,
    'Cannot silently leave a team that is already marked as registered'
  );

  // Amend registration back to 'ready_to_register' -> Leader A leaves team -> leaderId reassigns and status reopens to 'open' (3/4)
  await fetch(`${baseUrl}/api/teams/${autoTeamId}/registration`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokA}`,
    },
    body: JSON.stringify({
      registrationStatus: 'ready_to_register',
    }),
  });

  const leaveARes = await fetch(`${baseUrl}/api/teams/${autoTeamId}/leave`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokA}` },
  });
  const leaveAData = await leaveARes.json();
  assert.equal(leaveARes.status, 200);
  assert.equal(leaveAData.remainingMembers, 3);
  assert.equal(leaveAData.dissolved, false);

  const afterLeaveTeam = await fetch(`${baseUrl}/api/teams/${autoTeamId}`, {
    headers: { Authorization: `Bearer ${tokB}` },
  });
  const afterLeaveData = await afterLeaveTeam.json();
  assert.equal(afterLeaveData.team.memberCount, 3);
  assert.equal(
    afterLeaveData.team.status,
    'open',
    'Leaving a full 4/4 team must reopen recruitment status to open (3/4)'
  );
  assert.notEqual(
    afterLeaveData.team.leaderId,
    uidA,
    'Leader must be reassigned to a remaining active member when previous leader leaves'
  );
});

test('35. Edge Cases: Single member rejection blocks invitation, and accepting one team invitation atomically invalidates competing invitations in the same hackathon', async () => {
  const { upsertUserAndProfile, createOAuthSessionRecord } = await import(
    '../src/db/repository.ts'
  );

  const ts = Date.now();
  const uidT1A = `t1a_${ts}`;
  const uidT1B = `t1b_${ts}`;
  const uidT2A = `t2a_${ts}`;
  const uidT2B = `t2b_${ts}`;
  const uidCand = `cand_${ts}`;
  const uidRejected = `rej_${ts}`;

  const tokT1A = `pesu_tok_t1a_${ts}`;
  const tokT1B = `pesu_tok_t1b_${ts}`;
  const tokT2A = `pesu_tok_t2a_${ts}`;
  const tokT2B = `pesu_tok_t2b_${ts}`;
  const tokCand = `pesu_tok_cand_${ts}`;
  const tokRejected = `pesu_tok_rej_${ts}`;
  const expiresAt = new Date(Date.now() + 3600_000);

  for (const u of [
    { uid: uidT1A, tok: tokT1A, name: 'Team1 Alpha', isAdmin: true },
    { uid: uidT1B, tok: tokT1B, name: 'Team1 Beta', isAdmin: false },
    { uid: uidT2A, tok: tokT2A, name: 'Team2 Alpha', isAdmin: false },
    { uid: uidT2B, tok: tokT2B, name: 'Team2 Beta', isAdmin: false },
    { uid: uidCand, tok: tokCand, name: 'Sought-After Candidate', isAdmin: false },
    { uid: uidRejected, tok: tokRejected, name: 'Rejected Candidate', isAdmin: false },
  ]) {
    await upsertUserAndProfile({
      uid: u.uid,
      email: `${u.uid}@pesu.pes.edu`,
      displayName: u.name,
      pesuOidcSub: `SUB_${u.uid}`,
      isAdmin: u.isAdmin,
    });
    await createOAuthSessionRecord({
      sessionToken: u.tok,
      uid: u.uid,
      pesuSub: `SUB_${u.uid}`,
      accessToken: `acc_${u.uid}`,
      refreshToken: null,
      scopes: ['openid', 'profile', 'email'],
      expiresAt,
    });
  }

  // Publish hackathon
  const candRes = await fetch(`${baseUrl}/api/hackathons/candidates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokT1A}`,
    },
    body: JSON.stringify({
      source: 'submitted_public_url',
      sourceUrl: `https://events.pes.edu/competing-teams-${ts}`,
      originalSubmissionUrl: `https://events.pes.edu/competing-teams-${ts}`,
      verifiedCanonicalUrl: `https://events.pes.edu/competing-teams-${ts}`,
      sourceUrlStatus: 'verified',
      externalFingerprint: `pes__competing_${ts}`,
      title: `Competing Teams Hackathon ${ts}`,
      organizer: 'PES University',
      eventType: 'hackathon',
      matchable: true,
      themes: ['Systems'],
      description: 'Hackathon for testing competing team invitations.',
      startAt: '2026-12-24',
      endAt: '2026-12-25',
      registrationDeadline: '2026-12-22',
      timezone: 'Asia/Kolkata',
      venue: { campus: 'EC Campus', name: 'Main Auditorium' },
      format: 'onsite',
      teamSize: { min: 2, max: 4 },
      registrationUrl: `https://events.pes.edu/competing-teams-${ts}`,
      eligibilityNotes: 'Open to all',
      fieldEvidence: {},
      classification: { ruleGatePassed: true, mlScore: 1, reason: 'Hackathon' },
      warnings: [],
    }),
  });
  const candData = await candRes.json();
  const approveRes = await fetch(
    `${baseUrl}/api/admin/candidates/${candData.candidate.id}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokT1A}`,
      },
      body: JSON.stringify({
        minTeamSize: 2,
        maxTeamSize: 4,
        eventType: 'hackathon',
        matchable: true,
        campus: 'EC Campus',
      }),
    }
  );
  const hackathonId = (await approveRes.json()).hackathon.id;

  // Form Team 1 (uidT1A + uidT1B) and Team 2 (uidT2A + uidT2B) via mutual right swipes
  await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokT1A}` },
    body: JSON.stringify({ hackathonId, targetType: 'user', targetId: uidT1B, decision: 'interested' }),
  });
  const t1Match = await (
    await fetch(`${baseUrl}/api/swipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokT1B}` },
      body: JSON.stringify({ hackathonId, targetType: 'user', targetId: uidT1A, decision: 'interested' }),
    })
  ).json();
  const team1Id = t1Match.autoCreatedTeam.id;

  await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokT2A}` },
    body: JSON.stringify({ hackathonId, targetType: 'user', targetId: uidT2B, decision: 'interested' }),
  });
  const t2Match = await (
    await fetch(`${baseUrl}/api/swipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokT2B}` },
      body: JSON.stringify({ hackathonId, targetType: 'user', targetId: uidT2A, decision: 'interested' }),
    })
  ).json();
  const team2Id = t2Match.autoCreatedTeam.id;

  // Case 1: uidT1A matches with uidRejected -> uidT1B votes REJECT -> proposal immediately marked 'rejected'
  await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokT1A}` },
    body: JSON.stringify({ hackathonId, targetType: 'user', targetId: uidRejected, decision: 'interested' }),
  });
  const rejPropRes = await (
    await fetch(`${baseUrl}/api/swipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokRejected}` },
      body: JSON.stringify({ hackathonId, targetType: 'user', targetId: uidT1A, decision: 'interested' }),
    })
  ).json();
  const rejPropId = rejPropRes.teamProposal.id;

  const rejectVoteRes = await fetch(
    `${baseUrl}/api/teams/proposals/${rejPropId}/vote`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokT1B}` },
      body: JSON.stringify({ vote: 'reject' }),
    }
  );
  const rejectVoteData = await rejectVoteRes.json();
  assert.equal(rejectVoteRes.status, 200);
  assert.equal(rejectVoteData.proposal.status, 'rejected');

  // Case 2: uidCand matches with BOTH Team 1 and Team 2, and both teams unanimously approve -> uidCand receives 2 competing invitations
  await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokT1A}` },
    body: JSON.stringify({ hackathonId, targetType: 'user', targetId: uidCand, decision: 'interested' }),
  });
  const prop1Data = await (
    await fetch(`${baseUrl}/api/swipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokCand}` },
      body: JSON.stringify({ hackathonId, targetType: 'user', targetId: uidT1A, decision: 'interested' }),
    })
  ).json();
  const prop1Id = prop1Data.teamProposal.id;

  await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokT2A}` },
    body: JSON.stringify({ hackathonId, targetType: 'user', targetId: uidCand, decision: 'interested' }),
  });
  const prop2Data = await (
    await fetch(`${baseUrl}/api/swipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokCand}` },
      body: JSON.stringify({ hackathonId, targetType: 'user', targetId: uidT2A, decision: 'interested' }),
    })
  ).json();
  const prop2Id = prop2Data.teamProposal.id;

  // Both Team 1 (uidT1B) and Team 2 (uidT2B) vote approve -> both proposals transition to 'invited'
  await fetch(`${baseUrl}/api/teams/proposals/${prop1Id}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokT1B}` },
    body: JSON.stringify({ vote: 'approve' }),
  });
  await fetch(`${baseUrl}/api/teams/proposals/${prop2Id}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokT2B}` },
    body: JSON.stringify({ vote: 'approve' }),
  });

  // Candidate accepts Team 1 -> joins Team 1 (3/4) AND Team 2's invitation is atomically expired
  const acceptTeam1 = await fetch(
    `${baseUrl}/api/teams/proposals/${prop1Id}/accept`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokCand}` },
      body: JSON.stringify({ decision: 'accept' }),
    }
  );
  assert.equal(acceptTeam1.status, 200);

  // Attempting to also accept Team 2 must fail with 409
  const acceptTeam2 = await fetch(
    `${baseUrl}/api/teams/proposals/${prop2Id}/accept`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokCand}` },
      body: JSON.stringify({ decision: 'accept' }),
    }
  );
  assert.equal(
    acceptTeam2.status,
    409,
    'Candidate cannot join a second team in the same hackathon after accepting Team 1'
  );

  // Verify Team 2 still has only 2 members and prop2 status is 'expired'
  const team2Inspect = await (
    await fetch(`${baseUrl}/api/teams/${team2Id}`, {
      headers: { Authorization: `Bearer ${tokT2A}` },
    })
  ).json();
  assert.equal(team2Inspect.team.memberCount, 2);
  const prop2After = team2Inspect.proposals.find(
    (p: { id: string }) => p.id === prop2Id
  );
  assert.equal(prop2After.status, 'expired');
  assert.notEqual(team1Id, team2Id);
});

test('36. PESU Announcements HTML 403 upstream error handling (PROVIDER_UNAVAILABLE 502 + homepageBannersSupported=false) and public events.pes.edu pagination extraction', async () => {
  const {
    upsertUserAndProfile,
    updateUserProfileAndPrivacy,
    createOAuthSessionRecord,
  } = await import('../src/db/repository.ts');
  const { extractPesuEventsPaginationLinks } = await import(
    '../src/lib/eventsAndAnnouncements.ts'
  );

  // 1. Verify extractPesuEventsPaginationLinks discovers ?page=2, ?page=3 links on events.pes.edu/browse/...
  const sampleBrowseHtml = `
    <html>
      <body>
        <div class="events-list">
          <a href="/events/hack-1">Hack 1</a>
        </div>
        <nav class="pagination">
          <a href="/browse/7?page=1">1</a>
          <a href="/browse/7?page=2">2</a>
          <a href="https://events.pes.edu/browse/7?page=3">3</a>
          <a href="/browse/99?page=2">Different Category</a>
        </nav>
      </body>
    </html>
  `;
  const pageLinks = extractPesuEventsPaginationLinks(
    sampleBrowseHtml,
    'https://events.pes.edu/browse/7'
  );
  assert.deepEqual(
    pageLinks,
    [
      'https://events.pes.edu/browse/7?page=2',
      'https://events.pes.edu/browse/7?page=3',
    ],
    'Must extract valid pagination links for the current browse category and ignore page 1 or other categories'
  );

  // 2. Verify GET /api/pesu/announcements?refresh=true returns PROVIDER_UNAVAILABLE (502) and homepageBannersSupported=false when upstream returns an HTML 403 page (even when user has announcements:read)
  const ts = Date.now();
  const uidAnn = `pesu_ann_html403_${ts}`;
  const tokAnn = `pesu_tok_ann_html403_${ts}`;

  const { profile: annProfile } = await upsertUserAndProfile({
    uid: uidAnn,
    email: `${uidAnn}@pesu.pes.edu`,
    displayName: 'Announcement Tester',
    pesuOidcSub: `SUB_${uidAnn}`,
    isAdmin: false,
  });
  await updateUserProfileAndPrivacy({
    uid: uidAnn,
    profile: annProfile,
    privacyPreferences: {
      profileVisible: true,
      githubConsent: false,
      aiEnrichmentConsent: false,
      academyAnnouncementsOptIn: true,
      academyTimetableOptIn: false,
    },
  });
  await createOAuthSessionRecord({
    sessionToken: tokAnn,
    uid: uidAnn,
    pesuSub: `SUB_${uidAnn}`,
    accessToken: 'valid_token_with_announcements_scope',
    refreshToken: null,
    scopes: ['openid', 'profile', 'email', 'announcements:read'],
    expiresAt: new Date(Date.now() + 3600_000),
  });

  setServerTestOverrides({
    fetchFn: async (input) => {
      const url = String(input);
      if (url.includes('/api/v1/announcements')) {
        return new Response(
          '<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1><p>Upstream Render/Cloudflare block</p></body></html>',
          {
            status: 403,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }
        );
      }
      return new Response('{}', { status: 200 });
    },
  });

  try {
    const annRes = await fetch(
      `${baseUrl}/api/pesu/announcements?refresh=true`,
      {
        headers: { Authorization: `Bearer ${tokAnn}` },
      }
    );
    const annData = await annRes.json();
    assert.equal(
      annRes.status,
      502,
      'Upstream HTML 403 proxy error when user already has announcements:read scope must return 502 PROVIDER_UNAVAILABLE, not 403 MISSING_ANNOUNCEMENTS_SCOPE'
    );
    assert.equal(annData.errorCode, 'PROVIDER_UNAVAILABLE');
    assert.equal(annData.homepageBannersSupported, false);
    assert.ok(
      typeof annData.homepageBannersNote === 'string' &&
        annData.homepageBannersNote.includes('homepage carousel banners'),
      'Response must explicitly document that PESU Academy homepage carousel banners are not exposed by the API'
    );
  } finally {
    resetServerTestOverrides();
  }
});







