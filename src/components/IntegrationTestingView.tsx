import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileText,
  FileUp,
  Github,
  Globe,
  KeyRound,
  Loader2,
  LogOut,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { ExecutionMode } from '../types/domain';
import {
  DeveloperDiagnosticTelemetry,
  PesuOAuthCallbackPostMessage,
  PesuOAuthDiscoveryResponse,
  PesuOAuthSessionStatusResponse,
  PesuOAuthStageStatuses,
  PesuOAuthUrlResponse,
} from '../types/apiContracts';
import {
  extractLiveEventFileMetadata,
  extractLiveEventUrlMetadata,
  extractPublicEventPreview,
  runBoundedGitHubEnrichmentDraft,
  runLiveGitHubAndGeminiEnrichment,
  verifyLiveEventUrl,
} from '../services/adapters';

interface IntegrationTestingViewProps {
  executionMode: ExecutionMode;
  onChangeExecutionMode: (mode: ExecutionMode) => void;
}

interface IntegrationProbeState {
  status: 'idle' | 'running' | 'success' | 'error';
  httpStatus?: number;
  latencyMs?: number;
  summary?: string;
  payload?: unknown;
  diagnostics?: DeveloperDiagnosticTelemetry;
  errorType?:
    | 'auth_error'
    | 'rate_limit'
    | 'missing_config'
    | 'network_error'
    | 'validation_error'
    | 'transient_overload';
}

interface UrlAutomatedTestCase {
  id: string;
  label: string;
  url: string;
  expectedOutcome: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  actualDetail?: string;
}

const DEFAULT_OAUTH_STAGES: PesuOAuthStageStatuses = {
  providerDiscovery: 'idle',
  configuration: 'missing_client_id',
  redirectUriValidation: 'valid',
  authorizationRedirect: 'idle',
  tokenExchange: 'idle',
  verifiedIdentity: 'unverified',
};

const DiagnosticTelemetryCard: React.FC<{
  diagnostics?: DeveloperDiagnosticTelemetry;
}> = ({ diagnostics }) => {
  if (!diagnostics) return null;
  return (
    <div className="mt-2 p-2.5 bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-lg font-mono text-[11px] text-slate-700 dark:text-slate-300 grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div>
        <span className="text-slate-400 block font-sans text-[10px] uppercase">Service Name</span>
        <span className="font-semibold">{diagnostics.serviceName}</span>
      </div>
      <div>
        <span className="text-slate-400 block font-sans text-[10px] uppercase">HTTP Status</span>
        <span className="font-semibold">{diagnostics.httpStatus}</span>
      </div>
      <div>
        <span className="text-slate-400 block font-sans text-[10px] uppercase">Error Category</span>
        <span className="font-semibold">{diagnostics.errorCategory}</span>
      </div>
      <div>
        <span className="text-slate-400 block font-sans text-[10px] uppercase">Model Used</span>
        <span className="font-semibold">
          {diagnostics.modelUsed ??
            (diagnostics.extractionMethod ? `none (${diagnostics.extractionMethod})` : 'n/a')}
        </span>
      </div>
      <div>
        <span className="text-slate-400 block font-sans text-[10px] uppercase">Retry Attempts</span>
        <span className="font-semibold">{diagnostics.retryAttempts}</span>
      </div>
      <div>
        <span className="text-slate-400 block font-sans text-[10px] uppercase">Request Duration</span>
        <span className="font-semibold">{diagnostics.durationMs} ms</span>
      </div>
      <div className="col-span-2">
        <span className="text-slate-400 block font-sans text-[10px] uppercase">
          Request ID / Extraction Method
        </span>
        <span className="font-semibold break-all">
          {diagnostics.requestId ?? 'n/a'}
          {diagnostics.extractionMethod ? ` · method=${diagnostics.extractionMethod}` : ''}
        </span>
      </div>
    </div>
  );
};

