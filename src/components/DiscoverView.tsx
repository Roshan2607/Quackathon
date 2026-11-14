import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Search,
  SlidersHorizontal,
  UserPlus,
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
  ParticipationIntent,
  Profile,
  Team,
  User,
} from '../types/domain';
import {
  computeInterestCircles,
  countEligiblePeopleForHackathon,
  countEligibleTeamsForHackathon,
  rankPeopleForHackathon,
  rankTeamsForHackathon,
} from '../services/matchingEngine';
import { AVAILABILITY_WINDOWS, ROLE_TAXONOMY } from '../data/seedData';

interface DiscoverViewProps {
  currentUser: User;
  hackathons: Hackathon[];
  selectedHackathonId: string;
  onSelectHackathon: (id: string) => void;
  discoveryMode: DiscoveryMode;
  onChangeDiscoveryMode: (mode: DiscoveryMode) => void;
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
      Pick<Participation, 'intent' | 'desiredRoles' | 'availabilityWindows' | 'discoverable'>
    >
  ) => void;
  onSwipeDecision: (
    card: CandidateCard,
    decision: 'interested' | 'passed',
    customNote?: string
  ) => void;
  onResetPassedCards: (hackathonId: string) => void;
  onBlockUser: (targetUid: string) => void;
}

const GRID_PAGE_SIZE = 8;

