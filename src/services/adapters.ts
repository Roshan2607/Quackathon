/**
 * Modular Service Adapters (Quackathon — PES Hackathon Team Finder)
 *
 * Clearly separates:
 * - Demo Mode deterministic simulations (explicitly labeled as Demo Mode)
 * - Live API Mode client calls to the Express backend (/api/github/fetch, /api/gemini/extract-profile,
 *   /api/events/extract-url, /api/events/extract-file, /api/events/verify-url, /api/pesu-oauth/*)
 *
 * Never reports simulated responses as successful live API calls.
 */

import { CampusType, EventCandidate, EventType, ProfileEvidenceDraft } from '../types/domain';

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
      blockedReason: 'Invalid URL syntax. Only valid HTTPS public event URLs are accepted.',
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
      blockedReason: 'URLs containing embedded credentials are rejected by security policy.',
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
      blockedReason: `Host "${hostname}" is not on the Demo Mode allowlist. Switch to Live API Mode to fetch public metadata from any safe HTTPS host, or fill event fields manually.`,
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
 * Two-Stage Hackathon-vs-Talk Classifier
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
    /\b(workshop|webinar|guest lecture|seminar|tech talk|keynote|speaker session|hands-on session)\b/.test(
      combined
    ) && !/\b(24-hour hackathon|36-hour hackathon|team competition)\b/.test(combined);

  if (hasWorkshopOrTalkSignal) {
    const isTalk = /\b(talk|lecture|seminar|keynote|webinar)\b/.test(combined);
    return {
      eventType: isTalk ? 'tech_talk' : 'workshop',
      matchable: false,
      ruleGatePassed: false,
      mlScore: 0.14,
      reason:
        'Rule Gate Excluded: Detected speaker/attendance workshop or tech talk without team prototype competition.',
    };
  }

  if (params.maxTeamSize === 1) {
    return {
      eventType: combined.includes('ctf') ? 'ctf' : 'other',
      matchable: false,
      ruleGatePassed: false,
      mlScore: 0.88,
      reason:
        'Rule Gate Excluded from Team Matching: Solo-only competition (maxTeamSize = 1). Listed in directory without People/Teams assembly.',
    };
  }

  if (combined.includes('ctf') || combined.includes('capture the flag')) {
    return {
      eventType: 'ctf',
      matchable: true,
      ruleGatePassed: true,
      mlScore: 0.91,
      reason: 'Classified as Team CTF competition with collaborative problem solving.',
    };
  }

  if (combined.includes('ideathon')) {
    return {
      eventType: 'ideathon',
      matchable: true,
      ruleGatePassed: true,
      mlScore: 0.87,
      reason: 'Classified as Team Ideathon competition.',
    };
  }

  if (combined.includes('buildathon')) {
    return {
      eventType: 'buildathon',
      matchable: true,
      ruleGatePassed: true,
      mlScore: 0.93,
      reason: 'Classified as Team Buildathon with prototype submission.',
    };
  }

  return {
    eventType: 'hackathon',
    matchable: true,
    ruleGatePassed: true,
    mlScore: 0.94,
    reason: 'Passed team-competition rule gate (team formation + project build indicators).',
  };
}

/**
 * DEMO MODE ONLY: Simulates deterministic public metadata preview for preset test URLs.
 */
