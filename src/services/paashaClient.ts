/**
 * PAASHA Microservice Client Adapter (`src/services/paashaClient.ts`)
 *
 * Connects Quackathon to the independent PAASHA microservice
 * (https://github.com/Roshan2607/pesu-announcements-scraper) over HTTP.
 *
 * Design & Security Principles:
 * - PAASHA remains a separate, independently deployable service.
 * - Uses PAASHA's primary structured endpoint `GET /api/v1/hackathons` (not the reduced
 *   `/api/v1/quackathon/events` announcement envelope) so full metadata—stable ID, category,
 *   organizer, event dates, registration URL, deadline/status, verified team-size bounds,
 *   campus/venue, public source verification metadata, and classification metadata—is preserved.
 * - Uses `GET /api/v1/connection-status` (and `/health`) for service diagnostics.
 * - Reads `PAASHA_SERVICE_URL`, `PAASHA_API_KEY`, and `PAASHA_REQUEST_TIMEOUT_MS` strictly
 *   from server-side environment variables.
 * - Never exposes `PAASHA_API_KEY` in client bundles, API responses, or logs.
 * - Implements request timeouts, bounded retries for transient network/5xx errors,
 *   strict runtime schema validation, and graceful degradation when PAASHA is unreachable.
 */

export type PaashaEventCategory =
  | 'HACKATHON'
  | 'IDEATHON'
  | 'CTF'
  | 'CODING_COMPETITION'
  | 'WORKSHOP'
  | 'GENERAL_ANNOUNCEMENT';

export interface PaashaEligibilityInfo {
  campus: 'RR' | 'EC' | 'ALL' | 'UNKNOWN';
  departments: string[];
  targetYears: number[];
  isOpenToAll: boolean;
  status: 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'UNKNOWN';
  registrationDeadline: string | null;
}

export interface PaashaVerificationInfo {
  isIndependentlyVerified: boolean;
  verificationSource:
    | 'PUBLIC_PLATFORM'
    | 'OFFICIAL_DOMAIN'
    | 'UNVERIFIED_PORTAL_ONLY';
  publicProofUrl: string | null;
  candidateProofUrl: string | null;
  verificationStatus:
    | 'VERIFIED'
    | 'PENDING_VERIFICATION'
    | 'FAILED_ACCESSIBILITY'
    | 'FAILED_RELEVANCE'
    | 'UNVERIFIED';
  verifiedAt: string | null;
  verificationFailureReason: string | null;
  requiresAdminReview: boolean;
}

export interface PaashaClassifiedHackathon {
  id: string;
  announcementId: string;
  title: string;
  category: PaashaEventCategory;
  isHackathon: boolean;
  isMatchable: boolean;
  organizer: string | null;
  publishedDate: string | null;
  eventDates: {
    start: string | null;
    end: string | null;
  };
  startAt: string | null;
  endAt: string | null;
  registrationDeadline: string | null;
  registrationStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  registrationUrl: string | null;
  officialSourceUrl: string | null;
  cashPrize: string | null;
  teamSize: {
    min: number;
    max: number;
  } | null;
  minTeamSize: number | null;
  maxTeamSize: number | null;
  format: 'onsite' | 'online' | 'hybrid' | 'unknown';
  mode: 'ONLINE' | 'OFFLINE' | 'HYBRID' | 'UNKNOWN';
  campus: string | null;
  venue: string | null;
  posterUrl: string | null;
  ocrExtracted: boolean;
  ocrSnippet?: string | null;
  description: string;
  publicSummary: string;
  tags: string[];
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  classificationReason: string;
  verificationStatus: string;
  fieldProvenance?: Record<string, string>;
  eligibility: PaashaEligibilityInfo;
  verification: PaashaVerificationInfo;
}

export type PaashaHackathonItem = PaashaClassifiedHackathon;

export type PaashaErrorCategory =
  | 'NONE'
  | 'MISSING_CONFIG'
  | 'INVALID_CONFIG'
  | 'UNAUTHORIZED'
  | 'TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'INVALID_RESPONSE';

export type PaashaErrorCode =
  | 'PAASHA_NOT_CONFIGURED'
  | 'PAASHA_UNAUTHORIZED'
  | 'PAASHA_TIMEOUT'
  | 'PAASHA_UNAVAILABLE'
  | 'PAASHA_INVALID_RESPONSE';

export interface PaashaClientDiagnostics {
  serviceName: 'paasha_microservice';
  configured: boolean;
  serviceUrl: string | null;
  endpoint: string;
  httpStatus: number | null;
  errorCategory: PaashaErrorCategory;
  retryAttempts: number;
  durationMs: number;
}

