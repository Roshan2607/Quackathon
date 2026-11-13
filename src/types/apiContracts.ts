/**
 * Shared Frontend/Backend API Contracts (Quackathon — PES Hackathon Team Finder)
 *
 * Ensures strict compile-time consistency between `server.ts`, `src/services/adapters.ts`,
 * `src/components/IntegrationTestingView.tsx`, and `src/components/HackathonsView.tsx`.
 */

import { CampusType, EventType } from './domain';

export type ExternalServiceName =
  | 'gemini_api'
  | 'github_rest_api'
  | 'pesu_oauth2'
  | 'event_url_extractor'
  | 'file_processor';

export type IntegrationErrorCategory =
  | 'NONE'
  | 'RATE_LIMITED'
  | 'TRANSIENT_UNAVAILABLE'
  | 'UPSTREAM_5XX'
  | 'AUTH_ERROR'
  | 'MISSING_CONFIG'
  | 'VALIDATION_ERROR'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'FILE_TOO_LARGE'
  | 'SSRF_BLOCKED'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'INVALID_DISCOVERY_HTML'
  | 'INVALID_DISCOVERY_METADATA'
  | 'OAUTH_SCOPE_REJECTED'
  | 'OAUTH_REDIRECT_URI_MISMATCH'
  | 'OAUTH_STATE_INVALID'
  | 'OAUTH_CONSENT_ERROR'
  | 'OAUTH_TOKEN_EXCHANGE_FAILED';

export type ExtractionMethodUsed =
  | 'pdf_text_parser'
  | 'deterministic_html'
  | 'gemini_multimodal'
  | 'gemini_text'
  | 'manual_fallback';

/**
 * Structured developer diagnostics returned by all integration endpoints.
 * Never includes API keys, client secrets, or raw access tokens.
 */
export interface DeveloperDiagnosticTelemetry {
  serviceName: ExternalServiceName;
  httpStatus: number;
  errorCategory: IntegrationErrorCategory;
  modelUsed?: string | null;
  retryAttempts: number;
  durationMs: number;
  requestId?: string | null;
  extractionMethod?: ExtractionMethodUsed;
}

/**
 * Standardized URL Verification Contract (Requirement #4)
 * Reconciles `status` values and `finalUrl` / `canonicalUrl` / `verifiedCanonicalUrl`.
 */
export type UrlVerificationStatus =
  | 'verified'
  | 'redirected_valid'
  | 'broken'
  | 'blocked_policy'
  | 'missing'
  | 'unavailable';

export interface VerifyUrlRequest {
  url: string;
}

export interface VerifyUrlResponse {
  ok: boolean;
  live: true;
  status: UrlVerificationStatus;
  httpStatus: number;
  submittedUrl: string;
  finalUrl: string | null;
  canonicalUrl: string | null;
  verifiedCanonicalUrl: string | null;
  redirectChain: string[];
  detectedTitle?: string | null;
  userMessage: string;
  error?: string;
  errorCategory?: IntegrationErrorCategory;
  diagnostics: DeveloperDiagnosticTelemetry;
}

/**
 * Extracted Event Fields Payload (shared by URL and File extraction)
 */
export interface ExtractedEventFields {
  title: string | null;
  organizer: string | null;
  eventType: EventType;
  themes: string[];
  description: string | null;
  venueName: string | null;
  campus: CampusType | null;
  format: 'onsite' | 'online' | 'hybrid' | 'unknown';
  startAt: string | null;
  endAt: string | null;
  registrationDeadline: string | null;
  minTeamSize: number | null;
  maxTeamSize: number | null;
  eligibilityNotes: string | null;
  registrationUrl: string | null;
  officialSourceUrl: string | null;
  extractedTextEvidence: string | null;
}

