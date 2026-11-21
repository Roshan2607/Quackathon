import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CampusType,
  EventCandidate,
  EventSourceType,
  ExecutionMode,
  Hackathon,
  PrivateAcademyHint,
  Profile,
  SourceUrlVerificationStatus,
  User,
} from '../types/domain';
import { PesuPublicEventsSyncResponse } from '../types/apiContracts';
import {
  classifyEventCandidateText,
  extractLiveEventFileMetadata,
  extractLiveEventUrlMetadata,
  extractPublicEventPreview,
  validateSubmittedEventUrl,
  verifyLiveEventUrl,
} from '../services/adapters';
import {
  formatEventDateDisplayIST,
  formatEventTypeCategoryLabel,
  getTodayDateStringIST,
  resolveHackathonSourceCategory,
} from '../lib/eventsAndAnnouncements';
import {
  describeHackathonRegistrationDetail,
  filterUpcomingStudentHackathons,
  paginateItems,
} from '../lib/pagination';
import { isHackathonEligibleForMatching } from '../services/matchingEngine';
import { apiFetch } from '../lib/apiClient';
import { Modal } from './Modal';
import { SelectMenu, SelectMenuOption } from './SelectMenu';
import { QUACKATHON_MINI_LOGO_SRC } from './LoginPage';
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Info,
  Link2,
  Loader2,
  MapPin,
  Plus,
  Search,
  Upload,
  Users,
  XCircle,
} from 'lucide-react';

interface HackathonsViewProps {
  currentUser: User;
  currentProfile?: Profile;
  executionMode: ExecutionMode;
  hackathons: Hackathon[];
  privateAcademyHints: PrivateAcademyHint[];
  onSelectHackathonForDiscovery: (hackathonId: string) => void;
  onSubmitEventCandidate: (candidate: EventCandidate) => void;
  onSaveProfile?: (
    profile: Profile,
    privacy: User['privacyPreferences']
  ) => Promise<void> | void;
  onConnectPesuAcademy?: (mode: 'popup' | 'redirect') => void;
  onRefreshCatalog?: () => Promise<void> | void;
  onNotify?: (message: string) => void;
}

const PAGE_SIZE = 10;

const CAMPUS_OPTIONS: SelectMenuOption[] = [
  { value: 'ALL', label: 'All PESU Campuses' },
  { value: 'RR Campus', label: 'RR Campus' },
  { value: 'EC Campus', label: 'EC Campus' },
  { value: 'Online / Multi-Campus', label: 'Online / Multi-Campus' },
];

