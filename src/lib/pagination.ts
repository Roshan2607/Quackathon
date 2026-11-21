import { Hackathon } from '../types/domain';
import {
  getEventDateBoundsIST,
  getTodayDateStringIST,
  getVerifiableRegistrationStatus,
  isEligibleTeamHackathonCatalogEvent,
} from './eventsAndAnnouncements';

export interface PaginationResult<T> {
  pageItems: T[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  startIndex: number;
  endIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  pageNumbers: number[];
  showPagination: boolean;
}

/**
 * Deterministic conventional numbered pagination (no infinite scrolling).
 * - Default page size: 10 items per page (Page 1: 1-10, Page 2: 11-20, ...)
 * - Clamps requested page safely into [1, totalPages]
 * - `showPagination` is false when all items fit on one page (totalItems <= pageSize)
 */
export function paginateItems<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize = 10
): PaginationResult<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalItems = items.length;
  const totalPages = totalItems === 0 ? 1 : Math.ceil(totalItems / safePageSize);
  const currentPage = Math.min(
    totalPages,
    Math.max(1, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 1))
  );

  const zeroStart = (currentPage - 1) * safePageSize;
  const pageItems = items.slice(zeroStart, zeroStart + safePageSize);
  const startIndex = totalItems === 0 ? 0 : zeroStart + 1;
  const endIndex = totalItems === 0 ? 0 : zeroStart + pageItems.length;

  const pageNumbers: number[] = [];
  for (let p = 1; p <= totalPages; p += 1) {
    pageNumbers.push(p);
  }

  return {
    pageItems,
    currentPage,
    totalPages,
    totalItems,
    pageSize: safePageSize,
    startIndex,
    endIndex,
    hasPrevious: currentPage > 1,
    hasNext: currentPage < totalPages,
    pageNumbers,
    showPagination: totalItems > safePageSize,
  };
}

/**
 * Returns true when a hackathon is an upcoming, non-ended, non-expired-registration
 * event eligible for the student-facing Hackathons catalog.
 *
 * - Excludes ended events (`endYmd < todayIst`).
 * - Excludes expired registrations and explicitly closed/archived events.
 * - Retains valid upcoming events whose registration has not yet opened (`unknown`
 *   registration status with a future event date).
 * - Excludes undated past/closed events; retains undated published team hackathons
 *   only when not explicitly closed.
 */
export function isUpcomingStudentCatalogHackathon(
  hackathon: Hackathon,
  todayIstYmd: string = getTodayDateStringIST()
): boolean {
  if (!isEligibleTeamHackathonCatalogEvent(hackathon)) {
    return false;
  }

  if (
    hackathon.status === 'completed' ||
    hackathon.status === 'archived' ||
    hackathon.status === 'draft' ||
    hackathon.status === 'registration_closed'
  ) {
    return false;
  }

  const { startYmd, endYmd } = getEventDateBoundsIST(hackathon);
  // Require a valid upcoming/ongoing end date — past events are always excluded
  if (!startYmd || !endYmd || endYmd < todayIstYmd) {
    return false;
  }

  const reg = getVerifiableRegistrationStatus(hackathon, todayIstYmd);
  if (reg.status === 'ended' || reg.status === 'closed') {
    return false;
  }

  return true;
}

/**
 * Filters and deterministically sorts upcoming student-facing hackathons
 * (nearest start date first, then alphabetically by name, then by id).
 */
export function filterUpcomingStudentHackathons(
  hackathons: readonly Hackathon[],
  referenceDate: Date = new Date()
): Hackathon[] {
  const todayIst = getTodayDateStringIST(referenceDate);
  return hackathons
    .filter((h) => isUpcomingStudentCatalogHackathon(h, todayIst))
    .sort((a, b) => {
      const boundsA = getEventDateBoundsIST(a);
      const boundsB = getEventDateBoundsIST(b);
      const startA = boundsA.startYmd ?? '9999-99-99';
      const startB = boundsB.startYmd ?? '9999-99-99';
      if (startA !== startB) return startA.localeCompare(startB);
      const nameCmp = (a.name || '').localeCompare(b.name || '');
      if (nameCmp !== 0) return nameCmp;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Distinguishes upcoming events whose registration has not opened yet from
 * open registrations and closed/ended events for the expanded Hackathon detail view.
 */
export function describeHackathonRegistrationDetail(
  hackathon: Hackathon,
  todayIstYmd: string = getTodayDateStringIST()
): {
  kind: 'open' | 'not_yet_open' | 'closed' | 'ended';
  label: string;
  helperText: string;
} {
  const reg = getVerifiableRegistrationStatus(hackathon, todayIstYmd);
  const { startYmd, endYmd } = getEventDateBoundsIST(hackathon);

  if (reg.status === 'ended' || (endYmd && endYmd < todayIstYmd)) {
    return {
      kind: 'ended',
      label: 'Event Ended',
      helperText: 'This competition has already concluded. Teammate matching is closed.',
    };
  }

  if (reg.status === 'closed') {
    return {
      kind: 'closed',
      label: 'Registration Closed',
      helperText: 'Registration is closed for this event. New teammate matching is disabled.',
    };
  }

  if (reg.status === 'unknown') {
    const isFuture = Boolean(startYmd && startYmd > todayIstYmd);
    return {
      kind: 'not_yet_open',
      label: isFuture ? 'Registration Not Yet Open' : 'Registration Status Unconfirmed',
      helperText: isFuture
        ? 'This upcoming event has not published an open registration link yet. Check the official source page for updates.'
        : 'Registration details are not yet confirmed on the official listing.',
    };
  }

  return {
    kind: 'open',
    label: reg.label,
    helperText: 'Verify official rules and submit your team through the official registration link.',
  };
}
