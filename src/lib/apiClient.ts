/**
 * Shared Typed API Client (Quackathon — Real-Data MVP)
 *
 * Inspects HTTP status and Content-Type BEFORE attempting JSON.parse,
 * preventing `Unexpected token '<', "<!doctype..."` errors when an upstream
 * proxy or server returns HTML instead of JSON.
 */

let inMemoryAuthToken: string | null = null;

export function setApiClientAuthToken(token: string | null) {
  inMemoryAuthToken = token;
}

export function getApiClientAuthToken(): string | null {
  return inMemoryAuthToken;
}

export interface ApiClientResult<T> {
  ok: boolean;
  status: number;
  contentType: string;
  data?: T;
  errorMessage?: string;
  diagnosticSnippet?: string;
}

function createDiagnosticSnippet(rawBody: string, maxLen = 180): string {
  const collapsed = rawBody.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '(empty response body)';
  return collapsed.length > maxLen
    ? `${collapsed.slice(0, maxLen)}...`
    : collapsed;
}

/**
 * Options accepted by {@link apiFetch}.
 *
 * `body` additionally accepts a plain JavaScript object. Plain objects are
 * JSON-encoded automatically (and get an `application/json` content type),
 * which prevents `fetch` from serialising them as the literal string
 * "[object Object]" and the server from rejecting the payload as malformed
 * JSON. Explicit `JSON.stringify(...)` calls keep working unchanged.
 */
export interface ApiClientOptions extends Omit<RequestInit, 'body'> {
  timeoutMs?: number;
  body?: BodyInit | object | null;
}

function isPlainJsonBody(body: unknown): body is Record<string, unknown> {
  if (body === null || typeof body !== 'object') return false;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
    return false;
  if (
    typeof ArrayBuffer !== 'undefined' &&
    (body instanceof ArrayBuffer || ArrayBuffer.isView(body))
  )
    return false;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
    return false;
  return true;
}

export async function apiFetch<T = Record<string, unknown>>(
  path: string,
  options: ApiClientOptions = {}
): Promise<ApiClientResult<T>> {
  const { timeoutMs = 15000, headers: customHeaders, ...restOptions } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(customHeaders as Record<string, string> | undefined),
  };

  const isJsonObjectBody = isPlainJsonBody(restOptions.body);
  const body: BodyInit | null | undefined = isJsonObjectBody
    ? JSON.stringify(restOptions.body)
    : (restOptions.body as BodyInit | null | undefined);

  if (body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (inMemoryAuthToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${inMemoryAuthToken}`;
  }

  try {
    const resp = await fetch(path, {
      ...restOptions,
      body,
      headers,
      credentials: 'include',
      signal: controller.signal,
    });

    const status = resp.status;
    const contentType = resp.headers.get('content-type') ?? '';
    const rawText = await resp.text();
    const trimmed = rawText.trimStart();

    const isJsonContent =
      contentType.toLowerCase().includes('application/json') ||
      contentType.toLowerCase().includes('+json');

    const looksLikeHtml =
      contentType.toLowerCase().includes('text/html') ||
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('<');

    if (looksLikeHtml || (!isJsonContent && trimmed.startsWith('<'))) {
      const snippet = createDiagnosticSnippet(rawText);
      return {
        ok: false,
        status,
        contentType: contentType || 'text/html',
        errorMessage: `Server returned an unexpected HTML response (HTTP ${status}) for ${path} instead of JSON. Verify the backend Express server is running.`,
        diagnosticSnippet: snippet,
      };
    }

    let parsed: Record<string, unknown> = {};
    if (trimmed.length > 0) {
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        return {
          ok: false,
          status,
          contentType,
          errorMessage: `Invalid JSON response from ${path} (HTTP ${status}, Content-Type: ${
            contentType || 'unknown'
          }).`,
          diagnosticSnippet: createDiagnosticSnippet(rawText),
        };
      }
    }

    const ok = resp.ok && parsed.ok !== false;
    const errorMessage = !ok
      ? (typeof parsed.userMessage === 'string' && parsed.userMessage) ||
        (typeof parsed.error === 'string' && parsed.error) ||
        (typeof parsed.message === 'string' && parsed.message) ||
        `Request to ${path} failed with HTTP ${status}.`
      : undefined;

    return {
      ok,
      status,
      contentType,
      data: parsed as unknown as T,
      errorMessage,
    };
  } catch (err: unknown) {
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.includes('aborted'));
    return {
      ok: false,
      status: isAbort ? 504 : 0,
      contentType: '',
      errorMessage: isAbort
        ? `Request to ${path} timed out after ${Math.round(timeoutMs / 1000)}s.`
        : `Network error calling ${path}: ${
            err instanceof Error ? err.message : String(err)
          }`,
    };
  } finally {
    clearTimeout(timer);
  }
}