export const HackathonsView: React.FC<HackathonsViewProps> = ({
  currentUser,
  executionMode,
  hackathons,
  onSelectHackathonForDiscovery,
  onSubmitEventCandidate,
  onRefreshCatalog,
  onNotify,
}) => {
  const [campusFilter, setCampusFilter] = useState<CampusType | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDetailHackathon, setSelectedDetailHackathon] =
    useState<Hackathon | null>(null);

  // Public PESU Events (`events.pes.edu`) Auto-Sync on cold start
  const [isSyncingPesuPublic, setIsSyncingPesuPublic] = useState(false);
  const didAutoSyncPublicRef = useRef(false);

  const handleSyncPesuPublicEvents = useCallback(
    async (forceRefresh = false) => {
      if (isSyncingPesuPublic) return;
      setIsSyncingPesuPublic(true);
      try {
        const res = await apiFetch<
          PesuPublicEventsSyncResponse & { hackathons?: Hackathon[] }
        >('/api/events/sync-pesu-public', {
          method: 'POST',
          body: { forceRefresh },
          timeoutMs: 25000,
        });
        if (res.ok && onRefreshCatalog) {
          await onRefreshCatalog();
        }
      } catch {
        // Silent fallback: keep live catalog intact
      } finally {
        setIsSyncingPesuPublic(false);
      }
    },
    [isSyncingPesuPublic, onRefreshCatalog]
  );

  useEffect(() => {
    if (didAutoSyncPublicRef.current || executionMode !== 'live') return;
    const hasPesuPublicEvents = hackathons.some(
      (h) => resolveHackathonSourceCategory(h) === 'PES_PUBLIC'
    );
    if (!hasPesuPublicEvents) {
      didAutoSyncPublicRef.current = true;
      void handleSyncPesuPublicEvents(false);
    }
  }, [executionMode, hackathons, handleSyncPesuPublicEvents]);

  // Suggest Event Modal State
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submissionTab, setSubmissionTab] = useState<'url' | 'file'>('url');
  const [candidateSourceOverride, setCandidateSourceOverride] =
    useState<EventSourceType | null>(null);
  const [rawUrl, setRawUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlWarnings, setUrlWarnings] = useState<string[]>([]);
  const [isExtractingLive, setIsExtractingLive] = useState(false);
  const [useAiFallbackForUrl, setUseAiFallbackForUrl] = useState(false);

  const [originalSubmissionUrl, setOriginalSubmissionUrl] = useState<
    string | null
  >(null);
  const [verifiedCanonicalUrl, setVerifiedCanonicalUrl] = useState<
    string | null
  >(null);
  const [sourceUrlStatus, setSourceUrlStatus] =
    useState<SourceUrlVerificationStatus>('unverified');
  const [redirectChainInfo, setRedirectChainInfo] = useState<string[]>([]);
  const [uploadedAttachmentMeta, setUploadedAttachmentMeta] = useState<
    EventCandidate['uploadedAttachment'] | undefined
  >(undefined);
  const [extractionEvidenceQuote, setExtractionEvidenceQuote] = useState<
    string | null
  >(null);

  const [title, setTitle] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [description, setDescription] = useState('');
  const [campus, setCampus] = useState<CampusType | ''>('');
  const [venueName, setVenueName] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [registrationDeadline, setRegistrationDeadline] = useState('');
  const [registrationUrl, setRegistrationUrl] = useState('');
  const [minTeamSize, setMinTeamSize] = useState<string>('');
  const [maxTeamSize, setMaxTeamSize] = useState<string>('');
  const [themesInput, setThemesInput] = useState(
    'Applied AI/ML, Developer Tools'
  );
  const [submissionSuccessToast, setSubmissionSuccessToast] = useState<
    string | null
  >(null);

  const parsedMinTeam =
    minTeamSize.trim() === '' ? null : parseInt(minTeamSize, 10);
  const parsedMaxTeam =
    maxTeamSize.trim() === '' ? null : parseInt(maxTeamSize, 10);

  const liveClassification = classifyEventCandidateText({
    title,
    description,
    minTeamSize: parsedMinTeam,
    maxTeamSize: parsedMaxTeam,
  });

  const todayIst = getTodayDateStringIST();

  // Upcoming-only verified team hackathons (excludes ended, closed, past, workshops/talks)
  const upcomingHackathons = useMemo(
    () => filterUpcomingStudentHackathons(hackathons),
    [hackathons]
  );

  // Apply Search + Campus filter deterministically
  const filteredHackathons = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return upcomingHackathons.filter((h) => {
      if (campusFilter !== 'ALL' && h.venue?.campus !== campusFilter) {
        return false;
      }
      if (q) {
        const matchesName = h.name.toLowerCase().includes(q);
        const matchesOrg = (h.organizer ?? '').toLowerCase().includes(q);
        const matchesTheme = (h.themes ?? []).some((t) =>
          t.toLowerCase().includes(q)
        );
        const matchesVenue = (h.venue?.name ?? '').toLowerCase().includes(q);
        if (!matchesName && !matchesOrg && !matchesTheme && !matchesVenue) {
          return false;
        }
      }
      return true;
    });
  }, [upcomingHackathons, campusFilter, searchQuery]);

  // Reset to Page 1 whenever search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, campusFilter]);

  const pagination = useMemo(
    () => paginateItems(filteredHackathons, currentPage, PAGE_SIZE),
    [filteredHackathons, currentPage]
  );

  // Keep currentPage clamped if catalog shrinks
  useEffect(() => {
    if (pagination.currentPage !== currentPage) {
      setCurrentPage(pagination.currentPage);
    }
  }, [pagination.currentPage, currentPage]);

  const handleFetchUrlPreview = async () => {
    setUrlError(null);
    setUrlWarnings([]);
    setRedirectChainInfo([]);
    setCandidateSourceOverride('submitted_public_url');

    const precheck = validateSubmittedEventUrl(rawUrl);
    if (!precheck.allowed && precheck.blockedReason?.includes('SSRF')) {
      setUrlError(precheck.blockedReason);
      setSourceUrlStatus('blocked_policy');
      setOriginalSubmissionUrl(rawUrl);
      setVerifiedCanonicalUrl(null);
      return;
    }

    setOriginalSubmissionUrl(rawUrl);

    if (executionMode === 'live') {
      setIsExtractingLive(true);
      try {
        const verifyRes = await verifyLiveEventUrl(rawUrl);
        setRedirectChainInfo(verifyRes.redirectChain ?? []);

        if (!verifyRes.ok) {
          setSourceUrlStatus(
            verifyRes.status === 'blocked_policy' ? 'blocked_policy' : 'broken'
          );
          setVerifiedCanonicalUrl(null);
          setUrlError(
            verifyRes.userMessage ??
              'URL verification failed. Enter details manually.'
          );
          return;
        }

        const resolvedCanonical =
          verifyRes.verifiedCanonicalUrl ??
          verifyRes.canonicalUrl ??
          verifyRes.finalUrl ??
          rawUrl;
        setVerifiedCanonicalUrl(resolvedCanonical);
        setSourceUrlStatus(
          verifyRes.status === 'redirected_valid'
            ? 'redirected_valid'
            : 'verified'
        );

        const res = await extractLiveEventUrlMetadata(
          rawUrl,
          false,
          useAiFallbackForUrl
        );
        if (!res.ok || !res.draft) {
          setUrlError(res.errorMessage ?? 'Live URL extraction failed.');
          setUrlWarnings(res.warnings);
          return;
        }
        const d = res.draft;
        setUrlWarnings(res.warnings);
        if (d.title) setTitle(d.title);
        if (d.organizer) setOrganizer(d.organizer);
        if (d.description) setDescription(d.description);
        if (d.venue?.campus) setCampus(d.venue.campus);
        if (d.venue?.name) setVenueName(d.venue.name);
        setStartAt(d.startAt ? d.startAt.slice(0, 10) : '');
        setEndAt(d.endAt ? d.endAt.slice(0, 10) : '');
        setRegistrationDeadline(
          d.registrationDeadline ? d.registrationDeadline.slice(0, 10) : ''
        );
        if (d.registrationUrl) setRegistrationUrl(d.registrationUrl);
        setMinTeamSize(
          d.teamSize?.min !== null && d.teamSize?.min !== undefined
            ? String(d.teamSize.min)
            : ''
        );
        setMaxTeamSize(
          d.teamSize?.max !== null && d.teamSize?.max !== undefined
            ? String(d.teamSize.max)
            : ''
        );
        if (d.themes && d.themes.length > 0)
          setThemesInput(d.themes.join(', '));
        setExtractionEvidenceQuote(
          d.fieldEvidence?.source?.[0]?.excerpt ?? null
        );
      } finally {
        setIsExtractingLive(false);
      }
      return;
    }

    const result = extractPublicEventPreview(rawUrl);
    if (!result.validation.allowed) {
      setUrlError(result.validation.blockedReason ?? 'URL blocked by policy.');
      setSourceUrlStatus('blocked_policy');
    } else if (result.validation.requiresManualEntryFallback) {
      setUrlWarnings(result.warnings);
      setSourceUrlStatus('unverified');
    } else {
      setUrlWarnings(result.warnings);
      setSourceUrlStatus('verified');
      setVerifiedCanonicalUrl(result.validation.normalizedUrl ?? rawUrl);
      const d = result.draft;
      if (d.title) setTitle(d.title);
      if (d.organizer) setOrganizer(d.organizer);
      if (d.description) setDescription(d.description);
      if (d.venue?.campus) setCampus(d.venue.campus);
      if (d.venue?.name) setVenueName(d.venue.name);
      setStartAt(d.startAt ? d.startAt.slice(0, 10) : '');
      setEndAt(d.endAt ? d.endAt.slice(0, 10) : '');
      setRegistrationDeadline(
        d.registrationDeadline ? d.registrationDeadline.slice(0, 10) : ''
      );
      if (d.registrationUrl) setRegistrationUrl(d.registrationUrl);
      setMinTeamSize(
        d.teamSize?.min !== null && d.teamSize?.min !== undefined
          ? String(d.teamSize.min)
          : ''
      );
      setMaxTeamSize(
        d.teamSize?.max !== null && d.teamSize?.max !== undefined
          ? String(d.teamSize.max)
          : ''
      );
      if (d.themes) setThemesInput(d.themes.join(', '));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUrlError(null);
    setUrlWarnings([]);
    setCandidateSourceOverride('uploaded_brochure_or_poster');
    setIsExtractingLive(true);

    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(new Error('Could not read uploaded file.'));
        reader.readAsDataURL(file);
      });

      const res = await extractLiveEventFileMetadata({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64Data,
      });

      setUploadedAttachmentMeta({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        byteSize: file.size,
        extractedEvidenceQuote: res.draft?.fieldEvidence?.source?.[0]?.excerpt,
      });

      if (!res.ok || !res.draft) {
        setUrlError(
          res.errorMessage ??
            'File extraction failed. Please fill out the fields manually.'
        );
        setUrlWarnings(res.warnings);
        return;
      }
      setUrlWarnings(res.warnings);
      const d = res.draft;
      if (d.title) setTitle(d.title);
      if (d.organizer) setOrganizer(d.organizer);
      if (d.description) setDescription(d.description);
      if (d.venue?.campus) setCampus(d.venue.campus);
      if (d.venue?.name) setVenueName(d.venue.name);
      setStartAt(d.startAt ? d.startAt.slice(0, 10) : '');
      setEndAt(d.endAt ? d.endAt.slice(0, 10) : '');
      setRegistrationDeadline(
        d.registrationDeadline ? d.registrationDeadline.slice(0, 10) : ''
      );
      if (d.registrationUrl) setRegistrationUrl(d.registrationUrl);
      setMinTeamSize(
        d.teamSize?.min !== null && d.teamSize?.min !== undefined
          ? String(d.teamSize.min)
          : ''
      );
      setMaxTeamSize(
        d.teamSize?.max !== null && d.teamSize?.max !== undefined
          ? String(d.teamSize.max)
          : ''
      );
      if (d.themes && d.themes.length > 0) setThemesInput(d.themes.join(', '));
      setExtractionEvidenceQuote(d.fieldEvidence?.source?.[0]?.excerpt ?? null);
    } finally {
      setIsExtractingLive(false);
    }
  };

  const handleSubmitCandidate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !organizer.trim()) return;

    const finalSourceType: EventSourceType =
      candidateSourceOverride ??
      (submissionTab === 'file'
        ? 'uploaded_brochure_or_poster'
        : 'submitted_public_url');

    const nowIso = new Date().toISOString();
    const candidate: EventCandidate = {
      id: `cand_${Date.now()}`,
      source: finalSourceType,
      submittedByUid: currentUser.uid,
      externalFingerprint: `student_${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${startAt || 'tbd'}`,
      sourceUrl: verifiedCanonicalUrl ?? (rawUrl.trim() || undefined),
      originalSubmissionUrl:
        originalSubmissionUrl ?? (rawUrl.trim() || null),
      verifiedCanonicalUrl: verifiedCanonicalUrl ?? null,
      sourceUrlStatus,
      uploadedAttachment: uploadedAttachmentMeta,
      title: title.trim(),
      organizer: organizer.trim(),
      eventType: liveClassification.eventType,
      matchable: liveClassification.matchable,
      venue: {
        campus: campus || null,
        name: venueName.trim() || null,
      },
      format: campus === 'Online / Multi-Campus' ? 'online' : 'onsite',
      startAt: startAt || null,
      endAt: endAt || startAt || null,
      registrationDeadline: registrationDeadline || null,
      timezone: 'Asia/Kolkata',
      teamSize: {
        min: parsedMinTeam,
        max: parsedMaxTeam,
      },
      themes: themesInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      description:
        description.trim() || 'Student-submitted event pending review.',
      registrationUrl: registrationUrl.trim() || null,
      eligibilityNotes: null,
      fieldEvidence: {
        source: [
          {
            sourceUrl: verifiedCanonicalUrl ?? (rawUrl.trim() || 'manual_entry'),
            excerpt:
              extractionEvidenceQuote ??
              `Submitted by ${currentUser.displayName}`,
          },
        ],
      },
      classification: {
        ruleGatePassed: liveClassification.matchable,
        mlScore:
          finalSourceType === 'uploaded_brochure_or_poster'
            ? 0.88
            : verifiedCanonicalUrl
            ? 0.9
            : 0.75,
        reason: liveClassification.reason,
      },
      reviewStatus: 'needs_confirmation',
      warnings: urlWarnings,
      lastSeenAt: nowIso,
    };

    onSubmitEventCandidate(candidate);
    setShowSubmitModal(false);
    setSubmissionSuccessToast(
      `"${candidate.title}" submitted for review. It will appear once verified.`
    );
    onNotify?.(`"${candidate.title}" submitted for review.`);
    setTimeout(() => setSubmissionSuccessToast(null), 5000);

    setRawUrl('');
    setCandidateSourceOverride(null);
    setOriginalSubmissionUrl(null);
    setVerifiedCanonicalUrl(null);
    setSourceUrlStatus('unverified');
    setRedirectChainInfo([]);
    setUploadedAttachmentMeta(undefined);
    setExtractionEvidenceQuote(null);
    setTitle('');
    setOrganizer('');
    setDescription('');
    setCampus('');
    setVenueName('');
    setStartAt('');
    setEndAt('');
    setRegistrationDeadline('');
    setRegistrationUrl('');
    setMinTeamSize('');
    setMaxTeamSize('');
    setUrlError(null);
    setUrlWarnings([]);
  };

  const detailRegInfo = selectedDetailHackathon
    ? describeHackathonRegistrationDetail(selectedDetailHackathon, todayIst)
    : null;
  const detailMatchable = selectedDetailHackathon
    ? isHackathonEligibleForMatching(selectedDetailHackathon)
    : false;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1c1b1b]">
            Hackathons
          </h1>
          <span className="text-xs font-medium text-[#746e65] tabular-nums">
            {filteredHackathons.length}{' '}
            {filteredHackathons.length === 1 ? 'upcoming event' : 'upcoming events'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setCandidateSourceOverride(null);
            setShowSubmitModal(true);
          }}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] active:scale-[0.98] border border-[#e5be35] text-[#1c1b1b] text-xs font-bold shadow-xs transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Suggest Hackathon</span>
        </button>
      </div>

      {submissionSuccessToast && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium"
        >
          {submissionSuccessToast}
        </div>
      )}

      {/* Search & Campus Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-[#746e65] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search upcoming hackathons..."
            aria-label="Search upcoming hackathons"
            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-[#e9e5dd] bg-white text-[#1c1b1b] placeholder:text-[#746e65] focus:outline-none focus:ring-1 focus:ring-[#ffd84d] focus:border-[#d0c6ae] transition-colors duration-150"
          />
        </div>

        <SelectMenu
          value={campusFilter}
          options={CAMPUS_OPTIONS}
          onChange={(val) => setCampusFilter(val as CampusType | 'ALL')}
          ariaLabel="Filter by campus"
          className="sm:w-52 shrink-0"
          menuAlign="right"
        />
      </div>

      {/* Upcoming Hackathons Grid */}
      {filteredHackathons.length === 0 ? (
        <div className="bg-white border border-[#e9e5dd] rounded-2xl p-10 text-center space-y-3.5">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#fff3c9] border border-[#f0d98c] flex items-center justify-center p-2">
            <img
              src={QUACKATHON_MINI_LOGO_SRC}
              alt="Quackathon"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#1c1b1b]">
              {searchQuery.trim() || campusFilter !== 'ALL'
                ? 'No upcoming hackathons match your search'
                : 'No upcoming hackathons listed yet'}
            </h2>
            <p className="text-xs text-[#746e65] max-w-md mx-auto leading-relaxed">
              {searchQuery.trim() || campusFilter !== 'ALL'
                ? 'Try clearing your search query or switching back to all campuses.'
                : 'Only upcoming, verified team hackathons appear here. Past and closed competitions are automatically hidden.'}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2.5 pt-1 flex-wrap">
            {(searchQuery.trim() || campusFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCampusFilter('ALL');
                }}
                className="px-3.5 py-2 rounded-xl border border-[#e9e5dd] bg-white hover:bg-[#f6f3eb] text-xs font-semibold text-[#1c1b1b] transition-colors duration-150 cursor-pointer"
              >
                Clear Filters
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setCandidateSourceOverride(null);
                setShowSubmitModal(true);
              }}
              className="px-4 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-xs font-bold text-[#1c1b1b] transition-colors duration-150 cursor-pointer"
            >
              Suggest a Hackathon
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
            data-testid="hackathons-grid"
          >
            {pagination.pageItems.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setSelectedDetailHackathon(h)}
                data-testid={`hackathon-card-${h.id}`}
                className="quack-interactive-card group w-full text-left bg-white border border-[#e9e5dd] rounded-2xl p-5 flex items-center justify-between gap-4 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#bd920c]"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-[#fff3c9] border border-[#f2dc8c] flex items-center justify-center shrink-0 text-[#725c00]">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-[#1c1b1b] truncate group-hover:text-[#725c00] transition-colors duration-150">
                      {h.name}
                    </h2>
                    <p className="text-xs text-[#746e65] mt-1 tabular-nums">
                      {formatEventDateDisplayIST(h)}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#746e65] group-hover:text-[#1c1b1b] group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
              </button>
            ))}
          </div>

          {/* Conventional Numbered Pagination (Hidden when all results fit on 1 page) */}
          {pagination.showPagination && (
            <nav
              aria-label="Hackathons pagination"
              data-testid="hackathons-pagination"
              className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-[#e9e5dd]"
            >
              <p className="text-xs text-[#746e65] tabular-nums">
                Showing {pagination.startIndex}–{pagination.endIndex} of{' '}
                {pagination.totalItems} upcoming hackathons
              </p>
              <div className="flex items-center gap-1.5 flex-wrap justify-center">
                <button
                  type="button"
                  disabled={!pagination.hasPrevious}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#e9e5dd] bg-white hover:bg-[#f6f3eb] text-xs font-semibold text-[#1c1b1b] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </button>

                {pagination.pageNumbers.map((pageNum) => {
                  const isCurrent = pageNum === pagination.currentPage;
                  return (
                    <button
                      key={pageNum}
                      type="button"
                      aria-current={isCurrent ? 'page' : undefined}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`min-w-[34px] h-[32px] px-2.5 rounded-lg border text-xs font-semibold tabular-nums transition-colors duration-150 cursor-pointer ${
                        isCurrent
                          ? 'bg-[#ffd84d] border-[#e5be35] text-[#1c1b1b] font-bold shadow-2xs'
                          : 'bg-white border-[#e9e5dd] text-[#4d4634] hover:bg-[#f6f3eb]'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  type="button"
                  disabled={!pagination.hasNext}
                  onClick={() =>
                    setCurrentPage((p) =>
                      Math.min(pagination.totalPages, p + 1)
                    )
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#e9e5dd] bg-white hover:bg-[#f6f3eb] text-xs font-semibold text-[#1c1b1b] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </nav>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* EXPANDED HACKATHON DETAILS MODAL (Keyboard Accessible + Focus Trap)  */}
      {/* ==================================================================== */}
      {selectedDetailHackathon && detailRegInfo && (
        <Modal
          title={selectedDetailHackathon.name}
          subtitle={`${formatEventTypeCategoryLabel(selectedDetailHackathon.eventType)} · ${selectedDetailHackathon.organizer}`}
          headerIcon={<Calendar className="w-4 h-4 text-[#725c00]" />}
          maxWidthClass="max-w-xl"
          onClose={() => setSelectedDetailHackathon(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setSelectedDetailHackathon(null)}
                className="px-4 py-2 rounded-xl border border-[#e9e5dd] bg-white hover:bg-[#f6f3eb] text-xs font-semibold text-[#4d4634] transition-colors duration-150 cursor-pointer"
              >
                Close
              </button>
              {detailMatchable ? (
                <button
                  type="button"
                  onClick={() => {
                    const id = selectedDetailHackathon.id;
                    setSelectedDetailHackathon(null);
                    onSelectHackathonForDiscovery(id);
                  }}
                  className="px-4 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-[#1c1b1b] text-xs font-bold shadow-2xs transition-colors duration-150 cursor-pointer"
                >
                  Find Teammates
                </button>
              ) : (
                <span className="text-xs font-medium text-[#746e65] px-2">
                  Teammate matching unavailable
                </span>
              )}
            </>
          }
        >
          <div className="space-y-5 text-xs">
            {/* Key Event Metadata Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#faf8f2] border border-[#e9e5dd] rounded-xl p-4">
              <div>
                <div className="text-[11px] font-medium text-[#746e65]">
                  Event Date
                </div>
                <div className="font-semibold text-[#1c1b1b] mt-0.5 tabular-nums">
                  {formatEventDateDisplayIST(selectedDetailHackathon)}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium text-[#746e65] flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  <span>Venue &amp; Format</span>
                </div>
                <div className="font-semibold text-[#1c1b1b] mt-0.5">
                  {selectedDetailHackathon.format === 'online'
                    ? 'Online'
                    : [
                        selectedDetailHackathon.venue?.name,
                        selectedDetailHackathon.venue?.campus,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'PES University'}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium text-[#746e65] flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  <span>Team Size</span>
                </div>
                <div className="font-semibold text-[#1c1b1b] mt-0.5 tabular-nums">
                  {selectedDetailHackathon.minTeamSize !== null &&
                  selectedDetailHackathon.maxTeamSize !== null
                    ? selectedDetailHackathon.minTeamSize ===
                      selectedDetailHackathon.maxTeamSize
                      ? `${selectedDetailHackathon.minTeamSize} members`
                      : `${selectedDetailHackathon.minTeamSize}–${selectedDetailHackathon.maxTeamSize} members`
                    : 'Not specified on official page'}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium text-[#746e65]">
                  Registration Status
                </div>
                <div className="font-semibold text-[#1c1b1b] mt-0.5">
                  {detailRegInfo.label}
                </div>
              </div>

              {selectedDetailHackathon.registrationDeadline && (
                <div className="sm:col-span-2 pt-2 border-t border-[#e9e5dd]">
                  <div className="text-[11px] font-medium text-[#746e65]">
                    Registration Deadline
                  </div>
                  <div className="font-semibold text-[#1c1b1b] mt-0.5 tabular-nums">
                    {formatEventDateDisplayIST({
                      startAt: selectedDetailHackathon.registrationDeadline,
                      endAt: selectedDetailHackathon.registrationDeadline,
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Eligibility & Registration Guidance */}
            <div
              className={`rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${
                detailRegInfo.kind === 'not_yet_open'
                  ? 'bg-[#fff3c9]/50 border-[#f0d98c] text-[#564500]'
                  : detailRegInfo.kind === 'open'
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  : 'bg-[#f6f3f2] border-[#e9e5dd] text-[#4d4634]'
              }`}
            >
              {detailRegInfo.helperText}
            </div>

            {/* Description */}
            {selectedDetailHackathon.description && (
              <div className="space-y-1.5">
                <div className="font-semibold text-[#1c1b1b] text-xs">
                  About this Hackathon
                </div>
                <p className="text-[#4d4634] whitespace-pre-line leading-relaxed text-xs">
                  {selectedDetailHackathon.description}
                </p>
              </div>
            )}

            {/* Themes */}
            {selectedDetailHackathon.themes &&
              selectedDetailHackathon.themes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedDetailHackathon.themes.map((theme) => (
                    <span
                      key={theme}
                      className="px-2.5 py-1 rounded-lg bg-[#f6f3f2] border border-[#e9e5dd] text-[#4d4634] text-[11px] font-medium"
                    >
                      {theme}
                    </span>
                  ))}
                </div>
              )}

            {/* Official Links */}
            <div className="space-y-2 pt-3 border-t border-[#f1ede6]">
              <div className="font-semibold text-[#1c1b1b] text-xs">
                Official Links
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedDetailHackathon.registrationUrl &&
                  selectedDetailHackathon.registrationUrl.startsWith(
                    'http'
                  ) && (
                    <a
                      href={selectedDetailHackathon.registrationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-[#1c1b1b] font-bold transition-colors duration-150"
                    >
                      <span>Official Registration</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                {Array.from(
                  new Set(
                    [
                      selectedDetailHackathon.verifiedCanonicalUrl,
                      ...(selectedDetailHackathon.sourceIds ?? []).filter((s) =>
                        s.startsWith('http')
                      ),
                    ].filter(
                      (u): u is string =>
                        Boolean(u) &&
                        u !== selectedDetailHackathon.registrationUrl
                    )
                  )
                ).map((url, idx) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#e9e5dd] bg-white hover:bg-[#f6f3eb] text-[#1c1b1b] font-semibold transition-colors duration-150"
                  >
                    <span>
                      Official Event Page{idx > 0 ? ` #${idx + 1}` : ''}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ==================================================================== */}
      {/* SUGGEST HACKATHON MODAL                                              */}
      {/* ==================================================================== */}
      {showSubmitModal && (
        <Modal
          title="Suggest a Hackathon"
          subtitle="Submissions are verified before appearing in the upcoming catalog."
          headerIcon={<Plus className="w-4 h-4 text-[#725c00]" />}
          maxWidthClass="max-w-xl"
          onClose={() => setShowSubmitModal(false)}
        >
          <div className="space-y-4">
            {/* Source Method Tabs */}
            <div className="flex rounded-xl border border-[#e9e5dd] p-1 bg-[#faf8f2]">
              <button
                type="button"
                onClick={() => setSubmissionTab('url')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                  submissionTab === 'url'
                    ? 'bg-white text-[#1c1b1b] shadow-2xs border border-[#e9e5dd]'
                    : 'text-[#746e65] hover:text-[#1c1b1b]'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Public Event URL</span>
              </button>
              <button
                type="button"
                onClick={() => setSubmissionTab('file')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                  submissionTab === 'file'
                    ? 'bg-white text-[#1c1b1b] shadow-2xs border border-[#e9e5dd]'
                    : 'text-[#746e65] hover:text-[#1c1b1b]'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Poster / PDF Brochure</span>
              </button>
            </div>

            {submissionTab === 'url' ? (
              <div className="space-y-2.5">
                <label className="block text-xs font-semibold text-[#1c1b1b]">
                  Step 1: Verify &amp; Extract from Public Event URL (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={rawUrl}
                    onChange={(e) => setRawUrl(e.target.value)}
                    placeholder="https://events.pes.edu/... or Unstop / Devfolio link"
                    className="flex-1 px-3 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-[#faf8f2] text-[#1c1b1b] font-mono focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                  />
                  <button
                    type="button"
                    disabled={isExtractingLive}
                    onClick={handleFetchUrlPreview}
                    className="px-3.5 py-2 rounded-xl bg-[#24211c] hover:bg-[#3a352d] text-white text-xs font-semibold shrink-0 cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors duration-150"
                  >
                    {isExtractingLive && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    <span>
                      {isExtractingLive ? 'Verifying...' : 'Verify & Extract'}
                    </span>
                  </button>
                </div>

                <label className="inline-flex items-center gap-1.5 text-[11px] text-[#746e65] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useAiFallbackForUrl}
                    onChange={(e) => setUseAiFallbackForUrl(e.target.checked)}
                    className="rounded border-[#d0c6ae]"
                  />
                  <span>Use AI fallback if event page is unstructured</span>
                </label>

                {originalSubmissionUrl && (
                  <div className="p-2.5 rounded-xl bg-[#faf8f2] border border-[#e9e5dd] text-[11px] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#4d4634]">
                        URL Status:
                      </span>
                      <span className="font-mono font-semibold uppercase text-[#725c00]">
                        {sourceUrlStatus}
                      </span>
                    </div>
                    {verifiedCanonicalUrl && (
                      <div className="font-mono text-emerald-700 truncate">
                        Canonical: {verifiedCanonicalUrl}
                      </div>
                    )}
                    {redirectChainInfo.length > 1 && (
                      <div className="text-[#746e65] truncate">
                        Redirects: {redirectChainInfo.join(' → ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                <label className="block text-xs font-semibold text-[#1c1b1b]">
                  Step 1: Upload Official Event Brochure (PDF) or Poster
                  (PNG/JPG/WebP)
                </label>
                <div className="border-2 border-dashed border-[#e9e5dd] rounded-xl p-4 text-center space-y-2 bg-[#faf8f2]">
                  <FileText className="w-6 h-6 text-[#746e65] mx-auto" />
                  <div className="text-xs text-[#4d4634]">
                    <label className="text-[#725c00] font-semibold hover:underline cursor-pointer">
                      <span>Choose PDF or Poster Image</span>
                      <input
                        type="file"
                        accept=".pdf,image/png,image/jpeg,image/webp"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>{' '}
                    (Max 10MB)
                  </div>
                  {isExtractingLive && (
                    <div className="inline-flex items-center gap-1.5 text-xs text-[#725c00] font-medium">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Extracting details from file...</span>
                    </div>
                  )}
                  {uploadedAttachmentMeta && (
                    <div className="text-[11px] font-mono text-emerald-700">
                      Attached: {uploadedAttachmentMeta.fileName} (
                      {Math.round(uploadedAttachmentMeta.byteSize / 1024)} KB)
                    </div>
                  )}
                </div>
              </div>
            )}

            {urlError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-800">
                <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{urlError}</span>
              </div>
            )}

            {urlWarnings.length > 0 && (
              <div className="p-3 rounded-xl bg-[#fff3c9]/60 border border-[#f0d98c] space-y-1 text-xs text-[#564500]">
                {urlWarnings.map((w, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#875200] shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={handleSubmitCandidate}
              className="space-y-3 pt-3 border-t border-[#f1ede6]"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#1c1b1b] mb-1">
                    Event Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., HackPES 2026"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-[#faf8f2] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1c1b1b] mb-1">
                    Organizer / Club *
                  </label>
                  <input
                    type="text"
                    required
                    value={organizer}
                    onChange={(e) => setOrganizer(e.target.value)}
                    placeholder="e.g., PES CSE & ACM Student Chapter"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-[#faf8f2] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#1c1b1b] mb-1">
                  Description &amp; Format Details
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief event overview..."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-[#faf8f2] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                />
              </div>

              <div
                className={`p-2.5 rounded-xl border text-xs flex items-start gap-2 ${
                  liveClassification.matchable
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : 'bg-[#fff3c9]/60 border-[#f0d98c] text-[#564500]'
                }`}
              >
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">
                    Category:{' '}
                    <span className="uppercase font-mono">
                      {liveClassification.eventType}
                    </span>
                  </div>
                  <div className="text-[11px] opacity-85">
                    {liveClassification.reason}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-[#4d4634] mb-1">
                    Campus
                  </label>
                  <select
                    value={campus}
                    onChange={(e) =>
                      setCampus(e.target.value as CampusType | '')
                    }
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-white"
                  >
                    <option value="">Unconfirmed</option>
                    <option value="RR Campus">RR Campus</option>
                    <option value="EC Campus">EC Campus</option>
                    <option value="Online / Multi-Campus">
                      Online / Multi-Campus
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#4d4634] mb-1">
                    Venue / Room
                  </label>
                  <input
                    type="text"
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    placeholder="Leave blank if TBA"
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-[#faf8f2] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#4d4634] mb-1">
                    Min Team
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    placeholder="2"
                    value={minTeamSize}
                    onChange={(e) => setMinTeamSize(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-[#faf8f2] focus:bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#4d4634] mb-1">
                    Max Team
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    placeholder="4"
                    value={maxTeamSize}
                    onChange={(e) => setMaxTeamSize(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-[#faf8f2] focus:bg-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-[#4d4634] mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#4d4634] mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#4d4634] mb-1">
                    Registration Deadline
                  </label>
                  <input
                    type="date"
                    value={registrationDeadline}
                    onChange={(e) => setRegistrationDeadline(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-[#4d4634] mb-1">
                    Official Registration Link
                  </label>
                  <input
                    type="url"
                    value={registrationUrl}
                    onChange={(e) => setRegistrationUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-[#faf8f2] focus:bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#4d4634] mb-1">
                    Themes (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={themesInput}
                    onChange={(e) => setThemesInput(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#e9e5dd] bg-[#faf8f2] focus:bg-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubmitModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#e9e5dd] bg-white hover:bg-[#f6f3eb] text-xs font-semibold text-[#4d4634] transition-colors duration-150 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-[#1c1b1b] text-xs font-bold transition-colors duration-150 cursor-pointer"
                >
                  Submit for Review
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
};
