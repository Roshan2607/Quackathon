import http from 'node:http';
import crypto from 'node:crypto';
import { app, setServerTestOverrides, resetServerTestOverrides } from '../server.ts';

let serverInstance: http.Server;
let baseUrl = '';

function createBase64UrlJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = Buffer.from('mock_sig').toString('base64url');
  return `${header}.${body}.${sig}`;
}

async function run() {
  await new Promise<void>((resolve) => {
    serverInstance = app.listen(0, '127.0.0.1', () => {
      const addr = serverInstance.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });

  process.env.PESU_OAUTH_CLIENT_ID = 'test_client_perf';
  process.env.PESU_OAUTH_CLIENT_SECRET = 'test_secret_perf';
  process.env.PESU_OAUTH_ISSUER_URL = 'https://oauth.pesu.mock';

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
        const idToken = createBase64UrlJwt({
          iss: 'https://oauth.pesu.mock',
          aud: 'test_client_perf',
          sub: 'perf_student_123',
          name: 'Latency Baseline Tester',
          email: 'perf@pesu.pes.edu',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        return new Response(
          JSON.stringify({
            access_token: 'perf_access_token_abc',
            refresh_token: 'perf_refresh_token_def',
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
            sub: 'perf_student_123',
            name: 'Latency Baseline Tester',
            email: 'perf@pesu.pes.edu',
            preferred_username: 'PES1UG23CS888',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    },
  });

  const runs = 5;
  const metrics = {
    oauthInitiation: [] as number[],
    oauthCallbackTokenExchange: [] as number[],
    sessionRestoration: [] as number[],
    bootstrapLoading: [] as number[],
    endToEndLoginTotal: [] as number[],
  };

  console.log(`Starting ${runs} benchmark runs on baseline implementation...`);

  for (let i = 0; i < runs; i++) {
    // 1. OAuth Initiation
    const t0 = performance.now();
    const urlRes = await fetch(`${baseUrl}/api/pesu-oauth/url?scope=openid%20profile%20email`);
    const t1 = performance.now();
    metrics.oauthInitiation.push(t1 - t0);

    const setCookieHeader = urlRes.headers.get('set-cookie') ?? '';
    const cookiePair = setCookieHeader.split(';')[0];
    const urlData = (await urlRes.json()) as { state: string };

    // 2. OAuth Callback & Token Exchange
    const t2 = performance.now();
    const cbRes = await fetch(
      `${baseUrl}/auth/pesu/callback?code=mock_code_${i}&state=${encodeURIComponent(urlData.state)}`,
      { headers: { Cookie: cookiePair } }
    );
    await cbRes.text();
    const t3 = performance.now();
    metrics.oauthCallbackTokenExchange.push(t3 - t2);

    const cbCookieHeader = cbRes.headers.get('set-cookie') ?? '';
    const cbCookiePairs = cbCookieHeader.split(',').map(c => c.split(';')[0].trim()).join('; ');
    const combinedCookie = `${cookiePair}; ${cbCookiePairs}`;

    // 3. Session Restoration
    const t4 = performance.now();
    const sessRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: combinedCookie },
    });
    await sessRes.json();
    const t5 = performance.now();
    metrics.sessionRestoration.push(t5 - t4);

    // 4. Initial Bootstrap Loading
    const t6 = performance.now();
    const bootRes = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Cookie: combinedCookie },
    });
    await bootRes.json();
    const t7 = performance.now();
    metrics.bootstrapLoading.push(t7 - t6);

    // Total end to end (Initiation + Callback + Session Restoration + Bootstrap)
    metrics.endToEndLoginTotal.push((t1 - t0) + (t3 - t2) + (t5 - t4) + (t7 - t6));
  }

  const avg = (arr: number[]) => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);
  const min = (arr: number[]) => Math.min(...arr).toFixed(2);
  const max = (arr: number[]) => Math.max(...arr).toFixed(2);

  console.log('\n================ BASELINE LATENCY RESULTS ================');
  console.log(`OAuth Initiation (/api/pesu-oauth/url): avg ${avg(metrics.oauthInitiation)}ms (min ${min(metrics.oauthInitiation)}ms, max ${max(metrics.oauthInitiation)}ms)`);
  console.log(`OAuth Callback & Exchange (/auth/pesu/callback): avg ${avg(metrics.oauthCallbackTokenExchange)}ms (min ${min(metrics.oauthCallbackTokenExchange)}ms, max ${max(metrics.oauthCallbackTokenExchange)}ms)`);
  console.log(`Session Restoration (/api/auth/session): avg ${avg(metrics.sessionRestoration)}ms (min ${min(metrics.sessionRestoration)}ms, max ${max(metrics.sessionRestoration)}ms)`);
  console.log(`Full Bootstrap Loading (/api/bootstrap): avg ${avg(metrics.bootstrapLoading)}ms (min ${min(metrics.bootstrapLoading)}ms, max ${max(metrics.bootstrapLoading)}ms)`);
  console.log(`Total End-to-End Sequence: avg ${avg(metrics.endToEndLoginTotal)}ms (min ${min(metrics.endToEndLoginTotal)}ms, max ${max(metrics.endToEndLoginTotal)}ms)`);
  console.log('==========================================================\n');

  resetServerTestOverrides();
  serverInstance.close();
  const { pool } = await import('../src/db/index.ts');
  await pool.end();
}

void run();