export interface PaashaHackathonsFetchResult {
  ok: boolean;
  total: number;
  syncedAt: string | null;
  fetchedAt: string | null;
  hackathons: PaashaClassifiedHackathon[];
  items: PaashaClassifiedHackathon[];
  invalidItemsDropped: number;
  warnings: string[];
  statusCode: number;
  errorCode?: PaashaErrorCode;
  error?: string;
  message: string;
  userMessage: string;
  diagnostics: PaashaClientDiagnostics;
}

export interface PaashaConnectionStatusResult {
  ok: boolean;
  configured: boolean;
  reachable: boolean;
  serviceReachable: boolean;
  authenticated: boolean;
  serviceUrl: string | null;
  statusCode: number;
  errorCode?: PaashaErrorCode;
  portalLive: boolean;
  sessionActive: boolean;
  latencyMs: number | null;
  checkedAt: string;
  syncStatus: Record<string, unknown> | null;
  upstreamStatus: Record<string, unknown> | null;
  error?: string;
  message: string;
  userMessage: string;
  diagnostics: PaashaClientDiagnostics;
}

export interface PaashaConfig {
  configured: boolean;
  serviceUrl: string | null;
  apiKey: string | null;
  timeoutMs: number;
  configError?: string;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

let customFetchOverride: FetchLike | null = null;

export function setPaashaClientFetchOverride(fn: FetchLike | null): void {
  customFetchOverride = fn;
}

function getActiveFetch(): FetchLike {
  return customFetchOverride ?? globalThis.fetch.bind(globalThis);
}

function mapCategoryToErrorCode(cat: PaashaErrorCategory): PaashaErrorCode | undefined {
  switch (cat) {
    case 'NONE':
      return undefined;
    case 'MISSING_CONFIG':
    case 'INVALID_CONFIG':
      return 'PAASHA_NOT_CONFIGURED';
    case 'UNAUTHORIZED':
      return 'PAASHA_UNAUTHORIZED';
    case 'TIMEOUT':
      return 'PAASHA_TIMEOUT';
    case 'INVALID_RESPONSE':
      return 'PAASHA_INVALID_RESPONSE';
    case 'SERVICE_UNAVAILABLE':
    default:
      return 'PAASHA_UNAVAILABLE';
  }
}

/**
 * Resolves PAASHA microservice configuration from server-side environment variables.
 * Never logs or returns the raw API key to external callers.
 */
export function resolvePaashaConfig(): PaashaConfig {
  const rawUrl = (
    process.env.PAASHA_SERVICE_URL ||
    process.env.HACKATHON_SCRAPER_SERVICE_URL ||
    ''
  ).trim();
  const rawKey = (
    process.env.PAASHA_API_KEY ||
    process.env.HACKATHON_SCRAPER_API_KEY ||
    ''
  ).trim();
  const rawTimeout = parseInt(
    process.env.PAASHA_REQUEST_TIMEOUT_MS || '15000',
    10
  );
  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout >= 500 && rawTimeout <= 60000
      ? rawTimeout
      : 15000;

  if (!rawUrl && !rawKey) {
    return {
      configured: false,
      serviceUrl: null,
      apiKey: null,
      timeoutMs,
      configError:
        'PAASHA_SERVICE_URL and PAASHA_API_KEY are not configured on the server.',
    };
  }

  if (!rawUrl) {
    return {
      configured: false,
      serviceUrl: null,
      apiKey: null,
      timeoutMs,
      configError: 'PAASHA_SERVICE_URL is missing.',
    };
  }

  let normalizedUrl: string;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        configured: false,
        serviceUrl: null,
        apiKey: null,
        timeoutMs,
        configError:
          'PAASHA_SERVICE_URL must use http:// or https:// protocol.',
      };
    }
    normalizedUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return {
      configured: false,
      serviceUrl: null,
      apiKey: null,
      timeoutMs,
      configError: 'PAASHA_SERVICE_URL is not a valid URL.',
    };
  }

  if (!rawKey) {
    return {
      configured: false,
      serviceUrl: normalizedUrl,
      apiKey: null,
      timeoutMs,
      configError:
        'PAASHA_API_KEY is missing. Set a server-side Bearer token to authenticate with PAASHA.',
    };
  }

  return {
    configured: true,
    serviceUrl: normalizedUrl,
    apiKey: rawKey,
    timeoutMs,
  };
}

/**
 * Redacts any accidental occurrence of the secret API key from error strings.
 */
