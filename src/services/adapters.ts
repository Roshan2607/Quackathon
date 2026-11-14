/**
 * Modular Service Adapters (Quackathon — Real-Data MVP)
 *
 * Uses the shared typed API client (`src/lib/apiClient.ts`) which validates HTTP status
 * and `Content-Type` (`application/json`) before parsing JSON, preventing HTML fallback
 * syntax errors (`Unexpected token '<'`).
 *
 * Key Guarantees:
 * - Deterministic GitHub repository extraction works immediately with 0 Gemini calls.
 * - Optional Gemini enhancement uses a strict timeout and never blocks GitHub import.
 * - All suggested skills and projects start as unapproved (`approved: false`), requiring explicit user confirmation.
 * - Unknown events are never automatically classified as hackathons (`eventType: 'unknown'`, `matchable: false`).
 */

import {
  CampusType,
  EventCandidate,
  EventType,
  ProfileEvidenceDraft,
} from '../types/domain';
import {
  DeveloperDiagnosticTelemetry,
  ExtractEventFileResponse,
  ExtractEventUrlResponse,
  ExtractionMethodUsed,
  VerifyUrlResponse,
} from '../types/apiContracts';
import { apiFetch } from '../lib/apiClient';

const ALLOWED_PUBLIC_EVENT_HOSTS = [
  'events.pes.edu',
  'unstop.com',
  'devfolio.co',
  'hack2skill.com',
  'github.com',
];

export interface UrlValidationResult {
  allowed: boolean;
  normalizedUrl?: string;
  host?: string;
  blockedReason?: string;
  requiresManualEntryFallback: boolean;
}

/**
 * Client-side SSRF & URL Policy Pre-Check
 */
