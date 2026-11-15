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
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
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
 * Extracts explicit team size bounds from text if stated (e.g., "teams of 2 to 4", "team size: 3-4").
 */
export function extractGroundedTeamSize(text: string): {
  min: number | null;
  max: number | null;
  excerpt: string | null;
} {
  const rangeMatch = text.match(
    /(?:teams?\s+of|team\s+size\s*(?:of|:)?|group\s+of)\s*(\d)\s*(?:to|-|–|—)\s*(\d)\s*(?:members|students|participants|builders|people)?/i
  );
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10);
    const b = parseInt(rangeMatch[2], 10);
    if (a >= 1 && b >= a && b <= 10) {
      return { min: a, max: b, excerpt: rangeMatch[0].trim() };
    }
  }

  const upToMatch = text.match(
    /(?:up\s+to|maximum\s+of|max\s+team\s+size\s*(?:of|:)?)\s*(\d)\s*(?:members|students|participants)/i
  );
  if (upToMatch) {
    const max = parseInt(upToMatch[1], 10);
    if (max >= 1 && max <= 10) {
      const min = /\b(solo|individual)\b/i.test(text) ? 1 : null;
      return { min, max, excerpt: upToMatch[0].trim() };
    }
  }

  if (/\b(solo\s+only|individual\s+participation\s+only)\b/i.test(text)) {
    return { min: 1, max: 1, excerpt: 'Individual participation only' };
  }

  return { min: null, max: null, excerpt: null };
}

