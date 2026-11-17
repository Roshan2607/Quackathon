import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderGit2,
  Heart,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import {
  BlockRecord,
  CandidateCard,
  DiscoveryMode,
  Hackathon,
  Interest,
  Membership,
  Participation,
  Profile,
  Team,
  User,
} from '../types/domain';
import {
  computeInterestCircles,
  computeTeamCombinedCapabilities,
  rankPeopleForHackathon,
} from '../services/matchingEngine';
import { AVAILABILITY_WINDOWS, ROLE_TAXONOMY } from '../data/seedData';

interface DiscoverViewProps {
  currentUser: User;
  hackathons: Hackathon[];
  selectedHackathonId: string;
  onSelectHackathon: (id: string) => void;
  discoveryMode?: DiscoveryMode;
  onChangeDiscoveryMode?: (mode: DiscoveryMode) => void;
  users: User[];
  profiles: Record<string, Profile>;
  participations: Participation[];
  teams: Team[];
  memberships: Membership[];
  interests: Interest[];
  blocks: BlockRecord[];
  onUpdateParticipation: (
    hackathonId: string,
    updates: Partial<
      Pick<
        Participation,
        'intent' | 'desiredRoles' | 'availabilityWindows' | 'discoverable'
      >
    >
  ) => void;
  onSwipeDecision: (
    card: CandidateCard,
    decision: 'interested' | 'passed',
    customNote?: string
  ) => Promise<void> | void;
  onResetPassedCards: (hackathonId: string) => void;
  onBlockUser: (targetUid: string) => void;
  onOpenMyTeam?: () => void;
}

const SWIPE_THRESHOLD_PX = 85;