export function validateSubmittedEventUrl(rawInput: string): UrlValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      allowed: false,
      blockedReason: 'Please provide an event URL.',
      requiresManualEntryFallback: true,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      allowed: false,
      blockedReason:
        'Invalid URL syntax. Only valid HTTPS public event URLs are accepted.',
      requiresManualEntryFallback: true,
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      allowed: false,
      blockedReason: `Blocked unsafe scheme "${parsed.protocol}". Only HTTPS public URLs are permitted.`,
      requiresManualEntryFallback: true,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      allowed: false,
      blockedReason:
        'URLs containing embedded credentials are rejected by security policy.',
      requiresManualEntryFallback: true,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  const isPrivateOrLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local');

  if (isPrivateOrLoopback) {
    return {
      allowed: false,
      host: hostname,
      blockedReason:
        'SSRF Gate Blocked: Localhost, private RFC1918 networks, and cloud metadata endpoints (169.254.x.x) are strictly denied. Falling back to manual metadata entry.',
      requiresManualEntryFallback: true,
    };
  }

  if (hostname.includes('pesuacademy.com')) {
    return {
      allowed: false,
      host: hostname,
      blockedReason:
        'Policy Gate: pesuacademy.com requires student authentication and cannot be scraped by the server. Please enter public organizer metadata manually.',
      requiresManualEntryFallback: true,
    };
  }

  const isApprovedHost = ALLOWED_PUBLIC_EVENT_HOSTS.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`)
  );

  if (!isApprovedHost) {
    return {
      allowed: true,
      normalizedUrl: parsed.toString(),
      host: hostname,
      blockedReason: `Host "${hostname}" is not on the preset allowlist. Use Live Extraction to fetch public metadata from any safe HTTPS host, or fill event fields manually.`,
      requiresManualEntryFallback: true,
    };
  }

  return {
    allowed: true,
    normalizedUrl: parsed.toString(),
    host: hostname,
    requiresManualEntryFallback: false,
  };
}

/**
 * Deterministic Rule-Based Hackathon-vs-Talk Classifier (Requirement #5)
 *
 * - Never fabricates arbitrary ML confidence numbers.
 * - Never defaults unknown events to 'hackathon'. Unknown or ambiguous events
 *   return `eventType: 'unknown'`, `matchable: false`, `ruleGatePassed: false`,
 *   requiring explicit moderator review before publishing.
 */
export function classifyEventCandidateText(params: {
  title: string;
  description: string;
  minTeamSize: number | null;
  maxTeamSize: number | null;
}): {
  eventType: EventType;
  matchable: boolean;
  ruleGatePassed: boolean;
  mlScore: number;
  reason: string;
} {
  const combined = `${params.title} ${params.description}`.toLowerCase();

  const hasWorkshopOrTalkSignal =
    /\b(workshop|webinar|guest lecture|seminar|tech talk|keynote|speaker session|hands-on session|bootcamp)\b/.test(
      combined
    ) &&
    !/\b(hackathon|buildathon|ideathon|24-hour|36-hour|48-hour|team competition)\b/.test(
      combined
    );

  if (hasWorkshopOrTalkSignal) {
    const isTalk = /\b(talk|lecture|seminar|keynote|webinar)\b/.test(combined);
    return {
      eventType: isTalk ? 'tech_talk' : 'workshop',
      matchable: false,
      ruleGatePassed: false,
      mlScore: 0,
      reason:
        'Rule Gate Excluded: Detected speaker/attendance workshop or tech talk without team prototype competition.',
    };
  }

  if (params.maxTeamSize === 1) {
    return {
      eventType:
        combined.includes('ctf') || combined.includes('capture the flag')
          ? 'ctf'
          : 'other',
      matchable: false,
      ruleGatePassed: false,
      mlScore: 0,
      reason:
        'Rule Gate Excluded from Team Matching: Solo-only competition (maxTeamSize = 1).',
    };
  }

  if (/\b(ctf|capture the flag)\b/.test(combined)) {
    return {
      eventType: 'ctf',
      matchable: true,
      ruleGatePassed: true,
      mlScore: 1,
      reason:
        'Deterministic Rule Gate Passed: Explicit CTF / Capture the Flag team competition indicator.',
    };
  }

  if (/\bideathon\b/.test(combined)) {
    return {
      eventType: 'ideathon',
      matchable: true,
      ruleGatePassed: true,
      mlScore: 1,
      reason:
        'Deterministic Rule Gate Passed: Explicit Team Ideathon indicator.',
    };
  }

  if (/\bbuildathon\b/.test(combined)) {
    return {
      eventType: 'buildathon',
      matchable: true,
      ruleGatePassed: true,
      mlScore: 1,
      reason:
        'Deterministic Rule Gate Passed: Explicit Team Buildathon indicator.',
    };
  }

  const hasExplicitHackathonSignal =
    /\b(hackathon|hack-a-thon|24-hour|36-hour|48-hour|team sprint|code sprint|team competition)\b/.test(
      combined
    );

  if (hasExplicitHackathonSignal) {
    return {
      eventType: 'hackathon',
      matchable: true,
      ruleGatePassed: true,
      mlScore: 1,
      reason:
        'Deterministic Rule Gate Passed: Explicit hackathon / team sprint indicators detected.',
    };
  }

  // Requirement #5: Do NOT automatically classify unknown events as hackathons!
  return {
    eventType: 'unknown',
    matchable: false,
    ruleGatePassed: false,
    mlScore: 0,
    reason:
      'Unconfirmed Event Type: No explicit hackathon, buildathon, ideathon, or CTF keywords detected. Requires moderator confirmation before enabling team matching.',
  };
}

/**
 * Isolated Test/Sandbox Helper: Simulates deterministic public metadata preview for preset test URLs.
 */
export function extractPublicEventPreview(rawUrl: string): {
  isLiveApiResult: false;
  validation: UrlValidationResult;
  draft: Partial<EventCandidate>;
  warnings: string[];
} {
  const validation = validateSubmittedEventUrl(rawUrl);
  if (!validation.allowed || validation.requiresManualEntryFallback) {
    return {
      isLiveApiResult: false,
      validation,
      draft: {
        source: 'submitted_public_url',
        sourceUrl: validation.normalizedUrl ?? rawUrl,
        originalSubmissionUrl: rawUrl,
        verifiedCanonicalUrl: null,
        sourceUrlStatus: 'unverified',
        title: '',
        organizer: '',
        description: '',
        themes: [],
        teamSize: { min: null, max: null },
        format: 'unknown',
      },
      warnings: validation.blockedReason ? [validation.blockedReason] : [],
    };
  }

  const lowerUrl = validation.normalizedUrl!.toLowerCase();

  if (lowerUrl.includes('workshop') || lowerUrl.includes('talk')) {
    const cls = classifyEventCandidateText({
      title: 'Intro to Kubernetes & Cloud Native Workshop',
      description:
        'Hands-on speaker workshop for beginners. Individual attendance.',
      minTeamSize: null,
      maxTeamSize: null,
    });
    return {
      isLiveApiResult: false,
      validation,
      draft: {
        source: 'submitted_public_url',
        sourceUrl: validation.normalizedUrl,
        originalSubmissionUrl: rawUrl,
        verifiedCanonicalUrl: validation.normalizedUrl,
        sourceUrlStatus: 'verified',
        title: 'Intro to Kubernetes & Cloud Native Workshop (Sandbox Preview)',
        organizer: 'Cloud Native Club PESU',
        eventType: cls.eventType,
        matchable: cls.matchable,
        themes: ['Systems/Cloud', 'Developer Tools'],
        description:
          'Hands-on speaker workshop covering pod scheduling. No team competition.',
        startAt: '2026-12-10T14:00:00+05:30',
        endAt: '2026-12-10T17:00:00+05:30',
        registrationDeadline: null,
        timezone: 'Asia/Kolkata',
        venue: { campus: 'RR Campus', name: 'B-Block Room 204' },
        format: 'onsite',
        teamSize: { min: null, max: null },
        fieldEvidence: {
          title: [
            {
              sourceUrl: validation.normalizedUrl!,
              excerpt: 'OG title: Intro to Kubernetes Workshop',
            },
          ],
        },
        classification: {
          ruleGatePassed: cls.ruleGatePassed,
          mlScore: cls.mlScore,
          reason: cls.reason,
        },
      },
      warnings: [
        '[Sandbox Mode] Detected a Workshop/Talk (matchable = false). Excluded from team discovery.',
      ],
    };
  }

  return {
    isLiveApiResult: false,
    validation,
    draft: {
      source: 'submitted_public_url',
      sourceUrl: validation.normalizedUrl,
      originalSubmissionUrl: rawUrl,
      verifiedCanonicalUrl: validation.normalizedUrl,
      sourceUrlStatus: 'verified',
      title: 'PES Open Source & Developer Tools Hackathon 2026 (Sandbox Preview)',
      organizer: 'PES OS Club',
      eventType: 'hackathon',
      matchable: true,
      themes: ['Developer Tools', 'Open-Source Systems', 'Applied AI/ML'],
      description: '24-hour open-source tooling and compiler plugin hackathon.',
      startAt: '2026-12-21T09:00:00+05:30',
      endAt: '2026-12-22T12:00:00+05:30',
      registrationDeadline: '2026-12-18T23:59:00+05:30',
      timezone: 'Asia/Kolkata',
      venue: { campus: 'RR Campus', name: 'GJBC Seminar Hall 2' },
      format: 'onsite',
      teamSize: { min: 2, max: 4 },
      fieldEvidence: {
        teamSize: [
          {
            sourceUrl: validation.normalizedUrl!,
            excerpt: 'Page body rule: "Teams of 2 to 4 students allowed."',
          },
        ],
      },
      classification: {
        ruleGatePassed: true,
        mlScore: 1,
        reason:
          'Verified 24h team hackathon with explicit 2–4 team size bounds.',
      },
    },
    warnings: [
      '[Sandbox Mode] Preview generated from test fixture.',
    ],
  };
}

// In-flight deduplication and short-lived TTL cache to eliminate duplicate network requests
const inFlightRequests = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function withDedupeAndCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  shouldCache: (res: T) => boolean,
  forceRefresh = false
): Promise<T> {
  if (!forceRefresh) {
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.value as T);
    }
  }
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = fetcher()
    .then((res) => {
      if (shouldCache(res)) {
        responseCache.set(key, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          value: res,
        });
      }
      return res;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });
  inFlightRequests.set(key, promise);
  return promise;
}

/**
 * LIVE API MODE: Calls server-side /api/events/verify-url using the shared typed API client.
 */
export async function verifyLiveEventUrl(
  rawUrl: string,
  forceRefresh = false
): Promise<VerifyUrlResponse> {
  const key = `verify_url:${rawUrl.trim()}`;
  return withDedupeAndCache(
    key,
    async () => {
      const start = Date.now();
      const res = await apiFetch<VerifyUrlResponse>('/api/events/verify-url', {
        method: 'POST',
        body: JSON.stringify({ url: rawUrl }),
        timeoutMs: 12000,
      });

      if (res.data && typeof res.data.status === 'string') {
        return res.data;
      }

      return {
        ok: false,
        live: true,
        status: 'broken',
        httpStatus: res.status,
        submittedUrl: rawUrl,
        finalUrl: null,
        canonicalUrl: null,
        verifiedCanonicalUrl: null,
        redirectChain: [],
        userMessage:
          res.errorMessage || 'Network error while verifying event URL.',
        error: res.errorMessage,
        errorCategory: 'NETWORK_ERROR',
        diagnostics: {
          serviceName: 'event_url_extractor',
          httpStatus: res.status,
          errorCategory: 'NETWORK_ERROR',
          retryAttempts: 0,
          durationMs: Date.now() - start,
        },
      };
    },
    (res) => res.ok,
    forceRefresh
  );
}

/**
 * LIVE API MODE: Calls server-side /api/events/extract-url to fetch and parse the real webpage.
 * Uses deterministic HTML/JSON-LD extraction first; only uses Gemini when requested.
 */
export async function extractLiveEventUrlMetadata(
  rawUrl: string,
  forceRefresh = false,
  useGeminiFallback = false
): Promise<{
  ok: boolean;
  isLiveApiResult: true;
  draft?: Partial<EventCandidate>;
  warnings: string[];
  errorMessage?: string;
  redirectChain?: string[];
  extractionMethod?: ExtractionMethodUsed;
  diagnostics?: DeveloperDiagnosticTelemetry;
}> {
  const key = `extract_url:${rawUrl.trim()}:${useGeminiFallback ? 'ai' : 'det'}`;
  return withDedupeAndCache(
    key,
    async () => {
      const apiRes = await apiFetch<ExtractEventUrlResponse>(
        '/api/events/extract-url',
        {
          method: 'POST',
          body: JSON.stringify({ url: rawUrl, useGeminiFallback }),
          timeoutMs: 15000,
        }
      );

      const payload = apiRes.data;
      if (!apiRes.ok || !payload || !payload.ok) {
        return {
          ok: false,
          isLiveApiResult: true,
          warnings: payload?.warnings ?? [],
          errorMessage:
            payload?.userMessage ??
            apiRes.errorMessage ??
            `Could not retrieve event page (HTTP ${apiRes.status}).`,
          redirectChain: payload?.redirectChain,
          extractionMethod: payload?.extractionMethod,
          diagnostics: payload?.diagnostics,
        };
      }

      const d = payload.data;
      const det = payload.deterministic ?? {};
      const ai = payload.aiSupplement ?? {};

      const title = d?.title ?? ai.title ?? det.title ?? '';
      const description = d?.description ?? det.description ?? '';
      const minTeam = d?.minTeamSize ?? ai.minTeamSize ?? det.minTeamSize ?? null;
      const maxTeam = d?.maxTeamSize ?? ai.maxTeamSize ?? det.maxTeamSize ?? null;

      const cls = classifyEventCandidateText({
        title,
        description,
        minTeamSize: minTeam,
        maxTeamSize: maxTeam,
      });

      const warnings: string[] = [...(payload.warnings ?? [])];
      if (minTeam === null || maxTeam === null) {
        warnings.push(
          'Team size (min/max) was not explicitly found on the source page and remains unconfirmed (null).'
        );
      }

      const resolvedCanonical =
        payload.verifiedCanonicalUrl ??
        payload.canonicalUrl ??
        payload.finalUrl ??
        rawUrl;

      const resolvedEventType: EventType =
        d?.eventType && d.eventType !== 'unknown'
          ? (d.eventType as EventType)
          : cls.eventType;

      const resolvedMatchable =
        resolvedEventType === 'hackathon' ||
        resolvedEventType === 'buildathon' ||
        resolvedEventType === 'ideathon' ||
        resolvedEventType === 'ctf'
          ? maxTeam !== 1
          : cls.matchable;

      return {
        ok: true,
        isLiveApiResult: true,
        redirectChain: payload.redirectChain,
        extractionMethod: payload.extractionMethod,
        diagnostics: payload.diagnostics,
        warnings,
        draft: {
          source: 'submitted_public_url',
          sourceUrl: resolvedCanonical,
          originalSubmissionUrl: payload.submittedUrl ?? rawUrl,
          verifiedCanonicalUrl: resolvedCanonical,
          sourceUrlStatus:
            (payload.redirectChain?.length ?? 0) > 1
              ? 'redirected_valid'
              : 'verified',
          title,
          organizer: d?.organizer ?? ai.organizer ?? det.organizer ?? '',
          eventType: resolvedEventType,
          matchable: resolvedMatchable,
          themes:
            Array.isArray(d?.themes) && d.themes.length > 0 ? d.themes : [],
          description,
          startAt: d?.startAt ?? ai.startAt ?? det.startAt ?? null,
          endAt: d?.endAt ?? ai.endAt ?? det.endAt ?? null,
          registrationDeadline:
            d?.registrationDeadline ?? ai.registrationDeadline ?? null,
          timezone: 'Asia/Kolkata',
          venue: {
            campus: (d?.campus as CampusType) ?? null,
            name: d?.venueName ?? null,
          },
          format: d?.format ?? 'unknown',
          teamSize: {
            min: minTeam,
            max: maxTeam,
          },
          registrationUrl: d?.registrationUrl ?? resolvedCanonical ?? null,
          eligibilityNotes: d?.eligibilityNotes ?? null,
          fieldEvidence: {
            source: [
              {
                sourceUrl: resolvedCanonical,
                excerpt:
                  d?.extractedTextEvidence ??
                  det.teamSizeExcerpt ??
                  `Fetched live from ${resolvedCanonical}`,
              },
            ],
          },
          classification: {
            ruleGatePassed: resolvedMatchable,
            mlScore: resolvedMatchable ? 1 : 0,
            reason: cls.reason,
          },
          reviewStatus:
            resolvedMatchable && minTeam !== null && maxTeam !== null
              ? 'new'
              : 'needs_confirmation',
        },
      };
    },
    (res) => res.ok,
    forceRefresh
  );
}

/**
 * LIVE API MODE: Calls server-side /api/events/extract-file for uploaded PDF brochures and PNG/JPG/WebP posters.
 */
export async function extractLiveEventFileMetadata(file: {
  fileName: string;
  mimeType: string;
  base64Data: string;
}): Promise<{
  ok: boolean;
  isLiveApiResult: true;
  fileAccepted: boolean;
  extractionMethod?: ExtractionMethodUsed;
  draft?: Partial<EventCandidate>;
  warnings: string[];
  errorMessage?: string;
  diagnostics?: DeveloperDiagnosticTelemetry;
}> {
  const apiRes = await apiFetch<ExtractEventFileResponse>(
    '/api/events/extract-file',
    {
      method: 'POST',
      body: JSON.stringify(file),
      timeoutMs: 18000,
    }
  );

  const payload = apiRes.data;
  if (!apiRes.ok || !payload || !payload.ok) {
    return {
      ok: false,
      isLiveApiResult: true,
      fileAccepted: Boolean(payload?.fileAccepted ?? true),
      extractionMethod: payload?.extractionMethod,
      warnings: payload?.warnings ?? [],
      errorMessage:
        payload?.userMessage ??
        apiRes.errorMessage ??
        "AI extraction is temporarily unavailable. Your poster was accepted, but its details couldn't be extracted. Retry extraction or enter the information manually.",
      diagnostics: payload?.diagnostics,
    };
  }

  const d = payload.data!;
  const minTeam = typeof d.minTeamSize === 'number' ? d.minTeamSize : null;
  const maxTeam = typeof d.maxTeamSize === 'number' ? d.maxTeamSize : null;

  const cls = classifyEventCandidateText({
    title: d.title || '',
    description: d.description || '',
    minTeamSize: minTeam,
    maxTeamSize: maxTeam,
  });

  const resolvedType: EventType =
    d.eventType && d.eventType !== 'unknown'
      ? (d.eventType as EventType)
      : cls.eventType;

  const resolvedMatchable =
    resolvedType === 'hackathon' ||
    resolvedType === 'buildathon' ||
    resolvedType === 'ideathon' ||
    resolvedType === 'ctf'
      ? maxTeam !== 1
      : cls.matchable;

  return {
    ok: true,
    isLiveApiResult: true,
    fileAccepted: true,
    extractionMethod: payload.extractionMethod,
    warnings: payload.warnings ?? [],
    diagnostics: payload.diagnostics,
    draft: {
      source: 'uploaded_brochure_or_poster',
      originalSubmissionUrl: d.officialSourceUrl ?? null,
      verifiedCanonicalUrl: null,
      sourceUrlStatus: d.officialSourceUrl ? 'unverified' : 'unavailable',
      uploadedAttachment: {
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        byteSize: payload.byteSize,
        extractedEvidenceQuote: d.extractedTextEvidence ?? undefined,
      },
      title: d.title ?? '',
      organizer: d.organizer ?? '',
      eventType: resolvedType,
      matchable: resolvedMatchable,
      themes: Array.isArray(d.themes) ? d.themes : [],
      description: d.description ?? '',
      startAt: d.startAt ?? null,
      endAt: d.endAt ?? null,
      registrationDeadline: d.registrationDeadline ?? null,
      timezone: 'Asia/Kolkata',
      venue: {
        campus: (d.campus as CampusType) ?? null,
        name: d.venueName ?? null,
      },
      format: d.format ?? 'unknown',
      teamSize: {
        min: minTeam,
        max: maxTeam,
      },
      registrationUrl: d.registrationUrl ?? null,
      eligibilityNotes: d.eligibilityNotes ?? null,
      fieldEvidence: {
        uploadedFile: [
          {
            sourceUrl: `attachment://${payload.fileName}`,
            excerpt:
              d.extractedTextEvidence ?? `Extracted from ${payload.fileName}`,
          },
        ],
      },
      classification: {
        ruleGatePassed: resolvedMatchable,
        mlScore: resolvedMatchable ? 1 : 0,
        reason: cls.reason,
      },
      reviewStatus:
        resolvedMatchable && minTeam !== null && maxTeam !== null
          ? 'new'
          : 'needs_confirmation',
    },
  };
}

