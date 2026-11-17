import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CampusType,
  EventCandidate,
  EventSourceType,
  EventType,
  ExecutionMode,
  Hackathon,
  PrivateAcademyHint,
  Profile,
  SourceUrlVerificationStatus,
  User,
} from '../types/domain';
import {
  PesuAnnouncementsResponse,
  PesuPublicEventsSyncResponse,
} from '../types/apiContracts';
import {
  classifyEventCandidateText,
  extractLiveEventFileMetadata,
  extractLiveEventUrlMetadata,
  extractPublicEventPreview,
  validateSubmittedEventUrl,
  verifyLiveEventUrl,
} from '../services/adapters';
import {
  buildSanitizedCandidateDraftFromAnnouncement,
  detectTechnicalEventFromAnnouncement,
  filterAnnouncementsByPublicationDate,
  filterAndSortEventsByTime,
  formatEventDateDisplayIST,
  formatEventTypeCategoryLabel,
  getHackathonSourceLabel,
  getTodayDateStringIST,
  getVerifiableRegistrationStatus,
  isEligibleTeamHackathonCatalogEvent,
  NormalizedPesuAnnouncement,
  resolveHackathonSourceCategory,
  TimeFilterPreset,
  UnifiedEventSourceFilter,
} from '../lib/eventsAndAnnouncements';
import { apiFetch } from '../lib/apiClient';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  Globe,
  Info,
  Link2,
  Loader2,
  Lock,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
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

interface PersistedEventsFilterState {
  sourceFilter: UnifiedEventSourceFilter;
  timePreset: TimeFilterPreset;
  customStart: string;
  customEnd: string;
  openRegistrationOnly: boolean;
  campusFilter: CampusType | 'ALL';
  searchQuery: string;
}

const FILTER_STORAGE_KEY = 'quackathon_events_filters_v1';

function loadPersistedFilterState(): PersistedEventsFilterState {
  const defaults: PersistedEventsFilterState = {
    sourceFilter: 'ALL_PUBLISHED',
    timePreset: 'UPCOMING',
    customStart: '',
    customEnd: '',
    openRegistrationOnly: false,
    campusFilter: 'ALL',
    searchQuery: '',
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PersistedEventsFilterState>;
    return {
      sourceFilter: parsed.sourceFilter ?? defaults.sourceFilter,
      timePreset: parsed.timePreset ?? defaults.timePreset,
      customStart: parsed.customStart ?? defaults.customStart,
      customEnd: parsed.customEnd ?? defaults.customEnd,
      openRegistrationOnly: Boolean(parsed.openRegistrationOnly),
      campusFilter: parsed.campusFilter ?? defaults.campusFilter,
      searchQuery: parsed.searchQuery ?? defaults.searchQuery,
    };
  } catch {
    return defaults;
  }
}