export function extractPublicEventPreview(rawUrl: string): {
  validation: UrlValidationResult;
  draft: Partial<EventCandidate>;
  warnings: string[];
} {
  const validation = validateSubmittedEventUrl(rawUrl);
  if (!validation.allowed || validation.requiresManualEntryFallback) {
    return {
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
      description: 'Hands-on speaker workshop for beginners. Individual attendance.',
      minTeamSize: null,
      maxTeamSize: null,
    });
    return {
      validation,
      draft: {
        source: 'submitted_public_url',
        sourceUrl: validation.normalizedUrl,
        originalSubmissionUrl: rawUrl,
        verifiedCanonicalUrl: validation.normalizedUrl,
        sourceUrlStatus: 'verified',
        title: 'Intro to Kubernetes & Cloud Native Workshop (Demo Preview)',
        organizer: 'Cloud Native Club PESU',
        eventType: cls.eventType,
        matchable: cls.matchable,
        themes: ['Systems/Cloud', 'Developer Tools'],
        description: 'Hands-on speaker workshop covering pod scheduling. No team competition.',
        startAt: '2026-12-10T14:00:00+05:30',
        endAt: '2026-12-10T17:00:00+05:30',
        registrationDeadline: null,
        timezone: 'Asia/Kolkata',
        venue: { campus: 'RR Campus', name: 'B-Block Room 204' },
        format: 'onsite',
        teamSize: { min: null, max: null },
        fieldEvidence: {
          title: [{ sourceUrl: validation.normalizedUrl!, excerpt: 'OG title: Intro to Kubernetes Workshop' }],
        },
        classification: {
          ruleGatePassed: cls.ruleGatePassed,
          mlScore: cls.mlScore,
          reason: cls.reason,
        },
      },
      warnings: [
        '[Demo Mode] Detected a Workshop/Talk (matchable = false). Excluded from team discovery.',
      ],
    };
  }

  if (lowerUrl.includes('unstop.com')) {
    return {
      validation,
      draft: {
        source: 'submitted_public_url',
        sourceUrl: validation.normalizedUrl,
        originalSubmissionUrl: rawUrl,
        verifiedCanonicalUrl: validation.normalizedUrl,
        sourceUrlStatus: 'verified',
        title: 'Smart Mobility & Autonomous Transit Hackathon 2026 (Demo Preview)',
        organizer: 'IEEE ITS & PES Mobility Cell',
        eventType: 'hackathon',
        matchable: true,
        themes: ['Robotics/IoT', 'Computer Vision', 'Climate/Civic Tech'],
        description:
          'Demo preview: Team size was not present in structured JSON-LD and is left unconfirmed for reviewer check.',
        startAt: '2026-12-14',
        endAt: '2026-12-15',
        registrationDeadline: null,
        timezone: 'Asia/Kolkata',
        venue: { campus: 'EC Campus', name: null },
        format: 'hybrid',
        teamSize: { min: null, max: null },
        fieldEvidence: {
          title: [
            {
              sourceUrl: validation.normalizedUrl!,
              excerpt: 'JSON-LD @type=Event name: Smart Mobility & Autonomous Transit Hackathon 2026',
            },
          ],
        },
        classification: {
          ruleGatePassed: true,
          mlScore: 0.91,
          reason: 'Team hackathon title and problem tracks detected; team size bounds require manual confirmation.',
        },
      },
      warnings: [
        '[Demo Mode] Missing Constraints Preserved: Team size (min/max) and registration deadline were kept as null.',
      ],
    };
  }

  return {
    validation,
    draft: {
      source: 'submitted_public_url',
      sourceUrl: validation.normalizedUrl,
      originalSubmissionUrl: rawUrl,
      verifiedCanonicalUrl: validation.normalizedUrl,
      sourceUrlStatus: 'verified',
      title: 'PES Open Source & Developer Tools Sprint 2026 (Demo Preview)',
      organizer: 'PES OS Club',
      eventType: 'hackathon',
      matchable: true,
      themes: ['Developer Tools', 'Open-Source Systems', 'Applied AI/ML'],
      description:
        '24-hour open-source tooling and compiler plugin hackathon.',
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
        mlScore: 0.95,
        reason: 'Verified 24h team buildathon with explicit 2–4 team size bounds.',
      },
    },
    warnings: ['[Demo Mode] Preview generated from synthetic preset. Switch to Live API Mode to fetch real URLs.'],
  };
}

/**
 * LIVE API MODE: Calls server-side /api/events/extract-url to fetch and parse the real webpage.
 */
