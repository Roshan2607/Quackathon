import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Lock,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  CampusType,
  EventCandidate,
  Hackathon,
  PrivateAcademyHint,
  User,
} from '../types/domain';
import {
  classifyEventCandidateText,
  extractPublicEventPreview,
} from '../services/adapters';
import { INTEREST_TAXONOMY } from '../data/seedData';

interface HackathonsViewProps {
  currentUser: User;
  hackathons: Hackathon[];
  selectedHackathonId: string;
  privateHints: PrivateAcademyHint[];
  onSelectHackathonForDiscovery: (hackathonId: string) => void;
  onToggleAcademyScope: (scope: 'announcements' | 'timetable') => void;
  onSubmitEventCandidate: (candidate: EventCandidate) => void;
}

export const HackathonsView: React.FC<HackathonsViewProps> = ({
  currentUser,
  hackathons,
  selectedHackathonId,
  privateHints,
  onSelectHackathonForDiscovery,
  onToggleAcademyScope,
  onSubmitEventCandidate,
}) => {
  const [catalogFilter, setCatalogFilter] = useState<'matchable' | 'non_matchable' | 'all'>('matchable');
  const [campusFilter, setCampusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProvenanceId, setExpandedProvenanceId] = useState<string | null>(null);

  // Suggest Event URL modal state
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [urlInput, setUrlInput] = useState('https://unstop.com/hackathons/smart-mobility-pes-2026');
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [ssrfBlockedMessage, setSsrfBlockedMessage] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftOrganizer, setDraftOrganizer] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftCampus, setDraftCampus] = useState<CampusType>('RR Campus');
  const [draftStartAt, setDraftStartAt] = useState('');
  const [draftDeadline, setDraftDeadline] = useState('');
  const [draftMinTeam, setDraftMinTeam] = useState<string>('');
  const [draftMaxTeam, setDraftMaxTeam] = useState<string>('');
  const [draftThemes, setDraftThemes] = useState<string[]>(['Applied AI/ML', 'Climate/Civic Tech']);
  const [hasParsedPreview, setHasParsedPreview] = useState(false);

  const userPrivateHints = privateHints.filter((h) => h.ownerUid === currentUser.uid);

  const filteredHackathons = hackathons.filter((h) => {
    if (catalogFilter === 'matchable' && !h.matchable) return false;
    if (catalogFilter === 'non_matchable' && h.matchable) return false;
    if (campusFilter !== 'ALL' && h.venue.campus !== campusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = h.name.toLowerCase().includes(q);
      const matchTheme = h.themes.some((t) => t.toLowerCase().includes(q));
      const matchOrg = h.organizer.toLowerCase().includes(q);
      if (!matchName && !matchTheme && !matchOrg) return false;
    }
    return true;
  });

  const handleRunUrlPreview = (targetUrl?: string) => {
    const urlToTest = targetUrl ?? urlInput;
    if (targetUrl) setUrlInput(targetUrl);

    const result = extractPublicEventPreview(urlToTest);
    setPreviewWarnings(result.warnings);
    setSsrfBlockedMessage(
      !result.validation.allowed ? result.validation.blockedReason ?? 'Blocked by policy gate' : null
    );
    setDraftTitle(result.draft.title ?? '');
    setDraftOrganizer(result.draft.organizer ?? '');
    setDraftDescription(result.draft.description ?? '');
    setDraftCampus((result.draft.venue?.campus as CampusType) ?? 'RR Campus');
    setDraftStartAt(result.draft.startAt ?? '');
    setDraftDeadline(result.draft.registrationDeadline ?? '');
    setDraftMinTeam(
      result.draft.teamSize?.min !== null && result.draft.teamSize?.min !== undefined
        ? String(result.draft.teamSize.min)
        : ''
    );
    setDraftMaxTeam(
      result.draft.teamSize?.max !== null && result.draft.teamSize?.max !== undefined
        ? String(result.draft.teamSize.max)
        : ''
    );
    if (result.draft.themes && result.draft.themes.length > 0) {
      setDraftThemes(result.draft.themes);
    }
    setHasParsedPreview(true);
  };

  const liveClassification = classifyEventCandidateText({
    title: draftTitle || 'Untitled Candidate',
    description: draftDescription,
    minTeamSize: draftMinTeam ? Number(draftMinTeam) : null,
    maxTeamSize: draftMaxTeam ? Number(draftMaxTeam) : null,
  });

  const handleStageCandidate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftTitle.trim()) return;

    const minVal = draftMinTeam.trim() ? Number(draftMinTeam) : null;
    const maxVal = draftMaxTeam.trim() ? Number(draftMaxTeam) : null;

    const newCandidate: EventCandidate = {
      id: `cand_user_${Date.now()}`,
      source: 'submitted_public_url',
      sourceUrl: urlInput.trim() || undefined,
      submittedByUid: currentUser.uid,
      externalFingerprint: `${(draftOrganizer || 'org').toLowerCase().replace(/\s+/g, '_')}__${draftTitle
        .toLowerCase()
        .replace(/\s+/g, '_')}__${draftStartAt || 'unknown_date'}`,
      title: draftTitle.trim(),
      organizer: draftOrganizer.trim() || 'Student-Submitted Organizer (Unverified)',
      eventType: liveClassification.eventType,
      matchable: liveClassification.matchable,
      themes: draftThemes,
      description:
        draftDescription.trim() ||
        'Student-submitted event candidate staged for moderator verification.',
      startAt: draftStartAt.trim() || null,
      endAt: null,
      registrationDeadline: draftDeadline.trim() || null,
      timezone: 'Asia/Kolkata',
      venue: {
        campus: draftCampus,
        name: null,
      },
      format: draftCampus === 'Online / Multi-Campus' ? 'online' : 'onsite',
      teamSize: {
        min: minVal,
        max: maxVal,
      },
      registrationUrl: urlInput.trim() || null,
      eligibilityNotes: null,
      fieldEvidence: {
        title: [
          {
            sourceUrl: urlInput.trim() || 'manual-submission',
            excerpt: `Submitted by ${currentUser.displayName}; pending moderator verification.`,
          },
        ],
      },
      classification: {
        ruleGatePassed: liveClassification.ruleGatePassed,
        mlScore: liveClassification.mlScore,
        reason: liveClassification.reason,
      },
      reviewStatus:
        minVal === null || maxVal === null ? 'needs_confirmation' : 'new',
      warnings: [
        ...(minVal === null || maxVal === null
          ? ['Team size constraints are unconfirmed (null). Reviewer must verify before enforcing capacity.']
          : []),
        ...(!liveClassification.matchable
          ? [`Classified as ${liveClassification.eventType} (matchable = false).`]
          : []),
      ],
      lastSeenAt: new Date().toISOString(),
    };

    onSubmitEventCandidate(newCandidate);
    setShowSuggestModal(false);
    setHasParsedPreview(false);
  };

  return (
    <div className="space-y-8">
      {/* Top Section Header & Action */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            PES University Verified Event Catalog · Source-Attributed Directory
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Select a Hackathon to Build For
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-2xl">
            Every matchable event has verified team rules or explicit unconfirmed flags. Workshops, seminars, and solo-only contests are separated automatically so your discovery feed stays focused on real team building.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => {
              setShowSuggestModal(true);
              handleRunUrlPreview('https://unstop.com/hackathons/smart-mobility-pes-2026');
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Suggest Missing Hackathon URL
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Segmented Event-Type Policy Filter */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg self-start">
          <button
            onClick={() => setCatalogFilter('matchable')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              catalogFilter === 'matchable'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Team-Matchable Hackathons ({hackathons.filter((h) => h.matchable).length})
          </button>
          <button
            onClick={() => setCatalogFilter('non_matchable')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              catalogFilter === 'non_matchable'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Workshops, Talks & Solo Contests ({hackathons.filter((h) => !h.matchable).length})
          </button>
          <button
            onClick={() => setCatalogFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              catalogFilter === 'all'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            All Events ({hackathons.length})
          </button>
        </div>

        {/* Campus & Search Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            {['ALL', 'RR Campus', 'EC Campus', 'Online / Multi-Campus'].map((campus) => (
              <button
                key={campus}
                onClick={() => setCampusFilter(campus)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  campusFilter === campus
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {campus === 'ALL' ? 'All Campuses' : campus.replace(' / Multi-Campus', '')}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by theme or title..."
              className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>
      </div>

      {/* Main Hackathon Cards List */}
      <div className="grid grid-cols-1 gap-4">
        {filteredHackathons.map((h) => {
          const isSelected = h.id === selectedHackathonId;
          const isUnconfirmedBounds = h.minTeamSize === null || h.maxTeamSize === null;
          const provenanceKeys = Object.keys(h.fieldProvenance);

          return (
            <div
              key={h.id}
              className={`p-6 bg-white dark:bg-slate-900 border rounded-xl transition-colors ${
                isSelected
                  ? 'border-blue-600 dark:border-blue-500'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                <div className="space-y-2.5 flex-1">
                  {/* Quiet 1-line unboxed metadata kicker with · separators */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">
                      {h.eventType.replace('_', ' ')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{h.venue.campus ?? 'Campus Not Confirmed'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{h.format.toUpperCase()}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {h.startAt ? h.startAt.slice(0, 10) : 'Date Not Confirmed'}
                    </span>
                    <span aria-hidden="true">·</span>
                    {h.matchable ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Team Matching Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Non-Matchable ({h.eventType === 'ctf' ? 'Solo CTF' : 'Workshop / Talk'})
                      </span>
                    )}
                  </div>

                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
                    {h.name}
                  </h2>

                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-3xl">
                    {h.description}
                  </p>

                  {/* Themes as clean unboxed text with separators */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 pt-1">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Tracks & Themes:</span>
                    {h.themes.map((theme, idx) => (
                      <React.Fragment key={theme}>
                        <span>{theme}</span>
                        {idx < h.themes.length - 1 && <span aria-hidden="true">·</span>}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Constraints & Provenance Row */}
                  <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-slate-400 block">Team Size Bounds</span>
                      {isUnconfirmedBounds ? (
                        <span className="font-medium text-amber-700 dark:text-amber-400 inline-flex items-center gap-1 mt-0.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Not yet confirmed (Never guessed)
                        </span>
                      ) : (
                        <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
                          {h.minTeamSize === h.maxTeamSize
                            ? `${h.maxTeamSize} member (Solo)`
                            : `${h.minTeamSize} – ${h.maxTeamSize} members`}
                        </span>
                      )}
                    </div>

                    <div>
                      <span className="text-slate-400 block">Venue & Registration Deadline</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300 mt-0.5 block">
                        {h.venue.name ?? 'Venue room not yet confirmed'} ·{' '}
                        <span className="font-mono tabular-nums">
                          {h.registrationDeadline
                            ? `Closes ${h.registrationDeadline.slice(0, 10)}`
                            : 'Deadline not yet confirmed'}
                        </span>
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block">Classifier & Source Provenance</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300 mt-0.5 block">
                        {h.organizer}
                      </span>
                    </div>
                  </div>

                  {/* Expandable Field-Level Provenance Inspection */}
                  {expandedProvenanceId === h.id && (
                    <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2 text-xs">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        Field-Level Source Provenance & 2-Stage Classifier Audit
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">
                        <span className="font-medium">Classifier Verdict:</span> {h.classification.reason} (Confidence:{' '}
                        <span className="font-mono tabular-nums">
                          {Math.round(h.classification.mlConfidenceScore * 100)}%
                        </span>
                        )
                      </p>
                      {provenanceKeys.length > 0 ? (
                        <div className="space-y-1.5 pt-1">
                          {provenanceKeys.map((fieldKey) => {
                            const entry = h.fieldProvenance[fieldKey];
                            return (
                              <div key={fieldKey} className="text-slate-600 dark:text-slate-300">
                                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                                  {fieldKey}:
                                </span>{' '}
                                “{entry.excerpt}” —{' '}
                                <span className="text-slate-500">[{entry.sourceType}]</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-slate-500">
                          No granular field excerpts recorded; classified via rule gate.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Action Column */}
                <div className="flex flex-row lg:flex-col items-stretch sm:items-end justify-between gap-2.5 shrink-0">
                  {h.matchable ? (
                    <button
                      onClick={() => onSelectHackathonForDiscovery(h.id)}
                      className={`px-4 py-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center justify-center gap-2 ${
                        isSelected
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      {isSelected ? 'Active in Discovery →' : 'Browse People & Teams'}
                    </button>
                  ) : (
                    <span className="px-3 py-2 text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-lg whitespace-nowrap shrink-0">
                      Team Assembly Disabled
                    </span>
                  )}

                  <div className="flex items-center gap-3 text-xs">
                    <button
                      onClick={() =>
                        setExpandedProvenanceId(expandedProvenanceId === h.id ? null : h.id)
                      }
                      className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 underline underline-offset-4 cursor-pointer whitespace-nowrap"
                    >
                      {expandedProvenanceId === h.id ? 'Hide Provenance' : 'Inspect Provenance'}
                    </button>

                    {h.registrationUrl && (
                      <a
                        href={h.registrationUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                      >
                        Source Page
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Private PESU Academy Opt-In Hints Panel (Architecture Section 9 Track C) */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
              <Lock className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />
              <span>PESU OAuth2 Scoped Resource Boundary (`announcements:read` · Private by Default)</span>
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Personal Academy Event Hints for {currentUser.displayName}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 max-w-3xl">
              Per Section 9: Basic sign-in requests only <code className="font-mono">openid profile</code>. Opting into <code className="font-mono">announcements:read</code> surfaces hackathon hints strictly inside your own session—your account is never used as a shared campus crawler or republished to other students without independent organizer verification.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onToggleAcademyScope('announcements')}
              className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                currentUser.privacyPreferences.academyAnnouncementsOptIn
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {currentUser.privacyPreferences.academyAnnouncementsOptIn
                ? 'announcements:read Consented (Click to Revoke)'
                : 'Opt In to announcements:read'}
            </button>
          </div>
        </div>

        {currentUser.privacyPreferences.academyAnnouncementsOptIn ? (
          userPrivateHints.length > 0 ? (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800 pt-3">
              {userPrivateHints.map((hint) => (
                <div key={hint.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {hint.noticeTitle}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Detected Date: <span className="font-mono tabular-nums">{hint.detectedDateHint}</span> · Scope: <span className="font-mono">{hint.scopeUsed}</span> · {hint.note}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowSuggestModal(true);
                      handleRunUrlPreview(hint.publicLinkFound ?? 'https://events.pes.edu/browse/?tag=hackathon');
                      setDraftTitle(hint.noticeTitle.replace('[Private Academy Notice] ', ''));
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Attach Public Organizer Link for Review
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
              No unindexed team competition notices found in your personal Academy feed today.
            </p>
          )
        ) : (
          <p className="text-xs text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
            Academy announcement scanning is currently off for your account. Core hackathon discovery and matching work without it.
          </p>
        )}
      </div>

      {/* Modal: Student-Submitted Event URL + SSRF Gate + Deterministic Preview */}
      {showSuggestModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full p-6 space-y-5 my-8">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Suggest Missing Hackathon (URL Policy Gate & Preview)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Paste an official organizer, PES events, or Unstop link. Server fetch enforces an SSRF & domain allowlist gate, keeps missing fields as null, and stages candidates for moderator approval.
                </p>
              </div>
              <button
                onClick={() => setShowSuggestModal(false)}
                className="px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              >
                Close
              </button>
            </div>

            {/* Interactive Security & Policy Test Presets */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                Quick Test Scenarios (Click to test SSRF gate, missing bounds & workshop classifier):
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleRunUrlPreview('https://events.pes.edu/11720/pes-devtools-sprint')}
                  className="px-2.5 py-1 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded-md cursor-pointer"
                >
                  1. Valid events.pes.edu URL
                </button>
                <button
                  type="button"
                  onClick={() => handleRunUrlPreview('https://unstop.com/hackathons/smart-mobility-pes-2026')}
                  className="px-2.5 py-1 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded-md cursor-pointer"
                >
                  2. Unstop URL (Missing Team Size)
                </button>
                <button
                  type="button"
                  onClick={() => handleRunUrlPreview('https://events.pes.edu/11800/kubernetes-workshop-talk')}
                  className="px-2.5 py-1 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded-md cursor-pointer"
                >
                  3. Workshop URL (Classifier Gate)
                </button>
                <button
                  type="button"
                  onClick={() => handleRunUrlPreview('http://169.254.169.254/latest/meta-data/iam')}
                  className="px-2.5 py-1 text-xs bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-md cursor-pointer"
                >
                  4. Test SSRF Block (169.254.169.254)
                </button>
                <button
                  type="button"
                  onClick={() => handleRunUrlPreview('https://www.pesuacademy.com/Academy/s/studentProfilePESU')}
                  className="px-2.5 py-1 text-xs bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-md cursor-pointer"
                >
                  5. Test Login-Wall Block (pesuacademy.com)
                </button>
              </div>
            </div>

            {/* URL Input + Parse Button */}
            <div className="flex gap-2">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://events.pes.edu/... or https://unstop.com/..."
                className="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-mono"
              />
              <button
                type="button"
                onClick={() => handleRunUrlPreview()}
                className="px-4 py-2 text-xs font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5"
              >
                <FileSearch className="w-3.5 h-3.5" />
                Parse Public Metadata
              </button>
            </div>

            {/* SSRF or Policy Alert */}
            {ssrfBlockedMessage && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2.5 text-xs text-red-800 dark:text-red-300">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Automated Server Fetch Denied (Safe Fallback Active)</span>
                  {ssrfBlockedMessage}
                </div>
              </div>
            )}

            {previewWarnings.length > 0 && !ssrfBlockedMessage && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg space-y-1 text-xs text-amber-800 dark:text-amber-300">
                {previewWarnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Editable Candidate Draft Form */}
            <form onSubmit={handleStageCandidate} className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Event Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="e.g., PES Systems Hackathon 2026"
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Organizer / Club
                  </label>
                  <input
                    type="text"
                    value={draftOrganizer}
                    onChange={(e) => setDraftOrganizer(e.target.value)}
                    placeholder="e.g., PES Innovation Lab"
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Attributed Description (Used by 2-Stage Hackathon-vs-Talk Classifier)
                </label>
                <textarea
                  rows={2}
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="Describe the build goal, rules, or paste organizer summary..."
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Campus / Format
                  </label>
                  <select
                    value={draftCampus}
                    onChange={(e) => setDraftCampus(e.target.value as CampusType)}
                    className="w-full px-2.5 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="RR Campus">RR Campus</option>
                    <option value="EC Campus">EC Campus</option>
                    <option value="Online / Multi-Campus">Online / Multi-Campus</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Start Date (or Empty)
                  </label>
                  <input
                    type="text"
                    value={draftStartAt}
                    onChange={(e) => setDraftStartAt(e.target.value)}
                    placeholder="YYYY-MM-DD"
                    className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Min Team (Blank = Null)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={draftMinTeam}
                    onChange={(e) => setDraftMinTeam(e.target.value)}
                    placeholder="Unconfirmed"
                    className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Max Team (Blank = Null)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={draftMaxTeam}
                    onChange={(e) => setDraftMaxTeam(e.target.value)}
                    placeholder="Unconfirmed"
                    className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Live 2-Stage Classifier Telemetry */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    2-Stage Classifier Preview: <span className="uppercase font-mono">{liveClassification.eventType}</span>
                  </span>
                  <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                    Matchable: {liveClassification.matchable ? 'YES' : 'NO (Excluded from Team Feed)'}
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-300">{liveClassification.reason}</p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSuggestModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                >
                  Stage Candidate for Moderator Review
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
