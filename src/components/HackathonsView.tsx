import React, { useState, useMemo, useEffect } from 'react';
import {
  CampusType,
  EventCandidate,
  ExecutionMode,
  FieldEvidence,
  Hackathon,
  PrivateAcademyHint,
  User,
} from '../types/domain';
import {
  Calendar,
  MapPin,
  Users,
  Plus,
  ExternalLink,
  Search,
  ChevronDown,
  ChevronUp,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import {
  classifyEventCandidateText,
  extractLiveEventFileMetadata,
  extractLiveEventUrlMetadata,
  extractPublicEventPreview,
} from '../services/adapters';
import { apiFetch } from '../lib/apiClient';
import { Modal } from './Modal';

interface HackathonsViewProps {
  currentUser: User;
  executionMode: ExecutionMode;
  hackathons: Hackathon[];
  privateAcademyHints: PrivateAcademyHint[];
  onSelectHackathonForDiscovery: (hackathonId: string) => void;
  onSubmitEventCandidate: (candidate: EventCandidate) => void;
}

export const HackathonsView: React.FC<HackathonsViewProps> = React.memo(
  ({
    currentUser,
    executionMode,
    hackathons,
    privateAcademyHints,
    onSelectHackathonForDiscovery,
    onSubmitEventCandidate,
  }) => {
    const [filterCategory, setFilterCategory] = useState<
      'ALL' | 'MATCHABLE' | 'INFO_ONLY'
    >('ALL');
    const [campusFilter, setCampusFilter] = useState<CampusType | 'ALL'>('ALL');
    const [searchInput, setSearchInput] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [expandedEventIds, setExpandedEventIds] = useState<
      Record<string, boolean>
    >({});
    const [showAcademySection, setShowAcademySection] = useState(false);
    const [liveAcademyAnnouncements, setLiveAcademyAnnouncements] = useState<
      Array<{ id: string; title: string; dateHint: string; body: string }>
    >([]);
    const [academyStatusMsg, setAcademyStatusMsg] = useState<string | null>(
      null
    );
    const [isFetchingAcademy, setIsFetchingAcademy] = useState(false);

    // Suggest Event Modal state (Requirement #5: no hardcoded fake defaults; unknown fields remain null/empty)
    const [showSuggestModal, setShowSuggestModal] = useState(false);
    const [submissionMode, setSubmissionMode] = useState<
      'submitted_public_url' | 'uploaded_brochure_or_poster'
    >('submitted_public_url');
    const [sourceUrl, setSourceUrl] = useState('');
    const [title, setTitle] = useState('');
    const [organizer, setOrganizer] = useState('');
    const [campus, setCampus] = useState<CampusType | ''>('');
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [deadline, setDeadline] = useState('');
    const [minSize, setMinSize] = useState<string>('');
    const [maxSize, setMaxSize] = useState<string>('');
    const [description, setDescription] = useState('');
    const [extractedThemes, setExtractedThemes] = useState<string[]>([]);
    const [extractedEvidence, setExtractedEvidence] = useState<
      Record<string, FieldEvidence>
    >({});
    const [extractedWarnings, setExtractedWarnings] = useState<string[]>([]);
    const [verifiedUrl, setVerifiedUrl] = useState<string | null>(null);
    const [showMoreEventFields, setShowMoreEventFields] = useState(false);
    const [statusNote, setStatusNote] = useState<string | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);

    useEffect(() => {
      const timer = setTimeout(() => {
        setDebouncedQuery(searchInput.trim().toLowerCase());
      }, 140);
      return () => clearTimeout(timer);
    }, [searchInput]);

    const filteredEvents = useMemo(() => {
      return hackathons.filter((h) => {
        if (filterCategory === 'MATCHABLE' && !h.matchable) return false;
        if (filterCategory === 'INFO_ONLY' && h.matchable) return false;
        if (
          campusFilter !== 'ALL' &&
          h.venue.campus !== campusFilter &&
          h.venue.campus !== 'Online / Multi-Campus'
        ) {
          return false;
        }
        if (debouncedQuery) {
          const hay = `${h.name} ${h.organizer} ${h.description} ${h.themes.join(' ')}`.toLowerCase();
          if (!hay.includes(debouncedQuery)) return false;
        }
        return true;
      });
    }, [hackathons, filterCategory, campusFilter, debouncedQuery]);

    const liveClassifier = useMemo(() => {
      if (!showSuggestModal) return null;
      const minNum = minSize.trim() ? Number(minSize) : null;
      const maxNum = maxSize.trim() ? Number(maxSize) : null;
      return classifyEventCandidateText({
        title,
        description,
        minTeamSize: minNum,
        maxTeamSize: maxNum,
      });
    }, [showSuggestModal, title, description, minSize, maxSize]);

    const myAcademyHints = useMemo(
      () =>
        privateAcademyHints.filter((h) => h.ownerUid === currentUser.uid),
      [privateAcademyHints, currentUser.uid]
    );

    const toggleDetails = (id: string) => {
      setExpandedEventIds((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    const handleFetchAcademyAnnouncements = async () => {
      setIsFetchingAcademy(true);
      setAcademyStatusMsg(null);
      try {
        const res = await apiFetch<{
          ok: boolean;
          announcements?: Array<{
            id: string;
            title: string;
            dateHint: string;
            body: string;
          }>;
          error?: string;
        }>('/api/pesu/announcements');

        if (res.ok && res.data?.ok) {
          setLiveAcademyAnnouncements(res.data.announcements ?? []);
          setAcademyStatusMsg(
            res.data.announcements?.length
              ? `Loaded ${res.data.announcements.length} announcement(s) from PESU Academy.`
              : 'No new hackathon announcements found in PESU Academy.'
          );
        } else {
          setAcademyStatusMsg(
            res.data?.error ||
              res.errorMessage ||
              'PESU Academy announcement retrieval is currently unavailable.'
          );
        }
      } finally {
        setIsFetchingAcademy(false);
      }
    };

    const applyExtractedDraft = (d: Partial<EventCandidate>, warnings: string[]) => {
      if (d.title) setTitle(d.title);
      if (d.organizer) setOrganizer(d.organizer);
      if (d.description) setDescription(d.description);
      if (d.venue?.campus) setCampus(d.venue.campus);
      if (d.startAt) setStartAt(d.startAt.slice(0, 10));
      if (d.endAt) setEndAt(d.endAt.slice(0, 10));
      if (d.registrationDeadline)
        setDeadline(d.registrationDeadline.slice(0, 10));
      if (d.teamSize?.min !== undefined && d.teamSize.min !== null) {
        setMinSize(String(d.teamSize.min));
      } else {
        setMinSize('');
      }
      if (d.teamSize?.max !== undefined && d.teamSize.max !== null) {
        setMaxSize(String(d.teamSize.max));
      } else {
        setMaxSize('');
      }
      if (Array.isArray(d.themes)) {
        setExtractedThemes(d.themes);
      }
      if (d.fieldEvidence) {
        setExtractedEvidence(d.fieldEvidence);
      }
      if (d.verifiedCanonicalUrl) {
        setVerifiedUrl(d.verifiedCanonicalUrl);
      }
      setExtractedWarnings(warnings);
    };

    const handleExtractFromUrl = async (useGeminiFallback = false) => {
      if (!sourceUrl.trim()) return;
      setIsExtracting(true);
      setStatusNote(null);
      try {
        if (executionMode === 'live') {
          const res = await extractLiveEventUrlMetadata(
            sourceUrl.trim(),
            useGeminiFallback,
            useGeminiFallback
          );
          if (res.ok && res.draft) {
            applyExtractedDraft(res.draft, res.warnings ?? []);
            setStatusNote(
              useGeminiFallback
                ? 'Extracted available event facts from URL (with AI fallback). Unspecified fields remain blank.'
                : 'Extracted available metadata deterministically from URL. Unspecified fields remain blank.'
            );
            return;
          }
          setStatusNote(res.errorMessage || 'Could not extract metadata from URL.');
          return;
        }

        const preview = extractPublicEventPreview(sourceUrl.trim());
        applyExtractedDraft(preview.draft, preview.warnings);
        setStatusNote(preview.warnings[0] || 'Loaded preview.');
      } finally {
        setIsExtracting(false);
      }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsExtracting(true);
      setStatusNote(null);
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64Data = String(reader.result || '');
          const res = await extractLiveEventFileMetadata({
            fileName: file.name,
            mimeType: file.type || 'image/png',
            base64Data,
          });
          if (res.ok && res.draft) {
            applyExtractedDraft(res.draft, res.warnings ?? []);
            setStatusNote(`Extracted available facts from ${file.name}.`);
          } else {
            setStatusNote(
              res.errorMessage ||
                'Poster uploaded. Fill in any remaining details below.'
            );
          }
          setIsExtracting(false);
        };
        reader.readAsDataURL(file);
      } catch {
        setIsExtracting(false);
        setStatusNote('Could not read file.');
      }
    };

    const handleSubmitCandidate = (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim() || !organizer.trim()) return;
      const minNum = minSize.trim() ? Number(minSize) : null;
      const maxNum = maxSize.trim() ? Number(maxSize) : null;
      const cls = classifyEventCandidateText({
        title: title.trim(),
        description: description.trim(),
        minTeamSize: minNum,
        maxTeamSize: maxNum,
      });

      const warnings = [...extractedWarnings];
      if (minNum === null || maxNum === null) {
        warnings.push('Team size bounds not specified in source; marked unconfirmed.');
      }
      if (cls.eventType === 'unknown') {
        warnings.push('Event type is unconfirmed and requires moderator review.');
      }

      const candidate: EventCandidate = {
        id: `cand_${Date.now()}`,
        source: submissionMode,
        sourceUrl: sourceUrl.trim() || undefined,
        originalSubmissionUrl: sourceUrl.trim() || null,
        verifiedCanonicalUrl: verifiedUrl,
        sourceUrlStatus: verifiedUrl
          ? 'verified_canonical'
          : sourceUrl.trim()
          ? 'unverified'
          : 'unavailable',
        submittedByUid: currentUser.uid,
        externalFingerprint: `${organizer
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')}__${title
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')}__${startAt || 'undated'}`,
        title: title.trim(),
        organizer: organizer.trim(),
        eventType: cls.eventType,
        matchable: cls.matchable,
        themes: extractedThemes,
        description:
          description.trim() ||
          'Student-submitted event awaiting moderator review.',
        startAt: startAt || new Date().toISOString().slice(0, 10),
        endAt: endAt || startAt || new Date().toISOString().slice(0, 10),
        registrationDeadline: deadline || null,
        timezone: 'Asia/Kolkata',
        venue: {
          campus: campus ? (campus as CampusType) : null,
          name: null,
        },
        format: campus === 'Online / Multi-Campus' ? 'online' : 'onsite',
        teamSize: {
          min: minNum,
          max: maxNum,
        },
        registrationUrl: verifiedUrl ?? (sourceUrl.trim() || null),
        eligibilityNotes: null,
        fieldEvidence: extractedEvidence,
        classification: {
          ruleGatePassed: cls.ruleGatePassed,
          mlScore: cls.mlScore,
          reason: cls.reason,
        },
        reviewStatus:
          cls.eventType === 'unknown' || minNum === null || maxNum === null
            ? 'needs_confirmation'
            : 'new',
        warnings: Array.from(new Set(warnings)),
        lastSeenAt: new Date().toISOString(),
      };

      onSubmitEventCandidate(candidate);
      setTitle('');
      setOrganizer('');
      setDescription('');
      setSourceUrl('');
      setStartAt('');
      setEndAt('');
      setDeadline('');
      setMinSize('');
      setMaxSize('');
      setExtractedThemes([]);
      setExtractedEvidence({});
      setExtractedWarnings([]);
      setVerifiedUrl(null);
      setShowSuggestModal(false);
    };

    const formatDateShort = (iso: string | null) => {
      if (!iso) return 'TBA';
      return iso.slice(0, 10);
    };

    return (
      <div className="space-y-4">
        {/* Compact Top Filter & Action Bar */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg self-start">
              <button
                type="button"
                onClick={() => setFilterCategory('ALL')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterCategory === 'ALL'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                All ({hackathons.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterCategory('MATCHABLE')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterCategory === 'MATCHABLE'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Team Hackathons
              </button>
              <button
                type="button"
                onClick={() => setFilterCategory('INFO_ONLY')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterCategory === 'INFO_ONLY'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Workshops & Solo
              </button>
            </div>

            {/* Search, Campus Filter & Suggest Button */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:w-48">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search events..."
                  aria-label="Search events"
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <select
                value={campusFilter}
                onChange={(e) =>
                  setCampusFilter(e.target.value as CampusType | 'ALL')
                }
                aria-label="Filter by campus"
                className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <option value="ALL">All Campuses</option>
                <option value="RR Campus">RR Campus</option>
                <option value="EC Campus">EC Campus</option>
                <option value="Online / Multi-Campus">Online / Multi</option>
              </select>

              <button
                type="button"
                onClick={() => setShowSuggestModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Suggest Event
              </button>
            </div>
          </div>
        </div>

        {/* Compact Event Cards Grid */}
        {filteredEvents.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No verified hackathons published yet.
            </p>
            <p className="text-xs text-slate-500">
              Click &ldquo;Suggest Event&rdquo; above to submit a real campus hackathon URL or poster for review.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredEvents.map((event) => {
              const isExpanded = Boolean(expandedEventIds[event.id]);
              const validUrl =
                event.sourceUrlStatus !== 'unavailable' &&
                (event.verifiedCanonicalUrl ||
                  event.registrationUrl ||
                  event.originalSubmissionUrl);

              return (
                <div
                  key={event.id}
                  className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {event.eventType.replace('_', ' ')} · {event.organizer}
                        </span>
                        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                          {event.name}
                        </h3>
                      </div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                        {event.venue.campus ?? 'Campus Unspecified'}
                      </span>
                    </div>

                    {/* Essential Metadata Line */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {formatDateShort(event.startAt)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        {event.minTeamSize !== null && event.maxTeamSize !== null
                          ? event.minTeamSize === event.maxTeamSize
                            ? `${event.minTeamSize} member`
                            : `${event.minTeamSize}–${event.maxTeamSize} members`
                          : 'Team size unconfirmed'}
                      </span>
                      {event.registrationDeadline && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            Apply by {formatDateShort(event.registrationDeadline)}
                          </span>
                        </>
                      )}
                    </div>

                    {event.themes.length > 0 && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {event.themes.slice(0, 4).join(' · ')}
                      </div>
                    )}

                    {/* Expandable Details */}
                    {isExpanded && (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                        <p className="leading-relaxed">{event.description}</p>
                        {event.venue.name && (
                          <div>
                            <strong className="text-slate-800 dark:text-slate-200">
                              Venue:
                            </strong>{' '}
                            {event.venue.name}
                          </div>
                        )}
                        {event.eligibilityNotes && (
                          <div>
                            <strong className="text-slate-800 dark:text-slate-200">
                              Eligibility:
                            </strong>{' '}
                            {event.eligibilityNotes}
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-slate-400">
                            Verification: {event.verificationStatus.replace('_', ' ')}
                          </span>
                          {validUrl ? (
                            <a
                              href={validUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Source Link
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-slate-400">
                              Uploaded document source
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card Footer: Details Toggle + Single Primary Action */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleDetails(event.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    >
                      {isExpanded ? (
                        <>
                          Hide details <ChevronUp className="w-3.5 h-3.5" />
                        </>
                      ) : (
                        <>
                          Details <ChevronDown className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>

                    {event.matchable ? (
                      <button
                        type="button"
                        onClick={() => onSelectHackathonForDiscovery(event.id)}
                        className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Find Teammates
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">
                        {event.eventType === 'unknown'
                          ? 'Unconfirmed Type'
                          : 'Solo / Workshop'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Requirement #4: Consent-based PESU Academy Announcements */}
        {currentUser.privacyPreferences.academyAnnouncementsOptIn && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-2.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowAcademySection(!showAcademySection)}
                className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <span>
                  PESU Academy Announcements (
                  {liveAcademyAnnouncements.length + myAcademyHints.length})
                </span>
                {showAcademySection ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              <button
                type="button"
                disabled={isFetchingAcademy}
                onClick={() => {
                  setShowAcademySection(true);
                  handleFetchAcademyAnnouncements();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3 h-3 ${isFetchingAcademy ? 'animate-spin' : ''}`}
                />
                {isFetchingAcademy ? 'Checking...' : 'Check PESU Academy'}
              </button>
            </div>

            {showAcademySection && (
              <div className="p-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5 text-xs">
                {academyStatusMsg && (
                  <p className="text-slate-600 dark:text-slate-400">
                    {academyStatusMsg}
                  </p>
                )}
                {liveAcademyAnnouncements.map((ann) => (
                  <div
                    key={ann.id}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-1"
                  >
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {ann.title}
                    </div>
                    <div className="text-slate-500 font-mono">
                      {ann.dateHint}
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                      {ann.body}
                    </p>
                  </div>
                ))}
                {myAcademyHints.map((hint) => (
                  <div
                    key={hint.id}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-1"
                  >
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {hint.noticeTitle}
                    </div>
                    <div className="text-slate-500 font-mono">
                      {hint.detectedDateHint}
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                      {hint.note}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Suggest Event Modal */}
        {showSuggestModal && (
          <Modal
            title="Suggest a Campus Event"
            subtitle="Submit a real event link or poster/PDF for moderator review."
            onClose={() => setShowSuggestModal(false)}
            maxWidthClass="max-w-lg"
          >
            <form onSubmit={handleSubmitCandidate} className="space-y-3.5">
              <div className="flex gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSubmissionMode('submitted_public_url')}
                  className={`flex-1 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                    submissionMode === 'submitted_public_url'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Event Link
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSubmissionMode('uploaded_brochure_or_poster')
                  }
                  className={`flex-1 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                    submissionMode === 'uploaded_brochure_or_poster'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Upload Poster / PDF
                </button>
              </div>

              {submissionMode === 'submitted_public_url' ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://events.pes.edu/... or devfolio link"
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                    />
                    <button
                      type="button"
                      disabled={isExtracting}
                      onClick={() => handleExtractFromUrl(false)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {isExtracting ? 'Reading...' : 'Extract Facts'}
                    </button>
                    <button
                      type="button"
                      disabled={isExtracting}
                      onClick={() => handleExtractFromUrl(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                      title="Optional: Use Gemini AI if deterministic metadata is incomplete"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      AI Parse
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={handleFileUpload}
                    disabled={isExtracting}
                    className="w-full text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-900 file:text-white cursor-pointer"
                  />
                </div>
              )}

              {statusNote && (
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  {statusNote}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Event Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., PES Terrapthon 2026"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Organizer *
                  </label>
                  <input
                    type="text"
                    required
                    value={organizer}
                    onChange={(e) => setOrganizer(e.target.value)}
                    placeholder="e.g., PES Innovation Lab"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Campus
                  </label>
                  <select
                    value={campus}
                    onChange={(e) =>
                      setCampus(e.target.value as CampusType | '')
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                  >
                    <option value="">Unspecified</option>
                    <option value="RR Campus">RR Campus</option>
                    <option value="EC Campus">EC Campus</option>
                    <option value="Online / Multi-Campus">Online / Multi</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Min Team
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={minSize}
                    placeholder="Unknown"
                    onChange={(e) => setMinSize(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Max Team
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxSize}
                    placeholder="Unknown"
                    onChange={(e) => setMaxSize(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tracks, eligibility, and team guidelines..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowMoreEventFields(!showMoreEventFields)}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                {showMoreEventFields ? (
                  <>
                    Hide Dates <ChevronUp className="w-3.5 h-3.5" />
                  </>
                ) : (
                  <>
                    Dates ({startAt || 'Unspecified'}){' '}
                    <ChevronDown className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

              {showMoreEventFields && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                      className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={endAt}
                      onChange={(e) => setEndAt(e.target.value)}
                      className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      Deadline
                    </label>
                    <input
                      type="date"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>
              )}

              {liveClassifier && title.trim() && (
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-xs flex items-center justify-between text-slate-600 dark:text-slate-300">
                  <span>
                    Detected Category: <strong>{liveClassifier.eventType}</strong>
                  </span>
                  <span>
                    {liveClassifier.matchable
                      ? 'Eligible for Team Matching'
                      : liveClassifier.eventType === 'unknown'
                      ? 'Requires Moderator Confirmation'
                      : 'Listed as Workshop / Solo'}
                  </span>
                </div>
              )}

              <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                >
                  Submit for Review
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    );
  }
);