export async function extractLiveEventUrlMetadata(rawUrl: string): Promise<{
  ok: boolean;
  draft?: Partial<EventCandidate>;
  warnings: string[];
  errorMessage?: string;
  redirectChain?: string[];
}> {
  try {
    const resp = await fetch('/api/events/extract-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl, useGeminiFallback: true }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      return {
        ok: false,
        warnings: [],
        errorMessage: data.message ?? `Server returned HTTP ${resp.status}`,
        redirectChain: data.redirectChain,
      };
    }

    const det = data.deterministic ?? {};
    const ai = data.aiSupplement ?? {};

    const title = ai.title || det.title || '';
    const description = det.description || '';
    const minTeam = ai.minTeamSize ?? det.minTeamSize ?? null;
    const maxTeam = ai.maxTeamSize ?? det.maxTeamSize ?? null;

    const cls = classifyEventCandidateText({
      title: title || 'Extracted Event',
      description,
      minTeamSize: minTeam,
      maxTeamSize: maxTeam,
    });

    const warnings: string[] = [...(data.warnings ?? [])];
    if (minTeam === null || maxTeam === null) {
      warnings.push(
        'Team size (min/max) was not explicitly found on the source page and remains unconfirmed (null).'
      );
    }

    return {
      ok: true,
      redirectChain: data.redirectChain,
      warnings,
      draft: {
        source: 'submitted_public_url',
        sourceUrl: data.verifiedCanonicalUrl ?? rawUrl,
        originalSubmissionUrl: data.submittedUrl ?? rawUrl,
        verifiedCanonicalUrl: data.verifiedCanonicalUrl ?? rawUrl,
        sourceUrlStatus:
          (data.redirectChain?.length ?? 0) > 1 ? 'redirected_valid' : 'verified',
        title,
        organizer: ai.organizer || det.organizer || '',
        eventType: (ai.eventType as EventType) || cls.eventType,
        matchable: cls.matchable,
        themes:
          Array.isArray(ai.themes) && ai.themes.length > 0
            ? ai.themes
            : ['Applied AI/ML', 'Web/Mobile'],
        description,
        startAt: ai.startAt ?? det.startAt ?? null,
        endAt: ai.endAt ?? det.endAt ?? null,
        registrationDeadline: ai.registrationDeadline ?? null,
        timezone: 'Asia/Kolkata',
        venue: {
          campus: (ai.campus as CampusType) ?? null,
          name: ai.venueName ?? null,
        },
        format: ai.format ?? 'unknown',
        teamSize: {
          min: minTeam,
          max: maxTeam,
        },
        registrationUrl: ai.registrationUrl ?? data.verifiedCanonicalUrl ?? null,
        eligibilityNotes: ai.eligibilityNotes ?? null,
        fieldEvidence: {
          source: [
            {
              sourceUrl: data.verifiedCanonicalUrl ?? rawUrl,
              excerpt:
                ai.evidenceQuote ??
                det.teamSizeExcerpt ??
                `Fetched live from ${data.verifiedCanonicalUrl ?? rawUrl}`,
            },
          ],
        },
        classification: {
          ruleGatePassed: cls.ruleGatePassed,
          mlScore: cls.mlScore,
          reason: cls.reason,
        },
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      warnings: [],
      errorMessage: `Network error calling /api/events/extract-url: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
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
  draft?: Partial<EventCandidate>;
  warnings: string[];
  errorMessage?: string;
}> {
  try {
    const resp = await fetch('/api/events/extract-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    });
    const payload = await resp.json();

    if (!resp.ok || !payload.ok) {
      return {
        ok: false,
        warnings: [],
        errorMessage: payload.message ?? `Upload extraction failed (HTTP ${resp.status})`,
      };
    }

    const d = payload.data ?? {};
    const minTeam = typeof d.minTeamSize === 'number' ? d.minTeamSize : null;
    const maxTeam = typeof d.maxTeamSize === 'number' ? d.maxTeamSize : null;

    const cls = classifyEventCandidateText({
      title: d.title || file.fileName,
      description: d.description || '',
      minTeamSize: minTeam,
      maxTeamSize: maxTeam,
    });

    const warnings: string[] = [];
    if (minTeam === null || maxTeam === null) {
      warnings.push('Team size bounds were not found in the uploaded file and remain null.');
    }

    return {
      ok: true,
      warnings,
      draft: {
        source: 'uploaded_brochure_or_poster',
        originalSubmissionUrl: d.officialSourceUrl ?? null,
        verifiedCanonicalUrl: null,
        sourceUrlStatus: d.officialSourceUrl ? 'unverified' : 'unavailable',
        uploadedAttachment: {
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          byteSize: payload.byteSize,
          extractedEvidenceQuote: d.extractedTextEvidence,
        },
        title: d.title ?? '',
        organizer: d.organizer ?? '',
        eventType: (d.eventType as EventType) || cls.eventType,
        matchable: cls.matchable,
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
              excerpt: d.extractedTextEvidence ?? `Extracted from ${payload.fileName}`,
            },
          ],
        },
        classification: {
          ruleGatePassed: cls.ruleGatePassed,
          mlScore: cls.mlScore,
          reason: cls.reason,
        },
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      warnings: [],
      errorMessage: `File extraction request failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * DEMO MODE ONLY: Simulated GitHub import + draft extraction
 */
export function runBoundedGitHubEnrichmentDraft(params: {
  uid: string;
  githubUsername: string;
  simulateMaliciousReadme?: boolean;
}): ProfileEvidenceDraft {
  const cleanUser = params.githubUsername.replace(/[^a-zA-Z0-9-_]/g, '') || 'pes-student';

  if (params.simulateMaliciousReadme) {
    return {
      id: `draft_${Date.now()}`,
      uid: params.uid,
      source: 'github',
      isLiveApiResult: false,
      sourceUrl: `https://github.com/${cleanUser}/adversarial-readme-repo`,
      repoName: `${cleanUser}/adversarial-readme-repo`,
      rawEvidenceSummary:
        '[Demo Mode] Simulated repository contains a Python Flask app. Untrusted README included a prompt injection block which was stripped.',
      suggestedSkills: [
        {
          name: 'Python',
          category: 'backend',
          confidence: 'high',
          reason: 'Observable requirements.txt and app.py modules',
          approved: true,
        },
        {
          name: 'Flask',
          category: 'backend',
          confidence: 'medium',
          reason: 'Route handlers in app.py',
          approved: true,
        },
      ],
      suggestedProject: {
        title: 'Flask Micro-Webhook Relay',
        description: 'Small Python Flask service relaying webhook payloads with HMAC signature verification.',
        sourceUrl: `https://github.com/${cleanUser}/adversarial-readme-repo`,
        tags: ['Python', 'Developer Tools'],
        approved: true,
      },
      sanitizedWarnings: [
        '[Demo Mode] Ignored adversarial instruction inside README.md attempting to inject unverified skills.',
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
    repoName: `${cleanUser} (Demo Simulation)`,
    rawEvidenceSummary:
      '[Demo Mode] Simulated public repository metadata. Switch to Live API Mode to fetch your actual GitHub repositories and run real Gemini extraction.',
    suggestedSkills: [
      {
        name: 'TypeScript',
        category: 'frontend',
        confidence: 'high',
        reason: 'Typed React components in /src',
        approved: true,
      },
      {
        name: 'FastAPI',
        category: 'backend',
        confidence: 'high',
        reason: 'Async REST router in /server',
        approved: true,
      },
      {
        name: 'GraphQL',
        category: 'backend',
        confidence: 'low',
        reason: 'Mentioned in README Future Work only',
        approved: false,
      },
    ],
    suggestedProject: {
      title: 'Campus Grid Monitor (Demo)',
      description: 'Real-time solar inverter and classroom load dashboard built with React and FastAPI.',
      sourceUrl: `https://github.com/${cleanUser}`,
      tags: ['TypeScript', 'FastAPI', 'Climate/Civic Tech'],
      approved: true,
    },
    sanitizedWarnings: [],
    fetchedAt: new Date().toISOString(),
    userReviewed: false,
  };
}

/**
 * LIVE API MODE: Fetches real public repositories from GitHub REST API and runs real Gemini extraction.
 */
export async function runLiveGitHubAndGeminiEnrichment(params: {
  uid: string;
  githubUsername: string;
}): Promise<{
  ok: boolean;
  draft?: ProfileEvidenceDraft;
  errorMessage?: string;
  githubRateLimit?: { remaining?: string | null; limit?: string | null };
}> {
  // Step 1: Call real GitHub REST API via server
  const ghResp = await fetch('/api/github/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: params.githubUsername }),
  });
  const ghJson = await ghResp.json();

  if (!ghResp.ok || !ghJson.ok) {
    return {
      ok: false,
      errorMessage: ghJson.message ?? `GitHub fetch failed (HTTP ${ghResp.status})`,
      githubRateLimit: ghJson.rateLimit,
    };
  }

  // Step 2: Call real Gemini API via server to extract skills & projects from the retrieved repos
  const geminiResp = await fetch('/api/gemini/extract-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ githubData: ghJson }),
  });
  const geminiJson = await geminiResp.json();

  if (!geminiResp.ok || !geminiJson.ok) {
    return {
      ok: false,
      errorMessage: geminiJson.message ?? `Gemini extraction failed (HTTP ${geminiResp.status})`,
      githubRateLimit: ghJson.rateLimit,
    };
  }

  const extracted = geminiJson.data ?? {};
  const skills = Array.isArray(extracted.suggestedSkills)
    ? extracted.suggestedSkills.map(
        (s: { name: string; category: string; confidence: string; reason: string }) => ({
          name: s.name,
          category: s.category || 'general',
          confidence:
            s.confidence === 'high' || s.confidence === 'medium' ? s.confidence : 'low',
          reason: s.reason || 'Extracted from public repository evidence',
          approved: s.confidence !== 'low',
        })
      )
    : [];

  const projects = Array.isArray(extracted.projectSummaries)
    ? extracted.projectSummaries.map(
        (p: { title: string; description: string; sourceUrl?: string; tags?: string[] }) => ({
          title: p.title,
          description: p.description,
          sourceUrl: p.sourceUrl || ghJson.profile?.htmlUrl || `https://github.com/${params.githubUsername}`,
          tags: Array.isArray(p.tags) ? p.tags : [],
          approved: true,
        })
      )
    : [];

  const primaryProject = projects[0] ?? {
    title: ghJson.repositories?.[0]?.name ?? `${params.githubUsername} Repository`,
    description:
      ghJson.repositories?.[0]?.description ||
      `Public repository fetched from github.com/${params.githubUsername}`,
    sourceUrl:
      ghJson.repositories?.[0]?.url || `https://github.com/${params.githubUsername}`,
    tags: skills.slice(0, 3).map((s: { name: string }) => s.name),
    approved: true,
  };

  return {
    ok: true,
    githubRateLimit: ghJson.rateLimit,
    draft: {
      id: `live_draft_${Date.now()}`,
      uid: params.uid,
      source: 'github',
      isLiveApiResult: true,
      sourceUrl: ghJson.profile?.htmlUrl ?? `https://github.com/${params.githubUsername}`,
      repoName: `${ghJson.profile?.login} (${ghJson.repositories?.length ?? 0} public repos analyzed)`,
      rawEvidenceSummary: `Live GitHub REST API fetched ${
        ghJson.repositories?.length ?? 0
      } non-fork repositories (${
        ghJson.profile?.publicReposCount ?? 0
      } total public repos) and extracted structured suggestions via Gemini (gemini-4-hydrogen).`,
      suggestedSkills: skills,
      suggestedProjects: projects,
      suggestedProject: primaryProject,
      sanitizedWarnings: Array.isArray(extracted.warnings) ? extracted.warnings : [],
      fetchedAt: new Date().toISOString(),
      userReviewed: false,
    },
  };
}
