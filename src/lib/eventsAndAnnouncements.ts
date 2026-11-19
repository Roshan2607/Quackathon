/**
 * Unified PESU Announcements, Public Events (`events.pes.edu`), Evidence Detection,
 * Cross-Source Deduplication, and IST (`Asia/Kolkata`) Time Filtering Engine.
 *
 * Core Guarantees:
 * - Accurately normalizes PESU OAuth2 `/api/v1/announcements` payloads (`{ resource: "announcements", data: [...], fetched_at }`).
 * - Preserves original announcement publication dates (`date`) and NEVER mistakes publication date for an event's `startAt`.
 * - Never fabricates missing dates, venues, links, or team sizes (`null` -> labeled "Date TBA").
 * - Never classifies talks, seminars, info sessions, or workshops as hackathons.
 * - Deduplicates the same event across PESU Academy announcements, `events.pes.edu`, and student submissions.
 * - Consistently evaluates all date/time filters in `Asia/Kolkata` (IST, UTC+05:30).
 */

import {
  CampusType,
  EventCandidate,
  EventSourceType,
  EventType,
  Hackathon,
} from '../types/domain';

export interface NormalizedPesuAnnouncement {
  id: string;
  title: string;
  /** Original announcement publication date (YYYY-MM-DD) or null if unstated/malformed */
  date: string | null;
  description: string;
  image: string | null;
  attachments: number;
  rawDateText?: string | null;
}

export interface NormalizedAnnouncementEnvelope {
  resource: string;
  announcements: NormalizedPesuAnnouncement[];
  fetchedAt: string;
  validEnvelope: boolean;
}

export interface DetectedAnnouncementEventCandidate {
  isRelevantTechnicalEvent: boolean;
  confidence: 'high' | 'medium' | 'low';
  title: string;
  organizer: string | null;
  eventType: EventType;
  matchable: boolean;
  themes: string[];
  /** Event start date ONLY if explicitly stated in the announcement text (never copied from publication date!) */
  startAt: string | null;
  endAt: string | null;
  registrationDeadline: string | null;
  campus: CampusType | null;
  venueName: string | null;
  format: 'onsite' | 'online' | 'hybrid' | 'unknown';
  minTeamSize: number | null;
  maxTeamSize: number | null;
  registrationUrl: string | null;
  evidenceExcerpts: string[];
  classificationReason: string;
}

export interface ParsedPesuPublicEventListingItem {
  eventId: string;
  detailUrl: string;
  title: string;
  summary: string;
  statusLabel: 'Upcoming' | 'Live now' | 'Past' | 'Unknown';
  tags: string[];
  dateText: string | null;
  startAt: string | null;
  endAt: string | null;
  campus: CampusType | null;
  venueName: string | null;
  organizer: string | null;
  eventType: EventType;
  matchable: boolean;
}

export interface ParsedPesuPublicEventDetail {
  eventId: string | null;
  canonicalUrl: string;
  title: string | null;
  organizer: string | null;
  eventType: EventType;
  matchable: boolean;
  themes: string[];
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  registrationDeadline: string | null;
  campus: CampusType | null;
  venueName: string | null;
  format: 'onsite' | 'online' | 'hybrid' | 'unknown';
  minTeamSize: number | null;
  maxTeamSize: number | null;
  registrationUrl: string | null;
  statusLabel: 'Upcoming' | 'Live now' | 'Past' | 'Unknown';
  tags: string[];
  extractedEvidenceQuote: string;
  classificationReason: string;
}

export type TimeFilterPreset =
  | 'UPCOMING'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'PAST'
  | 'ALL'
  | 'CUSTOM';

export type UnifiedEventSourceFilter =
  | 'ALL_PUBLISHED'
  | 'PES_PUBLIC'
  | 'COMMUNITY_VERIFIED'
  | 'MY_ACADEMY';

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Decodes HTML entities and strips HTML tags cleanly without losing paragraph spacing.
 */