/**
 * Strict Event Classification using tags, title, and description.
 * Never presents workshops, talks, info sessions, or ordinary announcements as hackathons.
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
  const tagText = (params.tags ?? []).join(' ').toLowerCase();
  const titleLower = params.title.toLowerCase();
  const combined = `${params.title} ${params.description} ${tagText}`.toLowerCase();

  // Explicit Hackathon / Ideathon / Buildathon / CTF signal
  const hasExplicitHackathonTag = (params.tags ?? []).some((t) =>
    /^(#?hackathon|#?ideathon|#?buildathon|#?ctf|#?codesprint)$/i.test(t.trim())
  );
  const hasHackathonTitleOrBody =
    /\b(hackathon|hack-a-thon|ideathon|buildathon|capture the flag|\bctf\b|24-hour\s+hack|36-hour\s+hack|48-hour\s+hack|code\s+sprint|coding\s+sprint)\b/i.test(
      combined
    );

  // Explicit Talk / InfoSession / Seminar / Workshop signal
  const hasTalkTag = (params.tags ?? []).some((t) =>
    /^(#?talks?|#?infosession|#?seminar|#?webinar|#?keynote|#?lecture)$/i.test(
      t.trim()
    )
  );
  const hasWorkshopTag = (params.tags ?? []).some((t) =>
    /^(#?workshops?|#?bootcamp|#?handson)$/i.test(t.trim())
  );

  const isExplicitTalkInTitle =
    /\b(expert\s+talk|guest\s+lecture|tech\s+talk|info\s*session|webinar|seminar|keynote|panel\s+discussion|orientation)\b/i.test(
      titleLower
    );
  const isExplicitWorkshopInTitle =
    /\b(workshop|hands-on\s+session|masterclass|bootcamp|training\s+session)\b/i.test(
      titleLower
    );

  if (
    (hasTalkTag || isExplicitTalkInTitle) &&
    !hasExplicitHackathonTag &&
    !/\b(hackathon|ideathon|buildathon)\b/i.test(titleLower)
  ) {
    return {
      eventType: 'tech_talk',
      matchable: false,
      reason:
        'Classified as Tech Talk / Info Session from source tags or title; excluded from team matching.',
    };
  }

  if (
    (hasWorkshopTag || isExplicitWorkshopInTitle) &&
    !hasExplicitHackathonTag &&
    !/\b(hackathon|ideathon|buildathon)\b/i.test(titleLower)
  ) {
    return {
      eventType: 'workshop',
      matchable: false,
      reason:
        'Classified as Workshop / Bootcamp from source tags or title; excluded from team matching.',
    };
  }

  if (/\b(capture the flag|\bctf\b)\b/i.test(combined)) {
    const soloOnly = params.maxTeamSize === 1;
    return {
      eventType: 'ctf',
      matchable: !soloOnly,
      reason: soloOnly
        ? 'Solo CTF competition (maxTeamSize = 1).'
        : 'Verified CTF security competition.',
    };
  }

  if (/\bideathon\b/i.test(combined)) {
    return {
      eventType: 'ideathon',
      matchable: params.maxTeamSize !== 1,
      reason: 'Verified Ideathon competition.',
    };
  }

  if (/\bbuildathon\b/i.test(combined)) {
    return {
      eventType: 'buildathon',
      matchable: params.maxTeamSize !== 1,
      reason: 'Verified Buildathon competition.',
    };
  }

  if (hasExplicitHackathonTag || hasHackathonTitleOrBody) {
    return {
      eventType: 'hackathon',
      matchable: params.maxTeamSize !== 1,
      reason: 'Verified Hackathon with explicit source indicators.',
    };
  }

  if (
    /\b(coding\s+competition|programming\s+contest|team\s+competition|design\s+challenge|case\s+challenge)\b/i.test(
      combined
    )
  ) {
    return {
      eventType: 'team_competition',
      matchable: params.maxTeamSize !== 1,
      reason: 'Team technical competition.',
    };
  }

  if (/\b(workshop|hands-on|bootcamp)\b/i.test(combined)) {
    return {
      eventType: 'workshop',
      matchable: false,
      reason: 'Speaker or hands-on workshop without hackathon competition.',
    };
  }

  if (/\b(talk|lecture|seminar|webinar|keynote|conference)\b/i.test(combined)) {
    return {
      eventType: 'tech_talk',
      matchable: false,
      reason: 'Talk, lecture, or conference session.',
    };
  }

  return {
    eventType: 'unknown',
    matchable: false,
    reason: 'No explicit hackathon, ideathon, buildathon, or CTF keywords found.',
  };
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
    if (!cleanedUrl.toLowerCase().includes('pesuacademy.com')) {
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
      : cls.eventType !== 'unknown'
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
  // without splitting on nested `<div class="ticket-status">` or `<div class="ticket-tags">`
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
    const title = titleMatch ? cleanHtmlToText(titleMatch[1]) : '';
    if (!title) continue;

    // Extract status pill (Upcoming, Live now, Attended/Past)
    let statusLabel: 'Upcoming' | 'Live now' | 'Past' | 'Unknown' = 'Unknown';
    if (/\bstatus-upcoming\b/i.test(seg) || />\s*Upcoming\s*</i.test(seg)) {
      statusLabel = 'Upcoming';
    } else if (/\bstatus-live\b/i.test(seg) || />\s*Live\s+now\s*</i.test(seg)) {
      statusLabel = 'Live now';
    } else if (
      /\bstatus-past\b/i.test(seg) ||
      />\s*(?:Attended|Ended|Past|Completed)\s*</i.test(seg)
    ) {
      statusLabel = 'Past';
    }

    // Extract tags inside `.ticket-tags` or `.tag-pill` or `#Tag` spans
    const tags: string[] = [];
    const tagsBlockMatch = seg.match(
      /<div\s+class="[^"]*(?:ticket-tags|bt-tags|tags)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (tagsBlockMatch) {
      const spanMatches =
        tagsBlockMatch[1].match(/<span[^>]*>([\s\S]*?)<\/span>/gi) ?? [];
      for (const sm of spanMatches) {
        const t = cleanHtmlToText(sm);
        if (t && !tags.includes(t)) tags.push(t);
      }
    }
    // Also collect any `#Tag` pills in the card
    const hashTagMatches = seg.match(/>(#[A-Za-z0-9_-]+)</g) ?? [];
    for (const hm of hashTagMatches) {
      const cleanTag = hm.slice(1, -1).trim();
      if (cleanTag && !tags.includes(cleanTag)) tags.push(cleanTag);
    }

    // Summary paragraph
    const pMatch = seg.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const summary = pMatch ? cleanHtmlToText(pMatch[1]) : '';

    // Extract date and facts from `.ticket-facts` or bold spans
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

  // Title: prefer `.bt-title`, `<h1>`, or `og:title`
  const h1Match =
    html.match(/<h1[^>]*class="[^"]*bt-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
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
    rawTitle = rawTitle.replace(/\s*\|\s*PES\s*Events.*$/i, '').trim();
  }

  // Extract structured `.bt-fact-label` -> `.bt-fact-value` pairs
  const facts: Record<string, string> = {};
  const factBlockRegex =
    /<div[^>]*class="[^"]*bt-fact-label[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="[^"]*bt-fact-value[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let factMatch: RegExpExecArray | null;
  while ((factMatch = factBlockRegex.exec(html)) !== null) {
    const label = cleanHtmlToText(factMatch[1]).toLowerCase();
    const val = cleanHtmlToText(factMatch[2]);
    if (label && val) {
      facts[label] = val;
    }
  }

  // Extract Campus from `.bt-campus-name`
  const campusBlockMatch = html.match(
    /<[^>]*class="[^"]*bt-campus-name[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i
  );
  const campusText = campusBlockMatch ? cleanHtmlToText(campusBlockMatch[1]) : '';

  // Extract Tags
  const tags: string[] = [];
  const tagPillRegex =
    /<(?:span|a)[^>]*class="[^"]*(?:bt-tag|ticket-tag|tag)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|a)>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tagPillRegex.exec(html)) !== null) {
    const t = cleanHtmlToText(tm[1]);
    if (t && !tags.includes(t)) tags.push(t);
  }
  const hashMatches = html.match(/>(#[A-Za-z0-9_-]+)</g) ?? [];
  for (const hm of hashMatches) {
    const cleanTag = hm.slice(1, -1).trim();
    if (cleanTag && !tags.includes(cleanTag)) tags.push(cleanTag);
  }

  // Extract Status
  let statusLabel: 'Upcoming' | 'Live now' | 'Past' | 'Unknown' = 'Unknown';
  if (/>\s*Upcoming\s*</i.test(html)) statusLabel = 'Upcoming';
  else if (/>\s*Live\s+now\s*</i.test(html)) statusLabel = 'Live now';
  else if (/>\s*(?:Attended|Ended|Past)\s*</i.test(html)) statusLabel = 'Past';

  // Extract main event body description from `#eventBody` or `.rich-text`
  const bodyMatch =
    html.match(/<div[^>]*id="eventBody"[^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<div[^>]*class="[^"]*rich-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const ogDescMatch =
    html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    );

  const description = bodyMatch
    ? cleanHtmlToText(bodyMatch[1]).slice(0, 1200)
    : ogDescMatch
      ? cleanHtmlToText(ogDescMatch[1]).slice(0, 600)
      : null;

  // Date range from `facts['date']` or page text
  const dateSource = facts['date'] || facts['event date'] || '';
  const { startAt, endAt } = parseDateRangeFromText(
    dateSource || `${rawTitle ?? ''} ${description ?? ''}`
  );

  const venueName = facts['venue'] || facts['location'] || null;
  const organizer =
    facts['hosted by'] ||
    facts['organized by'] ||
    facts['organizer'] ||
    facts['department'] ||
    null;

  const campus =
    extractGroundedCampus(
      `${campusText} ${venueName ?? ''} ${organizer ?? ''} ${description ?? ''}`
    ) ?? null;

  // Extract external registration link if present
  let registrationUrl: string | null = null;
  const anchorRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRegex.exec(html)) !== null) {
    const href = am[1].trim();
    const anchorText = cleanHtmlToText(am[2]).toLowerCase();
    if (
      /\b(register|sign\s*up|apply|join|unstop|devfolio|forms\.gle|docs\.google\.com\/forms)\b/i.test(
        `${anchorText} ${href}`
      ) &&
      !href.includes('events.pes.edu/browse')
    ) {
      registrationUrl = href;
      break;
    }
  }
  if (!registrationUrl) {
    registrationUrl = canonicalUrl;
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
      !/^(hackathon|technical|upcoming|live|past)$/i.test(cleaned) &&
      themes.length < 4
    ) {
      themes.push(cleaned);
    }
  }
  if (themes.length === 0) {
    themes.push(cls.eventType === 'hackathon' ? 'Hackathon' : 'Technical Event');
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
    format:
      campus === 'Online / Multi-Campus'
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
 */