export interface ExtractEventFileRequest {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

export interface ExtractEventFileResponse {
  ok: boolean;
  live: true;
  fileAccepted: boolean;
  fileName: string;
  mimeType: string;
  byteSize: number;
  extractedAt?: string;
  extractionMethod: ExtractionMethodUsed;
  data?: ExtractedEventFields;
  warnings: string[];
  userMessage: string;
  errorCategory?: IntegrationErrorCategory;
  diagnostics: DeveloperDiagnosticTelemetry;
}

export interface ExtractEventUrlRequest {
  url: string;
  useGeminiFallback?: boolean;
}

export interface ExtractEventUrlResponse {
  ok: boolean;
  live: true;
  submittedUrl: string;
  finalUrl: string | null;
  canonicalUrl: string | null;
  verifiedCanonicalUrl: string | null;
  sourceUrlStatus: UrlVerificationStatus;
  redirectChain: string[];
  extractionMethod: ExtractionMethodUsed;
  deterministic?: Partial<ExtractedEventFields> & {
    visibleTextExcerpt?: string;
    hasJsonLdEvent?: boolean;
    teamSizeExcerpt?: string | null;
  };
  aiSupplement?: Partial<ExtractedEventFields> | null;
  data?: ExtractedEventFields;
  warnings: string[];
  userMessage: string;
  errorCategory?: IntegrationErrorCategory;
  diagnostics: DeveloperDiagnosticTelemetry;
}

/**
 * PESU OAuth2 End-to-End Contracts (Requirement #1)
 */
export interface PesuOAuthStageStatuses {
  providerDiscovery: 'idle' | 'ok' | 'invalid_response' | 'degraded_fallback' | 'unreachable';
  configuration: 'configured' | 'public_client_only' | 'missing_client_id';
  redirectUriValidation: 'valid' | 'mismatch';
  authorizationRedirect:
    | 'idle'
    | 'awaiting_user_consent'
    | 'callback_received'
    | 'consent_denied_or_error';
  tokenExchange: 'idle' | 'exchanging' | 'succeeded' | 'failed';
  verifiedIdentity: 'unverified' | 'verified';
}

export interface PesuVerifiedIdentity {
  sub: string;
  name?: string;
  email?: string;
  srn?: string;
  prn?: string;
  campus?: string;
  program?: string;
  grantedScopes: string[];
  verifiedAt: string;
  issuer: string;
}

export interface PesuOAuthDiscoveryResponse {
  ok: boolean;
  live: true;
  providerReachable: boolean;
  oidcDiscoveryAvailable: boolean;
  requestedUrl: string;
  responseUrl: string | null;
  httpStatus: number;
  contentType: string | null;
  redirectChain: string[];
  issuer: string | null;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  userinfoEndpoint: string | null;
  jwksUri?: string | null;
  revocationEndpoint?: string | null;
  responseTypesSupported?: string[];
  codeChallengeMethodsSupported?: string[];
  tokenEndpointAuthMethodsSupported?: string[];
  supportedScopes: string[];
  clientConfigured: boolean;
  clientSecretConfigured: boolean;
  expectedRedirectUri: string;
  allowedRedirectUris: string[];
  stages: PesuOAuthStageStatuses;
  userMessage: string;
  note?: string;
  configWarning?: string | null;
  diagnosticSnippet?: string | null;
  errorCategory?: IntegrationErrorCategory;
  diagnostics: DeveloperDiagnosticTelemetry;
}

export interface PesuOAuthUrlResponse {
  ok: boolean;
  live: true;
  /** Canonical property name for the authorization URL */
  authorizationUrl?: string;
  /** Alias preserved for backward compatibility */
  authUrl?: string;
  state?: string;
  redirectUri: string;
  scope?: string;
  scopes?: string[];
  codeChallengeMethod?: 'S256';
  stages: PesuOAuthStageStatuses;
  userMessage: string;
  errorCategory?: IntegrationErrorCategory;
  diagnostics: DeveloperDiagnosticTelemetry;
}

export interface PesuOAuthSessionStatusResponse {
  ok: boolean;
  authenticated: boolean;
  sessionId?: string;
  stages: PesuOAuthStageStatuses;
  identity?: PesuVerifiedIdentity | null;
  lastError?: string | null;
  lastDiagnostics?: DeveloperDiagnosticTelemetry | null;
}

/**
 * PostMessage payload sent from `/auth/pesu/callback` popup to the exact opener origin.
 * Never carries raw `access_token`, `refresh_token`, `client_secret`, or `code`.
 */
export interface PesuOAuthCallbackPostMessage {
  type: 'PESU_OAUTH_RESULT';
  ok: boolean;
  state: string;
  stages: PesuOAuthStageStatuses;
  identity?: PesuVerifiedIdentity | null;
  userMessage: string;
  errorCategory?: IntegrationErrorCategory;
  diagnostics: DeveloperDiagnosticTelemetry;
}