/**
 * Isolated Test/Sandbox Helper: Simulated GitHub import + draft extraction (All items start unapproved).
 */
export function runBoundedGitHubEnrichmentDraft(params: {
  uid: string;
  githubUsername: string;
  simulateMaliciousReadme?: boolean;
}): ProfileEvidenceDraft {
  const cleanUser =
    params.githubUsername.replace(/[^a-zA-Z0-9-_]/g, '') || 'pes-student';

  if (params.simulateMaliciousReadme) {
    return {
      id: `draft_${Date.now()}`,
      uid: params.uid,
      source: 'github',
      isLiveApiResult: false,
      sourceUrl: `https://github.com/${cleanUser}/adversarial-readme-repo`,
      repoName: `${cleanUser}/adversarial-readme-repo`,
      rawEvidenceSummary:
        '[Sandbox Mode] Simulated repository contains a Python Flask app. Untrusted README included a prompt injection block which was stripped.',
      suggestedSkills: [
        {
          name: 'Python',
          category: 'backend',
          confidence: 'high',
          reason: 'Observable requirements.txt and app.py modules',
          approved: false,
        },
        {
          name: 'Flask',
          category: 'backend',
          confidence: 'medium',
          reason: 'Route handlers in app.py',
          approved: false,
        },
      ],
      suggestedProject: {
        title: 'Flask Micro-Webhook Relay',
        description:
          'Small Python Flask service relaying webhook payloads with HMAC signature verification.',
        sourceUrl: `https://github.com/${cleanUser}/adversarial-readme-repo`,
        tags: ['Python', 'Developer Tools'],
        approved: false,
      },
      sanitizedWarnings: [
        '[Sandbox Mode] Ignored adversarial instruction inside README.md attempting to inject unverified skills.',
      ],
      fetchedAt: new Date().toISOString(),
      userReviewed: false,
    };
  }

  return {
    id: `draft_${Date.now()}`,
    uid: params.uid,
    source: 'github',
    isLiveApiResult: false,
    sourceUrl: `https://github.com/${cleanUser}`,
    repoName: `${cleanUser} (Sandbox Simulation)`,
    rawEvidenceSummary:
      '[Sandbox Mode] Simulated public repository metadata.',
    suggestedSkills: [
      {
        name: 'TypeScript',
        category: 'frontend',
        confidence: 'high',
        reason: 'Typed React components in /src',
        approved: false,
      },
      {
        name: 'FastAPI',
        category: 'backend',
        confidence: 'high',
        reason: 'Async REST router in /server',
        approved: false,
      },
    ],
    suggestedProject: {
      title: 'Campus Grid Monitor',
      description:
        'Real-time solar inverter and classroom load dashboard built with React and FastAPI.',
      sourceUrl: `https://github.com/${cleanUser}`,
      tags: ['TypeScript', 'FastAPI', 'Climate/Civic Tech'],
      approved: false,
    },
    sanitizedWarnings: [],
    fetchedAt: new Date().toISOString(),
    userReviewed: false,
  };
}