export const DiscoverView: React.FC<DiscoverViewProps> = React.memo(
  ({
    currentUser,
    hackathons,
    selectedHackathonId,
    onSelectHackathon,
    users,
    profiles,
    participations,
    teams,
    memberships,
    interests,
    blocks,
    onUpdateParticipation,
    onSwipeDecision,
    onResetPassedCards,
    onBlockUser,
    onOpenMyTeam,
  }) => {
    const [selectedCircleId, setSelectedCircleId] = useState<string>('ALL');
    const [roleFilter, setRoleFilter] = useState<string>('ALL');
    const [onlyFirstTimeHackers, setOnlyFirstTimeHackers] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [showFiltersDrawer, setShowFiltersDrawer] = useState(false);
    const [expandedDetails, setExpandedDetails] = useState(false);
    const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
    const [noteDraft, setNoteDraft] = useState('');
    const [submittingCardId, setSubmittingCardId] = useState<string | null>(null);
    const [exitDirection, setExitDirection] = useState<'left' | 'right' | null>(
      null
    );

    // Pointer drag gesture state for Tinder-like swipe cards
    const [dragOffsetX, setDragOffsetX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const dragStartXRef = useRef<number | null>(null);

    useEffect(() => {
      const timer = setTimeout(() => {
        setDebouncedQuery(searchInput);
      }, 140);
      return () => clearTimeout(timer);
    }, [searchInput]);

    const selectedHackathon =
      hackathons.find((h) => h.id === selectedHackathonId) ?? hackathons[0];

    const viewerProfile = profiles[currentUser.uid];

    const viewerParticipation = useMemo(
      () =>
        selectedHackathon
          ? participations.find(
              (p) =>
                p.hackathonId === selectedHackathon.id &&
                p.uid === currentUser.uid
            )
          : undefined,
      [participations, selectedHackathon, currentUser.uid]
    );

    const teamCapabilities = useMemo(() => {
      if (!selectedHackathon || !viewerProfile) return null;
      return computeTeamCombinedCapabilities({
        viewerUid: currentUser.uid,
        viewerProfile,
        hackathon: selectedHackathon,
        allTeams: teams,
        allMemberships: memberships,
        allProfiles: Object.values(profiles),
      });
    }, [
      selectedHackathon,
      viewerProfile,
      currentUser.uid,
      teams,
      memberships,
      profiles,
    ]);

    const viewerActiveTeam = teamCapabilities?.activeTeam ?? null;
    const isTeamFull = Boolean(
      viewerActiveTeam &&
        teamCapabilities &&
        (viewerActiveTeam.status === 'full' ||
          teamCapabilities.memberCount >= teamCapabilities.maxCapacity)
    );

    const interestCircles = useMemo(
      () =>
        selectedHackathon
          ? computeInterestCircles(selectedHackathon, participations, profiles)
          : [],
      [selectedHackathon, participations, profiles]
    );

    const activeCircleTags = useMemo(() => {
      if (selectedCircleId === 'ALL') return undefined;
      return interestCircles.find((c) => c.id === selectedCircleId)
        ?.matchingTags;
    }, [selectedCircleId, interestCircles]);

    const studentCards = useMemo(() => {
      if (!selectedHackathon) return [];
      return rankPeopleForHackathon({
        viewerUid: currentUser.uid,
        hackathon: selectedHackathon,
        users,
        profiles,
        participations,
        teams,
        memberships,
        interests,
        blocks,
        activeCircleTags,
        roleFilter,
        onlyFirstTimeHackers,
        searchQuery: debouncedQuery,
      }).cards;
    }, [
      currentUser.uid,
      selectedHackathon,
      users,
      profiles,
      participations,
      teams,
      memberships,
      interests,
      blocks,
      activeCircleTags,
      roleFilter,
      onlyFirstTimeHackers,
      debouncedQuery,
    ]);

    const topCard = studentCards[0] ?? null;
    const nextCard = studentCards[1] ?? null;
    const topCardUser = useMemo(
      () => (topCard ? users.find((u) => u.uid === topCard.id) : undefined),
      [topCard, users]
    );
    const topCardProfile = useMemo(
      () => (topCard ? profiles[topCard.id] : undefined),
      [topCard, profiles]
    );

    // Reset card-local UI when the top card changes
    useEffect(() => {
      setExpandedDetails(false);
      setDragOffsetX(0);
      setIsDragging(false);
      setExitDirection(null);
    }, [topCard?.id]);

    const triggerSwipe = useCallback(
      async (decision: 'interested' | 'passed') => {
        if (!topCard || submittingCardId === topCard.id || isTeamFull) return;
        const cardToSwipe = topCard;
        const noteToSend =
          decision === 'interested' ? noteDraft.trim() || undefined : undefined;

        setSubmittingCardId(cardToSwipe.id);
        setExitDirection(decision === 'interested' ? 'right' : 'left');
        setDragOffsetX(decision === 'interested' ? 220 : -220);

        try {
          await onSwipeDecision(cardToSwipe, decision, noteToSend);
          setNoteDraft('');
        } finally {
          setSubmittingCardId(null);
          setExitDirection(null);
          setDragOffsetX(0);
        }
      },
      [topCard, submittingCardId, isTeamFull, noteDraft, onSwipeDecision]
    );

    // Keyboard accessibility: ArrowLeft -> Pass, ArrowRight -> Interested
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (!topCard || isTeamFull || submittingCardId) return;
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
        ) {
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          void triggerSwipe('passed');
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          void triggerSwipe('interested');
        }
      };

      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [topCard, isTeamFull, submittingCardId, triggerSwipe]);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!topCard || isTeamFull || submittingCardId) return;
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('select') ||
        target.closest('a')
      ) {
        return;
      }
      dragStartXRef.current = e.clientX;
      setIsDragging(true);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || dragStartXRef.current === null) return;
      const deltaX = e.clientX - dragStartXRef.current;
      setDragOffsetX(Math.max(-260, Math.min(260, deltaX)));
    };

    const handlePointerUpOrCancel = () => {
      if (!isDragging) return;
      const finalDelta = dragOffsetX;
      dragStartXRef.current = null;
      setIsDragging(false);

      if (finalDelta >= SWIPE_THRESHOLD_PX) {
        void triggerSwipe('interested');
      } else if (finalDelta <= -SWIPE_THRESHOLD_PX) {
        void triggerSwipe('passed');
      } else {
        setDragOffsetX(0);
      }
    };

    if (!selectedHackathon) {
      return (
        <div className="p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-2">
          <Users className="w-8 h-8 text-slate-400 mx-auto" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            No hackathons published yet
          </h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Open the Events tab to sync public PESU events or submit a campus
            hackathon to start matching with fellow students.
          </p>
        </div>
      );
    }

    const handleToggleRole = (role: string) => {
      const currentRoles = viewerParticipation?.desiredRoles ?? ['Backend'];
      const next = currentRoles.includes(role)
        ? currentRoles.filter((r) => r !== role)
        : [...currentRoles, role];
      if (next.length > 0) {
        onUpdateParticipation(selectedHackathon.id, { desiredRoles: next });
      }
    };

    const handleToggleAvailability = (win: string) => {
      const currentWins = viewerParticipation?.availabilityWindows ?? [];
      const next = currentWins.includes(win)
        ? currentWins.filter((w) => w !== win)
        : [...currentWins, win];
      onUpdateParticipation(selectedHackathon.id, {
        availabilityWindows: next,
      });
    };

    const maxTeamCapacity = Math.min(
      4,
      selectedHackathon.maxTeamSize && selectedHackathon.maxTeamSize > 0
        ? selectedHackathon.maxTeamSize
        : 4
    );
    const minTeamCapacity =
      selectedHackathon.minTeamSize && selectedHackathon.minTeamSize > 0
        ? Math.min(selectedHackathon.minTeamSize, maxTeamCapacity)
        : Math.min(2, maxTeamCapacity);

    const interestedActionLabel = viewerActiveTeam
      ? `Interested · Propose to Team (${teamCapabilities?.memberCount ?? viewerActiveTeam.memberCount}/${maxTeamCapacity})`
      : 'Interested';

    return (
      <div className="space-y-5">
        {/* Top Student Discovery Header: Hackathon Context + Search & Filters */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3.5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Left: Hackathon Selector & Student Queue Counter */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 rounded-lg text-xs font-semibold text-blue-700 dark:text-blue-300">
                <Users className="w-3.5 h-3.5" />
                <span>Students</span>
                <span className="font-mono tabular-nums px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200">
                  {studentCards.length}
                </span>
              </div>

              <select
                aria-label="Select Hackathon"
                value={selectedHackathon.id}
                onChange={(e) => onSelectHackathon(e.target.value)}
                className="text-xs sm:text-sm font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-slate-900 dark:text-slate-100 cursor-pointer max-w-xs sm:max-w-md truncate"
              >
                {hackathons.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} {!h.matchable ? '(Workshop / Non-team)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Right: Search, Role Filter & Preferences Drawer */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search student skills, role, project..."
                  className="w-full sm:w-52 pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <select
                aria-label="Filter by role"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <option value="ALL">All Roles</option>
                {ROLE_TAXONOMY.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setShowFiltersDrawer(!showFiltersDrawer)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  showFiltersDrawer ||
                  selectedCircleId !== 'ALL' ||
                  onlyFirstTimeHackers
                    ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Filters & Preferences</span>
              </button>
            </div>
          </div>

          {/* Active Team & Matching Context Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono tabular-nums text-slate-500">
                Team size: {minTeamCapacity}–{maxTeamCapacity} students
              </span>
              <span aria-hidden="true">·</span>
              {viewerActiveTeam && teamCapabilities ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    Swiping for your team:{' '}
                    <strong>{viewerActiveTeam.name.split(' (')[0]}</strong> (
                    {teamCapabilities.memberCount}/{maxTeamCapacity} members)
                  </span>
                  {teamCapabilities.missingRoles.length > 0 && (
                    <span className="text-slate-500 dark:text-slate-400 font-normal">
                      · Complements needed:{' '}
                      {teamCapabilities.missingRoles.slice(0, 3).join(', ')}
                    </span>
                  )}
                </span>
              ) : (
                <span>
                  Mutual right-swipes automatically form a 2-student team for{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {selectedHackathon.name}
                  </strong>
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {viewerActiveTeam && onOpenMyTeam && (
                <button
                  type="button"
                  onClick={onOpenMyTeam}
                  className="text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer"
                >
                  Open My Team →
                </button>
              )}
              {(selectedCircleId !== 'ALL' ||
                roleFilter !== 'ALL' ||
                onlyFirstTimeHackers ||
                debouncedQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCircleId('ALL');
                    setRoleFilter('ALL');
                    setOnlyFirstTimeHackers(false);
                    setSearchInput('');
                  }}
                  className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Reset filters
                </button>
              )}
            </div>
          </div>

          {/* Progressive Disclosure: Interest Circles & Availability Preferences */}
          {showFiltersDrawer && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Domain / Theme Filter:
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedCircleId('ALL')}
                    className={`px-2.5 py-1 rounded-md border cursor-pointer ${
                      selectedCircleId === 'ALL'
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900'
                        : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    All Themes
                  </button>
                  {interestCircles.map((circle) => (
                    <button
                      key={circle.id}
                      type="button"
                      onClick={() => setSelectedCircleId(circle.id)}
                      className={`px-2.5 py-1 rounded-md border cursor-pointer ${
                        selectedCircleId === circle.id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {circle.label} ·{' '}
                      <span className="font-mono tabular-nums">
                        {circle.participantCount}
                      </span>
                    </button>
                  ))}
                </div>

                <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyFirstTimeHackers}
                    onChange={(e) => setOnlyFirstTimeHackers(e.target.checked)}
                  />
                  <span>First-time hackers only</span>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="space-y-1.5">
                  <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                    Your Preferred Roles for {selectedHackathon.name}:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLE_TAXONOMY.map((role) => {
                      const active = (
                        viewerParticipation?.desiredRoles ?? []
                      ).includes(role);
                      return (
                        <button
                          key={role}
                          type="button"
                          onClick={() => handleToggleRole(role)}
                          className={`px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                            active
                              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900'
                              : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {role}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                    Your Event Availability:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {AVAILABILITY_WINDOWS.map((win) => {
                      const active = (
                        viewerParticipation?.availabilityWindows ?? []
                      ).includes(win);
                      return (
                        <button
                          key={win}
                          type="button"
                          onClick={() => handleToggleAvailability(win)}
                          className={`px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                            active
                              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900'
                              : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {win}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Non-Matchable Event Notice */}
        {!selectedHackathon.matchable ? (
          <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-3">
            <AlertTriangle className="w-7 h-7 text-amber-600 mx-auto" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Team matching isn’t enabled for {selectedHackathon.name}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
              This event is classified as a{' '}
              {selectedHackathon.eventType.replace('_', ' ')}. Switch to a team
              hackathon to discover and match with fellow students.
            </p>
            {hackathons.find((h) => h.matchable) && (
              <button
                type="button"
                onClick={() => {
                  const firstMatchable = hackathons.find((h) => h.matchable);
                  if (firstMatchable) onSelectHackathon(firstMatchable.id);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
              >
                Switch to {hackathons.find((h) => h.matchable)?.name}
              </button>
            )}
          </div>
        ) : isTeamFull && viewerActiveTeam ? (
          /* Team Full Lock Banner */
          <div className="p-8 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 rounded-xl text-center space-y-3">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Your team {viewerActiveTeam.name.split(' (')[0]} is full (
              {teamCapabilities?.memberCount ?? viewerActiveTeam.memberCount}/
              {maxTeamCapacity})
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
              Recruitment is locked because your roster has reached the maximum
              size for {selectedHackathon.name}. Open My Team to coordinate in
              Team Chat or complete official event registration.
            </p>
            {onOpenMyTeam && (
              <button
                type="button"
                onClick={onOpenMyTeam}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
              >
                Go to My Team
              </button>
            )}
          </div>
        ) : !topCard ? (
          /* Empty State */
          <div className="p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-3">
            <Users className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              No more unseen students match your current filters
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              You have reviewed all available student profiles for{' '}
              {selectedHackathon.name}, or your filters narrowed the queue.
            </p>
            <div className="flex items-center justify-center gap-3 pt-1">
              {(selectedCircleId !== 'ALL' ||
                roleFilter !== 'ALL' ||
                onlyFirstTimeHackers ||
                debouncedQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCircleId('ALL');
                    setRoleFilter('ALL');
                    setOnlyFirstTimeHackers(false);
                    setSearchInput('');
                  }}
                  className="px-3.5 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg cursor-pointer"
                >
                  Clear Filters
                </button>
              )}
              <button
                type="button"
                onClick={() => onResetPassedCards(selectedHackathon.id)}
                className="px-3.5 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Review Passed Students Again</span>
              </button>
            </div>
          </div>
        ) : (
          /* Unified Student-Only Swipe Card Stack */
          <div className="max-w-xl mx-auto space-y-3">
            <div className="relative">
              {/* Background Next-Card Stack Preview */}
              {nextCard && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none select-none absolute inset-x-3 -bottom-2.5 h-6 bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800 rounded-2xl -z-10"
                />
              )}

              {/* Active Student Swipe Card */}
              <div
                data-testid="student-swipe-card"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUpOrCancel}
                onPointerCancel={handlePointerUpOrCancel}
                className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5 select-none transition-transform duration-150 ${
                  isDragging ? 'cursor-grabbing' : 'cursor-grab'
                } ${
                  dragOffsetX > 45
                    ? 'ring-2 ring-emerald-500/50'
                    : dragOffsetX < -45
                      ? 'ring-2 ring-rose-500/50'
                      : ''
                } ${
                  exitDirection === 'right'
                    ? 'translate-x-10 opacity-75'
                    : exitDirection === 'left'
                      ? '-translate-x-10 opacity-75'
                      : ''
                }`}
              >
                {/* Drag Swipe Visual Stamp */}
                {Math.abs(dragOffsetX) > 35 && (
                  <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider">
                    <span
                      className={`px-2.5 py-1 rounded border ${
                        dragOffsetX < -35
                          ? 'border-rose-500 text-rose-600 bg-rose-50 dark:bg-rose-950/50 opacity-100'
                          : 'opacity-0'
                      }`}
                    >
                      Pass
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded border ${
                        dragOffsetX > 35
                          ? 'border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 opacity-100'
                          : 'opacity-0'
                      }`}
                    >
                      Interested
                    </span>
                  </div>
                )}

                {/* Student Header: Name, Verified Campus & Branch/Year */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {topCard.subtitle}
                      </span>
                      {topCardUser?.verified && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          PESU Verified
                        </span>
                      )}
                      {topCard.isFirstTimeHacker && (
                        <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-medium">
                          First-time hacker
                        </span>
                      )}
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {topCard.title}
                    </h2>
                    {topCardProfile?.bio && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pt-0.5">
                        {topCardProfile.bio}
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-mono tabular-nums text-xs font-bold">
                      <Sparkles className="w-3.5 h-3.5" />
                      {topCard.featureBreakdown.totalScore ??
                        Math.round((topCard.overallScore ?? 0) * 100)}
                      % Match
                    </span>
                  </div>
                </div>

                {/* Grounded Recommendation Reasons (1–2 specific reasons) */}
                {topCard.compatibilityReasons.length > 0 && (
                  <div
                    data-testid="recommendation-reasons"
                    className="p-3.5 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/60 rounded-xl space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-blue-950 dark:text-blue-200">
                        Why this student is recommended
                      </span>
                      {topCard.featureBreakdown.evaluatedAgainstTeamId && (
                        <span className="text-[11px] text-blue-700 dark:text-blue-300 font-medium">
                          Ranked for your{' '}
                          {topCard.featureBreakdown.evaluatedAgainstMemberCount}
                          -member team
                        </span>
                      )}
                    </div>
                    {topCard.compatibilityReasons
                      .slice(0, 2)
                      .map((reason, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2 text-slate-800 dark:text-slate-200 font-medium"
                        >
                          <span className="text-blue-600 dark:text-blue-400 font-bold">
                            •
                          </span>
                          <span>{reason}</span>
                        </div>
                      ))}
                  </div>
                )}

                {/* Preferred Roles, Top Skills & Interests/Domains */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold block mb-1">
                        Preferred Roles
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {topCard.rolesOfferedOrNeeded.map((role) => (
                          <span
                            key={role}
                            className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold"
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    </div>

                    {topCardProfile && topCardProfile.interestTags.length > 0 && (
                      <div>
                        <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold block mb-1">
                          Domains & Interests
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {topCardProfile.interestTags.slice(0, 5).map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold block mb-1">
                        Top Skills
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {topCard.skills.slice(0, 7).map((skill) => {
                          const isComplementary = (
                            topCard.featureBreakdown.complementarySkills ?? []
                          )
                            .map((s) => s.toLowerCase())
                            .includes(skill.toLowerCase());
                          return (
                            <span
                              key={skill}
                              className={`px-2 py-0.5 rounded font-medium ${
                                isComplementary
                                  ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              {skill}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold block mb-0.5">
                        Availability & Working Style
                      </span>
                      <p className="text-slate-700 dark:text-slate-300">
                        {topCard.availabilitySummary || 'Flexible schedule'}
                        {topCard.workingStyle.length > 0
                          ? ` · ${topCard.workingStyle.slice(0, 2).join(', ')}`
                          : ''}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Highlighted GitHub / Project Summary (always visible when available) */}
                {topCard.featuredEvidence.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                    <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold flex items-center gap-1.5">
                      <FolderGit2 className="w-3.5 h-3.5" />
                      <span>Highlighted Projects & Proof of Work</span>
                    </span>
                    <div className="grid grid-cols-1 gap-2">
                      {topCard.featuredEvidence.slice(0, 2).map((ev, idx) => (
                        <div
                          key={idx}
                          className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-0.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {ev.title}
                            </span>
                            {(ev.tech ?? []).length > 0 && (
                              <span className="text-[11px] text-slate-500">
                                {(ev.tech ?? []).slice(0, 4).join(' · ')}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 line-clamp-2">
                            {ev.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Progressive Disclosure: Optional Note, Score Breakdown & Block */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setExpandedDetails(!expandedDetails)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 inline-flex items-center gap-1 cursor-pointer"
                  >
                    {expandedDetails ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5" />
                        <span>Hide intro note & score details</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        <span>Add intro note or inspect recommendation math</span>
                      </>
                    )}
                  </button>

                  {expandedDetails && (
                    <div className="mt-3 space-y-3 text-xs">
                      <div className="space-y-1.5">
                        <label className="font-semibold text-slate-700 dark:text-slate-300 block">
                          Optional intro note (sent when you both match)
                        </label>
                        {topCard.icebreakerDrafts.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {topCard.icebreakerDrafts
                              .slice(0, 2)
                              .map((draft, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setNoteDraft(draft)}
                                  className="text-left px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-md cursor-pointer"
                                >
                                  “{draft.slice(0, 64)}…”
                                </button>
                              ))}
                          </div>
                        )}
                        <input
                          type="text"
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Write a quick note about what you want to build..."
                          className="w-full px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <button
                          type="button"
                          onClick={() =>
                            setShowScoreBreakdown(!showScoreBreakdown)
                          }
                          className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                        >
                          {showScoreBreakdown
                            ? 'Hide recommendation weights'
                            : 'Show recommendation weights (45 / 35 / 20)'}
                        </button>

                        <button
                          type="button"
                          onClick={() => onBlockUser(topCard.id)}
                          className="inline-flex items-center gap-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>Block student</span>
                        </button>
                      </div>

                      {showScoreBreakdown && (
                        <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg grid grid-cols-3 gap-2 font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-400">
                          <div>
                            <span className="block text-slate-400">
                              Skill Complementarity
                            </span>
                            <strong>
                              {topCard.featureBreakdown
                                .skillComplementarityScore ??
                                topCard.featureBreakdown.interestOrRoleSim}
                              %
                            </strong>
                          </div>
                          <div>
                            <span className="block text-slate-400">
                              Shared Interests
                            </span>
                            <strong>
                              {topCard.featureBreakdown.sharedInterestsScore ??
                                topCard.featureBreakdown.tfidfThemeSim}
                              %
                            </strong>
                          </div>
                          <div>
                            <span className="block text-slate-400">
                              Swipe Affinity
                            </span>
                            <strong>
                              {topCard.featureBreakdown
                                .pastSwipeAffinityScore ?? 50}
                              %
                            </strong>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Primary Swipe Action Controls (Pass Left / Interested Right) */}
                <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    data-testid="swipe-pass-btn"
                    disabled={submittingCardId === topCard.id}
                    onClick={() => void triggerSwipe('passed')}
                    className="flex-1 sm:flex-initial px-5 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/50 dark:hover:text-rose-300 rounded-xl inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    <span>Pass</span>
                  </button>

                  <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400">
                    <ArrowLeft className="w-3 h-3" />
                    <span>Drag or use arrow keys</span>
                    <ArrowRight className="w-3 h-3" />
                  </div>

                  <button
                    type="button"
                    data-testid="swipe-interested-btn"
                    disabled={submittingCardId === topCard.id}
                    onClick={() => void triggerSwipe('interested')}
                    className="flex-1 sm:flex-initial px-6 py-2.5 text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Heart className="w-4 h-4" />
                    <span>{interestedActionLabel}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);