function redactSecret(message: string, secret: string | null): string {
  if (!message) return '';
  let out = message;
  if (secret && secret.length >= 4) {
    out = out.split(secret).join('[REDACTED_PAASHA_KEY]');
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
  return out;
}

const VALID_CATEGORIES = new Set<PaashaEventCategory>([
  'HACKATHON',
  'IDEATHON',
  'CTF',
  'CODING_COMPETITION',
  'WORKSHOP',
  'GENERAL_ANNOUNCEMENT',
]);

/**
 * Validates and normalizes a single hackathon record returned by PAASHA's `GET /api/v1/hackathons`.
 * Supports both nested PAASHA `/api/v1/hackathons` objects and flat PAASHA item structures.
 * Returns `null` if required structural fields (`id`, `title`) are missing or malformed.
 */
export function validatePaashaHackathonItem(
  raw: unknown
): { item: PaashaClassifiedHackathon | null; warning?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { item: null, warning: 'Skipped non-object item in PAASHA response.' };
  }

  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';

  if (!id || !title) {
    return {
      item: null,
      warning: `Skipped PAASHA record with missing id or title (id="${id || 'none'}").`,
    };
  }

  const rawCategoryStr = (
    typeof obj.category === 'string'
      ? obj.category
      : typeof obj.eventType === 'string'
        ? obj.eventType
        : ''
  )
    .trim()
    .toUpperCase();

  const normalizedCategoryStr =
    rawCategoryStr === 'COMPETITION' ? 'CODING_COMPETITION' : rawCategoryStr;

  const category: PaashaEventCategory = VALID_CATEGORIES.has(
    normalizedCategoryStr as PaashaEventCategory
  )
    ? (normalizedCategoryStr as PaashaEventCategory)
    : 'HACKATHON';

  const isHackathon =
    typeof obj.isHackathon === 'boolean'
      ? obj.isHackathon
      : category !== 'WORKSHOP' && category !== 'GENERAL_ANNOUNCEMENT';
  const isMatchable = Boolean(obj.isMatchable);
  const organizer =
    typeof obj.organizer === 'string' && obj.organizer.trim()
      ? obj.organizer.trim()
      : null;
  const publishedDate =
    typeof obj.publishedDate === 'string' && obj.publishedDate.trim()
      ? obj.publishedDate.trim()
      : null;

  const rawDates =
    obj.eventDates && typeof obj.eventDates === 'object'
      ? (obj.eventDates as Record<string, unknown>)
      : {};
  const start =
    typeof rawDates.start === 'string' && rawDates.start.trim()
      ? rawDates.start.trim()
      : typeof obj.startDate === 'string' && obj.startDate.trim()
        ? obj.startDate.trim()
        : typeof obj.startAt === 'string' && obj.startAt.trim()
          ? obj.startAt.trim()
          : null;
  const end =
    typeof rawDates.end === 'string' && rawDates.end.trim()
      ? rawDates.end.trim()
      : typeof obj.endDate === 'string' && obj.endDate.trim()
        ? obj.endDate.trim()
        : typeof obj.endAt === 'string' && obj.endAt.trim()
          ? obj.endAt.trim()
          : null;

  const registrationUrl =
    typeof obj.registrationUrl === 'string' && obj.registrationUrl.trim()
      ? obj.registrationUrl.trim()
      : null;
  const cashPrize =
    typeof obj.cashPrize === 'string' && obj.cashPrize.trim()
      ? obj.cashPrize.trim()
      : null;

  let teamSize: { min: number; max: number } | null = null;
  if (obj.teamSize && typeof obj.teamSize === 'object') {
    const ts = obj.teamSize as Record<string, unknown>;
    const min = typeof ts.min === 'number' ? Math.trunc(ts.min) : NaN;
    const max = typeof ts.max === 'number' ? Math.trunc(ts.max) : NaN;
    if (
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min >= 1 &&
      max >= min &&
      max <= 15
    ) {
      teamSize = { min, max };
    }
  } else {
    const flatMin =
      typeof obj.teamSizeMin === 'number'
        ? Math.trunc(obj.teamSizeMin)
        : typeof obj.minTeamSize === 'number'
          ? Math.trunc(obj.minTeamSize)
          : NaN;
    const flatMax =
      typeof obj.teamSizeMax === 'number'
        ? Math.trunc(obj.teamSizeMax)
        : typeof obj.maxTeamSize === 'number'
          ? Math.trunc(obj.maxTeamSize)
          : NaN;
    if (
      Number.isFinite(flatMin) &&
      Number.isFinite(flatMax) &&
      flatMin >= 1 &&
      flatMax >= flatMin &&
      flatMax <= 15
    ) {
      teamSize = { min: flatMin, max: flatMax };
    }
  }

  const rawFormat = (
    typeof obj.format === 'string'
      ? obj.format
      : typeof obj.mode === 'string'
        ? obj.mode
        : 'unknown'
  )
    .trim()
    .toLowerCase();
  const format: 'onsite' | 'online' | 'hybrid' | 'unknown' =
    rawFormat === 'onsite' || rawFormat === 'offline'
      ? 'onsite'
      : rawFormat === 'online'
        ? 'online'
        : rawFormat === 'hybrid'
          ? 'hybrid'
          : 'unknown';
  const mode: 'ONLINE' | 'OFFLINE' | 'HYBRID' | 'UNKNOWN' =
    format === 'online'
      ? 'ONLINE'
      : format === 'hybrid'
        ? 'HYBRID'
        : format === 'onsite'
          ? 'OFFLINE'
          : 'UNKNOWN';

  const venue =
    typeof obj.venue === 'string' && obj.venue.trim()
      ? obj.venue.trim()
      : typeof obj.campusOrVenue === 'string' && obj.campusOrVenue.trim()
        ? obj.campusOrVenue.trim()
        : null;
  const posterUrl =
    typeof obj.posterUrl === 'string' && obj.posterUrl.trim()
      ? obj.posterUrl.trim()
      : typeof obj.posterImageUrl === 'string' && obj.posterImageUrl.trim()
        ? obj.posterImageUrl.trim()
        : null;
  const ocrExtracted = Boolean(obj.ocrExtracted);
  const ocrSnippet =
    typeof obj.ocrSnippet === 'string' ? obj.ocrSnippet : null;
  const description =
    typeof obj.description === 'string' && obj.description.trim()
      ? obj.description.trim()
      : typeof obj.summary === 'string' && obj.summary.trim()
        ? obj.summary.trim()
        : typeof obj.publicSummary === 'string' && obj.publicSummary.trim()
          ? obj.publicSummary.trim()
          : '';
  const publicSummary =
    typeof obj.publicSummary === 'string' && obj.publicSummary.trim()
      ? obj.publicSummary.trim()
      : typeof obj.summary === 'string' && obj.summary.trim()
        ? obj.summary.trim()
        : description;

  const tags = Array.isArray(obj.tags)
    ? obj.tags
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim())
    : [];
  const rawConf =
    typeof obj.confidence === 'string' ? obj.confidence.toLowerCase() : 'medium';
  const confidence: 'high' | 'medium' | 'low' =
    rawConf === 'high' || rawConf === 'medium' || rawConf === 'low'
      ? rawConf
      : 'medium';
  const confidenceScore =
    typeof obj.confidenceScore === 'number'
      ? obj.confidenceScore
      : confidence === 'high'
        ? 0.9
        : confidence === 'medium'
          ? 0.7
          : 0.4;
  const classificationReason =
    typeof obj.classificationReason === 'string' &&
    obj.classificationReason.trim()
      ? obj.classificationReason.trim()
      : 'Classified by PAASHA.';

  const rawElig =
    obj.eligibility && typeof obj.eligibility === 'object'
      ? (obj.eligibility as Record<string, unknown>)
      : {};
  const rawCampus = (
    typeof rawElig.campus === 'string'
      ? rawElig.campus
      : typeof obj.campus === 'string'
        ? obj.campus
        : typeof obj.campusOrVenue === 'string'
          ? obj.campusOrVenue
          : 'UNKNOWN'
  )
    .trim()
    .toUpperCase();
  const campus: 'RR' | 'EC' | 'ALL' | 'UNKNOWN' =
    rawCampus === 'RR' || /RR\s*CAMPUS/i.test(rawCampus)
      ? 'RR'
      : rawCampus === 'EC' || /EC\s*CAMPUS/i.test(rawCampus)
        ? 'EC'
        : rawCampus === 'ALL'
          ? 'ALL'
          : 'UNKNOWN';

  const rawStatus = (
    typeof rawElig.status === 'string'
      ? rawElig.status
      : typeof obj.registrationStatus === 'string'
        ? obj.registrationStatus
        : 'UNKNOWN'
  )
    .trim()
    .toUpperCase();
  const status: 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'UNKNOWN' =
    rawStatus === 'REGISTRATION_OPEN' || rawStatus === 'OPEN'
      ? 'REGISTRATION_OPEN'
      : rawStatus === 'REGISTRATION_CLOSED' || rawStatus === 'CLOSED'
        ? 'REGISTRATION_CLOSED'
        : 'UNKNOWN';
  const registrationStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN' =
    status === 'REGISTRATION_OPEN'
      ? 'OPEN'
      : status === 'REGISTRATION_CLOSED'
        ? 'CLOSED'
        : 'UNKNOWN';

  const registrationDeadline =
    typeof rawElig.registrationDeadline === 'string' &&
    rawElig.registrationDeadline.trim()
      ? rawElig.registrationDeadline.trim()
      : typeof obj.registrationDeadline === 'string' &&
          obj.registrationDeadline.trim()
        ? obj.registrationDeadline.trim()
        : null;

  const eligibility: PaashaEligibilityInfo = {
    campus,
    departments: Array.isArray(rawElig.departments)
      ? rawElig.departments.filter((d): d is string => typeof d === 'string')
      : [],
    targetYears: Array.isArray(rawElig.targetYears)
      ? rawElig.targetYears.filter((y): y is number => typeof y === 'number')
      : [],
    isOpenToAll: Boolean(rawElig.isOpenToAll ?? true),
    status,
    registrationDeadline,
  };

  const rawVerif =
    obj.verification && typeof obj.verification === 'object'
      ? (obj.verification as Record<string, unknown>)
      : {};
  const rawVerifSource =
    typeof rawVerif.verificationSource === 'string'
      ? rawVerif.verificationSource.trim().toUpperCase()
      : 'UNVERIFIED_PORTAL_ONLY';
  const verificationSource: PaashaVerificationInfo['verificationSource'] =
    rawVerifSource === 'PUBLIC_PLATFORM' || rawVerifSource === 'OFFICIAL_DOMAIN'
      ? rawVerifSource
      : 'UNVERIFIED_PORTAL_ONLY';
  const rawVerifStatus = (
    typeof rawVerif.verificationStatus === 'string'
      ? rawVerif.verificationStatus
      : typeof obj.verificationStatus === 'string'
        ? obj.verificationStatus
        : 'UNVERIFIED'
  )
    .trim()
    .toUpperCase();
  const verificationStatus: PaashaVerificationInfo['verificationStatus'] =
    rawVerifStatus === 'VERIFIED' || rawVerifStatus === 'CONFIRMED'
      ? 'VERIFIED'
      : rawVerifStatus === 'PENDING_VERIFICATION' ||
          rawVerifStatus === 'ANNOUNCEMENT_ONLY'
        ? 'PENDING_VERIFICATION'
        : rawVerifStatus === 'FAILED_ACCESSIBILITY' ||
            rawVerifStatus === 'FAILED_RELEVANCE'
          ? (rawVerifStatus as PaashaVerificationInfo['verificationStatus'])
          : 'UNVERIFIED';

  const publicProofUrl =
    typeof rawVerif.publicProofUrl === 'string' &&
    rawVerif.publicProofUrl.trim()
      ? rawVerif.publicProofUrl.trim()
      : typeof obj.officialSourceUrl === 'string' &&
          obj.officialSourceUrl.trim()
        ? obj.officialSourceUrl.trim()
        : typeof obj.sourceUrl === 'string' && obj.sourceUrl.trim()
          ? obj.sourceUrl.trim()
          : null;

  const isIndependentlyVerified = Boolean(
    rawVerif.isIndependentlyVerified ?? obj.isIndependentlyVerified
  );

  const verification: PaashaVerificationInfo = {
    isIndependentlyVerified,
    verificationSource,
    publicProofUrl,
    candidateProofUrl:
      typeof rawVerif.candidateProofUrl === 'string' &&
      rawVerif.candidateProofUrl.trim()
        ? rawVerif.candidateProofUrl.trim()
        : publicProofUrl,
    verificationStatus,
    verifiedAt:
      typeof rawVerif.verifiedAt === 'string' && rawVerif.verifiedAt.trim()
        ? rawVerif.verifiedAt.trim()
        : typeof obj.verifiedAt === 'string' && obj.verifiedAt.trim()
          ? obj.verifiedAt.trim()
          : null,
    verificationFailureReason:
      typeof rawVerif.verificationFailureReason === 'string'
        ? rawVerif.verificationFailureReason
        : null,
    requiresAdminReview:
      typeof rawVerif.requiresAdminReview === 'boolean'
        ? rawVerif.requiresAdminReview
        : !isIndependentlyVerified,
  };

  const announcementId =
    typeof obj.announcementId === 'string' && obj.announcementId.trim()
      ? obj.announcementId.trim()
      : id;

  return {
    item: {
      id,
      announcementId,
      title,
      category,
      isHackathon,
      isMatchable,
      organizer,
      publishedDate,
      eventDates: { start, end },
      startAt: start,
      endAt: end,
      registrationDeadline,
      registrationStatus,
      registrationUrl,
      officialSourceUrl: publicProofUrl,
      cashPrize,
      teamSize,
      minTeamSize: teamSize?.min ?? null,
      maxTeamSize: teamSize?.max ?? null,
      format,
      mode,
      campus: campus !== 'UNKNOWN' ? campus : venue,
      venue,
      posterUrl,
      ocrExtracted,
      ocrSnippet,
      description,
      publicSummary,
      tags,
      confidence,
      confidenceScore,
      classificationReason,
      verificationStatus: rawVerifStatus,
      fieldProvenance:
        obj.fieldProvenance && typeof obj.fieldProvenance === 'object'
          ? (obj.fieldProvenance as Record<string, string>)
          : undefined,
      eligibility,
      verification,
    },
  };
}