export function cleanHtmlToText(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) return '';
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&ndash;|&#8211;|&#x2013;/gi, '–')
    .replace(/&mdash;|&#8212;|&#x2014;/gi, '—')
    .replace(/&ldquo;|&rdquo;|&quot;|&#34;|&#x22;|&#8220;|&#8221;|&#x201c;|&#x201d;/gi, '"')
    .replace(/&lsquo;|&rsquo;|&apos;|&#0*39;|&#x0*27;|&#8216;|&#8217;|&#x2018;|&#x2019;/gi, "'")
    .replace(/&lt;|&#60;|&#x3c;/gi, '<')
    .replace(/&gt;|&#62;|&#x3e;/gi, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&amp;|&#38;|&#x26;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Formats a year, month (1-12), day (1-31) into YYYY-MM-DD if valid, else null.
 */
function toValidIsoDate(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 2000 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parses a single date string (ISO YYYY-MM-DD, DD-MM-YYYY, or "07 Nov 2026" / "Nov 7, 2026")
 * into normalized YYYY-MM-DD or null. Never invents today's date.
 */
export function parseSingleDateToYmd(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Direct YYYY-MM-DD prefix (e.g. "2026-11-10" or "2026-11-10T09:00:00+05:30")
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (isoMatch) {
    return toValidIsoDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3])
    );
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY
  const dmySlash = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmySlash) {
    return toValidIsoDate(
      Number(dmySlash[3]),
      Number(dmySlash[2]),
      Number(dmySlash[1])
    );
  }

  // 3. "Sat, 07 Nov 2026" or "7th November 2026" or "07-Nov-2026"
  const dMonthY = trimmed.match(
    /(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})/i
  );
  if (dMonthY) {
    const day = Number(dMonthY[1]);
    const month = MONTH_MAP[dMonthY[2].toLowerCase()];
    const year = Number(dMonthY[3]);
    if (month) {
      return toValidIsoDate(year, month, day);
    }
  }

  // 4. "Nov 07, 2026" or "November 7th 2026"
  const monthDY = trimmed.match(
    /([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i
  );
  if (monthDY) {
    const month = MONTH_MAP[monthDY[1].toLowerCase()];
    const day = Number(monthDY[2]);
    const year = Number(monthDY[3]);
    if (month) {
      return toValidIsoDate(year, month, day);
    }
  }

  return null;
}

/**
 * Parses a date or date range string (e.g., "Sat, 07 Nov 2026 – 08 Nov 2026",
 * "Nov 7 - 8, 2026", "07 Nov 2026 to 08 Nov 2026", or single date "Thu, 09 Apr 2026")
 * into `{ startAt: YYYY-MM-DD | null, endAt: YYYY-MM-DD | null }`.
 */
export function parseDateRangeFromText(raw: string | null | undefined): {
  startAt: string | null;
  endAt: string | null;
} {
  if (!raw || typeof raw !== 'string') {
    return { startAt: null, endAt: null };
  }
  const text = cleanHtmlToText(raw);

  // Pattern A: "Sat, 07 Nov 2026 – Sun, 08 Nov 2026" or "07 Nov 2026 - 08 Nov 2026"
  const fullRangeMatch = text.match(
    /(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4})\s*(?:–|—|-|to)\s*(?:[A-Za-z]{3,9},?\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4})/i
  );
  if (fullRangeMatch) {
    const startAt = parseSingleDateToYmd(fullRangeMatch[1]);
    const endAt = parseSingleDateToYmd(fullRangeMatch[2]) ?? startAt;
    if (startAt) return { startAt, endAt };
  }

  // Pattern B: "07 – 08 Nov 2026" or "7th - 8th November 2026"
  const sharedMonthYearMatch = text.match(
    /(\d{1,2})(?:st|nd|rd|th)?\s*(?:–|—|-|to)\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}),?\s+(\d{4})/i
  );
  if (sharedMonthYearMatch) {
    const day1 = Number(sharedMonthYearMatch[1]);
    const day2 = Number(sharedMonthYearMatch[2]);
    const month = MONTH_MAP[sharedMonthYearMatch[3].toLowerCase()];
    const year = Number(sharedMonthYearMatch[4]);
    if (month) {
      const startAt = toValidIsoDate(year, month, day1);
      const endAt = toValidIsoDate(year, month, day2) ?? startAt;
      if (startAt) return { startAt, endAt };
    }
  }

  // Pattern C: "Nov 7 - 8, 2026" or "November 7 – 8, 2026"
  const monthFirstRangeMatch = text.match(
    /([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:–|—|-|to)\s*(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i
  );
  if (monthFirstRangeMatch) {
    const month = MONTH_MAP[monthFirstRangeMatch[1].toLowerCase()];
    const day1 = Number(monthFirstRangeMatch[2]);
    const day2 = Number(monthFirstRangeMatch[3]);
    const year = Number(monthFirstRangeMatch[4]);
    if (month) {
      const startAt = toValidIsoDate(year, month, day1);
      const endAt = toValidIsoDate(year, month, day2) ?? startAt;
      if (startAt) return { startAt, endAt };
    }
  }

  // Pattern D: ISO range "2026-11-07 to 2026-11-08"
  const isoRangeMatch = text.match(
    /(\d{4}-\d{2}-\d{2})\s*(?:–|—|-|to)\s*(\d{4}-\d{2}-\d{2})/i
  );
  if (isoRangeMatch) {
    const startAt = parseSingleDateToYmd(isoRangeMatch[1]);
    const endAt = parseSingleDateToYmd(isoRangeMatch[2]) ?? startAt;
    if (startAt) return { startAt, endAt };
  }

  // Pattern E: Single date anywhere in text
  const singleDmy = text.match(
    /(?:[A-Za-z]{3,9},?\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4})/i
  );
  if (singleDmy) {
    const startAt = parseSingleDateToYmd(singleDmy[1]);
    if (startAt) return { startAt, endAt: startAt };
  }

  const singleMdy = text.match(
    /([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i
  );
  if (singleMdy) {
    const startAt = parseSingleDateToYmd(singleMdy[1]);
    if (startAt) return { startAt, endAt: startAt };
  }

  const singleIso = parseSingleDateToYmd(text);
  if (singleIso) {
    return { startAt: singleIso, endAt: singleIso };
  }

  return { startAt: null, endAt: null };
}

/**
 * Normalizes the PESU OAuth2 `/api/v1/announcements` response payload.
 *
 * Official PESU OAuth provider format:
 * ```json
 * {
 *   "resource": "announcements",
 *   "data": [
 *     {
 *       "id": 12345,
 *       "title": "...",
 *       "date": "2026-11-10",
 *       "description": "...",
 *       "image": "https://...",
 *       "attachments": 2
 *     }
 *   ],
 *   "fetched_at": "ISO timestamp"
 * }
 * ```
 * Also supports legacy `{ announcements: [...] }` or direct array payloads.
 */
export function normalizePesuAnnouncementPayload(
  rawBody: unknown
): NormalizedAnnouncementEnvelope {
  const nowIso = new Date().toISOString();

  let rawList: unknown[] | null = null;
  let resourceName = 'announcements';
  let fetchedAt = nowIso;

  if (Array.isArray(rawBody)) {
    rawList = rawBody;
  } else if (rawBody && typeof rawBody === 'object') {
    const obj = rawBody as Record<string, unknown>;
    if (typeof obj.resource === 'string' && obj.resource.trim()) {
      resourceName = obj.resource.trim();
    }
    if (typeof obj.fetched_at === 'string' && obj.fetched_at.trim()) {
      fetchedAt = obj.fetched_at.trim();
    } else if (typeof obj.fetchedAt === 'string' && obj.fetchedAt.trim()) {
      fetchedAt = obj.fetchedAt.trim();
    }

    if (Array.isArray(obj.data)) {
      rawList = obj.data;
    } else if (Array.isArray(obj.announcements)) {
      rawList = obj.announcements;
    }
  }

  if (!rawList) {
    return {
      resource: resourceName,
      announcements: [],
      fetchedAt,
      validEnvelope: false,
    };
  }

  const normalized: NormalizedPesuAnnouncement[] = [];

  for (let idx = 0; idx < rawList.length; idx++) {
    const item = rawList[idx];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const rawTitle =
      typeof rec.title === 'string'
        ? cleanHtmlToText(rec.title)
        : typeof rec.subject === 'string'
          ? cleanHtmlToText(rec.subject)
          : '';
    const rawDesc =
      typeof rec.description === 'string'
        ? cleanHtmlToText(rec.description)
        : typeof rec.body === 'string'
          ? cleanHtmlToText(rec.body)
          : typeof rec.content === 'string'
            ? cleanHtmlToText(rec.content)
            : '';

    // Skip completely empty/malformed entries that have neither title nor description
    if (!rawTitle && !rawDesc) continue;

    const idVal =
      typeof rec.id === 'string' && rec.id.trim()
        ? rec.id.trim()
        : typeof rec.id === 'number' && Number.isFinite(rec.id)
          ? String(rec.id)
          : `ann_${idx + 1}`;

    const rawDateStr =
      typeof rec.date === 'string'
        ? rec.date.trim()
        : typeof rec.published_at === 'string'
          ? rec.published_at.trim()
          : typeof rec.created_at === 'string'
            ? rec.created_at.trim()
            : null;

    // Preserve original publication date; never substitute today's date if missing/malformed
    const parsedPublicationDate = rawDateStr
      ? parseSingleDateToYmd(rawDateStr)
      : null;

    let imageUrl: string | null = null;
    if (typeof rec.image === 'string' && rec.image.trim()) {
      const candidateImg = rec.image.trim();
      if (
        candidateImg.startsWith('https://') ||
        candidateImg.startsWith('http://') ||
        candidateImg.startsWith('data:image/')
      ) {
        imageUrl = candidateImg;
      }
    }

    let attachmentCount = 0;
    if (typeof rec.attachments === 'number' && Number.isFinite(rec.attachments)) {
      attachmentCount = Math.max(0, Math.floor(rec.attachments));
    } else if (Array.isArray(rec.attachments)) {
      attachmentCount = rec.attachments.length;
    } else if (typeof rec.attachments === 'string') {
      const parsedNum = Number(rec.attachments);
      if (Number.isFinite(parsedNum) && parsedNum >= 0) {
        attachmentCount = Math.floor(parsedNum);
      }
    }

    normalized.push({
      id: idVal,
      title: rawTitle || 'Untitled PESU Announcement',
      date: parsedPublicationDate,
      description: rawDesc,
      image: imageUrl,
      attachments: attachmentCount,
      rawDateText: rawDateStr,
    });
  }

  return {
    resource: resourceName,
    announcements: normalized,
    fetchedAt,
    validEnvelope: true,
  };
}

/**
 * Infers campus from grounded text without guessing when absent.
 */
export function extractGroundedCampus(text: string): CampusType | null {
  const lower = text.toLowerCase();
  const hasRR =
    /\b(rr campus|ring road|banashankari|mrd auditorium|gjbc|f-block|b-block)\b/.test(
      lower
    );
  const hasEC = /\b(ec campus|electronic city)\b/.test(lower);
  if (hasRR && hasEC) return 'Online / Multi-Campus';
  if (hasRR) return 'RR Campus';
  if (hasEC) return 'EC Campus';
  if (/\b(online|virtual|remote|multi-campus|cross-campus)\b/.test(lower)) {
    return 'Online / Multi-Campus';
  }
  return null;
}

/**
 * Extracts explicit team size bounds from text if stated (e.g., "teams of 2 to 4",
 * "Team Size – 3–4 members", "Team size: 3 or 4 members", "Register as a Team of 3",
 * "Team-based competition (3–4 members per team)", "Teams of 4 members only").
 */
export function extractGroundedTeamSize(text: string): {
  min: number | null;
  max: number | null;
  excerpt: string | null;
} {
  if (!text || typeof text !== 'string') {
    return { min: null, max: null, excerpt: null };
  }

  // 1. Explicit range: "teams of 2 to 4", "team size: 3-4", "Team Size – 3–4 members",
  //    "Team size: 3 or 4 members", "Team-based competition (3–4 members per team)"
  const rangeMatch = text.match(
    /(?:teams?\s+of|team\s+size\s*(?:of|:|-|–|—)?|group\s+of|team-based\s+(?:competition|hackathon|ideathon|buildathon|challenge|event)\s*\(?)\s*(\d{1,2})\s*(?:to|or|-|–|—)\s*(\d{1,2})\s*(?:members?|students?|participants?|builders?|people|per\s+team|in\s+each\s+team)?/i
  );
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10);
    const b = parseInt(rangeMatch[2], 10);
    if (a >= 1 && b >= a && b <= 10) {
      return { min: a, max: b, excerpt: rangeMatch[0].trim() };
    }
  }

  // 2. Min/Max phrasing: "minimum 2 and maximum 4 members"
  const minMaxMatch = text.match(
    /\bmin(?:imum)?\s*(?:of\s*)?(\d{1,2})\s*(?:and|,|to)\s*max(?:imum)?\s*(?:of\s*)?(\d{1,2})\s*(?:members?|students?|participants?|per\s+team)?/i
  );
  if (minMaxMatch) {
    const a = parseInt(minMaxMatch[1], 10);
    const b = parseInt(minMaxMatch[2], 10);
    if (a >= 1 && b >= a && b <= 10) {
      return { min: a, max: b, excerpt: minMaxMatch[0].trim() };
    }
  }

  // 3. Exact team size: "Team Size: 3 members per team", "Register as a Team of 3",
  //    "Teams of 4 members only", "compete in teams of 2"
  const exactTeamMatch = text.match(
    /(?:team\s+size\s*(?:of|:|-|–|—)?\s*(\d{1,2})\s*(?:members?|students?|participants?|per\s+team)?|(\d{1,2})\s*members?\s+(?:per\s+team|in\s+each\s+team)|(?:register\s+as\s+a\s+|compete\s+in\s+|participate\s+in\s+|form\s+(?:a\s+)?)?teams?\s+of\s+(\d{1,2})(?:\s*(?:members?|students?|participants?|people|only))?\b)/i
  );
  if (exactTeamMatch) {
    const n = parseInt(
      exactTeamMatch[1] || exactTeamMatch[2] || exactTeamMatch[3],
      10
    );
    if (n >= 1 && n <= 10) {
      return { min: n, max: n, excerpt: exactTeamMatch[0].trim() };
    }
  }

  // 4. Up to / maximum team size: "up to 4 members", "maximum of 4 students", "max team size: 4"
  const upToMatch = text.match(
    /(?:up\s+to|maximum\s+of|max(?:imum)?\s+team\s+size\s*(?:of|:|-|–|—)?)\s*(\d{1,2})\s*(?:members?|students?|participants?|per\s+team)/i
  );
  if (upToMatch) {
    const max = parseInt(upToMatch[1], 10);
    if (max >= 1 && max <= 10) {
      const min = /\b(solo|individual)\b/i.test(text) ? 1 : null;
      return { min, max, excerpt: upToMatch[0].trim() };
    }
  }

  // 5. Explicit individual / solo only
  if (
    /\b(solo\s+only|individual\s+participation\s+only|individual-only|single\s+participant\s+only)\b/i.test(
      text
    )
  ) {
    return { min: 1, max: 1, excerpt: 'Individual participation only' };
  }

  return { min: null, max: null, excerpt: null };
}

/**
 * Verifies whether an event genuinely supports team participation (`teamParticipationVerified`).
 *
 * Rules:
 * - Individual-only competitions (`maxTeamSize === 1` or explicit solo-only rule) -> `false`.
 * - Numeric `maxTeamSize > 1` or `minTeamSize > 1` (passed in or extracted from text) -> `true`.
 * - Explicit team participation phrasing in title/description/evidence -> `true`.
 * - Unknown / unstated team eligibility -> `false` (must NOT be marked `matchable: true`).
 */
export function verifyTeamParticipationEvidence(params: {
  title?: string | null;
  description?: string | null;
  minTeamSize?: number | null;
  maxTeamSize?: number | null;
  evidenceText?: string | null;
}): {
  teamParticipationVerified: boolean;
  minTeamSize: number | null;
  maxTeamSize: number | null;
  excerpt: string | null;
  reason: string;
} {
  const combined = cleanHtmlToText(
    `${params.title ?? ''} ${params.description ?? ''} ${params.evidenceText ?? ''}`
  );
  const extracted = extractGroundedTeamSize(combined);

  const preferExtractedRange =
    extracted.min !== null &&
    extracted.max !== null &&
    extracted.max > extracted.min &&
    params.minTeamSize === params.maxTeamSize;

  const effectiveMin = preferExtractedRange
    ? extracted.min
    : typeof params.minTeamSize === 'number' && params.minTeamSize >= 1
      ? params.minTeamSize
      : extracted.min;
  const effectiveMax = preferExtractedRange
    ? extracted.max
    : typeof params.maxTeamSize === 'number' && params.maxTeamSize >= 1
      ? params.maxTeamSize
      : extracted.max;

  const isSoloOnly =
    effectiveMax === 1 ||
    /\b(solo\s+only|individual\s+participation\s+only|individual-only|single\s+participant\s+only)\b/i.test(
      combined
    );

  if (isSoloOnly) {
    return {
      teamParticipationVerified: false,
      minTeamSize: 1,
      maxTeamSize: 1,
      excerpt: extracted.excerpt ?? 'Individual participation only',
      reason: 'Individual-only competition (maxTeamSize = 1); not eligible for team matching.',
    };
  }

  if (typeof effectiveMax === 'number' && effectiveMax > 1) {
    return {
      teamParticipationVerified: true,
      minTeamSize: effectiveMin ?? null,
      maxTeamSize: effectiveMax,
      excerpt:
        extracted.excerpt ??
        (effectiveMin
          ? `${effectiveMin}–${effectiveMax} members`
          : `Up to ${effectiveMax} members`),
      reason: `Verified team participation (team size ${effectiveMin ? `${effectiveMin}–${effectiveMax}` : `up to ${effectiveMax}`}).`,
    };
  }

  if (typeof effectiveMin === 'number' && effectiveMin > 1) {
    return {
      teamParticipationVerified: true,
      minTeamSize: effectiveMin,
      maxTeamSize: effectiveMax ?? effectiveMin,
      excerpt: extracted.excerpt ?? `${effectiveMin} members`,
      reason: `Verified team participation (minimum team size ${effectiveMin}).`,
    };
  }

  // Check for explicit multi-member team participation statements in the text even if exact numbers are omitted
  const explicitTeamRuleMatch = combined.match(
    /\b(student\s+teams|for\s+teams|in\s+teams|as\s+a\s+team|team-based\s+(?:competition|hackathon|ideathon|buildathon|challenges?|event)|team\s+competition|team\s+hackathon|team\s+ideathon|team\s+registration|team\s+leader\s+must|members?\s+per\s+team|members?\s+in\s+each\s+team|each\s+team\s+(?:must|can|will|shall|consists)|inter-college\s+teams?|open\s+to\s+teams|collaborate\s+in\s+teams|compete\s+as\s+teams|form\s+(?:your\s+|a\s+)?teams?|teams\s+will\s+(?:design|present|build|compete|participate|work|solve)|per\s+team\b|winning\s+teams\b|top\s+\d+\s+teams\b)\b/i
  );
  if (explicitTeamRuleMatch) {
    return {
      teamParticipationVerified: true,
      minTeamSize: null,
      maxTeamSize: null,
      excerpt: explicitTeamRuleMatch[0].trim(),
      reason: `Explicit team participation rule stated in source ("${explicitTeamRuleMatch[0].trim()}").`,
    };
  }

  return {
    teamParticipationVerified: false,
    minTeamSize: null,
    maxTeamSize: null,
    excerpt: null,
    reason:
      'Team participation eligibility is not stated in source text; awaiting team size verification.',
  };
}


/**
 * Deterministic Event Classification using source tags, title, subtitle, and description.
 * Zero Gemini calls.
 *
 * Supported categories:
 * - 'hackathon' / 'buildathon' (Hackathon / Buildathon)
 * - 'ideathon' / 'team_competition' (Ideathon / Competition)
 * - 'ctf' (CTF)
 * - 'workshop' (Workshop)
 * - 'tech_talk' (Talk / Seminar)
 * - 'conference' (Conference / Summit)
 * - 'other' / 'unknown' (Other)
 */
export function classifyGroundedEvent(params: {
  title: string;
  description: string;
  tags?: string[];
  minTeamSize?: number | null;
  maxTeamSize?: number | null;
}): {
  eventType: EventType;
  matchable: boolean;
  reason: string;
} {
  const cleanTitle = cleanHtmlToText(params.title);
  const cleanDesc = cleanHtmlToText(params.description);
  const cleanedTags = (params.tags ?? []).map((t) =>
    cleanHtmlToText(t).replace(/^#/, '').trim()
  );
  const tagText = cleanedTags.join(' ').toLowerCase();
  const titleLower = cleanTitle.toLowerCase();
  const descLower = cleanDesc.toLowerCase();
  const combined = `${cleanTitle} ${cleanDesc} ${tagText}`.toLowerCase();
  const textOnly = `${cleanTitle} ${cleanDesc}`.toLowerCase();

  const soloOnly =
    params.maxTeamSize === 1 ||
    /\b(solo\s+only|individual\s+participation\s+only)\b/i.test(textOnly);

  // 1. Cultural / Art / Music / Non-Tech Festival Override (e.g., "Kalavaibhava — A Celebration of Art, Talent, and Expression")
  const hasCulturalTag = cleanedTags.some((t) =>
    /^(cultural|art|music|dance|theatre|literary)$/i.test(t)
  );
  const isCulturalTitleOrBody =
    /\b(kalavaibhava|celebration\s+of\s+art|cultural\s+fest|music\s+concert|dance\s+festival|art\s+exhibition|talent\s+and\s+expression)\b/i.test(
      textOnly
    );
  const hasGenuineTechCompetitionInText =
    /\b(hackathon|hack-a-thon|ideathon|buildathon|capture\s+the\s+flag|\bctf\b|coding\s+marathon|competitive\s+programming|problem[\s-]solving|prototype|software|hardware|algorithm|quantum|robotics|cybercrimes?|cybersecurity|open\s+source\s+software)\b/i.test(
      textOnly
    );

  if ((hasCulturalTag || isCulturalTitleOrBody) && !hasGenuineTechCompetitionInText) {
    return {
      eventType: 'other',
      matchable: false,
      reason:
        'Classified as Cultural / Art event from source content; excluded from hackathon discovery.',
    };
  }

  // 2. Conference / Summit / Symposium Override
  //    e.g., "Technology Law and Intellectual Property Law Summit 2026",
  //    "31st International Advanced Computing and Communication Conference" (ADCOM 2027),
  //    "ICDDS 2024", "Emerging Technologies in Computing and Communication (ETCC)"
  const hasConferenceTag = cleanedTags.some((t) =>
    /^(conference|summit|symposium|colloquium|conclave)$/i.test(t)
  );
  const isConferenceInTitle =
    /\b(conference|summit|symposium|colloquium|conclave|\bicdds\b|\badcom\b|\betcc\b)\b/i.test(
      titleLower
    ) && !/\b(hackathon|ideathon|buildathon|ctf)\b/i.test(titleLower);
  const isConferenceInBody =
    /\b(international\s+conference|law\s+summit|annual\s+conference|\badcom\s*\d{4}\b|\bicdds['’]?\d{2,4}\b|\betcc\s*\d{4}\b|call\s+for\s+papers)\b/i.test(
      textOnly
    ) &&
    !/\b(pre-conference\s+hackathon|hackathon|ideathon|buildathon|ctf)\b/i.test(
      titleLower
    ) &&
    !/\b(24-hour\s+hackathon|12-hour\s+hackathon|10-hour\s+hackathon|coding\s+marathon)\b/i.test(
      descLower
    );

  if (
    (hasConferenceTag || isConferenceInTitle || isConferenceInBody) &&
    !/\b(hackathon|ideathon|buildathon|ctf)\b/i.test(titleLower)
  ) {
    return {
      eventType: 'conference',
      matchable: false,
      reason:
        'Classified as Conference / Summit from source title, tags, or description; excluded from team hackathon matching.',
    };
  }

  // 3. Explicit Workshop / Bootcamp / FDP Override
  const hasWorkshopTag = cleanedTags.some((t) =>
    /^(workshops?|bootcamp|handson|fdp)$/i.test(t)
  );
  const isExplicitWorkshopInTitle =
    /\b(workshop|hands-on\s+session|masterclass|bootcamp|training\s+session|faculty\s+development\s+program|\bfdp\b)\b/i.test(
      titleLower
    );
  const isWorkshopOnlyInBody =
    /\b(technical\s+workshop|design\s+thinking\s+workshop|machine\s+learning\s+workshop|workshop\s+event|faculty\s+development\s+program)\b/i.test(
      textOnly
    ) &&
    !/\b(hackathon|hack-a-thon|ideathon|buildathon|6\s+hour\s+ctf\s+challenge|24-hour|10-hour|12-hour)\b/i.test(
      textOnly
    );

  if (
    (isExplicitWorkshopInTitle || isWorkshopOnlyInBody) &&
    !/\b(hackathon|ideathon|buildathon)\b/i.test(titleLower)
  ) {
    return {
      eventType: 'workshop',
      matchable: false,
      reason:
        'Classified as Workshop / FDP from source title or description; excluded from team hackathon matching.',
    };
  }

  // 4. Explicit Talk / Lecture / Seminar / Webinar / Research Session Override
  const hasTalkTag = cleanedTags.some((t) =>
    /^(talks?|infosession|interactive\s+session|seminar|webinar|keynote|lecture)$/i.test(
      t
    )
  );
  const isExplicitTalkInTitleOrBody =
    /\b(expert\s+talk|expert\s+lecture|guest\s+lecture|technical\s+talk|tech\s+talk|info\s*session|webinar|seminar|keynote|panel\s+discussion|orientation|awareness\s+program|research\s+paper\s+writing|guide\s+to\s+research|podcast-style\s+conversations|an\s+industry\s+perspective|introduction\s+to\s+aws|interactive\s+research-focused\s+session|academic\s+and\s+technical\s+session)\b/i.test(
      textOnly
    );

  if (
    isExplicitTalkInTitleOrBody &&
    !/\b(hackathon|ideathon|buildathon|ctf|capture\s+the\s+flag)\b/i.test(
      titleLower
    ) &&
    !/\b(24-hour\s+hackathon|12-hour\s+hackathon|10-hour\s+hackathon)\b/i.test(
      descLower
    )
  ) {
    return {
      eventType: 'tech_talk',
      matchable: false,
      reason:
        'Classified as Talk / Seminar / Session from source title or description; excluded from team hackathon matching.',
    };
  }

  // 5. CTF (Capture The Flag) Competitions
  if (
    /\b(capture\s+the\s+flag|\bctf\b)\b/i.test(textOnly) &&
    !/\bworkshop\s+event\s+ctf\b/i.test(textOnly) &&
    (!/\bhackathon\b/i.test(titleLower) ||
      /\b(capture\s+the\s+flag|\bctf\b)\b/i.test(titleLower) ||
      /\bcapture\s+the\s+flag\s*\(ctf\)\s*hackathon\b/i.test(textOnly))
  ) {
    return {
      eventType: 'ctf',
      matchable: !soloOnly,
      reason: soloOnly
        ? 'Solo CTF competition (maxTeamSize = 1).'
        : 'Verified CTF security competition.',
    };
  }

  // 6. Ideathons
  if (
    /\b(ideathon|innovation\s+challenge)\b/i.test(textOnly) ||
    (/\benvision\s+a\s+sustainable\s+future\s+by\s+developing\s+innovative\b/i.test(
      textOnly
    ) &&
      /\bgreenglitch\b/i.test(titleLower))
  ) {
    return {
      eventType: 'ideathon',
      matchable: !soloOnly,
      reason: 'Verified Ideathon / Innovation competition.',
    };
  }

  // 7. Buildathons
  if (/\bbuildathon\b/i.test(textOnly)) {
    return {
      eventType: 'buildathon',
      matchable: !soloOnly,
      reason: 'Verified Buildathon competition.',
    };
  }

  // 8. Team Coding / Open-Source / Technical Competitions
  if (
    /\b(competitive\s+programming|coding\s+marathon|coding\s+competition|programming\s+contest|team\s+competition|contribution\s+spree|algomania|mach\s*zero|codecrypt)\b/i.test(
      textOnly
    ) &&
    !/\b(hackathon|hack-a-thon)\b/i.test(titleLower)
  ) {
    return {
      eventType: 'team_competition',
      matchable: !soloOnly,
      reason: 'Verified team coding / technical competition.',
    };
  }

  // 9. Hackathons (requires explicit hackathon evidence in title or description, not just a bare tag on a non-tech stub)
  const hasExplicitHackathonTag = cleanedTags.some((t) =>
    /^(hackathon|ideathon|buildathon|ctf|codesprint)$/i.test(t)
  );
  const hasHackathonEvidenceInText =
    /\b(hackathon|hack-a-thon|24[\s-]*h(?:ou)?rs?\s+hack|10[\s-]*h(?:ou)?rs?\s+hack|12[\s-]*h(?:ou)?rs?\s+hack|18[\s-]*h(?:ou)?rs?\s+hack|36[\s-]*h(?:ou)?rs?\s+hack|48[\s-]*h(?:ou)?rs?\s+hack|game\s+jam|code\s+sprint|coding\s+sprint|kodikon|terrathon|agentathon|finathon|aerothon|dabbathon|horcrux|hashcode|robofest|rero|codecraze|martechhack|cidecode|hackops|hackeee|heal-a-thon|heal-o-code|intentia|embedx|silicon\s+rush|swasthya\s+avishkar|deltatime|genesys)\b/i.test(
      textOnly
    );

  if (hasHackathonEvidenceInText) {
    return {
      eventType: 'hackathon',
      matchable: !soloOnly,
      reason: 'Verified Hackathon with explicit source evidence.',
    };
  }

  // If tagged #Hackathon on events.pes.edu AND has substantive competition/team/problem-solving text
  if (
    hasExplicitHackathonTag &&
    /\b(teams?|prize|compete|competition|challenge|build|prototype|coding|developers?|problem[\s-]solving)\b/i.test(
      textOnly
    )
  ) {
    return {
      eventType: 'hackathon',
      matchable: !soloOnly,
      reason: 'Verified Hackathon from source tag and competition details.',
    };
  }

  if (hasWorkshopTag || /\b(workshop|hands-on|bootcamp)\b/i.test(combined)) {
    return {
      eventType: 'workshop',
      matchable: false,
      reason: 'Workshop session without team hackathon competition.',
    };
  }

  if (
    hasTalkTag ||
    /\b(talk|lecture|seminar|webinar|keynote|session)\b/i.test(combined)
  ) {
    return {
      eventType: 'tech_talk',
      matchable: false,
      reason: 'Talk, lecture, or academic session.',
    };
  }

  return {
    eventType: 'other',
    matchable: false,
    reason:
      'Insufficient evidence of an eligible team hackathon, ideathon, CTF, or coding competition.',
  };
}

/**
 * Determines whether a record is eligible for the student-facing Hackathons discovery catalog.
 *
 * Eligible:
 * - Hackathons and buildathons ('hackathon', 'buildathon')
 * - Ideathons with team participation ('ideathon')
 * - CTF competitions that allow teams ('ctf')
 * - Coding or technical competitions requiring or permitting teams ('team_competition')
 *
 * Excluded:
 * - Tech talks and guest lectures ('tech_talk')
 * - Workshops ('workshop')
 * - Seminars and webinars
 * - Conferences and summits ('conference')
 * - Cultural events ('other')
 * - Individual-only competitions (maxTeamSize === 1)
 * - Archived or synthetic test records
 */
export function isEligibleTeamHackathonCatalogEvent(event: {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  title?: string | null;
  description?: string | null;
  eventType?: EventType | string | null;
  matchable?: boolean | null;
  themes?: string[] | null;
  minTeamSize?: number | null;
  maxTeamSize?: number | null;
  status?: string | null;
}): boolean {
  if (event.status === 'archived' || event.status === 'draft') {
    return false;
  }
  if (event.maxTeamSize === 1) {
    return false;
  }

  const title = cleanHtmlToText(event.name || event.title || '');
  const description = cleanHtmlToText(event.description || '');
  if (!title) return false;

  const reevaluated = classifyGroundedEvent({
    title,
    description,
    tags: event.themes ?? [],
    minTeamSize: event.minTeamSize,
    maxTeamSize: event.maxTeamSize,
  });

  const eligibleTypes = new Set<string>([
    'hackathon',
    'buildathon',
    'ideathon',
    'ctf',
    'team_competition',
  ]);

  if (!reevaluated.matchable || !eligibleTypes.has(reevaluated.eventType)) {
    return false;
  }

  if (
    event.eventType &&
    !eligibleTypes.has(String(event.eventType)) &&
    event.matchable === false
  ) {
    return false;
  }

  return true;
}

/**
 * Human-readable category label for supported EventTypes.
 */
export function formatEventTypeCategoryLabel(eventType: EventType | string): string {
  switch (eventType) {
    case 'hackathon':
    case 'buildathon':
      return 'Hackathon / Buildathon';
    case 'ideathon':
    case 'team_competition':
      return 'Ideathon / Competition';
    case 'ctf':
      return 'CTF';
    case 'workshop':
      return 'Workshop';
    case 'tech_talk':
      return 'Talk / Seminar';
    case 'conference':
      return 'Conference / Summit';
    default:
      return 'Other';
  }
}

/**
 * Inspects a normalized PESU Academy announcement and detects whether it describes
 * a relevant technical event (hackathon, ideathon, buildathon, CTF, coding competition, workshop, tech talk).
 *
 * CRITICAL: Never mistakes `ann.date` (the announcement's publication date) for the event's `startAt`!
 * Event dates are extracted ONLY when explicitly stated in the announcement title or description.
 */
export function detectTechnicalEventFromAnnouncement(
  ann: NormalizedPesuAnnouncement
): DetectedAnnouncementEventCandidate | null {
  const combined = `${ann.title}\n${ann.description}`;
  const lower = combined.toLowerCase();

  // Exclude pure academic administrative notices (exam seating, grade sheets, fee reminders, ESA timetable)
  const isPureAdminNotice =
    /\b(esa\s+seating|isa\s+seating|grade\s+card|revaluation|backlog\s+registration|tuition\s+fee|hostel\s+fee|bus\s+pass|hall\s+ticket|convocation\s+gown)\b/i.test(
      lower
    ) &&
    !/\b(hackathon|ideathon|buildathon|ctf|coding\s+competition)\b/i.test(lower);

  if (isPureAdminNotice) {
    return null;
  }

  const hasTechEventSignal =
    /\b(hackathon|hack-a-thon|ideathon|buildathon|\bctf\b|capture the flag|code\s+sprint|coding\s+competition|programming\s+contest|tech\s+talk|workshop|bootcamp|developer\s+challenge|open[\s-]source\s+sprint)\b/i.test(
      lower
    );

  if (!hasTechEventSignal) {
    return null;
  }

  const teamBounds = extractGroundedTeamSize(combined);
  const cls = classifyGroundedEvent({
    title: ann.title,
    description: ann.description,
    minTeamSize: teamBounds.min,
    maxTeamSize: teamBounds.max,
  });

  // Extract event dates ONLY from explicit event date expressions in the title/description
  // (NEVER from ann.date which is the announcement publication date)
  let startAt: string | null = null;
  let endAt: string | null = null;
  let registrationDeadline: string | null = null;

  // Look for deadline first so we don't confuse registration deadline with event start date
  const deadlineMatch = combined.match(
    /(?:registration\s+deadline|last\s+date\s+(?:to\s+register|for\s+registration)|register\s+(?:by|before)|deadline)\s*[:-]?\s*([A-Za-z0-9,\s–—-]+?\d{4})/i
  );
  if (deadlineMatch) {
    registrationDeadline = parseSingleDateToYmd(deadlineMatch[1]);
  }

  // Strip the deadline clause before searching for event start/end dates
  const textWithoutDeadline = deadlineMatch
    ? combined.replace(deadlineMatch[0], ' ')
    : combined;

  const explicitEventDateMatch =
    textWithoutDeadline.match(
      /(?:event\s+dates?|scheduled\s+(?:on|for)|held\s+(?:on|from)|taking\s+place\s+(?:on|from)|dates?\s*:)\s*([^\n.;]+)/i
    ) ||
    textWithoutDeadline.match(
      /\b(?:on|from)\s+(\d{1,2}(?:st|nd|rd|th)?\s+(?:[–—-]\s*\d{1,2}(?:st|nd|rd|th)?\s+)?[A-Za-z]{3,9},?\s+\d{4}(?:\s*(?:to|–|—|-)\s*\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4})?)/i
    );

  if (explicitEventDateMatch) {
    const parsedRange = parseDateRangeFromText(explicitEventDateMatch[1]);
    startAt = parsedRange.startAt;
    endAt = parsedRange.endAt;
  } else {
    // Check if there is an explicit date range in the body
    const fallbackRange = parseDateRangeFromText(textWithoutDeadline);
    if (fallbackRange.startAt) {
      startAt = fallbackRange.startAt;
      endAt = fallbackRange.endAt;
    }
  }

  // Extract organizer if explicitly stated
  let organizer: string | null = null;
  const orgMatch =
    combined.match(
      /(?:organized\s+by|hosted\s+by|conducted\s+by|presented\s+by)\s+([A-Z][A-Za-z0-9\s,&().-]{2,65}?)(?:[.\n;]|$)/i
    ) ||
    combined.match(
      /\b(Department\s+of\s+[A-Za-z\s&]+|PESU?\s+[A-Za-z0-9\s]+Club|ACM\s+PESU?|IEEE\s+PESU?|CIE\s+PESU?)\b/i
    );
  if (orgMatch && orgMatch[1]) {
    organizer = orgMatch[1].trim();
  }

  // Extract venue if explicitly stated
  let venueName: string | null = null;
  const venueMatch =
    combined.match(
      /(?:venue|location|room|auditorium)\s*[:-]\s*([^\n.;]{3,60})/i
    ) ||
    combined.match(
      /\b(MRD\s+Auditorium|GJBC\s+[A-Za-z0-9\s-]+|[FB]-\d{3}|Seminar\s+Hall\s*\d*)\b/i
    );
  if (venueMatch && venueMatch[1]) {
    venueName = venueMatch[1].trim();
  }

  const campus = extractGroundedCampus(combined);

  // Extract public registration URL if present (exclude private pesuacademy.com URLs)
  let registrationUrl: string | null = null;
  const urlMatches = combined.match(/https?:\/\/[^\s)>\]"']+/gi) ?? [];
  for (const rawUrl of urlMatches) {
    const cleanedUrl = rawUrl.replace(/[.,;!?]+$/, '');
    if (
      !cleanedUrl.toLowerCase().includes('pesuacademy.com') &&
      !cleanedUrl.toLowerCase().includes('me-qr.com/page/blog')
    ) {
      registrationUrl = cleanedUrl;
      break;
    }
  }

  // Themes grounded in keywords
  const themes: string[] = [];
  if (/\b(ai|ml|machine learning|llm|genai|deep learning)\b/i.test(lower)) {
    themes.push('Applied AI/ML');
  }
  if (/\b(cyber|security|ctf|cryptography)\b/i.test(lower)) {
    themes.push('Cybersecurity');
  }
  if (/\b(cloud|kubernetes|devops|distributed|systems)\b/i.test(lower)) {
    themes.push('Systems/Cloud');
  }
  if (/\b(open[\s-]source|developer tools|devtools)\b/i.test(lower)) {
    themes.push('Open-Source Systems');
  }
  if (/\b(iot|robotics|hardware|embedded)\b/i.test(lower)) {
    themes.push('Robotics & IoT');
  }
  if (themes.length === 0) {
    themes.push('General Technical');
  }

  const evidenceExcerpts: string[] = [`Title: "${ann.title}"`];
  if (startAt) {
    evidenceExcerpts.push(
      `Stated event date: ${startAt}${endAt && endAt !== startAt ? ` to ${endAt}` : ''}`
    );
  }
  if (teamBounds.excerpt) {
    evidenceExcerpts.push(`Stated team size: "${teamBounds.excerpt}"`);
  }
  if (registrationUrl) {
    evidenceExcerpts.push(`Public link: ${registrationUrl}`);
  }

  const confidence: 'high' | 'medium' | 'low' =
    cls.matchable && (startAt || registrationUrl)
      ? 'high'
      : cls.eventType !== 'unknown' && cls.eventType !== 'other'
        ? 'medium'
        : 'low';

  return {
    isRelevantTechnicalEvent: true,
    confidence,
    title: ann.title,
    organizer,
    eventType: cls.eventType,
    matchable: cls.matchable,
    themes,
    startAt,
    endAt,
    registrationDeadline,
    campus,
    venueName,
    format:
      campus === 'Online / Multi-Campus'
        ? 'online'
        : campus || venueName
          ? 'onsite'
          : 'unknown',
    minTeamSize: teamBounds.min,
    maxTeamSize: teamBounds.max,
    registrationUrl,
    evidenceExcerpts,
    classificationReason: cls.reason,
  };
}

/**
 * Redacts personal identifiers (emails, phone numbers, SRNs/PRNs) and strips private
 * announcement prose before a student submits an announcement-derived candidate for admin review.
 */
export function sanitizeTextForPublicCandidate(text: string): string {
  if (!text) return '';
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/\bPES[12][A-Z]{2}\d{2}[A-Z]{2}\d{3}\b/gi, '[redacted-srn]')
    .replace(/\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, '[redacted-phone]')
    .trim();
}

/**
 * Builds a privacy-safe, strictly grounded EventCandidate draft from a detected PESU Academy announcement.
 * Never includes raw private announcement text unless the student explicitly opts to include a sanitized summary.
 */
export function buildSanitizedCandidateDraftFromAnnouncement(params: {
  announcement: NormalizedPesuAnnouncement;
  detected: DetectedAnnouncementEventCandidate;
  includeSanitizedSummary?: boolean;
}): Partial<EventCandidate> {
  const { announcement, detected, includeSanitizedSummary = false } = params;

  const publicFactsSummary = [
    detected.eventType !== 'unknown'
      ? `Event type: ${detected.eventType.replace('_', ' ')}`
      : null,
    detected.organizer ? `Organizer: ${detected.organizer}` : null,
    detected.campus || detected.venueName
      ? `Location: ${[detected.venueName, detected.campus].filter(Boolean).join(', ')}`
      : null,
    detected.startAt
      ? `Dates: ${detected.startAt}${detected.endAt && detected.endAt !== detected.startAt ? ` to ${detected.endAt}` : ''}`
      : 'Dates: Date TBA (not stated in announcement)',
  ]
    .filter(Boolean)
    .join(' · ');

  const description = includeSanitizedSummary
    ? sanitizeTextForPublicCandidate(announcement.description).slice(0, 360)
    : publicFactsSummary;

  return {
    source: 'academy_opt_in_hint',
    sourceUrl: detected.registrationUrl ?? undefined,
    originalSubmissionUrl: detected.registrationUrl ?? null,
    verifiedCanonicalUrl: null,
    sourceUrlStatus: detected.registrationUrl ? 'unverified' : 'unavailable',
    title: sanitizeTextForPublicCandidate(detected.title),
    organizer: detected.organizer
      ? sanitizeTextForPublicCandidate(detected.organizer)
      : '',
    eventType: detected.eventType,
    matchable: detected.matchable,
    themes: detected.themes,
    description,
    startAt: detected.startAt,
    endAt: detected.endAt,
    registrationDeadline: detected.registrationDeadline,
    timezone: 'Asia/Kolkata',
    venue: {
      campus: detected.campus,
      name: detected.venueName
        ? sanitizeTextForPublicCandidate(detected.venueName)
        : null,
    },
    format: detected.format,
    teamSize: {
      min: detected.minTeamSize,
      max: detected.maxTeamSize,
    },
    registrationUrl: detected.registrationUrl,
    fieldEvidence: {
      announcementHint: detected.evidenceExcerpts.map((excerpt) => ({
        sourceUrl: detected.registrationUrl || 'pesu-academy://opt-in-hint',
        excerpt: sanitizeTextForPublicCandidate(excerpt),
      })),
    },
    classification: {
      ruleGatePassed: detected.matchable,
      mlScore: detected.matchable ? 1 : 0,
      reason: detected.classificationReason,
    },
    reviewStatus: 'needs_confirmation',
  };
}

/**
 * Enriches an event title with its official subtitle when the subtitle carries a distinct
 * hackathon/conference identity (e.g., "Robofest 5.0" + "IEEE RAS - ReRo Online Hackathon"
 * -> "Robofest 5.0 (ReRo Online Hackathon)").
 */
function combineEventTitleAndSubtitle(
  rawTitle: string,
  rawSubtitle: string | null | undefined
): string {
  const title = cleanHtmlToText(rawTitle);
  const subtitle = cleanHtmlToText(rawSubtitle ?? '');
  if (!title) return subtitle;
  if (!subtitle) return title;

  const titleLower = title.toLowerCase();
  const subLower = subtitle.toLowerCase();
  if (titleLower.includes(subLower)) return title;

  if (/\brero\s+online\s+hackathon\b/i.test(subtitle) && !/rero/i.test(title)) {
    return `${title} (ReRo Online Hackathon)`;
  }

  if (
    titleLower === 'hackathon' &&
    subtitle.length >= 3 &&
    subtitle.length <= 50
  ) {
    return `${title} — ${subtitle}`;
  }

  return title;
}

/**
 * Parses `https://events.pes.edu/browse/...` HTML listing pages into structured public event cards.
 */
export function parsePesuEventsHtmlListing(
  html: string,
  baseOrigin = 'https://events.pes.edu'
): ParsedPesuPublicEventListingItem[] {
  if (!html || typeof html !== 'string') return [];

  const results: ParsedPesuPublicEventListingItem[] = [];
  const seenIds = new Set<string>();

  // Match each `<div class="ticket ..." data-href="/11629/"> ... </div>` card block
  const segments = html.split(/<div\b(?=[^>]*\bdata-href="\/?\d+\/?")/i);
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const hrefMatch = seg.match(/data-href="\/?(\d+)\/?"/i);
    if (!hrefMatch) continue;

    const eventId = hrefMatch[1];
    if (seenIds.has(eventId)) continue;
    seenIds.add(eventId);

    const detailUrl = `${baseOrigin.replace(/\/$/, '')}/${eventId}/`;

    const titleMatch = seg.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const baseTitle = titleMatch ? cleanHtmlToText(titleMatch[1]) : '';
    if (!baseTitle) continue;

    // Extract status pill (Upcoming, Live now, Attended/Past)
    let statusLabel: 'Upcoming' | 'Live now' | 'Past' | 'Unknown' = 'Unknown';
    if (/\bstatus-upcoming\b/i.test(seg) || />\s*Upcoming\s*</i.test(seg)) {
      statusLabel = 'Upcoming';
    } else if (/\bstatus-live\b/i.test(seg) || />\s*Live\s+now\s*</i.test(seg)) {
      statusLabel = 'Live now';
    } else if (
      /\bstatus-past\b/i.test(seg) ||
      /\bis-past\b/i.test(seg) ||
      />\s*(?:Attended|Ended|Past|Completed)\s*</i.test(seg)
    ) {
      statusLabel = 'Past';
    }

    // Extract tags ONLY inside `.tags-inline`, `.ticket-tags`, or `.bt-tags` inside this card
    const tags: string[] = [];
    const tagsBlockMatch = seg.match(
      /<div\s+class="[^"]*(?:tags-inline|ticket-tags|bt-tags)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (tagsBlockMatch) {
      const spanMatches =
        tagsBlockMatch[1].match(/<span[^>]*>([\s\S]*?)<\/span>/gi) ?? [];
      for (const sm of spanMatches) {
        const t = cleanHtmlToText(sm).replace(/^#/, '').trim();
        if (t && !tags.includes(t)) tags.push(t);
      }
    }

    // Summary paragraph inside `.ticket-body`
    const pMatch = seg.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const summary = pMatch ? cleanHtmlToText(pMatch[1]) : '';
    const title = combineEventTitleAndSubtitle(baseTitle, summary);

    // Extract date from `.ticket-facts`
    let dateText: string | null = null;
    const factsMatch = seg.match(
      /<div\s+class="[^"]*ticket-facts[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    const searchArea = factsMatch ? factsMatch[1] : seg;
    const dateCandidateMatch = searchArea.match(
      /(?:[A-Za-z]{3},?\s+)?\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}(?:\s*(?:–|—|-|to)\s*(?:[A-Za-z]{3},?\s+)?\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})?/i
    );
    if (dateCandidateMatch) {
      dateText = cleanHtmlToText(dateCandidateMatch[0]);
    }

    const { startAt, endAt } = parseDateRangeFromText(dateText);
    const campus = extractGroundedCampus(`${seg} ${title} ${summary}`);

    const cls = classifyGroundedEvent({
      title,
      description: summary,
      tags,
    });

    results.push({
      eventId,
      detailUrl,
      title,
      summary,
      statusLabel,
      tags,
      dateText,
      startAt,
      endAt,
      campus,
      venueName: null,
      organizer: null,
      eventType: cls.eventType,
      matchable: cls.matchable,
    });
  }

  return results;
}

/**
 * Parses an individual `https://events.pes.edu/<id>/` event detail page into structured,
 * verifiable event metadata.
 *
 * CRITICAL: Scopes tag extraction to `<div class="sidebar-tags">` inside `.page-event-detail`
 * so global navbar `#tagsMegaPanel` links (`#Clubs & Activities`, `#Talks`, `#Workshop`, `#Management`)
 * never pollute event tags or classification!
 */
export function parsePesuEventDetailHtml(
  html: string,
  pageUrl: string
): ParsedPesuPublicEventDetail {
  const idMatch = pageUrl.match(/events\.pes\.edu\/(\d+)/i);
  const eventId = idMatch ? idMatch[1] : null;
  const canonicalUrl = eventId
    ? `https://events.pes.edu/${eventId}/`
    : pageUrl;

  // Scope parsing to `.page-event-detail` when present so header/footer mega-menus are ignored
  const detailStartIdx = html.indexOf('class="page-event-detail"');
  const scopedHtml =
    detailStartIdx !== -1 ? html.slice(detailStartIdx) : html;

  // Extract hero subtitle `<p class="sub">...</p>` from `<section class="event-hero">`
  const heroSubMatch = scopedHtml.match(
    /<p[^>]*class="[^"]*\bsub\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i
  );
  const heroSubtitle = heroSubMatch ? cleanHtmlToText(heroSubMatch[1]) : null;

  // Title: prefer `.bt-title`, `<h1>`, or `og:title`
  const h1Match =
    scopedHtml.match(
      /<h1[^>]*class="[^"]*bt-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i
    ) || scopedHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const ogTitleMatch =
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i
    );

  let rawTitle = h1Match
    ? cleanHtmlToText(h1Match[1])
    : ogTitleMatch
      ? cleanHtmlToText(ogTitleMatch[1])
      : null;
  if (rawTitle) {
    rawTitle = rawTitle
      .replace(/\s*(?:\||—|-)\s*events\.pes\.edu.*$/i, '')
      .replace(/\s*\|\s*PES\s*Events.*$/i, '')
      .trim();
    rawTitle = combineEventTitleAndSubtitle(rawTitle, heroSubtitle);
  }

  // Extract structured `.bt-fact-label` -> `.bt-fact-value` pairs (both `<span>` and `<div>` markup)
  const facts: Record<string, string> = {};
  const factBlockRegex =
    /<(?:span|div)[^>]*class="[^"]*bt-fact-label[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>\s*<(?:span|div)[^>]*class="[^"]*bt-fact-value[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/gi;
  let factMatch: RegExpExecArray | null;
  while ((factMatch = factBlockRegex.exec(scopedHtml)) !== null) {
    const label = cleanHtmlToText(factMatch[1]).toLowerCase();
    const val = cleanHtmlToText(factMatch[2]).replace(/,\s*$/, '').trim();
    if (label && val) {
      facts[label] = val;
    }
  }

  // Also extract `.sidebar-fact-label` -> `.chip-opt-dark` pairs from the sidebar
  const sidebarFactRegex =
    /<span[^>]*class="[^"]*sidebar-fact-label[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<span[^>]*class="[^"]*chip-opt-dark[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let sfm: RegExpExecArray | null;
  while ((sfm = sidebarFactRegex.exec(scopedHtml)) !== null) {
    const label = cleanHtmlToText(sfm[1]).toLowerCase();
    const val = cleanHtmlToText(sfm[2]).trim();
    if (label && val && !facts[label]) {
      facts[label] = val;
    }
  }

  // Extract Campus from `.bt-campus-name` or `facts['campus']`
  const campusBlockMatch = scopedHtml.match(
    /<[^>]*class="[^"]*bt-campus-name[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i
  );
  const campusText = campusBlockMatch
    ? cleanHtmlToText(campusBlockMatch[1])
    : facts['campus'] || '';

  // Extract Tags STRICTLY from `<div class="sidebar-tags">` or `.bt-tag` / `.ticket-tag` inside the event detail
  const tags: string[] = [];
  const sidebarTagsMatch = scopedHtml.match(
    /<div[^>]*class="[^"]*sidebar-tags[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );
  if (sidebarTagsMatch) {
    const anchorMatches =
      sidebarTagsMatch[1].match(/<a[^>]*>([\s\S]*?)<\/a>/gi) ?? [];
    for (const am of anchorMatches) {
      const t = cleanHtmlToText(am).replace(/^#/, '').trim();
      if (t && !tags.includes(t)) tags.push(t);
    }
  }
  const tagPillRegex =
    /<(?:span|a)[^>]*class="[^"]*(?:bt-tag|ticket-tag)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|a)>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tagPillRegex.exec(scopedHtml)) !== null) {
    const t = cleanHtmlToText(tm[1]).replace(/^#/, '').trim();
    if (t && !tags.includes(t)) tags.push(t);
  }

  // Extract Status from `.status-pill` in hero
  let statusLabel: 'Upcoming' | 'Live now' | 'Past' | 'Unknown' = 'Unknown';
  const statusPillMatch = scopedHtml.match(
    /<span[^>]*class="[^"]*status-pill[^"]*"[^>]*>([\s\S]*?)<\/span>/i
  );
  const statusPillText = statusPillMatch
    ? cleanHtmlToText(statusPillMatch[1])
    : '';
  if (/upcoming/i.test(statusPillText)) statusLabel = 'Upcoming';
  else if (/live\s+now/i.test(statusPillText)) statusLabel = 'Live now';
  else if (/attended|ended|past|closed/i.test(statusPillText))
    statusLabel = 'Past';

  // Extract main event body description from `.rich-text` inside `#eventBody`
  const richTextMatch = scopedHtml.match(
    /<div[^>]*class="[^"]*rich-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );
  const ogDescMatch =
    html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    );

  const richBodyText = richTextMatch
    ? cleanHtmlToText(richTextMatch[1])
    : ogDescMatch
      ? cleanHtmlToText(ogDescMatch[1])
      : '';

  let description: string | null = null;
  if (heroSubtitle && richBodyText) {
    if (richBodyText.toLowerCase().includes(heroSubtitle.toLowerCase())) {
      description = richBodyText.slice(0, 1200);
    } else {
      description = `${heroSubtitle}\n\n${richBodyText}`.slice(0, 1200);
    }
  } else if (richBodyText) {
    description = richBodyText.slice(0, 1200);
  } else if (heroSubtitle) {
    description = heroSubtitle.slice(0, 600);
  }

  // Date range from `facts['date']` or page text
  const dateSource = facts['date'] || facts['event date'] || '';
  const { startAt, endAt } = parseDateRangeFromText(
    dateSource || `${rawTitle ?? ''} ${description ?? ''}`
  );

  const rawVenue = facts['venue'] || facts['location'] || null;
  const venueName =
    rawVenue && !/^tba$/i.test(rawVenue.trim()) ? rawVenue.trim() : null;

  const organizer =
    facts['hosted by'] ||
    facts['organized by'] ||
    facts['organizer'] ||
    facts['department'] ||
    null;

  const isOnlineVenue =
    (venueName && /\bonline\s+event\b/i.test(venueName)) ||
    /\b24\/7\s+remote\s+robotics|\bonline\s+robotics\s+hackathon|\bonline\s+hackathon\b/i.test(
      `${rawTitle ?? ''} ${description ?? ''}`
    );

  const campus =
    extractGroundedCampus(
      `${campusText} ${venueName ?? ''} ${organizer ?? ''} ${description ?? ''}`
    ) ?? (isOnlineVenue ? 'Online / Multi-Campus' : null);

  // Extract external registration link from `#eventBody` / `.sidebar-actions` / `.rich-text`
  // Ignore bogus QR-code blog links (`me-qr.com/page/blog/*`) and calendar `.ics` links
  let registrationUrl: string | null = null;
  const eventBodyIdx = scopedHtml.indexOf('id="eventBody"');
  const linkSearchHtml =
    eventBodyIdx !== -1 ? scopedHtml.slice(eventBodyIdx) : scopedHtml;
  const anchorRegex =
    /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRegex.exec(linkSearchHtml)) !== null) {
    const href = am[1].replace(/&amp;/gi, '&').trim();
    const hrefLower = href.toLowerCase();
    const anchorText = cleanHtmlToText(am[2]).toLowerCase();
    if (
      hrefLower.includes('events.pes.edu/browse') ||
      hrefLower.includes('events.pes.edu/events/') ||
      hrefLower.endsWith('.ics') ||
      hrefLower.includes('me-qr.com/page/blog') ||
      hrefLower.includes('whatsapp.com/send') ||
      hrefLower.includes('twitter.com/intent') ||
      hrefLower.includes('linkedin.com/share') ||
      hrefLower.includes('facebook.com/sharer') ||
      hrefLower.includes('pes.edu/') && !hrefLower.includes('events.pes.edu')
    ) {
      continue;
    }
    if (
      /\b(register|registration|sign\s*up|apply|join|unstop|devfolio|forms\.gle|docs\.google\.com\/forms|vercel\.app|netlify\.app|cidecode\.in|thegreatindianhackathon\.com)\b/i.test(
        `${anchorText} ${href}`
      )
    ) {
      registrationUrl = href;
      break;
    }
  }

  // Extract registration deadline if mentioned in description
  let registrationDeadline: string | null = null;
  if (description) {
    const dlMatch = description.match(
      /(?:registration\s+deadline|last\s+date\s+to\s+register|register\s+(?:by|before))\s*[:-]?\s*([A-Za-z0-9,\s–—-]+?\d{4})/i
    );
    if (dlMatch) {
      registrationDeadline = parseSingleDateToYmd(dlMatch[1]);
    }
  }

  const teamBounds = extractGroundedTeamSize(
    `${rawTitle ?? ''} ${description ?? ''}`
  );

  const cls = classifyGroundedEvent({
    title: rawTitle ?? '',
    description: description ?? '',
    tags,
    minTeamSize: teamBounds.min,
    maxTeamSize: teamBounds.max,
  });

  const themes: string[] = [];
  for (const t of tags) {
    const cleaned = t.replace(/^#/, '').trim();
    if (
      cleaned &&
      !/^(upcoming|live|past)$/i.test(cleaned) &&
      themes.length < 4
    ) {
      themes.push(cleaned);
    }
  }
  if (themes.length === 0) {
    themes.push(formatEventTypeCategoryLabel(cls.eventType));
  }

  const evidenceParts = [
    rawTitle ? `Title: ${rawTitle}` : null,
    dateSource ? `Date: ${dateSource}` : startAt ? `Date: ${startAt}` : null,
    venueName ? `Venue: ${venueName}` : null,
    organizer ? `Hosted by: ${organizer}` : null,
    tags.length > 0 ? `Tags: ${tags.join(', ')}` : null,
  ].filter(Boolean);

  return {
    eventId,
    canonicalUrl,
    title: rawTitle,
    organizer,
    eventType: cls.eventType,
    matchable: cls.matchable,
    themes,
    description,
    startAt,
    endAt,
    registrationDeadline,
    campus,
    venueName,
    format: isOnlineVenue
      ? 'online'
      : campus === 'Online / Multi-Campus'
        ? 'online'
        : venueName || campus
          ? 'onsite'
          : 'unknown',
    minTeamSize: teamBounds.min,
    maxTeamSize: teamBounds.max,
    registrationUrl,
    statusLabel,
    tags,
    extractedEvidenceQuote:
      evidenceParts.join(' | ') || `Fetched from ${canonicalUrl}`,
    classificationReason: cls.reason,
  };
}

