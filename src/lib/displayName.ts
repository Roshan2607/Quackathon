/**
 * Student Display Name Resolution & Privacy Helpers
 *
 * Guarantees:
 * - Verified full names from PESU OAuth are used when available.
 * - `preferred_username` is NEVER treated as a human name when it is an SRN/PRN or ID.
 * - Verified SRN/PRN identifiers remain separate from `displayName` and are never exposed publicly.
 * - A student's manually chosen display name is preserved across future OAuth logins.
 * - Names are never fabricated when claims are missing.
 */

export const PLACEHOLDER_DISPLAY_NAME = 'PES Student';

const PESU_IDENTIFIER_PATTERNS: RegExp[] = [
  /^pes[12](?:ug|pg|ec|rr|hn)?\d{2}[a-z]{2,4}\d{2,4}$/i, // e.g., PES1UG22CS123, PES2PG23EC045
  /^pes[12]\d{8,14}$/i, // e.g., PES1202201234 (PRN)
  /^(?:pesu|firebase|user|uid|sub)_[a-z0-9_-]{3,}$/i, // internal UIDs
  /^\d{6,}$/, // bare numeric student/PRN IDs
  /^[a-z0-9]{10,}$/i, // single unbroken alphanumeric token with digits (e.g., hashed sub or SRN)
];

/**
 * Returns true if the given string looks like a PESU SRN, PRN, OAuth subject ID,
 * or opaque identifier rather than a human name.
 */
export function looksLikePesuIdentifier(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;

  // Email addresses are not display names
  if (trimmed.includes('@')) return true;

  // Contains a PESU SRN/PRN substring (e.g. "PES Student (PES1UG22CS123)")
  if (/\bpes[12](?:ug|pg|ec|rr|hn)?\d{2}[a-z]{0,4}\d{3,}\b/i.test(trimmed)) {
    return true;
  }

  for (const pattern of PESU_IDENTIFIER_PATTERNS) {
    if (pattern.test(trimmed)) {
      // Allow purely alphabetic single words like "Christopher" (handled by digit check below)
      if (pattern.source === '^[a-z0-9]{10,}$' && !/\d/.test(trimmed)) {
        continue;
      }
      return true;
    }
  }

  // Single token containing digits (e.g. "1PE22CS101", "UG23CS042")
  if (!/\s/.test(trimmed) && /\d/.test(trimmed) && trimmed.length >= 6) {
    return true;
  }

  return false;
}

/**
 * Returns true if a display name is missing, a generic placeholder, or an SRN/PRN identifier.
 */
export function isPlaceholderOrIdentifierDisplayName(
  raw: string | null | undefined
): boolean {
  if (!raw || typeof raw !== 'string') return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (
    /^pes\s+student(?:\s*\(.*\))?$/i.test(trimmed) ||
    /^guest\s+student$/i.test(trimmed) ||
    /^verified\s+student$/i.test(trimmed) ||
    /^student$/i.test(trimmed)
  ) {
    return true;
  }
  return looksLikePesuIdentifier(trimmed);
}

/**
 * Cleans and validates a candidate human name. Returns null if empty, placeholder, or SRN/PRN.
 */
export function normalizeHumanDisplayName(
  raw: unknown
): string | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed || collapsed.length < 2) return null;
  if (isPlaceholderOrIdentifierDisplayName(collapsed)) return null;
  return collapsed.slice(0, 80);
}

export interface ResolvedOAuthDisplayName {
  /** Validated human display name, or null if provider did not supply one. */
  verifiedName: string | null;
  /** Safe display name suitable for persistence (never an SRN/PRN). */
  displayName: string;
  /** True when OAuth did not provide a verified human name and the student should be offered a one-time name input. */
  needsDisplayNameSetup: boolean;
}

/**
 * Resolves a human display name from OAuth ID token / userinfo claims.
 * Strictly ignores SRN/PRN values in `preferred_username` or `sub`.
 */
export function resolveOAuthDisplayName(
  claims: Record<string, unknown>
): ResolvedOAuthDisplayName {
  const candidates: unknown[] = [
    claims.name,
    claims.full_name,
    claims.fullName,
    typeof claims.given_name === 'string' && typeof claims.family_name === 'string'
      ? `${claims.given_name.trim()} ${claims.family_name.trim()}`
      : null,
    claims.given_name,
    claims.preferred_username,
  ];

  for (const candidate of candidates) {
    const valid = normalizeHumanDisplayName(candidate);
    if (valid) {
      return {
        verifiedName: valid,
        displayName: valid,
        needsDisplayNameSetup: false,
      };
    }
  }

  return {
    verifiedName: null,
    displayName: PLACEHOLDER_DISPLAY_NAME,
    needsDisplayNameSetup: true,
  };
}

/**
 * Determines the display name to persist during an OAuth upsert without
 * ever overwriting a student's manually chosen valid name or regressing to an SRN.
 */
export function chooseUpsertDisplayName(params: {
  existingDisplayName?: string | null;
  existingCustomDisplayNameSet?: boolean;
  incomingDisplayName?: string | null;
  incomingVerifiedHumanName?: boolean;
}): {
  displayName: string;
  preserveCustomFlag: boolean;
} {
  const existingValid = normalizeHumanDisplayName(params.existingDisplayName);
  const incomingValid = normalizeHumanDisplayName(params.incomingDisplayName);

  // 1. Always preserve an explicitly chosen custom human name
  if (params.existingCustomDisplayNameSet && existingValid) {
    return {
      displayName: existingValid,
      preserveCustomFlag: true,
    };
  }

  // 2. If existing name is already a valid human name and incoming is NOT a verified human name, preserve existing
  if (existingValid && (!incomingValid || params.incomingVerifiedHumanName === false)) {
    return {
      displayName: existingValid,
      preserveCustomFlag: Boolean(params.existingCustomDisplayNameSet),
    };
  }

  // 3. If incoming is a valid human name (and existing was placeholder/SRN or not custom), use incoming
  if (incomingValid) {
    return {
      displayName: incomingValid,
      preserveCustomFlag: false,
    };
  }

  // 4. Preserve existing valid human name if present
  if (existingValid) {
    return {
      displayName: existingValid,
      preserveCustomFlag: Boolean(params.existingCustomDisplayNameSet),
    };
  }

  // 5. Fallback to safe non-SRN placeholder (never fabricate a name, never expose SRN)
  return {
    displayName: PLACEHOLDER_DISPLAY_NAME,
    preserveCustomFlag: false,
  };
}

/**
 * Ensures any user-facing display name never exposes an SRN/PRN in cards, menus, or messages.
 */
export function formatSafePublicDisplayName(
  displayName: string | null | undefined
): string {
  const valid = normalizeHumanDisplayName(displayName);
  return valid ?? PLACEHOLDER_DISPLAY_NAME;
}