/**
 * Internal helper performing an authenticated HTTP request to PAASHA with
 * per-request timeout (`AbortController`) and bounded retries on transient failures.
 */
async function requestPaashaJson(params: {
  path: string;
  method?: 'GET' | 'POST';
  maxRetries?: number;
  customFetch?: FetchLike;
}): Promise<{
  ok: boolean;
  httpStatus: number | null;
  data: Record<string, unknown> | null;
  errorCategory: PaashaErrorCategory;
  errorMessage?: string;
  retryAttempts: number;
  durationMs: number;
  serviceUrl: string | null;
  configured: boolean;
}> {
  const startTime = Date.now();
  const cfg = resolvePaashaConfig();

  if (!cfg.configured || !cfg.serviceUrl || !cfg.apiKey) {
    return {
      ok: false,
      httpStatus: null,
      data: null,
      errorCategory: cfg.configError?.includes('not a valid URL')
        ? 'INVALID_CONFIG'
        : 'MISSING_CONFIG',
      errorMessage:
        cfg.configError ||
        'PAASHA microservice is not configured on the server.',
      retryAttempts: 0,
      durationMs: Date.now() - startTime,
      serviceUrl: cfg.serviceUrl,
      configured: false,
    };
  }

  const fetchImpl = params.customFetch ?? getActiveFetch();
  const maxRetries = Math.min(2, Math.max(0, params.maxRetries ?? 1));
  const fullUrl = `${cfg.serviceUrl}${params.path.startsWith('/') ? params.path : `/${params.path}`}`;

  let attempt = 0;
  let lastErrorCategory: PaashaErrorCategory = 'SERVICE_UNAVAILABLE';
  let lastErrorMessage = 'PAASHA service is unreachable.';
  let lastHttpStatus: number | null = null;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const response = await fetchImpl(fullUrl, {
        method: params.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      lastHttpStatus = response.status;

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          httpStatus: response.status,
          data: null,
          errorCategory: 'UNAUTHORIZED',
          errorMessage:
            'PAASHA rejected the API key (HTTP 401/403). Verify PAASHA_API_KEY matches PAASHA API_SECRET_KEY.',
          retryAttempts: attempt,
          durationMs: Date.now() - startTime,
          serviceUrl: cfg.serviceUrl,
          configured: true,
        };
      }

      if (response.status >= 500) {
        lastErrorCategory = 'SERVICE_UNAVAILABLE';
        lastErrorMessage = `PAASHA returned HTTP ${response.status}.`;
        if (attempt < maxRetries) {
          attempt++;
          continue;
        }
        return {
          ok: false,
          httpStatus: response.status,
          data: null,
          errorCategory: 'SERVICE_UNAVAILABLE',
          errorMessage: lastErrorMessage,
          retryAttempts: attempt,
          durationMs: Date.now() - startTime,
          serviceUrl: cfg.serviceUrl,
          configured: true,
        };
      }

      const rawText = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return {
          ok: false,
          httpStatus: response.status,
          data: null,
          errorCategory: 'INVALID_RESPONSE',
          errorMessage:
            'PAASHA returned non-JSON or malformed JSON response.',
          retryAttempts: attempt,
          durationMs: Date.now() - startTime,
          serviceUrl: cfg.serviceUrl,
          configured: true,
        };
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          ok: false,
          httpStatus: response.status,
          data: null,
          errorCategory: 'INVALID_RESPONSE',
          errorMessage: 'PAASHA response root must be a JSON object.',
          retryAttempts: attempt,
          durationMs: Date.now() - startTime,
          serviceUrl: cfg.serviceUrl,
          configured: true,
        };
      }

      if (!response.ok) {
        const obj = parsed as Record<string, unknown>;
        return {
          ok: false,
          httpStatus: response.status,
          data: obj,
          errorCategory: 'SERVICE_UNAVAILABLE',
          errorMessage: redactSecret(
            typeof obj.error === 'string'
              ? obj.error
              : typeof obj.message === 'string'
                ? obj.message
                : `PAASHA returned HTTP ${response.status}.`,
            cfg.apiKey
          ),
          retryAttempts: attempt,
          durationMs: Date.now() - startTime,
          serviceUrl: cfg.serviceUrl,
          configured: true,
        };
      }

      return {
        ok: true,
        httpStatus: response.status,
        data: parsed as Record<string, unknown>,
        errorCategory: 'NONE',
        retryAttempts: attempt,
        durationMs: Date.now() - startTime,
        serviceUrl: cfg.serviceUrl,
        configured: true,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const rawMsg = err instanceof Error ? err.message : String(err);
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        /abort|timed?\s*out/i.test(rawMsg);

      lastErrorCategory = isAbort ? 'TIMEOUT' : 'SERVICE_UNAVAILABLE';
      lastErrorMessage = isAbort
        ? `PAASHA request timed out after ${cfg.timeoutMs}ms.`
        : `Could not connect to PAASHA microservice (${redactSecret(rawMsg, cfg.apiKey)}).`;

      if (attempt < maxRetries) {
        attempt++;
        continue;
      }
    }
  }

  return {
    ok: false,
    httpStatus: lastHttpStatus,
    data: null,
    errorCategory: lastErrorCategory,
    errorMessage: lastErrorMessage,
    retryAttempts: attempt,
    durationMs: Date.now() - startTime,
    serviceUrl: cfg.serviceUrl,
    configured: true,
  };
}