export function normalizeUrlForComparison(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('attachment://') || trimmed.startsWith('pesu-academy://')) {
    return null;
  }
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '') || '/';
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
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));
}

/**
 * Checks whether two event records (across PESU Academy announcements, `events.pes.edu`,
 * and student submissions) represent the SAME real-world event.
 */
export function areEventsSameRealWorldEvent(
  a: {
    title?: string | null;
    startAt?: string | null;
    organizer?: string | null;
    verifiedCanonicalUrl?: string | null;
    originalSubmissionUrl?: string | null;
    registrationUrl?: string | null;
  },
  b: {
    title?: string | null;
    startAt?: string | null;
    organizer?: string | null;
    verifiedCanonicalUrl?: string | null;
    originalSubmissionUrl?: string | null;
    registrationUrl?: string | null;
  }
): boolean {
  // 1. Exact URL match across any canonical / submission / registration URL
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

  // 2. Title similarity + compatible dates
  const rawTitleA = (a.title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const rawTitleB = (b.title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!rawTitleA || !rawTitleB) return false;

  const tokensA = normalizeEventTitleTokens(a.title);
  const tokensB = normalizeEventTitleTokens(b.title);

  let titleMatches = rawTitleA === rawTitleB;
  if (!titleMatches && tokensA.length > 0 && tokensB.length > 0) {
    const setB = new Set(tokensB);
    const shared = tokensA.filter((t) => setB.has(t));
    const minLen = Math.min(tokensA.length, tokensB.length);
    const maxLen = Math.max(tokensA.length, tokensB.length);
    // Match if all tokens of the shorter title appear in the longer title (with at least 2 significant tokens, or 1 unique coined name >= 6 chars)
    if (shared.length === minLen && (minLen >= 2 || (minLen === 1 && shared[0].length >= 6))) {
      titleMatches = true;
    } else if (shared.length / maxLen >= 0.7 && shared.length >= 2) {
      titleMatches = true;
    }
  }

  if (!titleMatches) return false;

  // Check date compatibility: if both have startAt dates, they must be within 4 days of each other
  const dateA = parseSingleDateToYmd(a.startAt);
  const dateB = parseSingleDateToYmd(b.startAt);
  if (dateA && dateB) {
    const msA = Date.parse(`${dateA}T00:00:00Z`);
    const msB = Date.parse(`${dateB}T00:00:00Z`);
    const diffDays = Math.abs(msA - msB) / (1000 * 60 * 60 * 24);
    return diffDays <= 4;
  }

  // If at least one source has startAt === null (e.g., an announcement without a date or Date TBA),
  // matching the distinct event title is sufficient!
  return true;
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
 */
export function getVerifiableRegistrationStatus(
  event: {
    registrationDeadline?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    registrationUrl?: string | null;
  },
  todayIstYmd: string = getTodayDateStringIST()
): {
  status: 'open' | 'closed' | 'ended' | 'unconfirmed';
  label: string;
} {
  const { startYmd, endYmd } = getEventDateBoundsIST(event);
  if (endYmd && endYmd < todayIstYmd) {
    return { status: 'ended', label: 'Event Ended' };
  }
  const deadlineYmd = parseSingleDateToYmd(event.registrationDeadline);
  if (deadlineYmd) {
    if (deadlineYmd < todayIstYmd) {
      return { status: 'closed', label: 'Registration Closed' };
    }
    return { status: 'open', label: 'Registration Open' };
  }
  if (startYmd && startYmd >= todayIstYmd && event.registrationUrl) {
    return { status: 'open', label: 'Registration Link Available' };
  }
  return { status: 'unconfirmed', label: 'Status Unconfirmed' };
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
    title: string;
    startAt?: string | null;
    endAt?: string | null;
    registrationDeadline?: string | null;
    registrationUrl?: string | null;
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

  return filtered.sort((a, b) => {
    const boundsA = getEventDateBoundsIST(a);
    const boundsB = getEventDateBoundsIST(b);

    if (options.preset === 'PAST') {
      const endA = boundsA.endYmd ?? '0000-00-00';
      const endB = boundsB.endYmd ?? '0000-00-00';
      if (endA !== endB) return endB.localeCompare(endA);
      return a.title.localeCompare(b.title);
    }

    if (options.preset === 'ALL') {
      // Bucket 0: Upcoming/Ongoing (endYmd >= todayIst), sorted ascending by startYmd
      // Bucket 1: Undated ("Date TBA")
      // Bucket 2: Past (endYmd < todayIst), sorted descending by endYmd
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
      return a.title.localeCompare(b.title);
    }

    // For UPCOMING, THIS_WEEK, THIS_MONTH, CUSTOM: chronological nearest first
    const startA = boundsA.startYmd ?? '9999-99-99';
    const startB = boundsB.startYmd ?? '9999-99-99';
    if (startA !== startB) return startA.localeCompare(startB);
    return a.title.localeCompare(b.title);
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