interface GitHubFetchResponsePayload {
  ok: boolean;
  live: boolean;
  userMessage?: string;
  message?: string;
  rateLimit?: { remaining?: string | null; limit?: string | null };
  profile?: {
    login: string;
    name: string;
    bio: string;
    publicReposCount: number;
    htmlUrl: string;
  };
  repositories?: Array<{
    name: string;
    url: string;
    description: string;
    language: string | null;
    topics: string[];
    stars: number;
    updatedAt: string;
    readmeExcerpt?: string;
  }>;
  diagnostics?: DeveloperDiagnosticTelemetry;
}

/**
 * Builds a deterministic ProfileEvidenceDraft directly from GitHub REST API repository metadata
 * with ZERO Gemini calls. Every suggested skill and project starts with `approved: false`.
 */
export function buildDeterministicGitHubDraft(params: {
  uid: string;
  githubUsername: string;
  ghJson: GitHubFetchResponsePayload;
}): ProfileEvidenceDraft {
  const repos = params.ghJson.repositories ?? [];
  const skillMap = new Map<
    string,
    {
      name: string;
      category: string;
      confidence: 'high' | 'medium' | 'low';
      reason: string;
      approved: boolean;
    }
  >();

  for (const repo of repos) {
    if (repo.language) {
      const key = repo.language.toLowerCase();
      if (!skillMap.has(key)) {
        skillMap.set(key, {
          name: repo.language,
          category: 'language',
          confidence: 'high',
          reason: `Primary language of ${repo.name}`,
          approved: false,
        });
      }
    }
    for (const topic of repo.topics ?? []) {
      const cleanTopic = topic.trim();
      if (!cleanTopic) continue;
      const key = cleanTopic.toLowerCase();
      if (!skillMap.has(key) && skillMap.size < 12) {
        skillMap.set(key, {
          name: cleanTopic,
          category: 'topic',
          confidence: 'medium',
          reason: `Repository topic on ${repo.name}`,
          approved: false,
        });
      }
    }
  }

  const suggestedProjects = repos.map((repo) => {
    const tags = [
      ...(repo.language ? [repo.language] : []),
      ...(repo.topics ?? []).slice(0, 3),
    ];
    return {
      title: repo.name,
      description:
        repo.description?.trim() ||
        (repo.readmeExcerpt
          ? repo.readmeExcerpt.split('\n')[0].slice(0, 140)
          : `Public repository by @${
              params.ghJson.profile?.login ?? params.githubUsername
            }`),
      sourceUrl: repo.url,
      tags,
      approved: false, // Strictly unapproved until user explicitly checks it
    };
  });

  const primaryProject = suggestedProjects[0] ?? {
    title: `${params.githubUsername} Public Profile`,
    description:
      params.ghJson.profile?.bio ||
      `GitHub profile for @${params.githubUsername}`,
    sourceUrl:
      params.ghJson.profile?.htmlUrl ??
      `https://github.com/${params.githubUsername}`,
    tags: Array.from(skillMap.values())
      .slice(0, 3)
      .map((s) => s.name),
    approved: false,
  };

  return {
    id: `gh_det_${Date.now()}`,
    uid: params.uid,
    source: 'github',
    isLiveApiResult: true,
    sourceUrl:
      params.ghJson.profile?.htmlUrl ??
      `https://github.com/${params.githubUsername}`,
    repoName: `${params.ghJson.profile?.login ?? params.githubUsername} (${
      repos.length
    } public repos fetched)`,
    rawEvidenceSummary: `Fetched ${repos.length} public repositories from GitHub REST API (${
      params.ghJson.profile?.publicReposCount ?? repos.length
    } total public repos). Review and check the skills or projects you want to add.`,
    suggestedSkills: Array.from(skillMap.values()),
    suggestedProjects,
    suggestedProject: primaryProject,
    sanitizedWarnings: [],
    fetchedAt: new Date().toISOString(),
    userReviewed: false,
  };
}