/**
 * Fetches structured hackathons & competitions from PAASHA's primary endpoint:
 * `GET /api/v1/hackathons`
 */
export async function fetchPaashaHackathons(options?: {
  includeUnverified?: boolean;
  matchableOnly?: boolean;
  category?: PaashaEventCategory;
  format?: 'onsite' | 'online' | 'hybrid';
  customFetch?: FetchLike;
}): Promise<PaashaHackathonsFetchResult> {
  const query = new URLSearchParams();
  if (options?.includeUnverified) {
    query.set('include_unverified', 'true');
  }
  if (options?.matchableOnly) {
    query.set('matchable_only', 'true');
  }
  if (options?.category) {
    query.set('category', options.category);
  }
  if (options?.format) {
    query.set('format', options.format);
  }

  const queryStr = query.toString();
  const endpoint = `/api/v1/hackathons${queryStr ? `?${queryStr}` : ''}`;

  const res = await requestPaashaJson({
    path: endpoint,
    method: 'GET',
    maxRetries: 1,
    customFetch: options?.customFetch,
  });

  if (!res.ok || !res.data) {
    const errorCode = mapCategoryToErrorCode(res.errorCategory) ?? 'PAASHA_UNAVAILABLE';
    const userMessage =
      res.errorCategory === 'MISSING_CONFIG' || res.errorCategory === 'INVALID_CONFIG'
        ? 'PAASHA microservice is not configured. Displaying verified events from existing sources.'
        : res.errorCategory === 'UNAUTHORIZED'
          ? 'PAASHA authentication failed (invalid API key). Displaying previously verified events.'
          : res.errorCategory === 'TIMEOUT'
            ? 'PAASHA microservice timed out. Displaying previously verified events.'
            : 'PAASHA microservice is currently unavailable. Displaying previously verified events.';
    const message = res.errorMessage || userMessage;

    return {
      ok: false,
      total: 0,
      syncedAt: null,
      fetchedAt: null,
      hackathons: [],
      items: [],
      invalidItemsDropped: 0,
      warnings: res.errorMessage ? [res.errorMessage] : [],
      statusCode: res.httpStatus ?? 503,
      errorCode,
      error: message,
      message,
      userMessage,
      diagnostics: {
        serviceName: 'paasha_microservice',
        configured: res.configured,
        serviceUrl: res.serviceUrl,
        endpoint,
        httpStatus: res.httpStatus,
        errorCategory: res.errorCategory,
        retryAttempts: res.retryAttempts,
        durationMs: res.durationMs,
      },
    };
  }

  const rawHackathons = Array.isArray(res.data.hackathons)
    ? res.data.hackathons
    : res.data.resource === 'hackathons' && Array.isArray(res.data.data)
      ? res.data.data
      : null;

  if (!Array.isArray(rawHackathons)) {
    const errMsg =
      'Invalid PAASHA response schema: expected hackathons array in /api/v1/hackathons.';
    return {
      ok: false,
      total: 0,
      syncedAt: null,
      fetchedAt: null,
      hackathons: [],
      items: [],
      invalidItemsDropped: 0,
      warnings: [
        'PAASHA /api/v1/hackathons response did not contain a valid hackathons array.',
      ],
      statusCode: 502,
      errorCode: 'PAASHA_INVALID_RESPONSE',
      error: errMsg,
      message: errMsg,
      userMessage:
        'PAASHA returned an unexpected response format. Displaying previously verified events.',
      diagnostics: {
        serviceName: 'paasha_microservice',
        configured: res.configured,
        serviceUrl: res.serviceUrl,
        endpoint,
        httpStatus: res.httpStatus,
        errorCategory: 'INVALID_RESPONSE',
        retryAttempts: res.retryAttempts,
        durationMs: res.durationMs,
      },
    };
  }

  const validated: PaashaClassifiedHackathon[] = [];
  const warnings: string[] = [];
  let invalidItemsDropped = 0;

  for (const rawItem of rawHackathons) {
    const { item, warning } = validatePaashaHackathonItem(rawItem);
    if (item) {
      validated.push(item);
    } else {
      invalidItemsDropped++;
      if (warning) warnings.push(warning);
    }
  }

  const syncedAt =
    typeof res.data.synced_at === 'string' && res.data.synced_at.trim()
      ? res.data.synced_at.trim()
      : typeof res.data.fetched_at === 'string' && res.data.fetched_at.trim()
        ? res.data.fetched_at.trim()
        : new Date().toISOString();

  const userMessage = `Retrieved ${validated.length} structured event record(s) from PAASHA.`;

  return {
    ok: true,
    total: validated.length,
    syncedAt,
    fetchedAt: syncedAt,
    hackathons: validated,
    items: validated,
    invalidItemsDropped,
    warnings,
    statusCode: 200,
    errorCode: undefined,
    message: userMessage,
    userMessage,
    diagnostics: {
      serviceName: 'paasha_microservice',
      configured: res.configured,
      serviceUrl: res.serviceUrl,
      endpoint,
      httpStatus: res.httpStatus,
      errorCategory: 'NONE',
      retryAttempts: res.retryAttempts,
      durationMs: res.durationMs,
    },
  };
}