export const HackathonsView: React.FC<HackathonsViewProps> = ({
  currentUser,
  currentProfile,
  executionMode,
  hackathons,
  onSelectHackathonForDiscovery,
  onSubmitEventCandidate,
  onSaveProfile,
  onConnectPesuAcademy,
  onRefreshCatalog,
  onNotify,
}) => {
  const initialFilters = useMemo(() => loadPersistedFilterState(), []);

  const [sourceFilter, setSourceFilter] = useState<UnifiedEventSourceFilter>(
    initialFilters.sourceFilter
  );
  const [timePreset, setTimePreset] = useState<TimeFilterPreset>(
    initialFilters.timePreset
  );
  const [customStart, setCustomStart] = useState<string>(
    initialFilters.customStart
  );
  const [customEnd, setCustomEnd] = useState<string>(initialFilters.customEnd);
  const [openRegistrationOnly, setOpenRegistrationOnly] = useState<boolean>(
    initialFilters.openRegistrationOnly
  );
  const [campusFilter, setCampusFilter] = useState<CampusType | 'ALL'>(
    initialFilters.campusFilter
  );
  const [searchQuery, setSearchQuery] = useState(initialFilters.searchQuery);
  const [selectedDetailHackathon, setSelectedDetailHackathon] =
    useState<Hackathon | null>(null);

  // Persist filter selections in sessionStorage while navigating within the page
  useEffect(() => {
    try {
      const toStore: PersistedEventsFilterState = {
        sourceFilter,
        timePreset,
        customStart,
        customEnd,
        openRegistrationOnly,
        campusFilter,
        searchQuery,
      };
      sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // ignore storage errors
    }
  }, [
    sourceFilter,
    timePreset,
    customStart,
    customEnd,
    openRegistrationOnly,
    campusFilter,
    searchQuery,
  ]);

  // Public PESU Events (`events.pes.edu`) Live Sync State
  const [isSyncingPesuPublic, setIsSyncingPesuPublic] = useState(false);
  const [lastPublicSyncMeta, setLastPublicSyncMeta] = useState<{
    fetchedAt: string;
    discoveredCount: number;
    reachablePagesCount: number;
    userMessage: string;
    ok: boolean;
  } | null>(null);
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
        if (res.data) {
          setLastPublicSyncMeta({
            fetchedAt: res.data.fetchedAt || new Date().toISOString(),
            discoveredCount: res.data.discoveredCount ?? 0,
            reachablePagesCount: res.data.reachablePagesCount ?? 0,
            userMessage:
              res.data.userMessage || 'Checked events.pes.edu public listings.',
            ok: Boolean(res.data.ok),
          });
        }
        if (res.ok && onRefreshCatalog) {
          await onRefreshCatalog();
        }
      } catch {
        setLastPublicSyncMeta({
          fetchedAt: new Date().toISOString(),
          discoveredCount: 0,
          reachablePagesCount: 0,
          userMessage: 'Could not reach events.pes.edu at this moment.',
          ok: false,
        });
      } finally {
        setIsSyncingPesuPublic(false);
      }
    },
    [isSyncingPesuPublic, onRefreshCatalog]
  );

  // Auto-sync public PESU events on initial load if none of the published events come from events.pes.edu yet
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

  // PESU Academy Announcements State (Strictly Private & Consent-Gated)
  const [academyAnnouncements, setAcademyAnnouncements] = useState<
    NormalizedPesuAnnouncement[]
  >([]);
  const [isLoadingAnnouncements, setIsLoadingAnnouncements] = useState(false);
  const [announcementsResponseState, setAnnouncementsResponseState] = useState<{
    loaded: boolean;
    ok: boolean;
    errorCode?: PesuAnnouncementsResponse['errorCode'];
    requiresOptIn?: boolean;
    requiresScopeGrant?: boolean;
    requiresReauth?: boolean;
    grantedScopes?: string[];
    fetchedAt?: string;
    userMessage?: string;
  }>({
    loaded: false,
    ok: false,
  });
  const [isSavingOptIn, setIsSavingOptIn] = useState(false);
  const [includeSanitizedSummaryById, setIncludeSanitizedSummaryById] =
    useState<Record<string, boolean>>({});

  const fetchAcademyAnnouncements = useCallback(
    async (forceRefresh = false) => {
      if (!currentUser.privacyPreferences.academyAnnouncementsOptIn) {
        setAcademyAnnouncements([]);
        setAnnouncementsResponseState({
          loaded: true,
          ok: false,
          errorCode: 'OPT_IN_REQUIRED',
          requiresOptIn: true,
          userMessage:
            'PESU Academy announcement retrieval is disabled by default. Review the delegated access disclosure below and opt in to connect.',
        });
        return;
      }

      setIsLoadingAnnouncements(true);
      try {
        const query = forceRefresh ? '?refresh=true' : '';
        const res = await apiFetch<PesuAnnouncementsResponse>(
          `/api/pesu/announcements${query}`,
          { timeoutMs: 15000 }
        );
        const data = res.data;

        if (res.ok && data?.ok && Array.isArray(data.announcements)) {
          setAcademyAnnouncements(
            data.announcements.map((a) => ({
              id: String(a.id),
              title: a.title || 'Untitled PESU Announcement',
              date: a.date ?? null,
              description: a.description || '',
              image: a.image ?? null,
              attachments: typeof a.attachments === 'number' ? a.attachments : 0,
            }))
          );
          setAnnouncementsResponseState({
            loaded: true,
            ok: true,
            fetchedAt: data.fetchedAt || new Date().toISOString(),
            grantedScopes: data.grantedScopes,
            userMessage:
              data.userMessage ||
              `Retrieved ${data.announcements.length} announcement(s).`,
          });
        } else {
          setAcademyAnnouncements([]);
          setAnnouncementsResponseState({
            loaded: true,
            ok: false,
            errorCode: data?.errorCode || 'PROVIDER_UNAVAILABLE',
            requiresOptIn: data?.requiresOptIn,
            requiresScopeGrant: data?.requiresScopeGrant,
            requiresReauth: data?.requiresReauth,
            grantedScopes: data?.grantedScopes,
            userMessage:
              data?.userMessage ||
              res.errorMessage ||
              'Could not retrieve PESU Academy announcements.',
          });
        }
      } catch {
        setAcademyAnnouncements([]);
        setAnnouncementsResponseState({
          loaded: true,
          ok: false,
          errorCode: 'NETWORK_ERROR',
          userMessage:
            'Network error while contacting PESU Academy announcements endpoint.',
        });
      } finally {
        setIsLoadingAnnouncements(false);
      }
    },
    [currentUser.privacyPreferences.academyAnnouncementsOptIn]
  );

  useEffect(() => {
    if (
      sourceFilter === 'MY_ACADEMY' ||
      currentUser.privacyPreferences.academyAnnouncementsOptIn
    ) {
      void fetchAcademyAnnouncements(false);
    }
  }, [
    sourceFilter,
    currentUser.privacyPreferences.academyAnnouncementsOptIn,
    fetchAcademyAnnouncements,
  ]);

  const handleToggleAcademyOptIn = async (enable: boolean) => {
    if (!onSaveProfile || !currentProfile) {
      onNotify?.(
        'Please sign in with your PESU account first to configure Academy announcement preferences.'
      );
      return;
    }
    setIsSavingOptIn(true);
    try {
      await onSaveProfile(currentProfile, {
        ...currentUser.privacyPreferences,
        academyAnnouncementsOptIn: enable,
      });
      if (enable) {
        onNotify?.(
          'Enabled PESU Academy announcement opt-in. Checking your PESU OAuth2 session scopes...'
        );
      } else {
        setAcademyAnnouncements([]);
        onNotify?.('Disabled PESU Academy announcement access.');
      }
    } finally {
      setIsSavingOptIn(false);
    }
  };

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

  // Distinct URL Tracking State
  const [originalSubmissionUrl, setOriginalSubmissionUrl] = useState<
    string | null
  >(null);
  const [verifiedCanonicalUrl, setVerifiedCanonicalUrl] = useState<
    string | null
  >(null);
  const [sourceUrlStatus, setSourceUrlStatus] =
    useState<SourceUrlVerificationStatus>('unverified');
  const [redirectChainInfo, setRedirectChainInfo] = useState<string[]>([]);

  // Uploaded File State
  const [uploadedAttachmentMeta, setUploadedAttachmentMeta] = useState<
    EventCandidate['uploadedAttachment'] | undefined
  >(undefined);
  const [extractionEvidenceQuote, setExtractionEvidenceQuote] = useState<
    string | null
  >(null);

  // Editable Event Candidate Form State
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
  const [themesInput, setThemesInput] = useState('Applied AI/ML, Developer Tools');
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

  // Populate Suggest Event modal from a detected PESU Academy announcement (privacy-safe)
  const handleOpenSuggestFromAnnouncement = (
    ann: NormalizedPesuAnnouncement
  ) => {
    const detected = detectTechnicalEventFromAnnouncement(ann);
    if (!detected) return;
    const includeSummary = Boolean(includeSanitizedSummaryById[ann.id]);
    const draft = buildSanitizedCandidateDraftFromAnnouncement({
      announcement: ann,
      detected,
      includeSanitizedSummary: includeSummary,
    });

    setCandidateSourceOverride('academy_opt_in_hint');
    setSubmissionTab('url');
    setRawUrl(draft.registrationUrl ?? '');
    setOriginalSubmissionUrl(draft.originalSubmissionUrl ?? null);
    setVerifiedCanonicalUrl(null);
    setSourceUrlStatus(draft.registrationUrl ? 'unverified' : 'unavailable');
    setRedirectChainInfo([]);
    setUploadedAttachmentMeta(undefined);
    setExtractionEvidenceQuote(
      detected.evidenceExcerpts.join(' · ') ||
        `Suggested from PESU Academy announcement "${ann.title}"`
    );

    setTitle(draft.title || ann.title);
    setOrganizer(draft.organizer || 'PES University');
    setDescription(draft.description || '');
    setCampus(draft.venue?.campus ?? '');
    setVenueName(draft.venue?.name ?? '');
    // CRITICAL: Only use explicitly detected event dates (never the announcement's publication date!)
    setStartAt(draft.startAt ? draft.startAt.slice(0, 10) : '');
    setEndAt(draft.endAt ? draft.endAt.slice(0, 10) : '');
    setRegistrationDeadline(
      draft.registrationDeadline ? draft.registrationDeadline.slice(0, 10) : ''
    );
    setRegistrationUrl(draft.registrationUrl ?? '');
    setMinTeamSize(
      draft.teamSize?.min !== null && draft.teamSize?.min !== undefined
        ? String(draft.teamSize.min)
        : ''
    );
    setMaxTeamSize(
      draft.teamSize?.max !== null && draft.teamSize?.max !== undefined
        ? String(draft.teamSize.max)
        : ''
    );
    setThemesInput((draft.themes ?? []).join(', '));
    setUrlError(null);
    setUrlWarnings([
      'Personal student identifiers and private announcement text were automatically stripped for public submission.',
      ...(draft.startAt
        ? []
        : [
            'No event start date was stated in the announcement; leaving Date blank will safely label it "Date TBA".',
          ]),
    ]);
    setShowSubmitModal(true);
  };

  // Eligible Hackathons-only catalog (excludes workshops, talks, conferences, cultural events, and solo-only events)
  const eligibleCatalogHackathons = useMemo(
    () => hackathons.filter((h) => isEligibleTeamHackathonCatalogEvent(h)),
    [hackathons]
  );

  // Source-filtered + Search/Campus-filtered + IST Time-filtered Published Hackathons
  const sourceCounts = useMemo(() => {
    let allCount = 0;
    let pesPublicCount = 0;
    let communityCount = 0;
    for (const h of eligibleCatalogHackathons) {
      allCount++;
      if (resolveHackathonSourceCategory(h) === 'PES_PUBLIC') {
        pesPublicCount++;
      } else {
        communityCount++;
      }
    }
    return {
      allCount,
      pesPublicCount,
      communityCount,
      academyCount: academyAnnouncements.length,
    };
  }, [eligibleCatalogHackathons, academyAnnouncements.length]);

  const filteredHackathons = useMemo(() => {
    const baseFiltered = eligibleCatalogHackathons.filter((h) => {
      const cat = resolveHackathonSourceCategory(h);
      if (sourceFilter === 'PES_PUBLIC' && cat !== 'PES_PUBLIC') return false;
      if (sourceFilter === 'COMMUNITY_VERIFIED' && cat !== 'COMMUNITY_VERIFIED')
        return false;

      if (campusFilter !== 'ALL' && h.venue.campus !== campusFilter)
        return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = h.name.toLowerCase().includes(q);
        const matchesOrg = h.organizer.toLowerCase().includes(q);
        const matchesTheme = h.themes.some((t) => t.toLowerCase().includes(q));
        const matchesVenue = (h.venue.name ?? '').toLowerCase().includes(q);
        if (!matchesName && !matchesOrg && !matchesTheme && !matchesVenue) {
          return false;
        }
      }
      return true;
    });

    return filterAndSortEventsByTime(
      baseFiltered.map((h) => ({ ...h, title: h.name })),
      {
        preset: timePreset,
        customStart,
        customEnd,
        openRegistrationOnly,
      }
    );
  }, [
    eligibleCatalogHackathons,
    sourceFilter,
    campusFilter,
    searchQuery,
    timePreset,
    customStart,
    customEnd,
    openRegistrationOnly,
  ]);

  // Filtered Academy Announcements (strictly by original publication date in IST)
  const filteredAnnouncements = useMemo(() => {
    return filterAnnouncementsByPublicationDate(academyAnnouncements, {
      preset: timePreset,
      customStart,
      customEnd,
      searchQuery,
    });
  }, [academyAnnouncements, timePreset, customStart, customEnd, searchQuery]);

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
            verifyRes.userMessage ?? 'URL verification failed. Enter details manually.'
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
          verifyRes.status === 'redirected_valid' ? 'redirected_valid' : 'verified'
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
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUrlError(null);
    setUrlWarnings([]);
    setCandidateSourceOverride('uploaded_brochure_or_poster');

    const allowedTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
    ];
    if (!allowedTypes.includes(file.type)) {
      setUrlError(
        `Unsupported file type "${file.type}". Please upload a PDF brochure or PNG/JPG/WebP poster.`
      );
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUrlError('File exceeds 10MB limit. Please upload a smaller brochure or poster.');
      return;
    }

    setUploadedAttachmentMeta({
      fileName: file.name,
      mimeType: file.type,
      byteSize: file.size,
    });

    const reader = new FileReader();
    reader.onload = async () => {
      const resultStr = String(reader.result || '');
      const base64Data = resultStr.includes(',')
        ? resultStr.split(',')[1]
        : resultStr;

      setIsExtractingLive(true);
      try {
        const res = await extractLiveEventFileMetadata({
          fileName: file.name,
          mimeType: file.type,
          base64Data,
        });

        if (!res.ok || !res.draft) {
          setUrlError(
            res.errorMessage ??
              'Could not automatically extract fields from this file. Your file is attached — please enter details manually below.'
          );
          setUrlWarnings(res.warnings);
          return;
        }

        const d = res.draft;
        setUrlWarnings(res.warnings);
        setUploadedAttachmentMeta(d.uploadedAttachment);
        setExtractionEvidenceQuote(
          d.uploadedAttachment?.extractedEvidenceQuote ?? null
        );
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
        if (d.originalSubmissionUrl)
          setOriginalSubmissionUrl(d.originalSubmissionUrl);
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
      } finally {
        setIsExtractingLive(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitCandidate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !organizer.trim()) return;

    const cleanStartAt = startAt.trim() ? startAt.trim() : null;
    const cleanEndAt = endAt.trim() ? endAt.trim() : cleanStartAt;
    const cleanDeadline = registrationDeadline.trim()
      ? registrationDeadline.trim()
      : null;

    const fingerprint = `${title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')}_${cleanStartAt || 'date_tba'}`;

    const resolvedSource: EventSourceType =
      candidateSourceOverride ??
      (submissionTab === 'file'
        ? 'uploaded_brochure_or_poster'
        : 'submitted_public_url');

    const newCandidate: EventCandidate = {
      id: `cand_user_${Date.now()}`,
      source: resolvedSource,
      sourceUrl:
        verifiedCanonicalUrl ??
        originalSubmissionUrl ??
        (rawUrl.trim() || undefined),
      originalSubmissionUrl:
        originalSubmissionUrl ?? (rawUrl.trim() || null),
      verifiedCanonicalUrl: verifiedCanonicalUrl ?? null,
      sourceUrlStatus:
        submissionTab === 'file' && !originalSubmissionUrl
          ? 'unavailable'
          : sourceUrlStatus,
      uploadedAttachment: uploadedAttachmentMeta,
      submittedByUid: currentUser.uid,
      externalFingerprint: fingerprint,
      title: title.trim(),
      organizer: organizer.trim(),
      eventType: liveClassification.eventType,
      matchable: liveClassification.matchable,
      themes: themesInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      description: description.trim(),
      // CRITICAL: Never substitute today's date if startAt/endAt is unknown! Keep null ("Date TBA").
      startAt: cleanStartAt,
      endAt: cleanEndAt,
      registrationDeadline: cleanDeadline,
      timezone: 'Asia/Kolkata',
      venue: {
        campus: campus || null,
        name: venueName.trim() || null,
      },
      format:
        campus === 'Online / Multi-Campus'
          ? 'online'
          : campus
            ? 'onsite'
            : 'unknown',
      teamSize: {
        min: parsedMinTeam,
        max: parsedMaxTeam,
      },
      registrationUrl:
        registrationUrl.trim() ||
        verifiedCanonicalUrl ||
        originalSubmissionUrl ||
        null,
      eligibilityNotes: null,
      fieldEvidence: {
        title: [
          {
            sourceUrl:
              verifiedCanonicalUrl ||
              originalSubmissionUrl ||
              (uploadedAttachmentMeta
                ? `attachment://${uploadedAttachmentMeta.fileName}`
                : 'manual-entry'),
            excerpt:
              extractionEvidenceQuote ||
              `Submitted by ${currentUser.displayName}: "${title.trim()}"`,
          },
        ],
      },
      classification: {
        ruleGatePassed: liveClassification.ruleGatePassed,
        mlScore: liveClassification.mlScore,
        reason: liveClassification.reason,
      },
      reviewStatus:
        liveClassification.matchable &&
        parsedMinTeam !== null &&
        parsedMaxTeam !== null &&
        sourceUrlStatus === 'verified'
          ? 'new'
          : 'needs_confirmation',
      warnings: urlWarnings,
      lastSeenAt: new Date().toISOString(),
    };

    onSubmitEventCandidate(newCandidate);
    setSubmissionSuccessToast(
      `Submitted "${newCandidate.title}" to the Admin Review Queue (${
        newCandidate.startAt ? newCandidate.startAt : 'Date TBA'
      }). Unreviewed submissions stay staged until verified.`
    );
    setShowSubmitModal(false);
    setCandidateSourceOverride(null);
    setRawUrl('');
    setTitle('');
    setOrganizer('');
    setDescription('');
    setStartAt('');
    setEndAt('');
    setRegistrationDeadline('');
    setRegistrationUrl('');
    setMinTeamSize('');
    setMaxTeamSize('');
    setUploadedAttachmentMeta(undefined);
    setOriginalSubmissionUrl(null);
    setVerifiedCanonicalUrl(null);
  };

  const todayIst = getTodayDateStringIST();

  return (
    <div className="space-y-4">
      {/* Compact Header Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Hackathons
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Discover verified team hackathons, ideathons, CTFs, and coding competitions from{' '}
            <span className="font-mono text-slate-700 dark:text-slate-300">
              events.pes.edu
            </span>{' '}
            and community submissions.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {sourceFilter !== 'MY_ACADEMY' && (
            <button
              type="button"
              disabled={isSyncingPesuPublic}
              onClick={() => void handleSyncPesuPublicEvents(true)}
              title="Fetch latest public hackathon listings from events.pes.edu"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isSyncingPesuPublic ? 'animate-spin text-blue-600' : ''}`}
              />
              <span>Sync events.pes.edu</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setCandidateSourceOverride(null);
              setShowSubmitModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Suggest Hackathon</span>
          </button>
        </div>
      </div>

      {submissionSuccessToast && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between gap-3 text-xs text-emerald-900 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{submissionSuccessToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setSubmissionSuccessToast(null)}
            className="text-emerald-700 hover:underline font-medium cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Unified Source Distinction Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
          <div
            role="tablist"
            aria-label="Hackathon discovery sources"
            className="flex flex-wrap items-center gap-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={sourceFilter === 'ALL_PUBLISHED'}
              onClick={() => setSourceFilter('ALL_PUBLISHED')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                sourceFilter === 'ALL_PUBLISHED'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span>All Hackathons</span>
              <span className="font-mono text-[11px] opacity-75">
                ({sourceCounts.allCount})
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={sourceFilter === 'PES_PUBLIC'}
              onClick={() => setSourceFilter('PES_PUBLIC')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                sourceFilter === 'PES_PUBLIC'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>PESU Public Events</span>
              <span className="font-mono text-[11px] opacity-75">
                ({sourceCounts.pesPublicCount})
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={sourceFilter === 'COMMUNITY_VERIFIED'}
              onClick={() => setSourceFilter('COMMUNITY_VERIFIED')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                sourceFilter === 'COMMUNITY_VERIFIED'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Verified Community Submissions</span>
              <span className="font-mono text-[11px] opacity-75">
                ({sourceCounts.communityCount})
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={sourceFilter === 'MY_ACADEMY'}
              onClick={() => setSourceFilter('MY_ACADEMY')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                sourceFilter === 'MY_ACADEMY'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>My PESU Academy Announcements</span>
              {announcementsResponseState.ok && (
                <span className="font-mono text-[11px] opacity-85">
                  ({sourceCounts.academyCount})
                </span>
              )}
            </button>
          </div>

          <span className="text-[11px] text-slate-400 font-mono">
            IST (Asia/Kolkata): {todayIst}
          </span>
        </div>

        {/* Date Filter Bar (Upcoming, This Week, This Month, Past, All) */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-semibold text-slate-500 mr-1 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {sourceFilter === 'MY_ACADEMY' ? 'Published:' : 'Date:'}
            </span>
            {(
              [
                { id: 'UPCOMING', label: sourceFilter === 'MY_ACADEMY' ? 'Latest' : 'Upcoming' },
                { id: 'THIS_WEEK', label: 'This Week' },
                { id: 'THIS_MONTH', label: 'This Month' },
                { id: 'PAST', label: 'Past' },
                { id: 'ALL', label: 'All' },
                { id: 'CUSTOM', label: 'Custom Range' },
              ] as { id: TimeFilterPreset; label: string }[]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTimePreset(item.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  timePreset === item.id
                    ? 'bg-slate-900 dark:bg-blue-600 text-white font-semibold'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {sourceFilter !== 'MY_ACADEMY' && (
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={openRegistrationOnly}
                onChange={(e) => setOpenRegistrationOnly(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Open registration only</span>
            </label>
          )}
        </div>

        {timePreset === 'CUSTOM' && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-slate-500 font-medium">From (IST):</span>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
            />
            <span className="text-slate-500 font-medium">To (IST):</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
            />
            {(customStart || customEnd) && (
              <button
                type="button"
                onClick={() => {
                  setCustomStart('');
                  setCustomEnd('');
                }}
                className="text-blue-600 hover:underline font-medium cursor-pointer"
              >
                Clear dates
              </button>
            )}
          </div>
        )}

        {/* Search + Campus Filter Row (No Workshop/Talk Filter) */}
        <div className="flex flex-col md:flex-row gap-2.5 pt-1">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                sourceFilter === 'MY_ACADEMY'
                  ? 'Search your PESU Academy announcements...'
                  : 'Search hackathons by name, campus, or domain...'
              }
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-blue-500"
            />
          </div>

          {sourceFilter !== 'MY_ACADEMY' && (
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                aria-label="Filter by campus"
                value={campusFilter}
                onChange={(e) =>
                  setCampusFilter(e.target.value as CampusType | 'ALL')
                }
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-slate-700 dark:text-slate-300"
              >
                <option value="ALL">All Campuses</option>
                <option value="RR Campus">RR Campus</option>
                <option value="EC Campus">EC Campus</option>
                <option value="HN Campus">HN Campus</option>
                <option value="Online / Multi-Campus">Online / Multi-Campus</option>
              </select>
            </div>
          )}
        </div>

        {/* Status Note for PESU Public Events Sync */}
        {sourceFilter === 'PES_PUBLIC' && lastPublicSyncMeta && (
          <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 border-t border-slate-100 dark:border-slate-800">
            <span>
              Source:{' '}
              <a
                href="https://events.pes.edu"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-medium"
              >
                https://events.pes.edu
              </a>{' '}
              · {lastPublicSyncMeta.userMessage}
            </span>
            <span className="font-mono">
              Checked: {new Date(lastPublicSyncMeta.fetchedAt).toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* VIEW A: MY PESU ACADEMY ANNOUNCEMENTS (PRIVATE, CONSENT-GATED)       */}
      {/* ==================================================================== */}
      {sourceFilter === 'MY_ACADEMY' ? (
        <div className="space-y-3">
          {/* Delegated Credential-Storage Disclosure & Privacy Notice */}
          <div className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/50 rounded-xl p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Private PESU Academy Announcements · Explicit Student Consent & Delegated Access
                </h2>
              </div>
              {currentUser.privacyPreferences.academyAnnouncementsOptIn && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isLoadingAnnouncements}
                    onClick={() => void fetchAcademyAnnouncements(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${isLoadingAnnouncements ? 'animate-spin' : ''}`}
                    />
                    <span>Refresh Feed</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSavingOptIn}
                    onClick={() => void handleToggleAcademyOptIn(false)}
                    className="text-[11px] text-slate-500 hover:text-rose-600 underline cursor-pointer"
                  >
                    Disable Opt-In
                  </button>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              <strong>How PESU-Dev Delegated Access Works:</strong> Standard PESU Sign-In (
              <code className="font-mono text-[11px]">openid profile email</code>) only verifies your student identity and never stores your PESU Academy password. Optional announcement access (
              <code className="font-mono text-[11px]">announcements:read</code>) uses the PESU OAuth2 provider&apos;s{' '}
              <strong>delegated mode</strong>, which requires the provider (
              <code className="font-mono text-[11px]">pesu-oauth2.onrender.com</code>) to seal your PESU Academy credentials in an encrypted vault to fetch announcements on your behalf. Quackathon never receives your password, never exposes your Academy access token to the browser, and never publishes your private announcements automatically.
            </p>

            <div className="pt-2 border-t border-amber-200/70 dark:border-amber-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
              <p className="text-slate-600 dark:text-slate-300">
                <strong>Missing a PESU Academy Homepage Banner Event?</strong>{' '}
                Homepage carousel banners (e.g., ReRo Online Hackathon, International Hour, The Alumni Playbook, Weekend CTF Workshops) are rendered by a separate portal widget not exposed by{' '}
                <code className="font-mono text-[11px]">/api/v1/announcements</code>.
              </p>
              <button
                type="button"
                data-testid="submit-homepage-banner-btn"
                onClick={() => setShowSubmitModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold hover:opacity-90 shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Submit Banner / Poster / Event Link</span>
              </button>
            </div>
          </div>

          {/* State 1: Opt-In Required */}
          {!currentUser.privacyPreferences.academyAnnouncementsOptIn ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 text-center space-y-3">
              <ShieldCheck className="w-7 h-7 text-amber-600 mx-auto" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Optional PESU Academy Announcement Access is Off
              </h3>
              <p className="text-xs text-slate-500 max-w-lg mx-auto">
                Enable optional delegated access if you want Quackathon to retrieve your PESU Academy announcements privately and highlight technical events you can suggest for review.
              </p>
              <div className="pt-1 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  disabled={isSavingOptIn}
                  onClick={() => void handleToggleAcademyOptIn(true)}
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isSavingOptIn
                    ? 'Saving Preference...'
                    : 'I Understand — Enable Optional Academy Announcements'}
                </button>
              </div>
            </div>
          ) : isLoadingAnnouncements ? (
            /* State 2: Loading */
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Fetching your PESU Academy announcements from PESU-Dev resource server...
              </p>
            </div>
          ) : !announcementsResponseState.ok ? (
            /* State 3: Distinct Authorization / Missing Scope / Expired Session / Upstream Error States */
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-800/70 p-6 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {announcementsResponseState.errorCode ===
                        'MISSING_ANNOUNCEMENTS_SCOPE' ||
                      announcementsResponseState.errorCode ===
                        'DELEGATED_CREDENTIALS_REQUIRED'
                        ? 'Additional PESU OAuth2 Permission Required (announcements:read)'
                        : announcementsResponseState.errorCode ===
                              'TOKEN_EXPIRED_OR_REVOKED' ||
                            announcementsResponseState.errorCode ===
                              'AUTH_REQUIRED'
                          ? 'PESU OAuth2 Session Required or Expired'
                          : 'PESU Academy Announcements Currently Unavailable'}
                    </h3>
                    {announcementsResponseState.errorCode && (
                      <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-mono text-[10px] font-semibold">
                        {announcementsResponseState.errorCode}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {announcementsResponseState.userMessage}
                  </p>

                  {announcementsResponseState.grantedScopes &&
                    announcementsResponseState.grantedScopes.length > 0 && (
                      <p className="text-[11px] font-mono text-slate-500">
                        Currently granted scopes:{' '}
                        {announcementsResponseState.grantedScopes.join(', ')}
                      </p>
                    )}

                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    {(announcementsResponseState.requiresScopeGrant ||
                      announcementsResponseState.requiresReauth ||
                      announcementsResponseState.errorCode ===
                        'AUTH_REQUIRED' ||
                      announcementsResponseState.errorCode ===
                        'MISSING_ANNOUNCEMENTS_SCOPE' ||
                      announcementsResponseState.errorCode ===
                        'DELEGATED_CREDENTIALS_REQUIRED' ||
                      announcementsResponseState.errorCode ===
                        'TOKEN_EXPIRED_OR_REVOKED') &&
                      onConnectPesuAcademy && (
                        <>
                          <button
                            type="button"
                            onClick={() => onConnectPesuAcademy('popup')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>
                              Authorize PESU Academy Access (announcements:read)
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onConnectPesuAcademy('redirect')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-semibold cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Authorize (Full-Page Redirect)</span>
                          </button>
                        </>
                      )}

                    <button
                      type="button"
                      onClick={() => void fetchAcademyAnnouncements(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Retry</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : filteredAnnouncements.length === 0 ? (
            /* State 4: True Empty State (Authorized & Succeeded, 0 matching announcements) */
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {academyAnnouncements.length === 0
                  ? '0 announcements returned from your PESU Academy feed.'
                  : 'No announcements match your current publication date or search filter.'}
              </p>
              {academyAnnouncements.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setTimePreset('ALL');
                    setSearchQuery('');
                  }}
                  className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                >
                  Show all {academyAnnouncements.length} announcement(s)
                </button>
              )}
            </div>
          ) : (
            /* State 5: Grounded Announcement Cards with Technical Event Detection */
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                <span>
                  Showing {filteredAnnouncements.length} of{' '}
                  {academyAnnouncements.length} private announcement(s)
                </span>
                {announcementsResponseState.fetchedAt && (
                  <span className="font-mono">
                    Fetched:{' '}
                    {new Date(
                      announcementsResponseState.fetchedAt
                    ).toLocaleString()}
                  </span>
                )}
              </div>

              {filteredAnnouncements.map((ann) => {
                const detected = detectTechnicalEventFromAnnouncement(ann);
                return (
                  <div
                    key={ann.id}
                    className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-semibold">
                            Private Academy Announcement
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">
                            Published: {ann.date ?? 'Date Unstated'}
                          </span>
                          {ann.attachments > 0 && (
                            <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {ann.attachments} attachment
                              {ann.attachments === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {ann.title}
                        </h3>
                      </div>
                    </div>

                    {ann.description && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line line-clamp-4">
                        {ann.description}
                      </p>
                    )}

                    {/* Evidence-Based Technical Event Candidate Box */}
                    {detected && (
                      <div className="mt-2 pt-2.5 border-t border-slate-100 dark:border-slate-800 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              Detected Technical Event Candidate:
                            </span>
                            <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 text-[10px] font-semibold uppercase">
                              {detected.eventType.replace('_', ' ')}
                            </span>
                            <span className="text-[11px] text-slate-600 dark:text-slate-400">
                              · Event Date:{' '}
                              <strong>
                                {detected.startAt
                                  ? `${detected.startAt}${
                                      detected.endAt &&
                                      detected.endAt !== detected.startAt
                                        ? ` to ${detected.endAt}`
                                        : ''
                                    }`
                                  : 'Date TBA (not stated in text)'}
                              </strong>
                            </span>
                            {detected.venueName || detected.campus ? (
                              <span className="text-[11px] text-slate-600 dark:text-slate-400">
                                ·{' '}
                                {[detected.venueName, detected.campus]
                                  .filter(Boolean)
                                  .join(', ')}
                              </span>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              handleOpenSuggestFromAnnouncement(ann)
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 text-white text-xs font-semibold cursor-pointer shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Suggest Event for Review</span>
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span>
                            Personal details and raw announcement text are stripped by default before staging for admin review.
                          </span>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-slate-700 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={Boolean(
                                includeSanitizedSummaryById[ann.id]
                              )}
                              onChange={(e) =>
                                setIncludeSanitizedSummaryById((prev) => ({
                                  ...prev,
                                  [ann.id]: e.target.checked,
                                }))
                              }
                              className="rounded border-slate-300"
                            />
                            <span>Include sanitized excerpt</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* ==================================================================== */
        /* VIEW B: MINIMAL HACKATHONS DISCOVERY GRID                            */
        /* ==================================================================== */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredHackathons.length === 0 ? (
            <div className="col-span-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2.5">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                No hackathons match your current date or source filters.
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                {timePreset === 'UPCOMING'
                  ? 'Switch the date filter to "All" or "Past" to view earlier or undated hackathons, or sync official listings from events.pes.edu.'
                  : 'Try broadening your date filter, clearing search keywords, or suggesting a verified hackathon.'}
              </p>
              <div className="pt-1 flex flex-wrap justify-center gap-2">
                {timePreset !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setTimePreset('ALL')}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
                  >
                    Show All Hackathons
                  </button>
                )}
                <button
                  type="button"
                  disabled={isSyncingPesuPublic}
                  onClick={() => void handleSyncPesuPublicEvents(true)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer"
                >
                  Sync events.pes.edu
                </button>
              </div>
            </div>
          ) : (
            filteredHackathons.map((h) => {
              const dateDisplay = formatEventDateDisplayIST(h);
              const regStatus = getVerifiableRegistrationStatus(h, todayIst);
              const hasVerifiedTeamSize =
                h.minTeamSize !== null && h.maxTeamSize !== null;
              const locationDisplay =
                h.format === 'online'
                  ? h.venue.campus && h.venue.campus !== 'Online / Multi-Campus'
                    ? `Online · ${h.venue.campus}`
                    : 'Online'
                  : [h.venue.name, h.venue.campus].filter(Boolean).join(' · ') ||
                    'PES University';

              return (
                <div
                  key={h.id}
                  data-testid={`hackathon-card-${h.id}`}
                  className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                >
                  <div className="space-y-2">
                    {/* Top Row: Registration Status Badge */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                        {formatEventTypeCategoryLabel(h.eventType)}
                      </span>

                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded ${
                          regStatus.isOpen
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : regStatus.status === 'unknown'
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {regStatus.label}
                      </span>
                    </div>

                    {/* 1. Hackathon Name */}
                    <button
                      type="button"
                      onClick={() => setSelectedDetailHackathon(h)}
                      className="text-left group cursor-pointer block w-full"
                    >
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 leading-snug transition-colors">
                        {h.name}
                      </h2>
                    </button>

                    {/* 2. Date, 3. Campus/Location, 4. Team Size (only if verified) */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400 pt-0.5">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-800 dark:text-slate-200">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {dateDisplay}
                      </span>

                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        {locationDisplay}
                      </span>

                      {hasVerifiedTeamSize && (
                        <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          {h.minTeamSize === h.maxTeamSize
                            ? `${h.minTeamSize} members`
                            : `${h.minTeamSize}–${h.maxTeamSize} members`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Footer: View Details + Find Teammates */}
                  <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedDetailHackathon(h)}
                      className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                    >
                      View Details
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectHackathonForDiscovery(h.id)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
                    >
                      Find Teammates
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* EVENT DETAIL VIEW MODAL (Full Description, Organizer, Source Links)  */}
      {/* ==================================================================== */}
      {selectedDetailHackathon && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-detail-modal-title"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-8">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                    {formatEventTypeCategoryLabel(selectedDetailHackathon.eventType)}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
                    {getHackathonSourceLabel(selectedDetailHackathon).label}
                  </span>
                </div>
                <h2
                  id="event-detail-modal-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100"
                >
                  {selectedDetailHackathon.name}
                </h2>
                <p className="text-xs text-slate-500">
                  Organized by {selectedDetailHackathon.organizer}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDetailHackathon(null)}
                className="text-xs text-slate-500 hover:text-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 cursor-pointer shrink-0"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
                <div>
                  <div className="text-[11px] text-slate-500 font-medium">
                    Event Date (IST)
                  </div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {formatEventDateDisplayIST(selectedDetailHackathon)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 font-medium">
                    Location / Format
                  </div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {selectedDetailHackathon.format === 'online'
                      ? 'Online'
                      : [
                          selectedDetailHackathon.venue.name,
                          selectedDetailHackathon.venue.campus,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'PES University'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 font-medium">
                    Registration Status
                  </div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {
                      getVerifiableRegistrationStatus(
                        selectedDetailHackathon,
                        todayIst
                      ).label
                    }
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 font-medium">
                    Team Size
                  </div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {selectedDetailHackathon.minTeamSize !== null &&
                    selectedDetailHackathon.maxTeamSize !== null
                      ? selectedDetailHackathon.minTeamSize ===
                        selectedDetailHackathon.maxTeamSize
                        ? `${selectedDetailHackathon.minTeamSize} members`
                        : `${selectedDetailHackathon.minTeamSize}–${selectedDetailHackathon.maxTeamSize} members`
                      : 'Not specified on official page'}
                  </div>
                </div>
              </div>

              {selectedDetailHackathon.description && (
                <div className="space-y-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    About this Hackathon
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                    {selectedDetailHackathon.description}
                  </p>
                </div>
              )}

              {/* Verified Source & Registration Links */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  Official Links & Provenance
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedDetailHackathon.registrationUrl &&
                    selectedDetailHackathon.registrationUrl.startsWith('http') && (
                      <a
                        href={selectedDetailHackathon.registrationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                      >
                        <span>Registration Link</span>
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
                      ].filter((u): u is string => Boolean(u))
                    )
                  ).map((url, idx) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold"
                    >
                      <span>
                        Official Source Page{idx > 0 ? ` #${idx + 1}` : ''}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50/50 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setSelectedDetailHackathon(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = selectedDetailHackathon.id;
                  setSelectedDetailHackathon(null);
                  onSelectHackathonForDiscovery(id);
                }}
                className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                Find Teammates for this Hackathon
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SUGGEST EVENT MODAL (URL EXTRACTION OR BROCHURE/POSTER UPLOAD)       */}
      {/* ==================================================================== */}
      {showSubmitModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="suggest-event-modal-title"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-8">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2
                  id="suggest-event-modal-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100"
                >
                  {candidateSourceOverride === 'academy_opt_in_hint'
                    ? 'Suggest Event from PESU Academy Announcement'
                    : 'Suggest a Public Event or Upload Brochure'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  All submissions enter the Admin Review Queue first. Leave dates blank if unknown (&quot;Date TBA&quot;).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                className="text-xs text-slate-500 hover:text-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              {/* Source Method Tabs */}
              <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-50 dark:bg-slate-800/60">
                <button
                  type="button"
                  onClick={() => setSubmissionTab('url')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    submissionTab === 'url'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>Public Event URL</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSubmissionTab('file')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    submissionTab === 'file'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Poster / PDF Brochure</span>
                </button>
              </div>

              {submissionTab === 'url' ? (
                <div className="space-y-2.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Step 1: Verify & Extract from Public Event URL (Optional)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={rawUrl}
                      onChange={(e) => setRawUrl(e.target.value)}
                      placeholder="https://events.pes.edu/11629/ or Unstop / Devfolio link"
                      className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                    <button
                      type="button"
                      disabled={isExtractingLive}
                      onClick={handleFetchUrlPreview}
                      className="px-3 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 shrink-0 cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isExtractingLive && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      <span>
                        {isExtractingLive ? 'Verifying...' : 'Verify & Extract'}
                      </span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <div className="flex flex-wrap gap-1.5">
                      <span>Quick fill:</span>
                      <button
                        type="button"
                        onClick={() =>
                          setRawUrl('https://events.pes.edu/11629/')
                        }
                        className="text-blue-600 hover:underline cursor-pointer"
                      >
                        events.pes.edu Hackathon
                      </button>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() =>
                          setRawUrl('https://events.pes.edu/11632/')
                        }
                        className="text-amber-600 hover:underline cursor-pointer"
                      >
                        events.pes.edu Talk (Excluded)
                      </button>
                    </div>

                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useAiFallbackForUrl}
                        onChange={(e) =>
                          setUseAiFallbackForUrl(e.target.checked)
                        }
                        className="rounded border-slate-300"
                      />
                      <span>AI fallback if unstructured</span>
                    </label>
                  </div>

                  {originalSubmissionUrl && (
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-600 dark:text-slate-300">
                          URL Status:
                        </span>
                        <span className="font-mono font-semibold uppercase text-blue-600">
                          {sourceUrlStatus}
                        </span>
                      </div>
                      {verifiedCanonicalUrl && (
                        <div className="font-mono text-emerald-700 dark:text-emerald-400 truncate">
                          Canonical: {verifiedCanonicalUrl}
                        </div>
                      )}
                      {redirectChainInfo.length > 1 && (
                        <div className="text-slate-400 truncate">
                          Redirects: {redirectChainInfo.join(' → ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Step 1: Upload Official Event Brochure (PDF) or Poster (PNG/JPG/WebP)
                  </label>
                  <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center space-y-2 bg-slate-50/50 dark:bg-slate-800/30">
                    <FileText className="w-6 h-6 text-slate-400 mx-auto" />
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      <label className="text-blue-600 font-semibold hover:underline cursor-pointer">
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
                      <div className="inline-flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Extracting grounded text from file...</span>
                      </div>
                    )}
                    {uploadedAttachmentMeta && (
                      <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                        Attached: {uploadedAttachmentMeta.fileName} (
                        {Math.round(uploadedAttachmentMeta.byteSize / 1024)} KB)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {urlError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-start gap-2 text-xs text-rose-800 dark:text-rose-200">
                  <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{urlError}</span>
                </div>
              )}

              {urlWarnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 space-y-1 text-xs text-amber-800 dark:text-amber-200">
                  {urlWarnings.map((w, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Candidate Form */}
              <form
                onSubmit={handleSubmitCandidate}
                className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Event Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g., HackPES 2026: Systems & AI"
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Organizer / Club *
                    </label>
                    <input
                      type="text"
                      required
                      value={organizer}
                      onChange={(e) => setOrganizer(e.target.value)}
                      placeholder="e.g., PES CSE & ACM Student Chapter"
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Description & Format Details
                  </label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Grounded event overview..."
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                {/* Live Rule-Based Classifier Preview */}
                <div
                  className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                    liveClassification.matchable
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 text-emerald-900 dark:text-emerald-200'
                      : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">
                      Detected Type:{' '}
                      <span className="uppercase font-mono">
                        {liveClassification.eventType}
                      </span>{' '}
                      (team matchable = {String(liveClassification.matchable)})
                    </div>
                    <div className="text-[11px] opacity-85">
                      {liveClassification.reason}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Campus
                    </label>
                    <select
                      value={campus}
                      onChange={(e) =>
                        setCampus(e.target.value as CampusType | '')
                      }
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    >
                      <option value="">Unconfirmed</option>
                      <option value="RR Campus">RR Campus</option>
                      <option value="EC Campus">EC Campus</option>
                      <option value="HN Campus">HN Campus</option>
                      <option value="Online">Online</option>
                      <option value="Cross-Campus">Cross-Campus</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Venue / Room
                    </label>
                    <input
                      type="text"
                      value={venueName}
                      onChange={(e) => setVenueName(e.target.value)}
                      placeholder="Leave blank if TBA"
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Min Team
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      placeholder="Null"
                      value={minTeamSize}
                      onChange={(e) => setMinTeamSize(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Max Team
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      placeholder="Null"
                      value={maxTeamSize}
                      onChange={(e) => setMaxTeamSize(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Start Date (blank = Date TBA)
                    </label>
                    <input
                      type="date"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={endAt}
                      onChange={(e) => setEndAt(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Registration Deadline
                    </label>
                    <input
                      type="date"
                      value={registrationDeadline}
                      onChange={(e) => setRegistrationDeadline(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Official Registration Link
                    </label>
                    <input
                      type="url"
                      value={registrationUrl}
                      onChange={(e) => setRegistrationUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Themes (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={themesInput}
                      onChange={(e) => setThemesInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSubmitModal(false)}
                    className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    Stage for Admin Review
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