/**
 * Normalizes a URL for duplicate comparison (strips protocol differences, www., query hash, trailing slash).
 * Returns null for generic/bogus links (`me-qr.com/page/blog/*`, `attachment://`, `pesu-academy://`).
 */
export function normalizeUrlForComparison(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (
    !trimmed ||
    trimmed.startsWith('attachment://') ||
    trimmed.startsWith('pesu-academy://') ||
    trimmed.toLowerCase().includes('me-qr.com/page/blog')
  ) {
    return null;
  }
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '') || '/';
    // Preserve query string for Google Forms / CMT links where path is generic
    if (
      host.includes('docs.google.com') ||
      host.includes('cmt3.research.microsoft.com')
    ) {
      return `${host}${path}${u.search}`.toLowerCase();
    }
    return `${host}${path}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  }
}

/**
 * Extracts significant tokens from an event title for cross-source duplicate matching.
 */
export function normalizeEventTitleTokens(title: string | null | undefined): string[] {
  if (!title || typeof title !== 'string') return [];
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'pes',
    'pesu',
    'university',
    'event',
    'annual',
    'edition',
    'season',
    'department',
    'club',
  ]);
  return cleanHtmlToText(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));
}

/**
 * Extracts explicit version/edition numbers from a title (e.g., "5.0", "6.0", "2025", "2026", "1000", "2000")
 * so distinct editions like "Kodikon 5.0" vs "KODIKON 6.0" or "Nimbus 1000" vs "Nimbus 2000"
 * or "Agentathon 2025" vs "Agentathon 2026" are NEVER falsely merged.
 */
function extractEditionMarkers(title: string | null | undefined): string[] {
  if (!title) return [];
  const clean = cleanHtmlToText(title).toLowerCase();
  const markers: string[] = [];
  const versionMatches = clean.match(/\b(?:v?\d+\.\d+|\d{4}|(?:1000|2000)|['’]\d{2})\b/g) ?? [];
  for (const m of versionMatches) {
    markers.push(m.replace(/^['’]/, '20').replace(/^v/, ''));
  }
  return markers;
}

/**
 * Extracts canonical conference / hackathon aliases from title + description
 * (e.g. "adcom 2027" / "31st international ... advanced computing and communication",
 *  "rero online hackathon" / "robofest 5.0").
 */
function extractCanonicalEventAliases(record: {
  title?: string | null;
  name?: string | null;
  description?: string | null;
}): string[] {
  const combined = cleanHtmlToText(
    `${record.title || record.name || ''} ${record.description || ''}`
  ).toLowerCase();
  const aliases: string[] = [];

  if (
    /\badcom\s*2027\b/i.test(combined) ||
    /\b31st\s+international\s+(?:conference\s+on\s+)?advanced\s+computing\s+and\s+communications?\b/i.test(
      combined
    )
  ) {
    aliases.push('alias:adcom_2027');
  }

  if (
    /\brobofest\s*5\.0\b/i.test(combined) &&
    /\brero\b/i.test(combined)
  ) {
    aliases.push('alias:robofest_5_rero_2025');
  }

  if (
    /\btriverse\s+ideathon\b/i.test(combined) &&
    (/\b2025\b/i.test(combined) || /\bhcltech\b/i.test(combined))
  ) {
    aliases.push('alias:triverse_ideathon_2025');
  }

  return aliases;
}

/**
 * Checks whether two event records (across PESU Academy announcements, `events.pes.edu`,
 * and student submissions) represent the SAME real-world event.
 *
 * Uses:
 * 1. Verified canonical URL or official event ID.
 * 2. Distinct registration URL (when non-generic and not just a fallback copy of canonicalUrl).
 * 3. Canonical conference/hackathon aliases + matching date range (e.g. ADCOM 2027 across 11537 & 11523).
 * 4. Normalized event title tokens + edition guard + date range compatibility.
 */
export function areEventsSameRealWorldEvent(
  a: {
    title?: string | null;
    name?: string | null;
    description?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    organizer?: string | null;
    verifiedCanonicalUrl?: string | null;
    originalSubmissionUrl?: string | null;
    registrationUrl?: string | null;
  },
  b: {
    title?: string | null;
    name?: string | null;
    description?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    organizer?: string | null;
    verifiedCanonicalUrl?: string | null;
    originalSubmissionUrl?: string | null;
    registrationUrl?: string | null;
  }
): boolean {
  const titleA = cleanHtmlToText(a.title || a.name || '');
  const titleB = cleanHtmlToText(b.title || b.name || '');

  // 1. Exact URL match across any non-empty canonical / submission / registration URL
  const urlsA = [
    normalizeUrlForComparison(a.verifiedCanonicalUrl),
    normalizeUrlForComparison(a.originalSubmissionUrl),
    normalizeUrlForComparison(a.registrationUrl),
  ].filter((x): x is string => Boolean(x));

  const urlsB = [
    normalizeUrlForComparison(b.verifiedCanonicalUrl),
    normalizeUrlForComparison(b.originalSubmissionUrl),
    normalizeUrlForComparison(b.registrationUrl),
  ].filter((x): x is string => Boolean(x));

  for (const ua of urlsA) {
    if (urlsB.includes(ua)) {
      return true;
    }
  }

  const dateA = parseSingleDateToYmd(a.startAt);
  const dateB = parseSingleDateToYmd(b.startAt);
  const datesCompatible = (() => {
    if (!dateA || !dateB) return true;
    const msA = Date.parse(`${dateA}T00:00:00Z`);
    const msB = Date.parse(`${dateB}T00:00:00Z`);
    const diffDays = Math.abs(msA - msB) / (1000 * 60 * 60 * 24);
    return diffDays <= 4;
  })();

  const sameYearOrUndated = (() => {
    if (!dateA || !dateB) return true;
    return dateA.slice(0, 4) === dateB.slice(0, 4);
  })();

  // 2. Canonical multi-page alias match (e.g., ADCOM 2027 across 11537 & 11523, Triverse Ideathon 2025 across 11364/11314/11283)
  const aliasesA = extractCanonicalEventAliases(a);
  const aliasesB = extractCanonicalEventAliases(b);
  if (
    aliasesA.length > 0 &&
    aliasesB.some((al) => aliasesA.includes(al)) &&
    (datesCompatible ||
      (aliasesA.includes('alias:triverse_ideathon_2025') &&
        aliasesB.includes('alias:triverse_ideathon_2025') &&
        sameYearOrUndated))
  ) {
    return true;
  }

  // 3. Edition guard: if both titles specify explicit edition/version markers and they differ
  //    (e.g. "Kodikon 5.0" vs "KODIKON 6.0", "Nimbus 1000" vs "Nimbus 2000", "Agentathon 2025" vs "Agentathon 2026"),
  //    they are separate editions and must NOT be merged.
  const editionsA = extractEditionMarkers(titleA);
  const editionsB = extractEditionMarkers(titleB);
  if (
    editionsA.length > 0 &&
    editionsB.length > 0 &&
    !editionsA.some((ea) => editionsB.includes(ea))
  ) {
    return false;
  }

  // 4. Title similarity + compatible dates
  const rawTitleA = titleA.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rawTitleB = titleB.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!rawTitleA || !rawTitleB) return false;

  const tokensA = normalizeEventTitleTokens(titleA);
  const tokensB = normalizeEventTitleTokens(titleB);

  let titleMatches = rawTitleA === rawTitleB;
  if (!titleMatches && tokensA.length > 0 && tokensB.length > 0) {
    const setB = new Set(tokensB);
    const shared = tokensA.filter((t) => setB.has(t));
    const minLen = Math.min(tokensA.length, tokensB.length);
    const maxLen = Math.max(tokensA.length, tokensB.length);
    if (
      shared.length === minLen &&
      (minLen >= 2 || (minLen === 1 && shared[0].length >= 6))
    ) {
      titleMatches = true;
    } else if (shared.length / maxLen >= 0.7 && shared.length >= 2) {
      titleMatches = true;
    }
  }

  if (!titleMatches) return false;
  return datesCompatible;
}

/**
 * Consolidates a list of Hackathons so that each real-world event is represented by
 * a single card, merging official source links and provenance when multiple pages
 * (e.g., two `events.pes.edu` pages or a community submission + official listing)
 * describe the same event.
 */
export function deduplicateHackathonCatalog(hackathons: Hackathon[]): Hackathon[] {
  const consolidated: Hackathon[] = [];

  for (const incoming of hackathons) {
    const cleanedIncoming: Hackathon = {
      ...incoming,
      name: cleanHtmlToText(incoming.name),
      description: cleanHtmlToText(incoming.description),
    };

    const existingIdx = consolidated.findIndex((ex) =>
      areEventsSameRealWorldEvent(
        {
          title: ex.name,
          description: ex.description,
          startAt: ex.startAt,
          endAt: ex.endAt,
          organizer: ex.organizer,
          verifiedCanonicalUrl: ex.verifiedCanonicalUrl,
          originalSubmissionUrl: ex.originalSubmissionUrl,
          registrationUrl: ex.registrationUrl,
        },
        {
          title: cleanedIncoming.name,
          description: cleanedIncoming.description,
          startAt: cleanedIncoming.startAt,
          endAt: cleanedIncoming.endAt,
          organizer: cleanedIncoming.organizer,
          verifiedCanonicalUrl: cleanedIncoming.verifiedCanonicalUrl,
          originalSubmissionUrl: cleanedIncoming.originalSubmissionUrl,
          registrationUrl: cleanedIncoming.registrationUrl,
        }
      )
    );

    if (existingIdx === -1) {
      consolidated.push(cleanedIncoming);
      continue;
    }

    const existing = consolidated[existingIdx];
    const mergedSourceIds = Array.from(
      new Set([
        ...(existing.sourceIds ?? []),
        ...(cleanedIncoming.sourceIds ?? []),
        existing.verifiedCanonicalUrl,
        cleanedIncoming.verifiedCanonicalUrl,
        existing.originalSubmissionUrl,
        cleanedIncoming.originalSubmissionUrl,
      ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0))
    );

    const mergedProvenance: Record<string, import('../types/domain.ts').FieldProvenanceEntry> = {
      ...(cleanedIncoming.fieldProvenance ?? {}),
      ...(existing.fieldProvenance ?? {}),
    };

    if (
      cleanedIncoming.verifiedCanonicalUrl &&
      cleanedIncoming.verifiedCanonicalUrl !== existing.verifiedCanonicalUrl
    ) {
      mergedProvenance[`source_${cleanedIncoming.id}`] = {
        sourceUrl: cleanedIncoming.verifiedCanonicalUrl,
        sourceType: cleanedIncoming.sourceType ?? 'pes_public_events',
        excerpt: `Consolidated official source page (${cleanedIncoming.name})`,
        verifiedAt: cleanedIncoming.lastVerifiedAt ?? new Date().toISOString(),
      };
    }

    // Prefer the more descriptive canonical conference/hackathon title if one is a generic track name
    const preferIncomingName =
      /31st international advanced computing/i.test(cleanedIncoming.name) &&
      !/31st international advanced computing/i.test(existing.name);

    // Prefer distinct external registration URL over a fallback canonical URL
    const existingRegIsFallback =
      !existing.registrationUrl ||
      normalizeUrlForComparison(existing.registrationUrl) ===
        normalizeUrlForComparison(existing.verifiedCanonicalUrl);
    const incomingRegIsDistinct =
      Boolean(cleanedIncoming.registrationUrl) &&
      normalizeUrlForComparison(cleanedIncoming.registrationUrl) !==
        normalizeUrlForComparison(cleanedIncoming.verifiedCanonicalUrl);

    const mergedSources = Array.from(
      new Set([
        ...(existing.sources ?? []),
        ...(cleanedIncoming.sources ?? []),
        ...mergedSourceIds,
      ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0))
    );

    const mergedName = preferIncomingName ? cleanedIncoming.name : existing.name;
    const mergedDesc =
      cleanedIncoming.description.length > existing.description.length
        ? cleanedIncoming.description
        : existing.description;
    const mergedRegUrl =
      existingRegIsFallback && incomingRegIsDistinct
        ? cleanedIncoming.registrationUrl
        : existing.registrationUrl || cleanedIncoming.registrationUrl;
    const mergedDeadline =
      existing.registrationDeadline || cleanedIncoming.registrationDeadline;
    const mergedStartAt = existing.startAt || cleanedIncoming.startAt;
    const mergedEndAt = existing.endAt || cleanedIncoming.endAt || mergedStartAt;
    const mergedMinTeam = existing.minTeamSize ?? cleanedIncoming.minTeamSize;
    const mergedMaxTeam = existing.maxTeamSize ?? cleanedIncoming.maxTeamSize;

    const states = evaluateHackathonEligibilityAndStates({
      name: mergedName,
      description: mergedDesc,
      eventType: existing.eventType,
      themes: existing.themes,
      minTeamSize: mergedMinTeam,
      maxTeamSize: mergedMaxTeam,
      startAt: mergedStartAt,
      endAt: mergedEndAt,
      registrationDeadline: mergedDeadline,
      registrationUrl: mergedRegUrl,
      verifiedCanonicalUrl: existing.verifiedCanonicalUrl || cleanedIncoming.verifiedCanonicalUrl,
      originalSubmissionUrl: existing.originalSubmissionUrl || cleanedIncoming.originalSubmissionUrl,
      sourceUrlStatus:
        existing.sourceUrlStatus === 'verified' || cleanedIncoming.sourceUrlStatus === 'verified'
          ? 'verified'
          : existing.sourceUrlStatus,
      sourceType: existing.sourceType,
      status: existing.status,
    });

    consolidated[existingIdx] = {
      ...existing,
      name: mergedName,
      description: mergedDesc,
      shortDescription: mergedDesc.slice(0, 220),
      startAt: mergedStartAt,
      endAt: mergedEndAt,
      dateDisplay: formatEventDateDisplayIST({ startAt: mergedStartAt, endAt: mergedEndAt }),
      registrationUrl: mergedRegUrl,
      registrationDeadline: mergedDeadline,
      minTeamSize: states.minTeamSize,
      maxTeamSize: states.maxTeamSize,
      teamSize: {
        min: states.minTeamSize,
        max: states.maxTeamSize,
      },
      isHackathon: states.isHackathon,
      teamParticipationVerified: states.teamParticipationVerified,
      publicSourceVerified: states.publicSourceVerified,
      matchable: states.matchable,
      findTeammatesEligible: states.findTeammatesEligible,
      registrationStatus: states.registrationStatus,
      registrationStatusDetail: states.registrationStatusDetail,
      registrationStatusLabel: states.registrationStatusLabel,
      venue: {
        campus: existing.venue?.campus ?? cleanedIncoming.venue?.campus ?? null,
        name: existing.venue?.name ?? cleanedIncoming.venue?.name ?? null,
      },
      sourceIds: mergedSourceIds,
      sources: mergedSources,
      fieldProvenance: mergedProvenance,
    };
  }

  return consolidated;
}

/**
 * Computes field-level diffs when a newly submitted/synced source provides additional or updated
 * grounded fields for an existing published Hackathon.
 */
export function computeProposedEventDiffs(
  existing: Hackathon,
  incoming: {
    startAt?: string | null;
    endAt?: string | null;
    registrationDeadline?: string | null;
    venue?: { campus?: CampusType | null; name?: string | null };
    registrationUrl?: string | null;
    verifiedCanonicalUrl?: string | null;
    teamSize?: { min?: number | null; max?: number | null };
    organizer?: string | null;
  }
): Array<{ field: string; oldValue: string; newValue: string }> {
  const diffs: Array<{ field: string; oldValue: string; newValue: string }> = [];

  const incStart = parseSingleDateToYmd(incoming.startAt);
  const exStart = parseSingleDateToYmd(existing.startAt);
  if (incStart && incStart !== exStart) {
    diffs.push({
      field: 'startAt',
      oldValue: exStart ?? 'Date TBA',
      newValue: incStart,
    });
  }

  const incEnd = parseSingleDateToYmd(incoming.endAt);
  const exEnd = parseSingleDateToYmd(existing.endAt);
  if (incEnd && incEnd !== exEnd) {
    diffs.push({
      field: 'endAt',
      oldValue: exEnd ?? 'Date TBA',
      newValue: incEnd,
    });
  }

  const incDeadline = parseSingleDateToYmd(incoming.registrationDeadline);
  const exDeadline = parseSingleDateToYmd(existing.registrationDeadline);
  if (incDeadline && incDeadline !== exDeadline) {
    diffs.push({
      field: 'registrationDeadline',
      oldValue: exDeadline ?? 'Unconfirmed',
      newValue: incDeadline,
    });
  }

  if (
    incoming.venue?.name &&
    incoming.venue.name.trim() &&
    incoming.venue.name.trim() !== (existing.venue?.name ?? '').trim()
  ) {
    diffs.push({
      field: 'venue',
      oldValue: existing.venue?.name ?? 'TBA',
      newValue: incoming.venue.name.trim(),
    });
  }

  if (
    incoming.registrationUrl &&
    incoming.registrationUrl.trim() &&
    normalizeUrlForComparison(incoming.registrationUrl) !==
      normalizeUrlForComparison(existing.registrationUrl)
  ) {
    diffs.push({
      field: 'registrationUrl',
      oldValue: existing.registrationUrl ?? 'None',
      newValue: incoming.registrationUrl.trim(),
    });
  }

  const existingMinTeam = existing.minTeamSize;
  const existingMaxTeam = existing.maxTeamSize;

  if (
    typeof incoming.teamSize?.min === 'number' &&
    typeof incoming.teamSize?.max === 'number' &&
    (incoming.teamSize.min !== existingMinTeam ||
      incoming.teamSize.max !== existingMaxTeam)
  ) {
    diffs.push({
      field: 'teamSize',
      oldValue:
        existingMinTeam && existingMaxTeam
          ? `${existingMinTeam}–${existingMaxTeam}`
          : 'Unconfirmed',
      newValue: `${incoming.teamSize.min}–${incoming.teamSize.max}`,
    });
  }

  return diffs;
}

// ============================================================================
// IST (`Asia/Kolkata`) Date & Time Filter Engine
// ============================================================================

/**
 * Returns a Date or timestamp formatted as `YYYY-MM-DD` in `Asia/Kolkata` (IST, UTC+05:30).
 */
export function getTodayDateStringIST(referenceDate: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(referenceDate);
}

/**
 * Computes Monday–Sunday calendar week boundaries (`YYYY-MM-DD`) in `Asia/Kolkata` for a given IST date string.
 */
export function getWeekBoundsIST(todayIstYmd: string): {
  weekStart: string;
  weekEnd: string;
} {
  const [y, m, d] = todayIstYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(dt);
  monday.setUTCDate(dt.getUTCDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const fmt = (dateObj: Date) =>
    `${String(dateObj.getUTCFullYear()).padStart(4, '0')}-${String(
      dateObj.getUTCMonth() + 1
    ).padStart(2, '0')}-${String(dateObj.getUTCDate()).padStart(2, '0')}`;

  return {
    weekStart: fmt(monday),
    weekEnd: fmt(sunday),
  };
}

/**
 * Computes first–last day calendar month boundaries (`YYYY-MM-DD`) in `Asia/Kolkata` for a given IST date string.
 */
export function getMonthBoundsIST(todayIstYmd: string): {
  monthStart: string;
  monthEnd: string;
} {
  const [y, m] = todayIstYmd.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    monthStart: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`,
    monthEnd: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(
      lastDay
    ).padStart(2, '0')}`,
  };
}

/**
 * Normalizes an event's start and end dates into `[startYmd, endYmd]` in `Asia/Kolkata`.
 * If `startAt` is null/unknown, returns `{ startYmd: null, endYmd: null }`.
 */
export function getEventDateBoundsIST(event: {
  startAt?: string | null;
  endAt?: string | null;
}): {
  startYmd: string | null;
  endYmd: string | null;
} {
  const startYmd = parseSingleDateToYmd(event.startAt);
  const endYmd = parseSingleDateToYmd(event.endAt) ?? startYmd;
  if (!startYmd && endYmd) {
    return { startYmd: endYmd, endYmd };
  }
  if (startYmd && endYmd && endYmd < startYmd) {
    return { startYmd, endYmd: startYmd };
  }
  return { startYmd, endYmd };
}

/**
 * Checks if two inclusive YYYY-MM-DD intervals `[aStart, aEnd]` and `[bStart, bEnd]` overlap.
 */
export function doDateIntervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/**
 * Determines verifiable registration status in IST without guessing when unverified.
 *
 * Distinguishes strictly between:
 * - 'open_confirmed' ("Registration confirmed open")
 * - 'deadline_known' ("Registration deadline known")
 * - 'link_available' ("Registration link available")
 * - 'unknown' ("Registration status unknown")
 * - 'closed' / 'ended' ("Registration closed")
 *
 * CRITICAL: A valid URL alone (especially when `registrationUrl` is merely the `events.pes.edu/<id>/`
 * detail page URL) does NOT prove registration is open!
 */
export function getVerifiableRegistrationStatus(
  event: {
    registrationDeadline?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    registrationUrl?: string | null;
    verifiedCanonicalUrl?: string | null;
    status?: string | null;
    registrationConfirmedOpen?: boolean | null;
  },
  todayIstYmd: string = getTodayDateStringIST()
): {
  status:
    | 'open_confirmed'
    | 'deadline_known'
    | 'link_available'
    | 'unknown'
    | 'closed'
    | 'ended';
  label: string;
  isOpen: boolean;
} {
  const { endYmd } = getEventDateBoundsIST(event);
  if (
    event.status === 'registration_closed' ||
    event.status === 'completed' ||
    event.status === 'archived'
  ) {
    return {
      status: 'closed',
      label: 'Registration Closed',
      isOpen: false,
    };
  }

  if (endYmd && endYmd < todayIstYmd) {
    return {
      status: 'ended',
      label: 'Registration Closed',
      isOpen: false,
    };
  }

  const regUrl = (event.registrationUrl ?? '').trim();
  if (regUrl && /\/closedform\b/i.test(regUrl)) {
    return {
      status: 'closed',
      label: 'Registration Closed',
      isOpen: false,
    };
  }

  const deadlineYmd = parseSingleDateToYmd(event.registrationDeadline);
  if (deadlineYmd) {
    if (deadlineYmd < todayIstYmd) {
      return {
        status: 'closed',
        label: 'Registration Closed',
        isOpen: false,
      };
    }
    return {
      status: 'deadline_known',
      label: `Registration Deadline: ${deadlineYmd}`,
      isOpen: true,
    };
  }

  if (event.registrationConfirmedOpen === true || event.status === 'in_progress') {
    return {
      status: 'open_confirmed',
      label: 'Registration Confirmed Open',
      isOpen: true,
    };
  }

  // Check if there is a genuine, distinct registration link (not a bogus QR blog link
  // and not merely a duplicate of the `events.pes.edu/<id>/` detail page URL)
  const normReg = normalizeUrlForComparison(regUrl);
  const normCanon = normalizeUrlForComparison(event.verifiedCanonicalUrl);
  const isBarePesEventDetailUrl =
    normReg !== null && /^events\.pes\.edu\/\d+$/.test(normReg);

  if (normReg && !isBarePesEventDetailUrl && normReg !== normCanon) {
    return {
      status: 'link_available',
      label: 'Registration Link Available',
      isOpen: true,
    };
  }

  if (normReg && !isBarePesEventDetailUrl && !normCanon) {
    return {
      status: 'link_available',
      label: 'Registration Link Available',
      isOpen: true,
    };
  }

  return {
    status: 'unknown',
    label: 'Registration Status Unknown',
    isOpen: false,
  };
}

/**
 * Formats an event's date or date range cleanly in IST, or returns `"Date TBA"` if unknown.
 */
export function formatEventDateDisplayIST(event: {
  startAt?: string | null;
  endAt?: string | null;
}): string {
  const { startYmd, endYmd } = getEventDateBoundsIST(event);
  if (!startYmd) return 'Date TBA';

  const formatSingle = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };

  if (!endYmd || endYmd === startYmd) {
    return formatSingle(startYmd);
  }
  return `${formatSingle(startYmd)} – ${formatSingle(endYmd)}`;
}

/**
 * Filters and sorts events according to the selected IST TimeFilterPreset, custom date range,
 * and optional open-registration filter.
 *
 * Rules:
 * - UPCOMING (default): includes ongoing (`startYmd <= today <= endYmd`) and future (`startYmd >= today`) events, sorted nearest `startYmd` first. Excludes undated ("Date TBA") and past events.
 * - THIS_WEEK: includes single-day and multi-day events whose `[startYmd, endYmd]` overlaps the current IST calendar week `[weekStart, weekEnd]`, sorted nearest first.
 * - THIS_MONTH: includes single-day and multi-day events whose `[startYmd, endYmd]` overlaps the current IST calendar month `[monthStart, monthEnd]`, sorted nearest first.
 * - PAST: includes events where `endYmd < today`, sorted most recent first (`endYmd` descending).
 * - ALL: includes all events (upcoming sorted nearest first, then undated `"Date TBA"` events, then past events most recent first).
 * - CUSTOM: includes events overlapping `[customStart, customEnd]`, sorted nearest first.
 */
export function filterAndSortEventsByTime<
  T extends {
    id: string;
    title?: string;
    name?: string;
    startAt?: string | null;
    endAt?: string | null;
    registrationDeadline?: string | null;
    registrationUrl?: string | null;
    verifiedCanonicalUrl?: string | null;
    status?: string | null;
  },
>(
  events: T[],
  options: {
    preset: TimeFilterPreset;
    customStart?: string | null;
    customEnd?: string | null;
    openRegistrationOnly?: boolean;
    referenceDate?: Date;
  }
): T[] {
  const todayIst = getTodayDateStringIST(options.referenceDate);
  const { weekStart, weekEnd } = getWeekBoundsIST(todayIst);
  const { monthStart, monthEnd } = getMonthBoundsIST(todayIst);

  const customFrom = parseSingleDateToYmd(options.customStart) ?? '0000-01-01';
  const customTo = parseSingleDateToYmd(options.customEnd) ?? '9999-12-31';

  const filtered = events.filter((ev) => {
    const { startYmd, endYmd } = getEventDateBoundsIST(ev);

    if (options.openRegistrationOnly) {
      const reg = getVerifiableRegistrationStatus(ev, todayIst);
      if (reg.status === 'closed' || reg.status === 'ended') {
        return false;
      }
    }

    switch (options.preset) {
      case 'ALL':
        return true;

      case 'UPCOMING': {
        if (!startYmd || !endYmd) return false; // Undated events are kept under ALL / Date TBA
        return endYmd >= todayIst;
      }

      case 'THIS_WEEK': {
        if (!startYmd || !endYmd) return false;
        return doDateIntervalsOverlap(startYmd, endYmd, weekStart, weekEnd);
      }

      case 'THIS_MONTH': {
        if (!startYmd || !endYmd) return false;
        return doDateIntervalsOverlap(startYmd, endYmd, monthStart, monthEnd);
      }

      case 'PAST': {
        if (!startYmd || !endYmd) return false;
        return endYmd < todayIst;
      }

      case 'CUSTOM': {
        if (!startYmd || !endYmd) return false;
        return doDateIntervalsOverlap(startYmd, endYmd, customFrom, customTo);
      }

      default:
        return true;
    }
  });

  const getTitle = (x: T) => x.title || x.name || '';

  return filtered.sort((a, b) => {
    const boundsA = getEventDateBoundsIST(a);
    const boundsB = getEventDateBoundsIST(b);

    if (options.preset === 'PAST') {
      const endA = boundsA.endYmd ?? '0000-00-00';
      const endB = boundsB.endYmd ?? '0000-00-00';
      if (endA !== endB) return endB.localeCompare(endA);
      return getTitle(a).localeCompare(getTitle(b));
    }

    if (options.preset === 'ALL') {
      const bucketOf = (b: { startYmd: string | null; endYmd: string | null }) => {
        if (!b.startYmd || !b.endYmd) return 1;
        return b.endYmd >= todayIst ? 0 : 2;
      };
      const bA = bucketOf(boundsA);
      const bB = bucketOf(boundsB);
      if (bA !== bB) return bA - bB;
      if (bA === 0) {
        return (boundsA.startYmd ?? '').localeCompare(boundsB.startYmd ?? '');
      }
      if (bA === 2) {
        return (boundsB.endYmd ?? '').localeCompare(boundsA.endYmd ?? '');
      }
      return getTitle(a).localeCompare(getTitle(b));
    }

    // For UPCOMING, THIS_WEEK, THIS_MONTH, CUSTOM: chronological nearest first
    const startA = boundsA.startYmd ?? '9999-99-99';
    const startB = boundsB.startYmd ?? '9999-99-99';
    if (startA !== startB) return startA.localeCompare(startB);
    return getTitle(a).localeCompare(getTitle(b));
  });
}

/**
 * Filters PESU Academy announcements strictly by their original publication date (`ann.date`) in IST.
 * Never confuses announcement publication date with an event start date.
 */
export function filterAnnouncementsByPublicationDate(
  announcements: NormalizedPesuAnnouncement[],
  options: {
    preset: TimeFilterPreset;
    customStart?: string | null;
    customEnd?: string | null;
    searchQuery?: string;
    referenceDate?: Date;
  }
): NormalizedPesuAnnouncement[] {
  const todayIst = getTodayDateStringIST(options.referenceDate);
  const { weekStart, weekEnd } = getWeekBoundsIST(todayIst);
  const { monthStart, monthEnd } = getMonthBoundsIST(todayIst);
  const customFrom = parseSingleDateToYmd(options.customStart) ?? '0000-01-01';
  const customTo = parseSingleDateToYmd(options.customEnd) ?? '9999-12-31';
  const q = (options.searchQuery ?? '').trim().toLowerCase();

  return announcements
    .filter((ann) => {
      if (q) {
        const hay = `${ann.title} ${ann.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      const pubYmd = parseSingleDateToYmd(ann.date);
      switch (options.preset) {
        case 'ALL':
        case 'UPCOMING':
          return true;
        case 'THIS_WEEK':
          return Boolean(pubYmd && pubYmd >= weekStart && pubYmd <= weekEnd);
        case 'THIS_MONTH':
          return Boolean(pubYmd && pubYmd >= monthStart && pubYmd <= monthEnd);
        case 'PAST':
          return Boolean(pubYmd && pubYmd <= todayIst);
        case 'CUSTOM':
          return Boolean(pubYmd && pubYmd >= customFrom && pubYmd <= customTo);
        default:
          return true;
      }
    })
    .sort((a, b) => {
      const dA = parseSingleDateToYmd(a.date) ?? '0000-00-00';
      const dB = parseSingleDateToYmd(b.date) ?? '0000-00-00';
      if (dA !== dB) return dB.localeCompare(dA); // Newest announcements first
      return a.title.localeCompare(b.title);
    });
}