/**
 * Fast, zero-Gemini GitHub repository import (Requirement #7).
 * Fetches real public repositories from `/api/github/fetch` and extracts languages,
 * topics, and repository descriptions deterministically with all items starting `approved: false`.
 */
export async function fetchLiveGitHubRepositoriesDeterministically(params: {
  uid: string;
  githubUsername: string;
  forceRefresh?: boolean;
}): Promise<{
  ok: boolean;
  isLiveApiResult: true;
  draft?: ProfileEvidenceDraft;
  rawGitHubPayload?: GitHubFetchResponsePayload;
  errorMessage?: string;
  githubRateLimit?: { remaining?: string | null; limit?: string | null };
  diagnostics?: DeveloperDiagnosticTelemetry;
}> {
  const key = `gh_det_fetch:${params.githubUsername.trim().toLowerCase()}`;
  return withDedupeAndCache(
    key,
    async () => {
      const ghRes = await apiFetch<GitHubFetchResponsePayload>(
        '/api/github/fetch',
        {
          method: 'POST',
          body: JSON.stringify({ username: params.githubUsername }),
          timeoutMs: 10000,
        }
      );

      const ghJson = ghRes.data;
      if (!ghRes.ok || !ghJson || !ghJson.ok) {
        return {
          ok: false,
          isLiveApiResult: true,
          errorMessage:
            ghJson?.userMessage ??
            ghJson?.message ??
            ghRes.errorMessage ??
            `GitHub fetch failed (HTTP ${ghRes.status})`,
          githubRateLimit: ghJson?.rateLimit,
          diagnostics: ghJson?.diagnostics,
        };
      }

      const draft = buildDeterministicGitHubDraft({
        uid: params.uid,
        githubUsername: params.githubUsername,
        ghJson,
      });

      return {
        ok: true,
        isLiveApiResult: true,
        draft,
        rawGitHubPayload: ghJson,
        githubRateLimit: ghJson.rateLimit,
        diagnostics: ghJson.diagnostics,
      };
    },
    (res) => res.ok,
    Boolean(params.forceRefresh)
  );
}

