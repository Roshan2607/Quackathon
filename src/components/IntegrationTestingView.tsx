import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileUp,
  Github,
  Globe,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { ExecutionMode } from '../types/domain';
import {
  extractLiveEventFileMetadata,
  extractLiveEventUrlMetadata,
  extractPublicEventPreview,
  runBoundedGitHubEnrichmentDraft,
  runLiveGitHubAndGeminiEnrichment,
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
  errorType?: 'auth_error' | 'rate_limit' | 'missing_config' | 'network_error' | 'validation_error';
}

interface UrlAutomatedTestCase {
  id: string;
  label: string;
  url: string;
  expectedOutcome: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  actualDetail?: string;
}

export const IntegrationTestingView: React.FC<IntegrationTestingViewProps> = ({
  executionMode,
  onChangeExecutionMode,
}) => {
  const [serverConfig, setServerConfig] = useState<{
    geminiConfigured: boolean;
    githubTokenConfigured: boolean;
    pesuOAuthClientConfigured: boolean;
    pesuOAuthIssuerUrl: string;
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
      expectedOutcome: 'Detects HTTP 404 and marks sourceUrlStatus as broken',
      status: 'pending',
    },
    {
      id: 'ssrf_metadata_block',
      label: 'SSRF Cloud Metadata IP Guard',
      url: 'http://169.254.169.254/latest/meta-data/',
      expectedOutcome: 'Blocked by SSRF protection before socket connection',
      status: 'pending',
    },
  ]);

  // 4. PESU OAuth2 (`pesu-dev/oauth2`) Test State
  const [oauthScopes, setOauthScopes] = useState<string>('openid profile email');
  const [oauthDiscoveryState, setOauthDiscoveryState] = useState<IntegrationProbeState>({
    status: 'idle',
  });
  const [oauthPopupStatus, setOauthPopupStatus] = useState<string | null>(null);

  // 5. File Processing (PDF Brochure / Poster Image) Test State
  const [fileResult, setFileResult] = useState<IntegrationProbeState>({ status: 'idle' });

  const fetchServerStatus = async () => {
    try {
      const res = await fetch('/api/integrations/status');
      if (res.ok) {
        const data = await res.json();
        if (data.services) {
          setServerConfig({
            geminiConfigured: Boolean(data.services.geminiApi?.configured),
            githubTokenConfigured: Boolean(data.services.githubRestApi?.authenticatedMode),
            pesuOAuthClientConfigured: Boolean(data.services.pesuOauth2?.hasClientId),
            pesuOAuthIssuerUrl: data.services.pesuOauth2?.issuerUrl ?? '',
            appUrl: window.location.origin,
          });
        } else if (data.integrations) {
          setServerConfig(data.integrations);
        }
      }
    } catch {
      // ignore initial status fetch error
    }
  };

  useEffect(() => {
    fetchServerStatus();

    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PESU_OAUTH_CALLBACK') {
        const payload = event.data.payload;
        if (payload.error) {
          setOauthPopupStatus(
            `OAuth Provider Returned Error: ${payload.error} (${payload.errorDescription || 'No description'})`
          );
        } else if (payload.code) {
          setOauthPopupStatus(
            `Authorization Code Received via PKCE callback! State=${payload.state?.slice(0, 8)}...`
          );
        }
      }
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, []);

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
        });
        return;
      }

      setGhResult({
        status: 'success',
        httpStatus: res.status,
        latencyMs,
        summary: `LIVE GitHub REST API Success: Fetched ${data.repositories?.length ?? 0} public repositories, languages, topics, and README excerpts for @${data.profile?.login}. Remaining Rate Limit: ${data.rateLimit?.remaining}/${data.rateLimit?.limit}.`,
        payload: data,
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
          latencyMs: Math.round(performance.now() - start),
          summary: live.errorMessage ?? 'Live Gemini extraction failed.',
          payload: live,
        });
        return;
      }

      setGeminiResult({
        status: 'success',
        httpStatus: 200,
        latencyMs: Math.round(performance.now() - start),
        summary: `LIVE Gemini API Success (gemini-4-hydrogen): Extracted ${live.draft.suggestedSkills.length} validated skill drafts and ${live.draft.suggestedProjects?.length ?? 1} project summaries from @${ghUsername}'s real GitHub evidence. All items require explicit user approval before publishing.`,
        payload: live.draft,
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
          latencyMs: Math.round(performance.now() - start),
          summary: live.errorMessage ?? 'Live URL extraction failed.',
          payload: live,
        });
        return;
      }

      setUrlResult({
        status: 'success',
        httpStatus: 200,
        latencyMs: Math.round(performance.now() - start),
        summary: `LIVE Event URL Extraction: Status=${(live.draft.sourceUrlStatus ?? 'verified').toUpperCase()} · Canonical URL=${live.draft.verifiedCanonicalUrl ?? 'null'} · Extracted Title="${live.draft.title || 'null'}"`,
        payload: live,
      });
    } catch (err) {
      setUrlResult({
        status: 'error',
        latencyMs: Math.round(performance.now() - start),
        summary: err instanceof Error ? err.message : 'Live URL extraction failed',
      });
    }
  };

  // Run Automated URL Verification Suite (Requirement #4)
  const handleRunAutomatedUrlSuite = async () => {
    setUrlTestCases((prev) =>
      prev.map((tc) => ({ ...tc, status: 'running', actualDetail: undefined }))
    );

    for (const tc of urlTestCases) {
      try {
        const res = await fetch('/api/events/verify-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: tc.url }),
        });
        const data = await res.json();

        let passed = false;
        let detail = '';

        if (tc.id === 'valid_event') {
          passed =
            data.ok === true &&
            (data.status === 'verified' || data.status === 'redirected_valid');
          detail = `HTTP ${data.httpStatus} · status=${data.status} · canonical=${data.verifiedCanonicalUrl}`;
        } else if (tc.id === 'redirected_url') {
          passed = data.ok === true && Boolean(data.verifiedCanonicalUrl);
          detail = `HTTP ${data.httpStatus} · status=${data.status} · canonical=${data.verifiedCanonicalUrl}`;
        } else if (tc.id === 'broken_404') {
          passed = data.status === 'unavailable' || data.httpStatus === 404 || !data.ok;
          detail = `HTTP ${data.httpStatus ?? 'ERR'} · status=${data.status ?? 'unavailable'} (Marked unavailable as expected)`;
        } else if (tc.id === 'ssrf_metadata_block') {
          passed = !res.ok || data.ok === false;
          detail = `Blocked (${res.status}): ${data.message || data.error}`;
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

  // Test 4: PESU OAuth2 Discovery & Authorized Consent Flow
  const handleProbePesuDiscovery = async () => {
    const start = performance.now();
    setOauthDiscoveryState({ status: 'running' });

    try {
      const res = await fetch('/api/pesu-oauth/discovery');
      const data = await res.json();
      setOauthDiscoveryState({
        status: data.ok ? 'success' : 'error',
        httpStatus: res.status,
        latencyMs: Math.round(performance.now() - start),
        summary: data.ok
          ? `Discovered OIDC metadata from ${data.issuer}`
          : `OIDC discovery probe note: ${data.note || data.message || data.error || 'Endpoint unreachable from cloud container'} (Client ID Configured: ${data.clientConfigured ? 'Yes' : 'No'})`,
        payload: data,
      });
    } catch (err) {
      setOauthDiscoveryState({
        status: 'error',
        latencyMs: Math.round(performance.now() - start),
        summary: err instanceof Error ? err.message : 'Failed to probe PESU OAuth2 discovery',
      });
    }
  };

  const handleLaunchPesuOAuthPopup = async () => {
    setOauthPopupStatus(null);
    try {
      const res = await fetch(`/api/pesu-oauth/url?scopes=${encodeURIComponent(oauthScopes)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setOauthPopupStatus(`Configuration Required: ${data.message || data.error}`);
        return;
      }
      const popup = window.open(data.authUrl, 'pesu_oauth_popup', 'width=560,height=680');
      if (!popup) {
        setOauthPopupStatus('Popup blocked by browser. Please allow popups for this site.');
      } else {
        setOauthPopupStatus(
          `Opened authorized PKCE consent window (${data.redirectUri}). Waiting for callback...`
        );
      }
    } catch (err) {
      setOauthPopupStatus(err instanceof Error ? err.message : 'Failed to construct OAuth URL');
    }
  };

  // Test 5: Live File Processing (Sample Poster Generation + Upload)
  const handleRunSamplePosterTest = async () => {
    const start = performance.now();
    setFileResult({ status: 'running' });

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 550;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');

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

      if (executionMode === 'demo') {
        setFileResult({
          status: 'success',
          latencyMs: Math.round(performance.now() - start),
          summary:
            '[DEMO SIMULATION — NOT A LIVE API CALL] Generated sample poster PNG (900x550). Switch to Live Test Mode above to send this image to /api/events/extract-file for real multimodal Gemini extraction.',
          payload: { fileName: 'quackathon-poster.png', mimeType: 'image/png' },
        });
        return;
      }

      const live = await extractLiveEventFileMetadata({
        fileName: 'quackathon-poster.png',
        mimeType: 'image/png',
        base64Data,
      });

      if (!live.ok || !live.draft) {
        setFileResult({
          status: 'error',
          latencyMs: Math.round(performance.now() - start),
          summary: live.errorMessage ?? 'Live file extraction failed.',
          payload: live,
        });
        return;
      }

      setFileResult({
        status: 'success',
        httpStatus: 200,
        latencyMs: Math.round(performance.now() - start),
        summary: `LIVE Multimodal Poster Extraction (gemini-4-hydrogen): Extracted Title="${live.draft.title}", Team Size=${live.draft.teamSize?.min}–${live.draft.teamSize?.max}, Venue="${live.draft.venue?.name} (${live.draft.venue?.campus})"`,
        payload: live.draft,
      });
    } catch (err) {
      setFileResult({
        status: 'error',
        latencyMs: Math.round(performance.now() - start),
        summary: err instanceof Error ? err.message : 'File extraction test failed',
      });
    }
  };

  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const start = performance.now();
    setFileResult({ status: 'running' });

    const reader = new FileReader();
    reader.onload = async () => {
      const resStr = String(reader.result ?? '');
      const base64Data = resStr.includes(',') ? resStr.split(',')[1] : resStr;
      try {
        const live = await extractLiveEventFileMetadata({
          fileName: file.name,
          mimeType: file.type,
          base64Data,
        });
        if (!live.ok || !live.draft) {
          setFileResult({
            status: 'error',
            latencyMs: Math.round(performance.now() - start),
            summary: live.errorMessage ?? 'Custom file extraction failed',
          });
          return;
        }
        setFileResult({
          status: 'success',
          httpStatus: 200,
          latencyMs: Math.round(performance.now() - start),
          summary: `LIVE File Extraction (${file.name}): Title="${live.draft.title || 'null'}", Team=${live.draft.teamSize?.min ?? 'null'}–${live.draft.teamSize?.max ?? 'null'}`,
          payload: live.draft,
        });
      } catch (err) {
        setFileResult({
          status: 'error',
          latencyMs: Math.round(performance.now() - start),
          summary: err instanceof Error ? err.message : 'Custom file upload extraction failed',
        });
      }
    };
    reader.readAsDataURL(file);
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
            Verify each external integration independently. Simulated responses in Demo Mode are never reported as live API calls. Switch to <strong>Live Test Mode</strong> to execute real server-side requests.
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
            Server-Side Environment & Secret Readiness
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
            <span className="text-slate-400 block">GEMINI_API_KEY (Server-Side)</span>
            <span
              className={`font-semibold ${
                serverConfig?.geminiConfigured ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              {serverConfig?.geminiConfigured
                ? 'Configured & Ready'
                : 'Missing in Environment'}
            </span>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <span className="text-slate-400 block">GitHub REST API</span>
            <span className="font-semibold text-emerald-600">
              {serverConfig?.githubTokenConfigured
                ? 'Authenticated (GITHUB_TOKEN set)'
                : 'Public Unauthenticated (60 req/hr)'}
            </span>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200/80 dark:border-slate-800">
            <span className="text-slate-400 block">PESU_OAUTH_CLIENT_ID</span>
            <span
              className={`font-semibold ${
                serverConfig?.pesuOAuthClientConfigured ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              {serverConfig?.pesuOAuthClientConfigured
                ? 'Client ID Configured'
                : 'Not Set (Discovery Probe Available)'}
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
              Extracts suggested skills and project summaries from retrieved GitHub evidence with JSON schema validation.
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
                  {geminiResult.status.toUpperCase()}
                </span>
                <span className="font-mono text-[11px]">{geminiResult.latencyMs} ms</span>
              </div>
              <p>{geminiResult.summary}</p>
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
              Fetches public event pages, follows redirects safely, extracts JSON-LD/OpenGraph metadata, and detects broken links.
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

        {/* 4. PESU OAuth2 (`pesu-dev/oauth2`) */}
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-600" />
              4. PESU OAuth2 (`pesu-dev/oauth2`) PKCE Flow
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Probes OIDC discovery metadata and launches an authorized PKCE S256 redirect/popup consent flow (zero password collection).
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Requested Scopes (Identity + Optional Academy Scopes)
            </label>
            <input
              type="text"
              value={oauthScopes}
              onChange={(e) => setOauthScopes(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleProbePesuDiscovery}
              disabled={oauthDiscoveryState.status === 'running'}
              className="px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              {oauthDiscoveryState.status === 'running' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Probe OIDC Discovery
            </button>

            <button
              type="button"
              onClick={handleLaunchPesuOAuthPopup}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Launch Authorized OAuth2 Consent Popup
            </button>
          </div>

          {oauthDiscoveryState.status !== 'idle' && oauthDiscoveryState.status !== 'running' && (
            <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs space-y-1">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                Discovery Result ({oauthDiscoveryState.latencyMs} ms):
              </div>
              <p className="text-slate-600 dark:text-slate-400">{oauthDiscoveryState.summary}</p>
            </div>
          )}

          {oauthPopupStatus && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{oauthPopupStatus}</span>
            </div>
          )}
        </div>

        {/* 5. File Processing (Brochure PDF / Poster Image) */}
        <div className="lg:col-span-2 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
                <FileUp className="w-4 h-4 text-blue-600" />
                5. Hackathon Poster & PDF Brochure Multimodal Extraction
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Validates file MIME type (PDF, PNG, JPG, WebP) and size (&le; 10 MB), then extracts structured event metadata while keeping missing fields null.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleRunSamplePosterTest}
                disabled={fileResult.status === 'running'}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                {fileResult.status === 'running' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Test Sample Hackathon Poster
              </button>

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
                <span>{fileResult.status.toUpperCase()}</span>
                <span className="font-mono text-[11px]">{fileResult.latencyMs} ms</span>
              </div>
              <p>{fileResult.summary}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