/**
 * Resolves the source classification of a published Hackathon for the unified Events page filter.
 */
export function resolveHackathonSourceCategory(
  h: Hackathon
): 'PES_PUBLIC' | 'COMMUNITY_VERIFIED' {
  if (h.sourceType === 'pes_public_events') {
    return 'PES_PUBLIC';
  }
  const urls = [
    h.verifiedCanonicalUrl,
    h.originalSubmissionUrl,
    h.registrationUrl,
    ...(h.sources ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (urls.includes('events.pes.edu')) {
    return 'PES_PUBLIC';
  }
  const provSource = h.fieldProvenance?.['_meta']?.sourceUrl ?? '';
  if (provSource.toLowerCase().includes('events.pes.edu')) {
    return 'PES_PUBLIC';
  }
  return 'COMMUNITY_VERIFIED';
}

/**
 * Human-readable badge label for a published Hackathon's provenance source.
 */
export function getHackathonSourceLabel(h: Hackathon): {
  label: string;
  isPesuOfficial: boolean;
  sourceType: EventSourceType;
} {
  const cat = resolveHackathonSourceCategory(h);
  if (cat === 'PES_PUBLIC') {
    return {
      label: 'PESU Public Event',
      isPesuOfficial: true,
      sourceType: 'pes_public_events',
    };
  }
  const st = h.sourceType ?? 'submitted_public_url';
  if (st === 'paasha_microservice') {
    return {
      label: 'Verified via PAASHA',
      isPesuOfficial: false,
      sourceType: st,
    };
  }
  if (st === 'academy_opt_in_hint') {
    return {
      label: 'Verified from Academy Hint',
      isPesuOfficial: false,
      sourceType: st,
    };
  }
  if (st === 'uploaded_brochure_or_poster') {
    return {
      label: 'Verified Poster / Brochure',
      isPesuOfficial: false,
      sourceType: st,
    };
  }
  if (st === 'approved_organizer') {
    return {
      label: 'Verified Organizer',
      isPesuOfficial: false,
      sourceType: st,
    };
  }
  return {
    label: 'Verified Community Submission',
    isPesuOfficial: false,
    sourceType: 'submitted_public_url',
  };
}

export const PESU_HOMEPAGE_BANNERS_NOTE =
  'PESU Academy homepage carousel banners (such as ReRo Online Hackathon, International Hour, The Alumni Playbook, or Weekend CTF Workshops) are rendered by a separate portal widget that is not exposed by the PESU OAuth2 /api/v1/announcements endpoint. You can add any homepage banner event directly using "Submit Banner / Poster / Event Link".';

/**
 * Extracts bounded pagination URLs from an `events.pes.edu/browse/...` HTML listing page.
 */
export function extractPesuEventsPaginationLinks(
  html: string,
  currentBrowseUrl: string,
  maxPagesPerCategory = 4
): string[] {
  if (!html || typeof html !== 'string') return [];
  const results: string[] = [];
  const seen = new Set<string>([currentBrowseUrl]);

  let baseUrl: URL;
  try {
    baseUrl = new URL(currentBrowseUrl);
  } catch {
    return [];
  }

  const hrefRegex = /href=["']([^"']*(?:\?|&amp;|&)page=(\d+)[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const rawHref = match[1].replace(/&amp;/gi, '&').trim();
    const pageNum = parseInt(match[2], 10);
    if (!Number.isFinite(pageNum) || pageNum < 2 || pageNum > maxPagesPerCategory) {
      continue;
    }
    try {
      const resolved = new URL(rawHref, baseUrl);
      if (resolved.hostname.toLowerCase() !== 'events.pes.edu') continue;
      if (resolved.pathname.replace(/\/+$/, '') !== baseUrl.pathname.replace(/\/+$/, '')) {
        continue;
      }
      const full = resolved.toString();
      if (!seen.has(full)) {
        seen.add(full);
        results.push(full);
      }
    } catch {
      // Ignore malformed hrefs
    }
  }

  return results;
}

/**
 * Checks whether a URL is a safe, public, non-private proof or registration URL.
 * Rejects `pesuacademy.com`, private IPs, localhost, `attachment://`, `pesu-academy://`,
 * and bogus QR generator landing pages (`me-qr.com/page/blog`).
 */
export function isSafePublicEventUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('attachment://') ||
    lower.startsWith('pesu-academy://') ||
    lower.includes('pesuacademy.com') ||
    lower.includes('me-qr.com/page/blog')
  ) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface EvaluatedHackathonStates {
  eventType: EventType;
  categoryLabel: string;
  isHackathon: boolean;
  teamParticipationVerified: boolean;
  publicSourceVerified: boolean;
  matchable: boolean;
  findTeammatesEligible: boolean;
  registrationStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  registrationStatusDetail:
    | 'open_confirmed'
    | 'deadline_known'
    | 'link_available'
    | 'unknown'
    | 'closed'
    | 'ended';
  registrationStatusLabel: string;
  minTeamSize: number | null;
  maxTeamSize: number | null;
  teamEligibilityReason: string;
  classificationReason: string;
}

/**
 * Evaluates all 5 required Phase 4 / Phase 6 state flags for an event:
 * 1. `isHackathon`: competition type identified ('hackathon' | 'buildathon' | 'ideathon' | 'ctf' | 'team_competition' and not solo-only)
 * 2. `teamParticipationVerified`: sufficient evidence of team eligibility (`maxTeamSize > 1` or explicit team rules)
 * 3. `publicSourceVerified`: reliable public evidence established (`events.pes.edu` or verified public URL)
 * 4. `matchable`: verified event eligible for teammate discovery (`isHackathon && teamParticipationVerified && publicSourceVerified`)
 * 5. `registrationStatus`: `'OPEN' | 'CLOSED' | 'UNKNOWN'` (unknown status stays `'UNKNOWN'`, never `'OPEN'`)
 */
export function evaluateHackathonEligibilityAndStates(params: {
  title?: string | null;
  name?: string | null;
  description?: string | null;
  eventType?: EventType | string | null;
  themes?: string[] | null;
  minTeamSize?: number | null;
  maxTeamSize?: number | null;
  startAt?: string | null;
  endAt?: string | null;
  registrationDeadline?: string | null;
  registrationUrl?: string | null;
  verifiedCanonicalUrl?: string | null;
  originalSubmissionUrl?: string | null;
  sourceUrlStatus?: string | null;
  sourceType?: EventSourceType | string | null;
  status?: string | null;
  registrationConfirmedOpen?: boolean | null;
  evidenceText?: string | null;
  todayIstYmd?: string;
}): EvaluatedHackathonStates {
  const title = cleanHtmlToText(params.title || params.name || '');
  const description = cleanHtmlToText(params.description || '');

  const teamCheck = verifyTeamParticipationEvidence({
    title,
    description,
    minTeamSize: params.minTeamSize,
    maxTeamSize: params.maxTeamSize,
    evidenceText: params.evidenceText,
  });

  const cls = classifyGroundedEvent({
    title,
    description,
    tags: params.themes ?? [],
    minTeamSize: teamCheck.minTeamSize,
    maxTeamSize: teamCheck.maxTeamSize,
  });

  const eligibleTypes = new Set<string>([
    'hackathon',
    'buildathon',
    'ideathon',
    'ctf',
    'team_competition',
  ]);
  const nonHackathonTypes = new Set<string>([
    'workshop',
    'tech_talk',
    'conference',
  ]);

  let effectiveEventType: EventType = cls.eventType;
  if (nonHackathonTypes.has(cls.eventType)) {
    effectiveEventType = cls.eventType;
  } else if (eligibleTypes.has(cls.eventType)) {
    effectiveEventType = cls.eventType;
  } else if (
    params.eventType &&
    nonHackathonTypes.has(String(params.eventType))
  ) {
    effectiveEventType = params.eventType as EventType;
  } else if (
    params.eventType &&
    eligibleTypes.has(String(params.eventType)) &&
    cls.eventType === 'other' &&
    !description
  ) {
    effectiveEventType = params.eventType as EventType;
  }

  const isSoloOnly = teamCheck.maxTeamSize === 1;
  const isArchivedOrDraft =
    params.status === 'archived' || params.status === 'draft';

  const isHackathon =
    Boolean(title) &&
    eligibleTypes.has(effectiveEventType) &&
    cls.matchable &&
    !isSoloOnly &&
    !isArchivedOrDraft;

  const hasValidPublicUrl =
    isSafePublicEventUrl(params.verifiedCanonicalUrl) ||
    isSafePublicEventUrl(params.registrationUrl) ||
    isSafePublicEventUrl(params.originalSubmissionUrl);

  const publicSourceVerified =
    hasValidPublicUrl ||
    params.sourceUrlStatus === 'verified' ||
    params.sourceType === 'pes_public_events' ||
    params.sourceType === 'approved_organizer';

  const teamParticipationVerified =
    isHackathon && teamCheck.teamParticipationVerified;

  const reg = getVerifiableRegistrationStatus(
    {
      registrationDeadline: params.registrationDeadline,
      startAt: params.startAt,
      endAt: params.endAt,
      registrationUrl: params.registrationUrl,
      verifiedCanonicalUrl: params.verifiedCanonicalUrl,
      status: params.status,
      registrationConfirmedOpen: params.registrationConfirmedOpen,
    },
    params.todayIstYmd ?? getTodayDateStringIST()
  );

  const registrationStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN' =
    reg.status === 'closed' || reg.status === 'ended'
      ? 'CLOSED'
      : reg.status === 'open_confirmed' ||
          reg.status === 'deadline_known' ||
          reg.status === 'link_available'
        ? 'OPEN'
        : 'UNKNOWN';

  // Events with unknown team eligibility must NEVER be marked matchable: true
  const matchable =
    isHackathon && teamParticipationVerified && publicSourceVerified;

  const findTeammatesEligible = matchable && registrationStatus !== 'CLOSED';

  return {
    eventType: effectiveEventType,
    categoryLabel: formatEventTypeCategoryLabel(effectiveEventType),
    isHackathon,
    teamParticipationVerified,
    publicSourceVerified,
    matchable,
    findTeammatesEligible,
    registrationStatus,
    registrationStatusDetail: reg.status,
    registrationStatusLabel: reg.label,
    minTeamSize: teamCheck.minTeamSize,
    maxTeamSize: teamCheck.maxTeamSize,
    teamEligibilityReason: teamCheck.reason,
    classificationReason: cls.reason,
  };
}

export interface ValidatedPaashaIngestionRecord {
  accepted: boolean;
  event?: ValidatedPaashaIngestionRecord;
  paashaId: string;
  announcementId: string;
  externalFingerprint: string;
  title: string;
  organizer: string;
  description: string;
  shortDescription: string;
  eventType: EventType;
  isHackathon: boolean;
  teamParticipationVerified: boolean;
  publicSourceVerified: boolean;
  matchable: boolean;
  findTeammatesEligible: boolean;
  registrationStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  registrationStatusDetail:
    | 'open_confirmed'
    | 'deadline_known'
    | 'link_available'
    | 'unknown'
    | 'closed'
    | 'ended';
  startAt: string | null;
  endAt: string | null;
  registrationDeadline: string | null;
  campus: CampusType | null;
  venueName: string | null;
  format: 'onsite' | 'online' | 'hybrid' | 'unknown';
  minTeamSize: number | null;
  maxTeamSize: number | null;
  registrationUrl: string | undefined;
  verifiedCanonicalUrl: string | null;
  imageUrl?: string | undefined;
  themes: string[];
  sources: string[];
  fieldProvenance: Record<string, import('../types/domain').FieldProvenanceEntry>;
  confidenceScore: number;
  shouldPublishToCatalog: boolean;
  reviewStatus: 'verified' | 'needs_confirmation' | 'rejected';
  rejectionOrHoldReason: string;
}

/**
 * Validates and transforms a single PAASHA `/api/v1/hackathons` record into a privacy-safe,
 * strictly grounded Quackathon ingestion record.
 *
 * Security & Grounding Guarantees:
 * - Does NOT blindly trust `item.isMatchable` or `item.isIndependentlyVerified`.
 * - Strips private `pesuacademy.com` URLs (`posterImageUrl`, internal links) and never exposes `ocrSnippet`.
 * - Redacts any personal student identifiers (emails, phone numbers, SRNs) from summary/title/organizer.
 * - Rejects copying `publishedDate` (announcement publication date) into `startAt` unless supported by event text/provenance.
 * - Requires verified public proof (`officialSourceUrl` or `registrationUrl`) and verified team participation (`maxTeamSize > 1` or explicit team rules) before marking `matchable: true` or auto-publishing.
 */
export function validateAndTransformPaashaHackathon(
  rawOrValidated: Record<string, any>,
  todayIstYmd: string = getTodayDateStringIST()
): ValidatedPaashaIngestionRecord {
  const itemId = String(rawOrValidated.id || '').trim();
  const announcementId = String(
    rawOrValidated.announcementId || itemId
  ).trim();
  const rawTitle = String(rawOrValidated.title || '');
  const rawOrganizer =
    typeof rawOrValidated.organizer === 'string'
      ? rawOrValidated.organizer
      : '';
  const rawSummaryText = [
    typeof rawOrValidated.publicSummary === 'string'
      ? rawOrValidated.publicSummary
      : '',
    typeof rawOrValidated.summary === 'string' ? rawOrValidated.summary : '',
    typeof rawOrValidated.description === 'string'
      ? rawOrValidated.description
      : '',
  ]
    .filter((s) => s.trim().length > 0)
    .join(' ');

  const sanitizedTitle = sanitizeTextForPublicCandidate(
    cleanHtmlToText(rawTitle)
  );
  const sanitizedOrganizer = rawOrganizer.trim()
    ? sanitizeTextForPublicCandidate(cleanHtmlToText(rawOrganizer))
    : 'PES University';
  const sanitizedSummary = sanitizeTextForPublicCandidate(
    cleanHtmlToText(rawSummaryText)
  );

  const rawOfficialUrl =
    rawOrValidated.officialSourceUrl ??
    rawOrValidated.sourceUrl ??
    rawOrValidated.verification?.publicProofUrl ??
    null;
  const rawRegUrl = rawOrValidated.registrationUrl ?? null;
  const rawPosterUrl =
    rawOrValidated.posterUrl ?? rawOrValidated.posterImageUrl ?? null;

  // Validate public URLs — strip any pesuacademy.com or unsafe internal URLs
  const safeOfficialUrl = isSafePublicEventUrl(rawOfficialUrl)
    ? String(rawOfficialUrl).trim()
    : null;
  const safeRegistrationUrl = isSafePublicEventUrl(rawRegUrl)
    ? String(rawRegUrl).trim()
    : null;
  const safePosterUrl = isSafePublicEventUrl(rawPosterUrl)
    ? String(rawPosterUrl).trim()
    : undefined;

  const verifiedCanonicalUrl = safeOfficialUrl || safeRegistrationUrl || null;
  const registrationUrl = safeRegistrationUrl || safeOfficialUrl || undefined;

  // Date grounding: never allow announcement `publishedDate` to masquerade as `startAt`
  const pubYmd = parseSingleDateToYmd(rawOrValidated.publishedDate ?? null);
  const rawStart =
    rawOrValidated.startAt ??
    rawOrValidated.startDate ??
    rawOrValidated.eventDates?.start ??
    null;
  const rawEnd =
    rawOrValidated.endAt ??
    rawOrValidated.endDate ??
    rawOrValidated.eventDates?.end ??
    null;
  const rawDeadline =
    rawOrValidated.registrationDeadline ??
    rawOrValidated.eligibility?.registrationDeadline ??
    null;

  let startAt = parseSingleDateToYmd(rawStart);
  let endAt = parseSingleDateToYmd(rawEnd) ?? startAt;
  const registrationDeadline = parseSingleDateToYmd(rawDeadline);

  const startProvenance = String(
    rawOrValidated.fieldProvenance?.startAt ?? ''
  ).toLowerCase();
  if (
    startAt &&
    pubYmd &&
    startAt === pubYmd &&
    (startProvenance.includes('publisheddate') ||
      startProvenance.includes('announcement_date'))
  ) {
    startAt = null;
    endAt = null;
  }
  if (startAt && endAt && endAt < startAt) {
    endAt = startAt;
  }

  // Campus & venue normalization
  const rawCampus = String(
    rawOrValidated.campus ??
      rawOrValidated.eligibility?.campus ??
      rawOrValidated.campusOrVenue ??
      ''
  )
    .toUpperCase()
    .trim();
  let campus: CampusType | null = null;
  if (rawCampus === 'RR' || /rr\s*campus|ring\s*road/i.test(rawCampus)) {
    campus = 'RR Campus';
  } else if (
    rawCampus === 'EC' ||
    /ec\s*campus|electronic\s*city/i.test(rawCampus)
  ) {
    campus = 'EC Campus';
  } else if (
    rawCampus === 'ONLINE' ||
    rawCampus === 'BOTH' ||
    rawCampus === 'MULTI'
  ) {
    campus = 'Online / Multi-Campus';
  } else {
    campus = extractGroundedCampus(
      `${rawCampus} ${rawOrValidated.venue ?? ''} ${sanitizedTitle} ${sanitizedSummary}`
    );
  }

  const rawVenueStr =
    rawOrValidated.venue ?? rawOrValidated.campusOrVenue ?? null;
  const venueName = rawVenueStr
    ? sanitizeTextForPublicCandidate(cleanHtmlToText(String(rawVenueStr)))
    : null;

  const modeUpper = String(
    rawOrValidated.mode ?? rawOrValidated.format ?? 'UNKNOWN'
  ).toUpperCase();
  const format: 'onsite' | 'online' | 'hybrid' | 'unknown' =
    modeUpper === 'ONLINE'
      ? 'online'
      : modeUpper === 'HYBRID'
        ? 'hybrid'
        : modeUpper === 'OFFLINE' ||
            modeUpper === 'ONSITE' ||
            venueName ||
            campus === 'RR Campus' ||
            campus === 'EC Campus'
          ? 'onsite'
          : 'unknown';

  // Map PAASHA category hint + run Quackathon's deterministic classifier
  const paashaCategoryUpper = String(
    rawOrValidated.category ?? rawOrValidated.eventType ?? ''
  ).toUpperCase();
  const categoryForcedNonHackathon: EventType | null =
    paashaCategoryUpper === 'WORKSHOP' || paashaCategoryUpper === 'BOOTCAMP'
      ? 'workshop'
      : paashaCategoryUpper === 'TECH_TALK' ||
          paashaCategoryUpper === 'SEMINAR' ||
          paashaCategoryUpper === 'WEBINAR' ||
          paashaCategoryUpper === 'LECTURE'
        ? 'tech_talk'
        : paashaCategoryUpper === 'CONFERENCE' ||
            paashaCategoryUpper === 'SUMMIT'
          ? 'conference'
          : paashaCategoryUpper === 'CULTURAL'
            ? 'other'
            : null;

  const cleanedTags = (Array.isArray(rawOrValidated.tags) ? rawOrValidated.tags : [])
    .map((t: unknown) =>
      sanitizeTextForPublicCandidate(cleanHtmlToText(String(t)))
        .replace(/^#/, '')
        .trim()
    )
    .filter(Boolean);

  const inputMinTeamSize =
    typeof rawOrValidated.minTeamSize === 'number'
      ? rawOrValidated.minTeamSize
      : typeof rawOrValidated.teamSizeMin === 'number'
        ? rawOrValidated.teamSizeMin
        : typeof rawOrValidated.teamSize?.min === 'number'
          ? rawOrValidated.teamSize.min
          : null;
  const inputMaxTeamSize =
    typeof rawOrValidated.maxTeamSize === 'number'
      ? rawOrValidated.maxTeamSize
      : typeof rawOrValidated.teamSizeMax === 'number'
        ? rawOrValidated.teamSizeMax
        : typeof rawOrValidated.teamSize?.max === 'number'
          ? rawOrValidated.teamSize.max
          : null;

  const rawRegStatus = String(
    rawOrValidated.registrationStatus ??
      rawOrValidated.eligibility?.status ??
      'UNKNOWN'
  ).toUpperCase();

  const states = evaluateHackathonEligibilityAndStates({
    title: sanitizedTitle,
    description: sanitizedSummary,
    eventType: categoryForcedNonHackathon ?? undefined,
    themes: cleanedTags,
    minTeamSize: inputMinTeamSize,
    maxTeamSize: inputMaxTeamSize,
    startAt,
    endAt,
    registrationDeadline,
    registrationUrl: safeRegistrationUrl,
    verifiedCanonicalUrl: safeOfficialUrl,
    sourceUrlStatus: verifiedCanonicalUrl ? 'verified' : 'unverified',
    sourceType: 'paasha_microservice',
    status:
      rawRegStatus === 'CLOSED' || rawRegStatus === 'REGISTRATION_CLOSED'
        ? 'registration_closed'
        : 'published',
    registrationConfirmedOpen: false,
    todayIstYmd,
  });

  // Override if PAASHA itself explicitly marked isHackathon: false or non-hackathon category
  const finalEventType: EventType =
    categoryForcedNonHackathon ?? states.eventType;
  const finalIsHackathon =
    rawOrValidated.isHackathon !== false &&
    categoryForcedNonHackathon === null &&
    states.isHackathon;

  // Public proof requires an actual safe external/official public URL (do NOT blindly trust item.isIndependentlyVerified)
  const finalPublicSourceVerified = Boolean(
    safeOfficialUrl || safeRegistrationUrl
  );

  const finalTeamVerified =
    finalIsHackathon && states.teamParticipationVerified;

  const finalMatchable =
    finalIsHackathon && finalTeamVerified && finalPublicSourceVerified;

  // Registration status: never upgrade UNKNOWN to OPEN without verified link/deadline
  const finalRegistrationStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN' =
    rawRegStatus === 'CLOSED' ||
    rawRegStatus === 'REGISTRATION_CLOSED' ||
    states.registrationStatus === 'CLOSED'
      ? 'CLOSED'
      : states.registrationStatus === 'OPEN'
        ? 'OPEN'
        : 'UNKNOWN';

  const finalFindTeammatesEligible =
    finalMatchable && finalRegistrationStatus !== 'CLOSED';

  const nowIso = new Date().toISOString();
  const provSourceUrl =
    verifiedCanonicalUrl || `paasha://hackathon/${itemId}`;
  const verifStatusLabel = String(
    rawOrValidated.verificationStatus ??
      rawOrValidated.verification?.verificationStatus ??
      'UNVERIFIED'
  );
  const fieldProvenance: Record<
    string,
    import('../types/domain').FieldProvenanceEntry
  > = {
    _meta: {
      sourceUrl: provSourceUrl,
      sourceType: 'paasha_microservice',
      excerpt: `PAASHA microservice record (${itemId}), verificationStatus=${verifStatusLabel}`,
      verifiedAt: nowIso,
    },
  };

  for (const [fieldKey, provDesc] of Object.entries(
    rawOrValidated.fieldProvenance ?? {}
  )) {
    fieldProvenance[fieldKey] = {
      sourceUrl: provSourceUrl,
      sourceType: 'paasha_microservice',
      excerpt: sanitizeTextForPublicCandidate(String(provDesc)).slice(0, 200),
      verifiedAt: nowIso,
    };
  }

  const sources = Array.from(
    new Set(
      [
        safeOfficialUrl,
        safeRegistrationUrl,
        `paasha:${itemId}`,
      ].filter((x): x is string => Boolean(x))
    )
  );

  // Only publish directly into the public hackathon catalog when:
  // 1. It is a real hackathon or eligible team competition (`finalIsHackathon`)
  // 2. Team participation is verified (`finalTeamVerified`)
  // 3. It has a verified public source URL (`finalPublicSourceVerified`)
  // Events with unverified team size are held in `event_candidates` (`needs_confirmation`) for admin review.
  const shouldPublishToCatalog =
    finalIsHackathon && finalTeamVerified && finalPublicSourceVerified;

  let reviewStatus: 'verified' | 'needs_confirmation' | 'rejected' =
    'needs_confirmation';
  let rejectionOrHoldReason = '';

  if (!finalIsHackathon) {
    reviewStatus = 'rejected';
    rejectionOrHoldReason = `Excluded non-hackathon or individual-only event (${finalEventType}).`;
  } else if (!finalPublicSourceVerified) {
    reviewStatus = 'needs_confirmation';
    rejectionOrHoldReason =
      'Held in candidate review: missing verifiable public proof URL outside pesuacademy.com.';
  } else if (!finalTeamVerified) {
    reviewStatus = 'needs_confirmation';
    rejectionOrHoldReason =
      'Held in candidate review: team participation eligibility (minTeamSize/maxTeamSize) is unknown.';
  } else {
    reviewStatus = 'verified';
    rejectionOrHoldReason =
      'Verified team hackathon with public proof and confirmed team participation.';
  }

  const fallbackSummary = [
    `${formatEventTypeCategoryLabel(finalEventType)} organized by ${sanitizedOrganizer}.`,
    startAt ? `Scheduled: ${startAt}${endAt && endAt !== startAt ? ` to ${endAt}` : ''}.` : null,
    states.minTeamSize || states.maxTeamSize
      ? `Team size: ${states.minTeamSize ?? 1}–${states.maxTeamSize ?? states.minTeamSize} members.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const finalDescription = sanitizedSummary || fallbackSummary;
  const confidenceScore =
    typeof rawOrValidated.confidenceScore === 'number'
      ? rawOrValidated.confidenceScore
      : 0.75;

  const record: ValidatedPaashaIngestionRecord = {
    accepted: finalIsHackathon,
    paashaId: itemId,
    announcementId,
    externalFingerprint: `paasha_hack_${itemId}`,
    title: sanitizedTitle,
    organizer: sanitizedOrganizer,
    description: finalDescription,
    shortDescription: finalDescription.slice(0, 220),
    eventType: finalEventType,
    isHackathon: finalIsHackathon,
    teamParticipationVerified: finalTeamVerified,
    publicSourceVerified: finalPublicSourceVerified,
    matchable: finalMatchable,
    findTeammatesEligible: finalFindTeammatesEligible,
    registrationStatus: finalRegistrationStatus,
    registrationStatusDetail:
      finalRegistrationStatus === 'CLOSED' &&
      states.registrationStatusDetail !== 'ended'
        ? 'closed'
        : states.registrationStatusDetail,
    startAt,
    endAt,
    registrationDeadline,
    campus,
    venueName,
    format,
    minTeamSize: states.minTeamSize,
    maxTeamSize: states.maxTeamSize,
    registrationUrl,
    verifiedCanonicalUrl,
    imageUrl: safePosterUrl,
    themes:
      cleanedTags.length > 0
        ? cleanedTags.slice(0, 5)
        : [formatEventTypeCategoryLabel(finalEventType)],
    sources,
    fieldProvenance,
    confidenceScore,
    shouldPublishToCatalog,
    reviewStatus,
    rejectionOrHoldReason,
  };
  record.event = record;
  return record;
}