function generateSamplePdfBrochureBase64(): {
  fileName: string;
  mimeType: string;
  base64Data: string;
} {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << >> /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 495 >>
stream
BT
(Title: PES Autonomous Systems & AI Buildathon 2026) Tj
(Organizer: PES Robotics & AI Society) Tj
(Start Date: 2026-11-21) Tj
(End Date: 2026-11-22) Tj
(Registration Deadline: 2026-11-18) Tj
(Venue: MRD Auditorium, RR Campus, Bengaluru) Tj
(Team Size: 2 to 4 members per team) Tj
(Eligibility: Open to all B.Tech students across RR and EC campuses) Tj
(Tracks: Applied AI/ML, Robotics/Edge Hardware, Developer Tools) Tj
(Official Website: https://events.pes.edu/11515/) Tj
ET
endstream
endobj
%%EOF`;
  return {
    fileName: 'PES_Autonomous_Systems_Brochure_2026.pdf',
    mimeType: 'application/pdf',
    base64Data: window.btoa(pdfContent),
  };
}

export const IntegrationTestingView: React.FC<IntegrationTestingViewProps> = ({
  executionMode,
  onChangeExecutionMode,
}) => {
  const [serverConfig, setServerConfig] = useState<{
    geminiConfigured: boolean;
    geminiPrimaryModel: string;
    geminiFallbackModel: string;
    geminiMaxRetries: number;
    githubTokenConfigured: boolean;
    pesuOAuthClientConfigured: boolean;
    pesuOAuthIssuerUrl: string;
    registeredRedirectUri: string;
    appUrl: string;
  } | null>(null);

  // 1. GitHub REST API Test State
  const [ghUsername, setGhUsername] = useState('octocat');
  const [ghResult, setGhResult] = useState<IntegrationProbeState>({ status: 'idle' });

  // 2. Gemini API Test State
  const [geminiResult, setGeminiResult] = useState<IntegrationProbeState>({ status: 'idle' });

  // 3. Event URL Extraction & Verification Test State
  const [testEventUrl, setTestEventUrl] = useState('https://events.pes.edu/11515/');
  const [urlResult, setUrlResult] = useState<IntegrationProbeState>({ status: 'idle' });

  // Automated URL Test Suite (Requirement #4: Valid, Redirected, Broken, SSRF Blocked)
  const [urlTestCases, setUrlTestCases] = useState<UrlAutomatedTestCase[]>([
    {
      id: 'valid_event',
      label: 'Valid Public HTTPS URL',
      url: 'https://example.com',
      expectedOutcome: 'Reachable HTTPS response with canonical URL verified',
      status: 'pending',
    },
    {
      id: 'redirected_url',
      label: 'Redirected HTTPS URL (301/302)',
      url: 'https://github.com/octocat',
      expectedOutcome: 'Follows redirect safely and records final canonical URL',
      status: 'pending',
    },
    {
      id: 'broken_404',
      label: 'Broken / Non-Existent Event Page (404)',
      url: 'https://api.github.com/non-existent-event-page-404-quackathon',
      expectedOutcome: 'Detects HTTP 404 and marks status as broken',
      status: 'pending',
    },
    {
      id: 'ssrf_metadata_block',
      label: 'SSRF Cloud Metadata IP Guard',
      url: 'http://169.254.169.254/latest/meta-data/',
      expectedOutcome: 'Blocked by SSRF protection (blocked_policy) before socket connection',
      status: 'pending',
    },
  ]);

  // 4. PESU OAuth2 (`pesu-dev/oauth2`) End-to-End State
  const [oauthScopes, setOauthScopes] = useState<string>('openid profile email');
  const [oauthStages, setOauthStages] = useState<PesuOAuthStageStatuses>(DEFAULT_OAUTH_STAGES);
  const [supportedScopes, setSupportedScopes] = useState<string[]>([
    'openid',
    'profile',
    'email',
    'announcements:read',
    'timetable:read',
  ]);
  const [activeOAuthState, setActiveOAuthState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('quackathon_oauth_state');
    } catch {
      return null;
    }
  });
  const [oauthSessionInfo, setOauthSessionInfo] = useState<PesuOAuthSessionStatusResponse | null>(
    null
  );
  const [oauthDiscoveryState, setOauthDiscoveryState] = useState<IntegrationProbeState>({
    status: 'idle',
  });
  const [oauthFlowNotice, setOauthFlowNotice] = useState<{
    tone: 'info' | 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  // 5. File Processing (PDF Brochure / Poster Image) Test State + Preserved Retry Payload
  const [fileResult, setFileResult] = useState<IntegrationProbeState>({ status: 'idle' });
  const [preservedFilePayload, setPreservedFilePayload] = useState<{
    fileName: string;
    mimeType: string;
    base64Data: string;
  } | null>(null);

  const fetchServerStatus = useCallback(async () => {
    try {
      const [statusRes, sessionRes] = await Promise.all([
        fetch('/api/integrations/status'),
        fetch('/api/pesu-oauth/session'),
      ]);

      if (statusRes.ok) {
        const data = await statusRes.json();
        if (data.services) {
          setServerConfig({
            geminiConfigured: Boolean(data.services.geminiApi?.configured),
            geminiPrimaryModel: data.services.geminiApi?.primaryModel ?? 'gemini-2.5-flash',
            geminiFallbackModel: data.services.geminiApi?.fallbackModel ?? 'gemini-2.0-flash',
            geminiMaxRetries: data.services.geminiApi?.maxRetries ?? 2,
            githubTokenConfigured: Boolean(data.services.githubRestApi?.authenticatedMode),
            pesuOAuthClientConfigured: Boolean(data.services.pesuOauth2?.hasClientId),
            pesuOAuthIssuerUrl: data.services.pesuOauth2?.issuerUrl ?? '',
            registeredRedirectUri:
              data.services.pesuOauth2?.registeredRedirectUri ??
              `${window.location.origin}/auth/pesu/callback`,
            appUrl: window.location.origin,
          });
        }
      }

      if (sessionRes.ok) {
        const sessionData = (await sessionRes.json()) as PesuOAuthSessionStatusResponse;
        setOauthSessionInfo(sessionData);
        if (sessionData.stages) {
          setOauthStages(sessionData.stages);
        }
      }
    } catch {
      // ignore initial status fetch error
    }
  }, []);

  useEffect(() => {
    fetchServerStatus();

    // Check URL hash/search if returning from full-page OAuth redirect
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('oauth_redirect') === '1') {
      fetchServerStatus();
    }

    const handleOAuthMessage = async (event: MessageEvent) => {
      // Security requirement: validate exact trusted origin, never accept wildcard origins
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as PesuOAuthCallbackPostMessage | undefined;
      if (!data || data.type !== 'PESU_OAUTH_RESULT') {
        return;
      }

      // State correlation check
      const expectedState =
        activeOAuthState ||
        (() => {
          try {
            return sessionStorage.getItem('quackathon_oauth_state');
          } catch {
            return null;
          }
        })();

      if (expectedState && data.state && data.state !== expectedState) {
        setOauthFlowNotice({
          tone: 'error',
          message: `OAuth state correlation mismatch (expected ${expectedState.slice(0, 8)}..., got ${data.state.slice(0, 8)}...). Discarded callback.`,
        });
        return;
      }

      if (data.stages) {
        setOauthStages(data.stages);
      }

      if (data.ok && data.stages?.tokenExchange === 'succeeded') {
        setOauthFlowNotice({
          tone: 'success',
          message:
            data.userMessage || 'OAuth2 PKCE token exchange and identity verification succeeded!',
        });
      } else {
        setOauthFlowNotice({
          tone: 'error',
          message: `OAuth2 Error (${data.errorCategory || 'OAUTH_ERROR'}): ${data.userMessage}`,
        });
      }

      await fetchServerStatus();
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [activeOAuthState, fetchServerStatus]);

  // Test 1: GitHub REST API
  const handleRunGitHubTest = async () => {
    const start = performance.now();
    setGhResult({ status: 'running' });

    if (executionMode === 'demo') {
      const sim = runBoundedGitHubEnrichmentDraft({
        uid: 'u_solo_arjun',
        githubUsername: ghUsername,
      });
      setGhResult({
        status: 'success',
        latencyMs: Math.round(performance.now() - start),
        summary: `[DEMO SIMULATION — NOT A LIVE API CALL] Simulated repository draft (${sim.repoName}) for @${ghUsername}. Switch to Live Test Mode above to call the real GitHub REST API.`,
        payload: sim,
      });
      return;
    }

    try {
      const res = await fetch('/api/github/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ghUsername }),
      });
      const data = await res.json();
      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok || !data.ok) {
        setGhResult({
          status: 'error',
          httpStatus: res.status,
          latencyMs,
          errorType: data.errorType || 'network_error',
          summary: data.message || data.error || `GitHub API returned HTTP ${res.status}`,
          payload: data,
          diagnostics: data.diagnostics,
        });
        return;
      }

      setGhResult({
        status: 'success',
        httpStatus: res.status,
        latencyMs,
        summary: `LIVE GitHub REST API Success: Fetched ${data.repositories?.length ?? 0} public repositories, languages, topics, and README excerpts for @${data.profile?.login}. Remaining Rate Limit: ${data.rateLimit?.remaining}/${data.rateLimit?.limit}.`,
        payload: data,
        diagnostics: data.diagnostics,
      });
    } catch (err) {
      setGhResult({
        status: 'error',
        latencyMs: Math.round(performance.now() - start),
        errorType: 'network_error',
        summary: err instanceof Error ? err.message : 'Network error calling /api/github/fetch',
      });
    }
  };

  // Test 2: Gemini API Structured Evidence Extraction
  const handleRunGeminiTest = async () => {
    const start = performance.now();
    setGeminiResult({ status: 'running' });

    if (executionMode === 'demo') {
      const sim = runBoundedGitHubEnrichmentDraft({
        uid: 'u_solo_arjun',
        githubUsername: ghUsername,
      });
      setGeminiResult({
        status: 'success',
        latencyMs: Math.round(performance.now() - start),
        summary: `[DEMO SIMULATION — NOT A LIVE API CALL] Simulated ${sim.suggestedSkills.length} skill drafts. Switch to Live Test Mode to invoke real Gemini structured extraction.`,
        payload: sim,
      });
      return;
    }

    try {
      const live = await runLiveGitHubAndGeminiEnrichment({
        uid: 'u_solo_arjun',
        githubUsername: ghUsername,
      });

      if (!live.ok || !live.draft) {
        setGeminiResult({
          status: 'error',
          httpStatus: live.diagnostics?.httpStatus,
          latencyMs: Math.round(performance.now() - start),
          summary: live.errorMessage ?? 'Live Gemini extraction failed.',
          payload: live,
          diagnostics: live.diagnostics,
        });
        return;
      }

      setGeminiResult({
        status: 'success',
        httpStatus: 200,
        latencyMs: Math.round(performance.now() - start),
        summary: `LIVE Gemini API Success (${live.diagnostics?.modelUsed ?? 'gemini'}): Extracted ${live.draft.suggestedSkills.length} validated skill drafts and ${live.draft.suggestedProjects?.length ?? 1} project summaries from @${ghUsername}'s real GitHub evidence. All items require explicit user approval before publishing.`,
        payload: live.draft,
        diagnostics: live.diagnostics,
      });
    } catch (err) {
      setGeminiResult({
        status: 'error',
        latencyMs: Math.round(performance.now() - start),
        summary: err instanceof Error ? err.message : 'Gemini extraction failed',
      });
    }
  };

  // Test 3: Event URL Extraction
  const handleRunUrlExtractionTest = async () => {
    const start = performance.now();
    setUrlResult({ status: 'running' });

    if (executionMode === 'demo') {
      const sim = extractPublicEventPreview(testEventUrl);
      setUrlResult({
        status: 'success',
        latencyMs: Math.round(performance.now() - start),
        summary: `[DEMO SIMULATION — NOT A LIVE API CALL] Simulated event candidate "${sim.draft.title || 'Unconfirmed'}". Switch to Live Test Mode to fetch and parse the real webpage.`,
        payload: sim,
      });
      return;
    }

    try {
      const live = await extractLiveEventUrlMetadata(testEventUrl);
      if (!live.ok || !live.draft) {
        setUrlResult({
          status: 'error',
          httpStatus: live.diagnostics?.httpStatus,
          latencyMs: Math.round(performance.now() - start),
          summary: live.errorMessage ?? 'Live URL extraction failed.',
          payload: live,
          diagnostics: live.diagnostics,
        });
        return;
      }

      setUrlResult({
        status: 'success',
        httpStatus: 200,
        latencyMs: Math.round(performance.now() - start),
        summary: `LIVE Event URL Extraction: Status=${(live.draft.sourceUrlStatus ?? 'verified').toUpperCase()} · Canonical URL=${live.draft.verifiedCanonicalUrl ?? 'null'} · Extracted Title="${live.draft.title || 'null'}"`,
        payload: live,
        diagnostics: live.diagnostics,
      });
    } catch (err) {
      setUrlResult({
        status: 'error',
        latencyMs: Math.round(performance.now() - start),
        summary: err instanceof Error ? err.message : 'Live URL extraction failed',
      });
    }
  };

  // Run Automated URL Verification Suite (Requirement #4: Uses reconciled VerifyUrlResponse contract)
  const handleRunAutomatedUrlSuite = async () => {
    setUrlTestCases((prev) =>
      prev.map((tc) => ({ ...tc, status: 'running', actualDetail: undefined }))
    );

    for (const tc of urlTestCases) {
      try {
        const data = await verifyLiveEventUrl(tc.url);

        let passed = false;
        let detail = '';

        if (tc.id === 'valid_event') {
          passed =
            data.ok === true &&
            (data.status === 'verified' || data.status === 'redirected_valid') &&
            Boolean(data.verifiedCanonicalUrl);
          detail = `HTTP ${data.httpStatus} · status=${data.status} · verifiedCanonicalUrl=${data.verifiedCanonicalUrl}`;
        } else if (tc.id === 'redirected_url') {
          passed =
            data.ok === true &&
            (data.status === 'redirected_valid' || data.status === 'verified') &&
            Boolean(data.verifiedCanonicalUrl);
          detail = `HTTP ${data.httpStatus} · status=${data.status} · finalUrl=${data.finalUrl}`;
        } else if (tc.id === 'broken_404') {
          passed =
            data.ok === false &&
            (data.status === 'broken' || data.status === 'unavailable' || data.httpStatus === 404);
          detail = `HTTP ${data.httpStatus ?? 'ERR'} · status=${data.status} (Broken link rejected as expected)`;
        } else if (tc.id === 'ssrf_metadata_block') {
          passed = data.ok === false && data.status === 'blocked_policy';
          detail = `status=${data.status}: ${data.userMessage || data.error || 'Blocked by SSRF policy'}`;
        }

        setUrlTestCases((prev) =>
          prev.map((item) =>
            item.id === tc.id
              ? { ...item, status: passed ? 'passed' : 'failed', actualDetail: detail }
              : item
          )
        );
      } catch (err) {
        setUrlTestCases((prev) =>
          prev.map((item) =>
            item.id === tc.id
              ? {
                  ...item,
                  status: 'failed',
                  actualDetail: err instanceof Error ? err.message : 'Request failed',
                }
              : item
          )
        );
      }
    }
  };

  // Test 4: PESU OAuth2 Discovery & Authorized Consent Flow (Fixes Problems A, B, C, D)
  const handleProbePesuDiscovery = async () => {
    const start = performance.now();
    setOauthDiscoveryState({ status: 'running' });

    try {
      const res = await fetch('/api/pesu-oauth/discovery');
      const data = (await res.json()) as PesuOAuthDiscoveryResponse;
      if (data.stages) {
        setOauthStages(data.stages);
      }
      if (data.supportedScopes && data.supportedScopes.length > 0) {
        setSupportedScopes(data.supportedScopes);
      }
      setOauthDiscoveryState({
        status: data.ok ? 'success' : 'error',
        httpStatus: res.status,
        latencyMs: Math.round(performance.now() - start),
        summary: data.ok
          ? `Discovered OIDC metadata from ${data.issuer} (token_endpoint: ${data.tokenEndpoint})`
          : `OIDC discovery probe status: ${data.note || data.userMessage || 'Provider unreachable'} (Client ID Configured: ${data.clientConfigured ? 'Yes' : 'No'})`,
        payload: data,
        diagnostics: data.diagnostics,
      });
    } catch (err) {
      setOauthDiscoveryState({
        status: 'error',
        latencyMs: Math.round(performance.now() - start),
        summary: err instanceof Error ? err.message : 'Failed to probe PESU OAuth2 discovery',
      });
    }
  };

  const handleStartPesuOAuthFlow = async (
    deliveryMode: 'redirect' | 'popup',
    overrideScope?: string
  ) => {
    setOauthFlowNotice(null);
    const scopeToRequest = overrideScope ?? oauthScopes;

    try {
      const query = new URLSearchParams({
        scope: scopeToRequest,
        mode: deliveryMode,
      });
      const res = await fetch(`/api/pesu-oauth/url?${query.toString()}`);
      const data = (await res.json()) as PesuOAuthUrlResponse;

      if (data.stages) {
        setOauthStages(data.stages);
      }

      if (!res.ok || !data.ok) {
        setOauthFlowNotice({
          tone: 'error',
          message: `${data.errorCategory || 'OAUTH_ERROR'}: ${data.userMessage || 'Failed to construct OAuth authorization URL.'}`,
        });
        return;
      }

      // Problem A fix: strictly validate authorizationUrl before opening popup or redirecting
      const targetUrl = data.authorizationUrl || data.authUrl;
      if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.startsWith('http')) {
        setOauthFlowNotice({
          tone: 'error',
          message:
            'Validation Guard: Backend returned an invalid or empty authorizationUrl. Refusing to open popup or redirect.',
        });
        return;
      }

      if (data.state) {
        setActiveOAuthState(data.state);
        try {
          sessionStorage.setItem('quackathon_oauth_state', data.state);
        } catch {
          // ignore storage error
        }
      }

      if (deliveryMode === 'redirect') {
        setOauthFlowNotice({
          tone: 'info',
          message: `Redirecting full window to ${targetUrl.slice(0, 64)}... (callback: ${data.redirectUri})`,
        });
        window.location.assign(targetUrl);
        return;
      }

      const popup = window.open(targetUrl, 'pesu_oauth_popup', 'width=560,height=680');
      if (!popup) {
        setOauthFlowNotice({
          tone: 'warning',
          message:
            'Popup was blocked by the browser or embedded preview frame. Use "Start Full-Page Redirect Flow" instead.',
        });
      } else {
        // Problem D fix: never label authentication successful merely because a popup opened
        setOauthFlowNotice({
          tone: 'info',
          message: `Authorization window opened (state=${data.state?.slice(0, 8)}...). Authentication is NOT complete until the callback exchanges the code for tokens and verifies identity.`,
        });
      }
    } catch (err) {
      setOauthFlowNotice({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to start PESU OAuth2 flow',
      });
    }
  };

  const handleLogoutPesuOAuth = async () => {
    await fetch('/api/pesu-oauth/logout', { method: 'POST' });
    setOauthFlowNotice({
      tone: 'info',
      message: 'Cleared server-side PESU OAuth2 session and reset stage statuses.',
    });
    await fetchServerStatus();
  };

  // Test 5: Live File Processing (Poster Image or PDF Brochure) + Preserved Retry
  const executeFileExtractionPayload = async (payload: {
    fileName: string;
    mimeType: string;
    base64Data: string;
  }) => {
    if (fileResult.status === 'running') return;
    setPreservedFilePayload(payload);
    const start = performance.now();
    setFileResult({ status: 'running' });

    if (executionMode === 'demo') {
      setFileResult({
        status: 'success',
        latencyMs: Math.round(performance.now() - start),
        summary: `[DEMO SIMULATION — NOT A LIVE API CALL] Staged ${payload.fileName} (${payload.mimeType}). Switch to Live Test Mode above to execute real server-side extraction.`,
        payload: {
          isLiveApiResult: false,
          fileName: payload.fileName,
          mimeType: payload.mimeType,
        },
      });
      return;
    }

    try {
      const live = await extractLiveEventFileMetadata(payload);
      if (!live.ok || !live.draft) {
        setFileResult({
          status: 'error',
          httpStatus: live.diagnostics?.httpStatus,
          latencyMs: Math.round(performance.now() - start),
          summary:
            live.errorMessage ??
            "AI extraction is temporarily unavailable. Your poster was accepted, but its details couldn't be extracted. Retry extraction or enter the information manually.",
          payload: live,
          diagnostics: live.diagnostics,
        });
        return;
      }

      setFileResult({
        status: 'success',
        httpStatus: 200,
        latencyMs: Math.round(performance.now() - start),
        summary: `LIVE Extraction (${payload.fileName} · method=${live.diagnostics?.extractionMethod ?? 'gemini_multimodal'}): Title="${live.draft.title || 'null'}", Team Size=${live.draft.teamSize?.min ?? 'null'}–${live.draft.teamSize?.max ?? 'null'}, Venue="${live.draft.venue?.name ?? 'null'} (${live.draft.venue?.campus ?? 'null'})"`,
        payload: live.draft,
        diagnostics: live.diagnostics,
      });
    } catch (err) {
      setFileResult({
        status: 'error',
        latencyMs: Math.round(performance.now() - start),
        summary: err instanceof Error ? err.message : 'File extraction test failed',
      });
    }
  };

  const handleRunSamplePosterTest = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 550;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, 900, 550);
    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('PES UNIVERSITY · DEPARTMENT OF CSE', 50, 75);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText('QUACKATHON AI SPRINT 2026', 50, 145);
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '24px sans-serif';
    ctx.fillText('Dates: May 9 - May 10, 2026 | Registration Deadline: May 4, 2026', 50, 220);
    ctx.fillText('Venue: MRD Auditorium, RR Campus, Bengaluru', 50, 270);
    ctx.fillText('Team Size: 2 to 4 Members | Open to all B.Tech students', 50, 320);
    ctx.fillText('Tracks: Applied AI/ML, Developer Tools, Robotics & Edge Hardware', 50, 370);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '20px monospace';
    ctx.fillText('Official Page: https://events.pes.edu/11515/', 50, 445);

    const dataUrl = canvas.toDataURL('image/png');
    const base64Data = dataUrl.split(',')[1] ?? '';

    await executeFileExtractionPayload({
      fileName: 'quackathon-poster.png',
      mimeType: 'image/png',
      base64Data,
    });
  };

  const handleRunSamplePdfBrochureTest = async () => {
    const pdfPayload = generateSamplePdfBrochureBase64();
    await executeFileExtractionPayload(pdfPayload);
  };

  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const resStr = String(reader.result ?? '');
      const base64Data = resStr.includes(',') ? resStr.split(',')[1] : resStr;
      await executeFileExtractionPayload({
        fileName: file.name,
        mimeType: file.type,
        base64Data,
      });
    };
    reader.readAsDataURL(file);
  };

  const renderStageBadge = (label: string, value: string) => {
    const isGood =
      value === 'ready' ||
      value === 'configured' ||
      value === 'valid' ||
      value === 'succeeded' ||
      value === 'verified';
    const isWarn = value === 'Redirected / Waiting for user consent' || value === 'redirected';
    const isBad =
      value === 'unavailable' ||
      value === 'missing_client_id' ||
      value === 'mismatch' ||
      value === 'failed';

    return (
      <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs">
        <span className="text-slate-400 block text-[10px] uppercase font-semibold">{label}</span>
        <span
          className={`font-mono font-bold mt-0.5 inline-block ${
            isGood
              ? 'text-emerald-600 dark:text-emerald-400'
              : isBad
              ? 'text-red-600 dark:text-red-400'
              : isWarn
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {value}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Header & Execution Mode Switcher */}
      <div className="pb-6 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1 flex items-center gap-1.5">
            <Code2 className="w-3.5 h-3.5" />
            Developer Integration Verification Suite · Server-Side Credentials Only
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            External Service & API Integration Testing
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-3xl">
            Verify each external integration independently. Simulated responses in Demo Mode are never reported as live API calls. Switch to <strong>Live Test Mode</strong> to execute real server-side requests with diagnostic telemetry.
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 dark:bg-slate-800 rounded-xl self-start lg:self-auto shrink-0">
          <button
            type="button"
            onClick={() => onChangeExecutionMode('demo')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              executionMode === 'demo'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Demo Mode (Simulated)
          </button>
          <button
            type="button"
            onClick={() => onChangeExecutionMode('live')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              executionMode === 'live'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Live Test Mode (Real APIs)
          </button>
        </div>
      </div>

      {/* Server Environment Configuration Status */}
      <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Server-Side Environment & Model Fallback Configuration
          </h2>
          <button
            type="button"
            onClick={fetchServerStatus}
            className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh Status
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <span className="text-slate-400 block">GEMINI_API_KEY & Models</span>
            <span
              className={`font-semibold block ${
                serverConfig?.geminiConfigured ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              {serverConfig?.geminiConfigured ? 'Configured & Ready' : 'Missing in Environment'}
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              Primary: {serverConfig?.geminiPrimaryModel ?? 'gemini-2.5-flash'} · Fallback:{' '}
              {serverConfig?.geminiFallbackModel ?? 'gemini-2.0-flash'} (Retries:{' '}
              {serverConfig?.geminiMaxRetries ?? 2})
            </span>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <span className="text-slate-400 block">GitHub REST API</span>
            <span className="font-semibold text-emerald-600 block">
              {serverConfig?.githubTokenConfigured
                ? 'Authenticated (GITHUB_TOKEN set)'
                : 'Public Unauthenticated (60 req/hr)'}
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              Server-side proxy: /api/github/fetch
            </span>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <span className="text-slate-400 block">PESU OAuth2 (`pesu-dev/oauth2`)</span>
            <span
              className={`font-semibold block ${
                serverConfig?.pesuOAuthClientConfigured ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              {serverConfig?.pesuOAuthClientConfigured
                ? 'Client ID Configured'
                : 'PESU_OAUTH_CLIENT_ID Not Set'}
            </span>
            <span className="font-mono text-[11px] text-slate-500 break-all">
              Callback: {serverConfig?.registeredRedirectUri ?? `${window.location.origin}/auth/pesu/callback`}
            </span>
          </div>
        </div>
      </div>

      {/* Integration Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. GitHub REST API */}
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
                <Github className="w-4 h-4" />
                1. GitHub REST API (`api.github.com`)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Fetches real public repositories, languages, topics, descriptions, and README excerpts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={ghUsername}
              onChange={(e) => setGhUsername(e.target.value)}
              placeholder="GitHub username (e.g., octocat, torvalds)"
              className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            />
            <button
              type="button"
              onClick={handleRunGitHubTest}
              disabled={ghResult.status === 'running'}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              {ghResult.status === 'running' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Test GitHub Fetch
            </button>
          </div>

          {ghResult.status !== 'idle' && ghResult.status !== 'running' && (
            <div
              className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                ghResult.status === 'success'
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  {ghResult.status === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600" />
                  )}
                  {ghResult.status.toUpperCase()}{' '}
                  {ghResult.httpStatus ? `(HTTP ${ghResult.httpStatus})` : ''}
                </span>
                <span className="font-mono text-[11px]">{ghResult.latencyMs} ms</span>
              </div>
              <p>{ghResult.summary}</p>
              <DiagnosticTelemetryCard diagnostics={ghResult.diagnostics} />
            </div>
          )}
        </div>

        {/* 2. Gemini API Structured Extraction */}
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              2. Gemini API Structured Evidence Extraction
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Extracts suggested skills and project summaries with exponential backoff retry and fallback model verification.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-600 dark:text-slate-400">
              Target evidence: <strong>@{ghUsername}</strong> repositories & READMEs
            </span>
            <button
              type="button"
              onClick={handleRunGeminiTest}
              disabled={geminiResult.status === 'running'}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              {geminiResult.status === 'running' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Run Gemini Extraction
            </button>
          </div>

          {geminiResult.status !== 'idle' && geminiResult.status !== 'running' && (
            <div
              className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                geminiResult.status === 'success'
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  {geminiResult.status === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600" />
                  )}
                  {geminiResult.status.toUpperCase()}{' '}
                  {geminiResult.httpStatus ? `(HTTP ${geminiResult.httpStatus})` : ''}
                </span>
                <span className="font-mono text-[11px]">{geminiResult.latencyMs} ms</span>
              </div>
              <p>{geminiResult.summary}</p>
              <DiagnosticTelemetryCard diagnostics={geminiResult.diagnostics} />
            </div>
          )}
        </div>

        {/* 3. Event URL Metadata Extraction & Automated URL Verification Suite */}
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-600" />
              3. Event URL Extraction & Canonical Link Verification
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Fetches public event pages, extracts JSON-LD/OpenGraph/HTML metadata deterministically before optional LLM fallback, and verifies canonical URLs.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="url"
              value={testEventUrl}
              onChange={(e) => setTestEventUrl(e.target.value)}
              placeholder="https://events.pes.edu/11515/ or https://example.com"
              className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-mono"
            />
            <button
              type="button"
              onClick={handleRunUrlExtractionTest}
              disabled={urlResult.status === 'running'}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              {urlResult.status === 'running' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Extract URL
            </button>
          </div>

          {urlResult.status !== 'idle' && urlResult.status !== 'running' && (
            <div
              className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
                urlResult.status === 'success'
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span>{urlResult.status.toUpperCase()}</span>
                <span className="font-mono text-[11px]">{urlResult.latencyMs} ms</span>
              </div>
              <p>{urlResult.summary}</p>
              <DiagnosticTelemetryCard diagnostics={urlResult.diagnostics} />
            </div>
          )}

          {/* Automated URL Verification Test Runner (Requirement #4) */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Automated Source URL Verification Suite (Valid, Redirected, 404, SSRF)
              </span>
              <button
                type="button"
                onClick={handleRunAutomatedUrlSuite}
                className="px-3 py-1 text-xs font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md cursor-pointer"
              >
                Run All 4 URL Tests
              </button>
            </div>

            <div className="space-y-1.5">
              {urlTestCases.map((tc) => (
                <div
                  key={tc.id}
                  className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {tc.label}
                    </span>
                    <span
                      className={`font-mono text-[11px] font-bold uppercase ${
                        tc.status === 'passed'
                          ? 'text-emerald-600'
                          : tc.status === 'failed'
                          ? 'text-red-600'
                          : tc.status === 'running'
                          ? 'text-blue-600'
                          : 'text-slate-400'
                      }`}
                    >
                      {tc.status}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 break-all">{tc.url}</div>
                  {tc.actualDetail && (
                    <div className="text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                      Result: {tc.actualDetail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 4. PESU OAuth2 (`pesu-dev/oauth2`) End-to-End PKCE Flow */}
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-blue-600" />
                4. PESU OAuth2 (`pesu-dev/oauth2`) Authorization Code + PKCE S256
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Validates OIDC discovery, scope allowlist, exact redirect URI, server-side PKCE token exchange, and verified identity claims.
              </p>
            </div>
            {oauthSessionInfo?.authenticated && (
              <button
                type="button"
                onClick={handleLogoutPesuOAuth}
                className="px-2.5 py-1 text-xs font-medium text-red-600 border border-red-200 dark:border-red-800 rounded-lg inline-flex items-center gap-1 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Clear Session
              </button>
            )}
          </div>

          {/* 6-Stage OAuth Verification Tracker */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {renderStageBadge('1. Provider Discovery', oauthStages.providerDiscovery)}
            {renderStageBadge('2. Configuration', oauthStages.configuration)}
            {renderStageBadge('3. Redirect URI Check', oauthStages.redirectUriValidation)}
            {renderStageBadge('4. Auth Redirect', oauthStages.authorizationRedirect)}
            {renderStageBadge('5. Token Exchange', oauthStages.tokenExchange)}
            {renderStageBadge('6. Verified Identity', oauthStages.verifiedIdentity)}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Requested Scopes (`scope` parameter · Validated against discovered supportedScopes)
            </label>
            <input
              type="text"
              value={oauthScopes}
              onChange={(e) => setOauthScopes(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            />
            <div className="text-[11px] text-slate-500 font-mono">
              Allowed scopes: {supportedScopes.join(', ')}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleProbePesuDiscovery}
              disabled={oauthDiscoveryState.status === 'running'}
              className="px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              {oauthDiscoveryState.status === 'running' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              1. Probe OIDC Discovery
            </button>

            <button
              type="button"
              onClick={() => handleStartPesuOAuthFlow('redirect')}
              className="px-3 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              2. Start Full-Page Redirect (Recommended)
            </button>

            <button
              type="button"
              onClick={() => handleStartPesuOAuthFlow('popup')}
              className="px-3 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Launch Popup Flow
            </button>

            <button
              type="button"
              onClick={() => handleStartPesuOAuthFlow('popup', 'openid admin: write_all')}
              className="px-2.5 py-2 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg cursor-pointer"
            >
              Test Unsupported Scope Guard
            </button>
          </div>

          {oauthDiscoveryState.status !== 'idle' && oauthDiscoveryState.status !== 'running' && (
            <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs space-y-1">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                Discovery Probe ({oauthDiscoveryState.latencyMs} ms):
              </div>
              <p className="text-slate-600 dark:text-slate-400">{oauthDiscoveryState.summary}</p>
              <DiagnosticTelemetryCard diagnostics={oauthDiscoveryState.diagnostics} />
            </div>
          )}

          {oauthFlowNotice && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                oauthFlowNotice.tone === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                  : oauthFlowNotice.tone === 'error'
                  ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
                  : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
              }`}
            >
              {oauthFlowNotice.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              ) : oauthFlowNotice.tone === 'error' ? (
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              )}
              <span>{oauthFlowNotice.message}</span>
            </div>
          )}

          {oauthSessionInfo?.authenticated && oauthSessionInfo.identity && (
            <div className="p-3 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs space-y-1">
              <div className="font-bold text-emerald-900 dark:text-emerald-200">
                Server-Verified PESU Identity (`pesu_oauth` Session Active)
              </div>
              <div className="font-mono text-[11px] text-emerald-800 dark:text-emerald-300">
                sub={oauthSessionInfo.identity.sub} · name={oauthSessionInfo.identity.name ?? 'n/a'} · email=
                {oauthSessionInfo.identity.email ?? 'n/a'} · scopes=
                {oauthSessionInfo.identity.grantedScopes.join(' ')}
              </div>
            </div>
          )}
        </div>

        {/* 5. File Processing (Brochure PDF / Poster Image) */}
        <div className="lg:col-span-2 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
                <FileUp className="w-4 h-4 text-blue-600" />
                5. Hackathon Poster & PDF Brochure Extraction (Deterministic PDF + Gemini Vision Retry/Fallback)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Extracts selectable PDF text deterministically without calling Gemini (`pdf_text_parser`), and uses bounded exponential backoff + model fallback for image posters. Preserves uploaded files for 1-click Retry.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleRunSamplePdfBrochureTest}
                disabled={fileResult.status === 'running'}
                className="px-3.5 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                Test Sample PDF Brochure (0 LLM Calls)
              </button>

              <button
                type="button"
                onClick={handleRunSamplePosterTest}
                disabled={fileResult.status === 'running'}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                {fileResult.status === 'running' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Test Sample PNG Poster (Vision)
              </button>

              {preservedFilePayload && (
                <button
                  type="button"
                  disabled={fileResult.status === 'running'}
                  onClick={() => executeFileExtractionPayload(preservedFilePayload)}
                  className="px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${fileResult.status === 'running' ? 'animate-spin' : ''}`}
                  />
                  Retry Extraction ({preservedFilePayload.fileName})
                </button>
              )}

              <label className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg cursor-pointer inline-flex items-center gap-1.5">
                <FileUp className="w-3.5 h-3.5" />
                Upload Custom PDF / Poster
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={handleCustomFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {fileResult.status !== 'idle' && fileResult.status !== 'running' && (
            <div
              className={`p-4 rounded-lg border text-xs space-y-2 ${
                fileResult.status === 'success'
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span>
                  {fileResult.status.toUpperCase()}{' '}
                  {fileResult.httpStatus ? `(HTTP ${fileResult.httpStatus})` : ''}
                </span>
                <span className="font-mono text-[11px]">{fileResult.latencyMs} ms</span>
              </div>
              <p>{fileResult.summary}</p>
              <DiagnosticTelemetryCard diagnostics={fileResult.diagnostics} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