/**
 * Optional Gemini AI enhancement on top of already-fetched GitHub repository data (Requirement #7).
 * Uses a strict 12s timeout and keeps all suggested skills and projects unapproved (`approved: false`).
 */
export async function runLiveGitHubAndGeminiEnrichment(params: {
  uid: string;
  githubUsername: string;
  forceRefresh?: boolean;
  useGemini?: boolean;
}): Promise<{
  ok: boolean;
  isLiveApiResult: true;
  draft?: ProfileEvidenceDraft;
  errorMessage?: string;
  githubRateLimit?: { remaining?: string | null; limit?: string | null };
  diagnostics?: DeveloperDiagnosticTelemetry;
}> {
  const detResult = await fetchLiveGitHubRepositoriesDeterministically({
    uid: params.uid,
    githubUsername: params.githubUsername,
    forceRefresh: params.forceRefresh,
  });

  if (!detResult.ok || !detResult.draft || !detResult.rawGitHubPayload) {
    return detResult;
  }

  // If Gemini enhancement was not explicitly requested, return the fast deterministic draft immediately
  if (params.useGemini === false) {
    return detResult;
  }

  const geminiRes = await apiFetch<{
    ok: boolean;
    model?: string;
    userMessage?: string;
    message?: string;
    data?: {
      suggestedSkills?: Array<{
        name: string;
        category: string;
        confidence: string;
        reason: string;
      }>;
      projectSummaries?: Array<{
        title: string;
        description: string;
        sourceUrl?: string;
        tags?: string[];
      }>;
      warnings?: string[];
    };
    diagnostics?: DeveloperDiagnosticTelemetry;
  }>('/api/gemini/extract-profile', {
    method: 'POST',
    body: JSON.stringify({ githubData: detResult.rawGitHubPayload }),
    timeoutMs: 12000,
  });

  const geminiJson = geminiRes.data;
  if (!geminiRes.ok || !geminiJson || !geminiJson.ok) {
    // Still return the real deterministic GitHub draft so the user's repos are immediately usable!
    return {
      ok: true,
      isLiveApiResult: true,
      draft: {
        ...detResult.draft,
        sanitizedWarnings: [
          geminiJson?.userMessage ??
            geminiRes.errorMessage ??
            'AI summary enhancement timed out or was unavailable; showing direct GitHub repository metadata.',
        ],
      },
      githubRateLimit: detResult.githubRateLimit,
      diagnostics: geminiJson?.diagnostics ?? detResult.diagnostics,
    };
  }

  const extracted = geminiJson.data ?? {};
  const aiSkills = Array.isArray(extracted.suggestedSkills)
    ? extracted.suggestedSkills.map((s) => ({
        name: s.name,
        category: s.category || 'general',
        confidence:
          s.confidence === 'high' || s.confidence === 'medium'
            ? (s.confidence as 'high' | 'medium')
            : ('low' as const),
        reason: s.reason || 'Extracted from public repository evidence',
        approved: false, // Strictly unapproved by default (Requirement #7)
      }))
    : [];

  // Merge deterministic languages + AI skills without duplicates
  const mergedSkillMap = new Map<string, (typeof aiSkills)[number]>();
  for (const s of detResult.draft.suggestedSkills) {
    mergedSkillMap.set(s.name.toLowerCase(), { ...s, approved: false });
  }
  for (const s of aiSkills) {
    mergedSkillMap.set(s.name.toLowerCase(), { ...s, approved: false });
  }

  const aiProjects = Array.isArray(extracted.projectSummaries)
    ? extracted.projectSummaries.map((p) => ({
        title: p.title,
        description: p.description,
        sourceUrl:
          p.sourceUrl ||
          detResult.rawGitHubPayload?.profile?.htmlUrl ||
          `https://github.com/${params.githubUsername}`,
        tags: Array.isArray(p.tags) ? p.tags : [],
        approved: false, // Strictly unapproved by default (Requirement #7)
      }))
    : detResult.draft.suggestedProjects ?? [];

  const primaryProject =
    aiProjects[0] ?? {
      ...detResult.draft.suggestedProject,
      approved: false,
    };

  return {
    ok: true,
    isLiveApiResult: true,
    githubRateLimit: detResult.githubRateLimit,
    diagnostics: geminiJson.diagnostics,
    draft: {
      ...detResult.draft,
      rawEvidenceSummary: `Fetched ${
        detResult.rawGitHubPayload.repositories?.length ?? 0
      } public repositories from GitHub and enhanced summaries with Gemini (${
        geminiJson.model ?? 'configured model'
      }). All suggestions start unchecked—select the ones you want to include.`,
      suggestedSkills: Array.from(mergedSkillMap.values()),
      suggestedProjects: aiProjects,
      suggestedProject: primaryProject,
      sanitizedWarnings: Array.isArray(extracted.warnings)
        ? extracted.warnings
        : [],
    },
  };
}
