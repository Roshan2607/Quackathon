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
  process.env.PESU_OAUTH_ISSUER_URL = 'https://ais-dev-br3lg427hqulcvidjuf6bn-148109744684.asia-east1.run.app/auth/pesu/callback';
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
  assert.ok(
    data.allowedRedirectUris.includes('https://ais-dev-br3lg427hqulcvidjuf6bn-148109744684.asia-east1.run.app/auth/pesu/callback')
  );
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

  // 3. Callback still succeeds because transaction is stored in PostgreSQL
  const cbRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=auth_code_multi_1&state=${encodeURIComponent(
      urlData.state
    )}`
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

test('28. Missing OAuth full-name claim does not default displayName to SRN and keeps SRN separate', async () => {
  const { db } = await import('../src/db/index.ts');
  const { users, profiles, oauthSessions } = await import('../src/db/schema.ts');
  const { eq } = await import('drizzle-orm');

  resetServerTestOverrides();
  process.env.PESU_OAUTH_CLIENT_ID = 'test_pesu_client_123';
  process.env.PESU_OAUTH_CLIENT_SECRET = 'test_pesu_secret_123';
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
          aud: 'test_pesu_client_123',
          sub: 'pesu_srn_student_01',
          preferred_username: 'PES1UG23CS777',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        return new Response(
          JSON.stringify({
            access_token: 'token_srn_test_1',
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
            sub: 'pesu_srn_student_01',
            preferred_username: 'PES1UG23CS777',
            srn: 'PES1UG23CS777',
            email: 'student777@pesu.pes.edu',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    },
  });

  const urlRes = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email`);
  const sidCookie = (urlRes.headers.get('set-cookie') ?? '').split(';')[0];
  const urlData = await urlRes.json();

  const cbRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=srn_code_1&state=${encodeURIComponent(urlData.state)}`,
    { headers: { Cookie: sidCookie } }
  );
  const cbHtml = await cbRes.text();
  assert.equal(cbRes.status, 200);

  // Extract postMessage payload from callback HTML
  const match = cbHtml.match(/var payload = ({.*?});/);
  assert.ok(match, 'Callback HTML must contain payload');
  const payload = JSON.parse(match[1]);

  assert.equal(payload.ok, true);
  assert.ok(!payload.user.displayName.includes('PES1UG23CS777'), 'displayName must NOT be an SRN');
  assert.equal(payload.user.displayName, 'PES Student');
  assert.equal(payload.identity.srn, 'PES1UG23CS777');
  assert.ok(!payload.identity.name, 'identity.name must be null/undefined when only SRN is given');

  // Verify DB session restoration
  const oauthCookie = (cbRes.headers.get('set-cookie') ?? '').split(';')[0];
  const sessRes = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: `${sidCookie}; ${oauthCookie}` },
  });
  const sessData = await sessRes.json();
  assert.equal(sessData.ok, true);
  assert.equal(sessData.authenticated, true);
  assert.equal(sessData.user.displayName, 'PES Student');

  // Cleanup
  await db.delete(oauthSessions).where(eq(oauthSessions.uid, payload.user.uid));
  await db.delete(profiles).where(eq(profiles.uid, payload.user.uid));
  await db.delete(users).where(eq(users.uid, payload.user.uid));
});

test('29. Preserves chosen display name across future OAuth re-logins and does not overwrite with OAuth claims', async () => {
  const { db } = await import('../src/db/index.ts');
  const { users, profiles, oauthSessions } = await import('../src/db/schema.ts');
  const { eq } = await import('drizzle-orm');

  resetServerTestOverrides();
  process.env.PESU_OAUTH_CLIENT_ID = 'test_pesu_client_123';
  process.env.PESU_OAUTH_CLIENT_SECRET = 'test_pesu_secret_123';
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
            scopes_supported: ['openid', 'profile', 'email'],
            code_challenge_methods_supported: ['S256'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === 'https://oauth.pesu.mock/token') {
        const idToken = createBase64UrlJwt({
          iss: 'https://oauth.pesu.mock',
          aud: 'test_pesu_client_123',
          sub: 'pesu_relogin_user_02',
          preferred_username: 'PES1UG23CS555',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        return new Response(
          JSON.stringify({
            access_token: 'token_relogin_1',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid profile email',
            id_token: idToken,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    },
  });

  // Step 1: Initial Login
  const urlRes = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email`);
  const sidCookie = (urlRes.headers.get('set-cookie') ?? '').split(';')[0];
  const urlData = await urlRes.json();

  const cbRes = await fetch(
    `${baseUrl}/auth/pesu/callback?code=relogin_code_1&state=${encodeURIComponent(urlData.state)}`,
    { headers: { Cookie: sidCookie } }
  );
  const cbCookie = (cbRes.headers.get('set-cookie') ?? '').split(';')[0];
  const authHeaders = { Cookie: `${sidCookie}; ${cbCookie}` };

  // Step 2: Student chooses a custom display name "Ananya Rao"
  const updateRes = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Ananya Rao',
      profile: {
        headline: 'AI Builder',
        skillTags: ['Python', 'PyTorch'],
        interestTags: ['Applied AI/ML'],
        preferredRoles: ['ML/Data'],
      },
    }),
  });
  const updateData = await updateRes.json();
  assert.equal(updateRes.status, 200);
  assert.equal(updateData.user.displayName, 'Ananya Rao');

  // Step 3: Student logs in again later via PESU OAuth
  const urlRes2 = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email`);
  const sidCookie2 = (urlRes2.headers.get('set-cookie') ?? '').split(';')[0];
  const urlData2 = await urlRes2.json();

  const cbRes2 = await fetch(
    `${baseUrl}/auth/pesu/callback?code=relogin_code_2&state=${encodeURIComponent(urlData2.state)}`,
    { headers: { Cookie: sidCookie2 } }
  );
  const cbCookie2 = (cbRes2.headers.get('set-cookie') ?? '').split(';')[0];

  const sessRes = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: `${sidCookie2}; ${cbCookie2}` },
  });
  const sessData = await sessRes.json();
  assert.equal(sessData.ok, true);
  assert.equal(sessData.authenticated, true);
  assert.equal(
    sessData.user.displayName,
    'Ananya Rao',
    'Custom display name must be preserved across OAuth re-logins'
  );

  // Cleanup
  await db.delete(oauthSessions).where(eq(oauthSessions.uid, sessData.user.uid));
  await db.delete(profiles).where(eq(profiles.uid, sessData.user.uid));
  await db.delete(users).where(eq(users.uid, sessData.user.uid));
});

test('30. Closed, ended, or non-matchable hackathons reject new team creation and swipe matching in backend APIs', async () => {
  const { upsertUserAndProfile, createOAuthSessionRecord, createPublishedHackathonDirect } = await import('../src/db/repository.ts');
  const { db } = await import('../src/db/index.ts');
  const { hackathons, users, profiles, oauthSessions, teams, swipes } = await import('../src/db/schema.ts');
  const { eq } = await import('drizzle-orm');

  // Create test user
  const testUid = `elig_user_${Date.now()}`;
  await upsertUserAndProfile({
    uid: testUid,
    displayName: 'Eligibility Tester',
    email: 'elig@pesu.pes.edu',
    pesuOidcSub: `sub_elig_${Date.now()}`,
    isAdmin: false,
  });

  const sessionToken = `pesu_tok_elig_${Date.now()}`;
  await createOAuthSessionRecord({
    sessionToken,
    uid: testUid,
    pesuSub: `sub_elig_${Date.now()}`,
    accessToken: null,
    refreshToken: null,
    scopes: ['openid', 'profile'],
    expiresAt: new Date(Date.now() + 3600000),
  });

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };

  // 1. Create a closed hackathon (registrationDeadline in past)
  const closedSlug = `closed_hack_${Date.now()}`;
  await createPublishedHackathonDirect({
    slug: closedSlug,
    name: 'Closed Hackathon 2025',
    organizer: 'Past Club',
    description: 'Past event where registration has ended.',
    eventType: 'hackathon',
    matchable: true,
    themes: ['AI/ML'],
    campus: 'RR Campus',
    venueName: 'Auditorium',
    format: 'onsite',
    startAt: '2025-10-10',
    endAt: '2025-10-11',
    registrationDeadline: '2025-10-01',
    minTeamSize: 2,
    maxTeamSize: 4,
    registrationUrl: 'https://events.pes.edu/past',
    verifiedCanonicalUrl: 'https://events.pes.edu/past',
    sourceUrlStatus: 'verified',
    createdByUid: testUid,
  });

  // Attempting to create a team for the closed event should return 400
  const teamRes = await fetch(`${baseUrl}/api/teams`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      hackathonId: closedSlug,
      name: 'Late Team',
      pitch: 'Trying to register late',
    }),
  });
  const teamData = await teamRes.json();
  assert.equal(teamRes.status, 400);
  assert.equal(teamData.ok, false);
  assert.match(teamData.error, /Registration for this event has closed|ended/);

  // Attempting to swipe interested on the closed event should return 400
  const swipeRes = await fetch(`${baseUrl}/api/swipes`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      hackathonId: closedSlug,
      targetType: 'user',
      targetId: 'target_student_123',
      decision: 'interested',
    }),
  });
  const swipeData = await swipeRes.json();
  assert.equal(swipeRes.status, 400);
  assert.equal(swipeData.ok, false);
  assert.match(swipeData.error, /Registration for this event has closed|ended/);

  // Cleanup
  await db.delete(swipes).where(eq(swipes.hackathonSlug, closedSlug));
  await db.delete(teams).where(eq(teams.hackathonSlug, closedSlug));
  await db.delete(hackathons).where(eq(hackathons.slug, closedSlug));
  await db.delete(oauthSessions).where(eq(oauthSessions.uid, testUid));
  await db.delete(profiles).where(eq(profiles.uid, testUid));
  await db.delete(users).where(eq(users.uid, testUid));
});