export const DiscoverView: React.FC<DiscoverViewProps> = React.memo(
  ({
    currentUser,
    hackathons,
    selectedHackathonId,
    onSelectHackathon,
    discoveryMode,
    onChangeDiscoveryMode,
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
  }) => {
    const [selectedCircleId, setSelectedCircleId] = useState<string>('ALL');
    const [roleFilter, setRoleFilter] = useState<string>('ALL');
    const [onlyFirstTimeHackers, setOnlyFirstTimeHackers] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [layoutMode, setLayoutMode] = useState<'deck' | 'grid'>('deck');
    const [showFiltersDrawer, setShowFiltersDrawer] = useState(false);
    const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
    const [showRankingMath, setShowRankingMath] = useState(false);
    const [applicationNote, setApplicationNote] = useState('');
    const [visibleCount, setVisibleCount] = useState(GRID_PAGE_SIZE);

    useEffect(() => {
      const timer = setTimeout(() => {
        setDebouncedQuery(searchInput);
        setVisibleCount(GRID_PAGE_SIZE);
      }, 140);
      return () => clearTimeout(timer);
    }, [searchInput]);

    const selectedHackathon =
      hackathons.find((h) => h.id === selectedHackathonId) ?? hackathons[0];

    const viewerParticipation = useMemo(
      () =>
        selectedHackathon
          ? participations.find(
              (p) =>
                p.hackathonId === selectedHackathon.id && p.uid === currentUser.uid
            )
          : undefined,
      [participations, selectedHackathon, currentUser.uid]
    );

    const viewerActiveMembership = useMemo(
      () =>
        selectedHackathon
          ? memberships.find(
              (m) =>
                m.hackathonId === selectedHackathon.id &&
                m.uid === currentUser.uid &&
                m.status === 'active'
            )
          : undefined,
      [memberships, selectedHackathon, currentUser.uid]
    );

    const viewerActiveTeam = useMemo(
      () =>
        viewerActiveMembership
          ? teams.find((t) => t.id === viewerActiveMembership.teamId)
          : undefined,
      [viewerActiveMembership, teams]
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
      return interestCircles.find((c) => c.id === selectedCircleId)?.matchingTags;
    }, [selectedCircleId, interestCircles]);

    // Only run full TF-IDF ranking for the active tab; use O(N) Pass-1 count for the inactive tab badge
    const peopleCards = useMemo(() => {
      if (!selectedHackathon || discoveryMode !== 'people') return [];
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
      discoveryMode,
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

    const teamCards = useMemo(() => {
      if (!selectedHackathon || discoveryMode !== 'teams') return [];
      return rankTeamsForHackathon({
        viewerUid: currentUser.uid,
        hackathon: selectedHackathon,
        profiles,
        participations,
        teams,
        interests,
        blocks,
        activeCircleTags,
        roleFilter,
        searchQuery: debouncedQuery,
      });
    }, [
      discoveryMode,
      currentUser.uid,
      selectedHackathon,
      profiles,
      participations,
      teams,
      interests,
      blocks,
      activeCircleTags,
      roleFilter,
      debouncedQuery,
    ]);

    const peopleCount = useMemo(() => {
      if (!selectedHackathon) return 0;
      if (discoveryMode === 'people') return peopleCards.length;
      return countEligiblePeopleForHackathon({
        viewerUid: currentUser.uid,
        hackathon: selectedHackathon,
        users,
        profiles,
        participations,
        memberships,
        interests,
        blocks,
        activeCircleTags,
        roleFilter,
        onlyFirstTimeHackers,
        searchQuery: debouncedQuery,
      });
    }, [
      discoveryMode,
      peopleCards.length,
      currentUser.uid,
      selectedHackathon,
      users,
      profiles,
      participations,
      memberships,
      interests,
      blocks,
      activeCircleTags,
      roleFilter,
      onlyFirstTimeHackers,
      debouncedQuery,
    ]);

    const teamsCount = useMemo(() => {
      if (!selectedHackathon) return 0;
      if (discoveryMode === 'teams') return teamCards.length;
      return countEligibleTeamsForHackathon({
        viewerUid: currentUser.uid,
        hackathon: selectedHackathon,
        teams,
        interests,
        blocks,
        activeCircleTags,
        roleFilter,
        searchQuery: debouncedQuery,
      });
    }, [
      discoveryMode,
      teamCards.length,
      currentUser.uid,
      selectedHackathon,
      teams,
      interests,
      blocks,
      activeCircleTags,
      roleFilter,
      debouncedQuery,
    ]);

    const activeCards = discoveryMode === 'people' ? peopleCards : teamCards;
    const topCard = activeCards[0];
    const pagedGridCards = activeCards.slice(0, visibleCount);

    if (!selectedHackathon) {
      return (
        <div className="p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-2">
          <Users className="w-8 h-8 text-slate-400 mx-auto" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            No hackathons published yet
          </h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Open the Hackathons tab to suggest a campus event or approve a candidate in Admin Review to start matching with builders and teams.
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
      onUpdateParticipation(selectedHackathon.id, { availabilityWindows: next });
    };

    const getPrimaryActionLabel = (card: CandidateCard) => {
      if (card.type === 'team') return 'Apply to Join';
      if (viewerActiveTeam && viewerActiveTeam.leaderId === currentUser.uid) {
        return `Invite to ${viewerActiveTeam.name.split(' (')[0]}`;
      }
      return 'Connect';
    };

    return (
      <div className="space-y-6">
        {/* Compact Top Discovery Bar: Event Selector + People/Teams Tabs + Search & Filters */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Left: People | Teams Segmented Tabs + Event Selector */}
            <div className="flex flex-wrap items-center gap-3">
              <div
                className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
                role="tablist"
                aria-label="Discovery mode"
              >
                <button
                  role="tab"
                  aria-selected={discoveryMode === 'people'}
                  onClick={() => onChangeDiscoveryMode('people')}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1.5 ${
                    discoveryMode === 'people'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>People</span>
                  <span className="font-mono tabular-nums text-slate-400">{peopleCount}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={discoveryMode === 'teams'}
                  onClick={() => onChangeDiscoveryMode('teams')}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1.5 ${
                    discoveryMode === 'teams'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <span>Teams</span>
                  <span className="font-mono tabular-nums text-slate-400">{teamsCount}</span>
                </button>
              </div>

              <select
                aria-label="Select Hackathon"
                value={selectedHackathon.id}
                onChange={(e) => onSelectHackathon(e.target.value)}
                className="text-xs sm:text-sm font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-slate-900 dark:text-slate-100 cursor-pointer max-w-xs sm:max-w-md truncate"
              >
                {hackathons.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} {!h.matchable ? '(Workshop / Solo)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Right: Search, Role Filter & Progressive Disclosure Filters Button */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search skills, name, or topic..."
                  className="w-full sm:w-48 pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
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

              <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setLayoutMode('deck')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                    layoutMode === 'deck'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  Focus
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode('grid')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                    layoutMode === 'grid'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  Grid
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowFiltersDrawer(!showFiltersDrawer)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  showFiltersDrawer || selectedCircleId !== 'ALL' || onlyFirstTimeHackers
                    ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Filters & Status</span>
              </button>
            </div>
          </div>

          {/* Subtle Unboxed Context Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono tabular-nums">
                {selectedHackathon.minTeamSize && selectedHackathon.maxTeamSize
                  ? `Team size: ${selectedHackathon.minTeamSize}–${selectedHackathon.maxTeamSize} members`
                  : 'Team size: Unconfirmed'}
              </span>
              <span aria-hidden="true">·</span>
              {viewerActiveMembership && viewerActiveTeam ? (
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                  Your Team: {viewerActiveTeam.name.split(' (')[0]} ({viewerActiveTeam.memberCount}/
                  {viewerActiveTeam.targetSize})
                </span>
              ) : (
                <span>
                  Status:{' '}
                  <strong className="text-slate-700 dark:text-slate-200 capitalize">
                    {(viewerParticipation?.intent ?? 'looking').replace('_', ' ')}
                  </strong>
                </span>
              )}
            </div>

            {selectedCircleId !== 'ALL' || roleFilter !== 'ALL' || onlyFirstTimeHackers || debouncedQuery ? (
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
            ) : null}
          </div>

          {/* Progressive Disclosure: Filters, Interest Circles & Event Availability */}
          {showFiltersDrawer && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Interest Circles:
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
                    All
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
                      <span className="font-mono tabular-nums">{circle.participantCount}</span>
                    </button>
                  ))}
                </div>

                {discoveryMode === 'people' && (
                  <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyFirstTimeHackers}
                      onChange={(e) => setOnlyFirstTimeHackers(e.target.checked)}
                    />
                    <span>First-time hackers only</span>
                  </label>
                )}
              </div>

              {!viewerActiveMembership && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Your Goal for This Event:
                  </span>
                  {(
                    [
                      { value: 'looking', label: 'Looking for Team' },
                      { value: 'recruiting', label: 'Recruiting' },
                      { value: 'open', label: 'Open to Either' },
                    ] as { value: ParticipationIntent; label: string }[]
                  ).map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() =>
                        onUpdateParticipation(selectedHackathon.id, { intent: item.value })
                      }
                      className={`px-2.5 py-1 rounded-md border cursor-pointer ${
                        (viewerParticipation?.intent ?? 'looking') === item.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="space-y-1.5">
                  <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                    Your Roles for This Event:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLE_TAXONOMY.map((role) => {
                      const active = (viewerParticipation?.desiredRoles ?? []).includes(role);
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
                      const active = (viewerParticipation?.availabilityWindows ?? []).includes(win);
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
              This event is listed as a {selectedHackathon.eventType.replace('_', ' ')}. Switch to a team hackathon to find teammates.
            </p>
            <button
              type="button"
              onClick={() => onSelectHackathon('hack_terrapthon_26')}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
            >
              Switch to PES Terrapthon 2026
            </button>
          </div>
        ) : activeCards.length === 0 ? (
          /* Empty State */
          <div className="p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-3">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              No unseen {discoveryMode === 'people' ? 'students' : 'teams'} match your filters
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Clear your filters or reset passed profiles for this event.
            </p>
            <div className="flex items-center justify-center gap-3 pt-1">
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
              <button
                type="button"
                onClick={() => onResetPassedCards(selectedHackathon.id)}
                className="px-3.5 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Passed
              </button>
            </div>
          </div>
        ) : layoutMode === 'deck' && topCard ? (
          /* Focus Card View — Clean, Minimal, Progressive Disclosure */
          <div className="max-w-2xl mx-auto">
            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-5">
              {/* Essential Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{topCard.subtitle}</span>
                    {topCard.isFirstTimeHacker && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                          First-time hacker
                        </span>
                      </>
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    {topCard.title}
                  </h2>
                </div>

                {topCard.type === 'team' && (
                  <span className="font-mono tabular-nums text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                    {topCard.memberCount}/{topCard.targetSize} members · {topCard.remainingSlots} open
                  </span>
                )}
              </div>

              {/* Essential Roles & Skills */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-3 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <span className="text-slate-400 block mb-0.5">
                    {topCard.type === 'person' ? 'Preferred Roles' : 'Roles Needed'}
                  </span>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {topCard.rolesOfferedOrNeeded.join(' · ')}
                  </div>
                  {topCard.customSpecializations && topCard.customSpecializations.length > 0 && (
                    <div className="text-slate-500 dark:text-slate-400 mt-1">
                      Specializations: {topCard.customSpecializations.join(' · ')}
                    </div>
                  )}
                </div>

                <div>
                  <span className="text-slate-400 block mb-0.5">Skills & Interests</span>
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    {topCard.skills.join(' · ')}
                  </div>
                </div>
              </div>

              {/* Concise Compatibility Highlights */}
              {topCard.compatibilityReasons.length > 0 && (
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-1 text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                    Why you match
                  </span>
                  {topCard.compatibilityReasons.slice(0, 2).map((reason, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-blue-600 font-bold">·</span>
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Progressive Disclosure Toggle: Projects, Schedule, Note & Match Details */}
              <div>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedCardId(expandedCardId === topCard.id ? null : topCard.id)
                  }
                  className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 inline-flex items-center gap-1 cursor-pointer"
                >
                  {expandedCardId === topCard.id ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>Hide Details</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>
                        Details ({topCard.featuredEvidence.length}{' '}
                        {topCard.type === 'person' ? 'projects' : 'build notes'}, schedule & note)
                      </span>
                    </>
                  )}
                </button>

                {expandedCardId === topCard.id && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-4 text-xs">
                    {topCard.featuredEvidence.length > 0 && (
                      <div className="space-y-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                          {topCard.type === 'person' ? 'Projects & Coursework' : 'Build Idea'}
                        </span>
                        {topCard.featuredEvidence.map((ev, i) => (
                          <div
                            key={i}
                            className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg space-y-0.5"
                          >
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {ev.title}
                            </div>
                            <p className="text-slate-600 dark:text-slate-300">{ev.description}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <span className="text-slate-400 block">Availability</span>
                        <span className="text-slate-700 dark:text-slate-300">
                          {topCard.availabilitySummary || 'Flexible'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Working Style</span>
                        <span className="text-slate-700 dark:text-slate-300">
                          {topCard.workingStyle.join(' · ')}
                        </span>
                      </div>
                    </div>

                    {/* Optional Note / Icebreaker */}
                    <div className="space-y-1.5">
                      <label className="font-semibold text-slate-700 dark:text-slate-300 block">
                        Attach an optional note
                      </label>
                      {topCard.icebreakerDrafts.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {topCard.icebreakerDrafts.slice(0, 2).map((draft, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setApplicationNote(draft)}
                              className="text-left px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-md cursor-pointer"
                            >
                              “{draft.slice(0, 60)}...”
                            </button>
                          ))}
                        </div>
                      )}
                      <input
                        type="text"
                        value={applicationNote}
                        onChange={(e) => setApplicationNote(e.target.value)}
                        placeholder="Write a short note (optional)..."
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      />
                    </div>

                    {/* Optional Match Breakdown & Block */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setShowRankingMath(!showRankingMath)}
                        className="text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showRankingMath ? 'Hide match breakdown' : 'View match breakdown'}
                      </button>

                      {topCard.type === 'person' && (
                        <button
                          type="button"
                          onClick={() => onBlockUser(topCard.id)}
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          Block user
                        </button>
                      )}
                    </div>

                    {showRankingMath && (
                      <div className="p-2.5 bg-slate-50 dark:bg-slate-950 rounded-lg flex flex-wrap gap-4 font-mono tabular-nums text-[11px] text-slate-500">
                        <span>
                          {topCard.featureBreakdown.primaryFitLabel}:{' '}
                          {topCard.featureBreakdown.interestOrRoleSim}%
                        </span>
                        <span>Theme similarity: {topCard.featureBreakdown.tfidfThemeSim}%</span>
                        <span>Schedule: {topCard.featureBreakdown.availabilitySim}%</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Primary Action Bar (One Obvious Primary Action + Quiet Pass) */}
              <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    onSwipeDecision(topCard, 'passed');
                    setApplicationNote('');
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Pass</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSwipeDecision(
                      topCard,
                      'interested',
                      applicationNote.trim() || undefined
                    );
                    setApplicationNote('');
                  }}
                  className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{getPrimaryActionLabel(topCard)}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Compact Grid View with Pagination */
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pagedGridCards.map((card) => {
                const isExpanded = expandedCardId === card.id;
                return (
                  <div
                    key={card.id}
                    className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {card.subtitle}
                          </p>
                          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                            {card.title}
                          </h3>
                        </div>
                        {card.type === 'team' && (
                          <span className="font-mono tabular-nums text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                            {card.remainingSlots} open
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          Roles:
                        </span>{' '}
                        {card.rolesOfferedOrNeeded.join(' · ')}
                      </div>

                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          Skills:
                        </span>{' '}
                        {card.skills.slice(0, 5).join(' · ')}
                      </div>

                      {card.compatibilityReasons[0] && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 rounded-lg">
                          {card.compatibilityReasons[0]}
                        </p>
                      )}

                      {isExpanded && (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                          {card.featuredEvidence.map((ev, i) => (
                            <div key={i}>
                              <strong className="text-slate-800 dark:text-slate-200">
                                {ev.title}:
                              </strong>{' '}
                              {ev.description}
                            </div>
                          ))}
                          <div>
                            <strong className="text-slate-800 dark:text-slate-200">
                              Schedule:
                            </strong>{' '}
                            {card.availabilitySummary || 'Flexible'}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setExpandedCardId(isExpanded ? null : card.id)}
                        className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {isExpanded ? 'Hide details' : 'Details'}
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSwipeDecision(card, 'passed')}
                          className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer"
                        >
                          Pass
                        </button>
                        <button
                          type="button"
                          onClick={() => onSwipeDecision(card, 'interested')}
                          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>{getPrimaryActionLabel(card)}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {activeCards.length > visibleCount && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + GRID_PAGE_SIZE)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Show More ({activeCards.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);