/**
 * Checks PAASHA's authenticated connection status (`GET /api/v1/connection-status`)
 * to diagnose service reachability and PESU Academy session health.
 */
export async function checkPaashaConnectionStatus(options?: {
  customFetch?: FetchLike;
}): Promise<PaashaConnectionStatusResult> {
  const endpoint = '/api/v1/connection-status';
  const checkedAt = new Date().toISOString();

  const res = await requestPaashaJson({
    path: endpoint,
    method: 'GET',
    maxRetries: 0,
    customFetch: options?.customFetch,
  });

  if (!res.ok) {
    const data = res.data ?? {};
    const errorCode = mapCategoryToErrorCode(res.errorCategory) ?? 'PAASHA_UNAVAILABLE';
    const userMessage =
      res.errorMessage || 'PAASHA connection status check failed.';
    return {
      ok: false,
      configured: res.configured,
      reachable: res.httpStatus !== null && res.httpStatus < 500,
      serviceReachable: res.httpStatus !== null && res.httpStatus < 500,
      authenticated: false,
      serviceUrl: res.serviceUrl,
      statusCode: res.httpStatus ?? 503,
      errorCode,
      portalLive: Boolean(data.portalLive),
      sessionActive: Boolean(data.sessionActive),
      latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : null,
      checkedAt,
      syncStatus:
        data.syncStatus && typeof data.syncStatus === 'object'
          ? (data.syncStatus as Record<string, unknown>)
          : null,
      upstreamStatus: data,
      error: res.errorMessage,
      message: userMessage,
      userMessage,
      diagnostics: {
        serviceName: 'paasha_microservice',
        configured: res.configured,
        serviceUrl: res.serviceUrl,
        endpoint,
        httpStatus: res.httpStatus,
        errorCategory: res.errorCategory,
        retryAttempts: res.retryAttempts,
        durationMs: res.durationMs,
      },
    };
  }

  const data = res.data!;
  const isOk = Boolean(data.ok ?? true);
  const userMessage = 'PAASHA microservice is reachable and authenticated.';
  return {
    ok: isOk,
    configured: true,
    reachable: true,
    serviceReachable: true,
    authenticated: true,
    serviceUrl: res.serviceUrl,
    statusCode: 200,
    errorCode: isOk ? undefined : 'PAASHA_UNAVAILABLE',
    portalLive: Boolean(data.portalLive),
    sessionActive: Boolean(data.sessionActive),
    latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : null,
    checkedAt:
      typeof data.checkedAt === 'string' ? data.checkedAt : checkedAt,
    syncStatus:
      data.syncStatus && typeof data.syncStatus === 'object'
        ? (data.syncStatus as Record<string, unknown>)
        : null,
    upstreamStatus: data,
    message: userMessage,
    userMessage,
    diagnostics: {
      serviceName: 'paasha_microservice',
      configured: true,
      serviceUrl: res.serviceUrl,
      endpoint,
      httpStatus: res.httpStatus,
      errorCategory: 'NONE',
      retryAttempts: res.retryAttempts,
      durationMs: res.durationMs,
    },
  };
}
