import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Compass,
  Filter,
  Info,
  Layers,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
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
    updates: Partial<Pick<Participation, 'intent' | 'desiredRoles' | 'availabilityWindows' | 'discoverable'>>
  ) => void;
  onSwipeDecision: (card: CandidateCard, decision: 'interested' | 'passed', customNote?: string) => void;
  onResetPassedCards: (hackathonId: string) => void;
  onBlockUser: (targetUid: string) => void;
}

export const DiscoverView: React.FC<DiscoverViewProps> = ({
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
  const [layoutMode, setLayoutMode] = useState<'deck' | 'grid'>('deck');
  const [showRankingMath, setShowRankingMath] = useState(false);
  const [showIntentEditor, setShowIntentEditor] = useState(false);
  const [applicationNote, setApplicationNote] = useState('');

  const selectedHackathon =
    hackathons.find((h) => h.id === selectedHackathonId) ?? hackathons[0];

  const viewerParticipation = participations.find(
    (p) => p.hackathonId === selectedHackathon.id && p.uid === currentUser.uid
  );

  const viewerActiveMembership = memberships.find(
    (m) =>
      m.hackathonId === selectedHackathon.id &&
      m.uid === currentUser.uid &&
      m.status === 'active'
  );

  const viewerActiveTeam = viewerActiveMembership
    ? teams.find((t) => t.id === viewerActiveMembership.teamId)
    : undefined;

  const interestCircles = useMemo(
    () => computeInterestCircles(selectedHackathon, participations, profiles),
    [selectedHackathon, participations, profiles]
  );

  const activeCircleTags = useMemo(() => {
    if (selectedCircleId === 'ALL') return undefined;
    return interestCircles.find((c) => c.id === selectedCircleId)?.matchingTags;
  }, [selectedCircleId, interestCircles]);

  const { cards: peopleCards } = useMemo(
    () =>
      rankPeopleForHackathon({
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
      }),
    [
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
    ]
  );

  const teamCards = useMemo(
    () =>
      rankTeamsForHackathon({
        viewerUid: currentUser.uid,
        hackathon: selectedHackathon,
        profiles,
        participations,
        teams,
        interests,
        blocks,
        activeCircleTags,
        roleFilter,
      }),
    [
      currentUser.uid,
      selectedHackathon,
      profiles,
      participations,
      teams,
      interests,
      blocks,
      activeCircleTags,
      roleFilter,
    ]
  );

  const activeCards = discoveryMode === 'people' ? peopleCards : teamCards;
  const topCard = activeCards[0];

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

  return (
    <div className="space-y-6">
      {/* Event Context Bar & Participation Status */}
      <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Event-Scoped Hybrid Discovery</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {selectedHackathon.minTeamSize && selectedHackathon.maxTeamSize
                  ? `Verified Team Bounds: ${selectedHackathon.minTeamSize}–${selectedHackathon.maxTeamSize} members`
                  : 'Team Size Constraints: Not Yet Confirmed'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                aria-label="Select Hackathon"
                value={selectedHackathon.id}
                onChange={(e) => onSelectHackathon(e.target.value)}
                className="text-lg font-bold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-slate-900 dark:text-slate-100 cursor-pointer"
              >
                {hackathons.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} {!h.matchable ? '(Non-Matchable)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Participation Intent & Roster Status */}
          <div className="flex flex-wrap items-center gap-3">
            {viewerActiveMembership && viewerActiveTeam ? (
              <div className="px-3.5 py-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-semibold block">
                    On Roster: {viewerActiveTeam.name.split(' (')[0]} ({viewerActiveTeam.memberCount}/{viewerActiveTeam.targetSize})
                  </span>
                  <span className="text-emerald-700 dark:text-emerald-400">
                    {viewerActiveTeam.leaderId === currentUser.uid
                      ? 'Recruiting Mode: People tab ranks candidates by missing team roles'
                      : 'Active Member: Solo People discovery updated'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                {(
                  [
                    { value: 'looking', label: 'Looking for Team' },
                    { value: 'recruiting', label: 'Recruiting' },
                    { value: 'open', label: 'Open to Either' },
                  ] as { value: ParticipationIntent; label: string }[]
                ).map((item) => (
                  <button
                    key={item.value}
                    onClick={() =>
                      onUpdateParticipation(selectedHackathon.id, { intent: item.value })
                    }
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      (viewerParticipation?.intent ?? 'looking') === item.value
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowIntentEditor(!showIntentEditor)}
              className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {showIntentEditor ? 'Hide Event Preferences' : 'Roles & Availability'}
            </button>
          </div>
        </div>

        {/* Collapsible Per-Event Roles & Schedule Editor */}
        {showIntentEditor && (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-2">
              <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                Your Roles for {selectedHackathon.name.split(' — ')[0]}:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {ROLE_TAXONOMY.map((role) => {
                  const active = (viewerParticipation?.desiredRoles ?? []).includes(role);
                  return (
                    <button
                      key={role}
                      onClick={() => handleToggleRole(role)}
                      className={`px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                        active
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {role}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                Your Event Availability Windows (20% Ranking Weight):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABILITY_WINDOWS.map((win) => {
                  const active = (viewerParticipation?.availabilityWindows ?? []).includes(win);
                  return (
                    <button
                      key={win}
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
        )}
      </div>

      {/* Gate if Non-Matchable Event (Workshop / Tech Talk / Solo CTF) */}
      {!selectedHackathon.matchable ? (
        <div className="p-8 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-600 mx-auto" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Team Discovery Disabled for Non-Team Event ({selectedHackathon.eventType.toUpperCase()})
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 max-w-xl mx-auto">
            {selectedHackathon.classification.reason} Select a team-eligible hackathon above to browse People and Teams.
          </p>
          <button
            onClick={() => onSelectHackathon('hack_terrapthon_26')}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
          >
            Switch to PES Terrapthon 2026
          </button>
        </div>
      ) : (
        <>
          {/* Interest Circles Strip (Architecture Section 7) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 inline-flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-blue-600" />
                Interest Circles (Thematic exploration filter — not automatic team membership)
              </span>
              <button
                onClick={() => setShowRankingMath(!showRankingMath)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer inline-flex items-center gap-1"
              >
                <Info className="w-3.5 h-3.5" />
                {showRankingMath ? 'Hide TF-IDF Feature Breakdown' : 'Inspect Local ML Ranking Math'}
              </button>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedCircleId('ALL')}
                className={`px-3.5 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedCircleId === 'ALL'
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                }`}
              >
                All Event Circles
              </button>
              {interestCircles.map((circle) => (
                <button
                  key={circle.id}
                  onClick={() => setSelectedCircleId(circle.id)}
                  className={`px-3.5 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedCircleId === circle.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  {circle.label} · <span className="font-mono tabular-nums">{circle.participantCount}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Confirmed Hybrid Discovery Tabs: People | Teams + Secondary Filters */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            {/* Hybrid Tabs (Confirmed Product Decision 13 Nov 2026) */}
            <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl self-start">
              <button
                onClick={() => onChangeDiscoveryMode('people')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-2 ${
                  discoveryMode === 'people'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Users className="w-4 h-4" />
                People Tab ({peopleCards.length} Eligible)
              </button>
              <button
                onClick={() => onChangeDiscoveryMode('teams')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-2 ${
                  discoveryMode === 'teams'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Layers className="w-4 h-4" />
                Teams Tab ({teamCards.length} Open Teams)
              </button>
            </div>

            {/* Role Filter, Cold-Start Beginner Toggle & Deck/Grid View */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  aria-label="Filter by role"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200"
                >
                  <option value="ALL">All Roles</option>
                  {ROLE_TAXONOMY.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {discoveryMode === 'people' && (
                <button
                  onClick={() => setOnlyFirstTimeHackers(!onlyFirstTimeHackers)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    onlyFirstTimeHackers
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  New to Hackathons Only
                </button>
              )}

              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  onClick={() => setLayoutMode('deck')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                    layoutMode === 'deck'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  Focus Card
                </button>
                <button
                  onClick={() => setLayoutMode('grid')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                    layoutMode === 'grid'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  Compare All ({activeCards.length})
                </button>
              </div>
            </div>
          </div>

          {/* Empty State if all cards acted upon or filtered */}
          {activeCards.length === 0 ? (
            <div className="p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-3">
              <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                No more unseen {discoveryMode === 'people' ? 'students' : 'teams'} match your current filters
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Seen profiles and passed cards do not reappear automatically. You can reset your passed cards for this hackathon or broaden your Interest Circle filter.
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => {
                    setSelectedCircleId('ALL');
                    setRoleFilter('ALL');
                    setOnlyFirstTimeHackers(false);
                  }}
                  className="px-3.5 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg cursor-pointer"
                >
                  Clear Filters
                </button>
                <button
                  onClick={() => onResetPassedCards(selectedHackathon.id)}
                  className="px-3.5 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Passed Cards in Event
                </button>
              </div>
            </div>
          ) : layoutMode === 'deck' && topCard ? (
            /* Single Focus Card Deck with Accessible Non-Gesture Controls */
            <div className="max-w-3xl mx-auto">
              <div className="p-6 sm:p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-6">
                {/* Card Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                        {topCard.type === 'person' ? 'Student Builder' : 'Open Hackathon Team'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{topCard.subtitle}</span>
                      {topCard.isFirstTimeHacker && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            First-Time Hacker (Cold-Start Protected)
                          </span>
                        </>
                      )}
                    </div>

                    <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {topCard.title}
                    </h2>
                  </div>

                  {topCard.type === 'team' && (
                    <div className="text-right shrink-0">
                      <span className="text-xs text-slate-400 block">Open Capacity</span>
                      <span className="font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100">
                        {topCard.memberCount} / {topCard.targetSize} Confirmed ({topCard.remainingSlots} left)
                      </span>
                    </div>
                  )}
                </div>

                {/* Human-Readable Compatibility Reasons (Never a numerical person score) */}
                <div className="p-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900 rounded-lg space-y-2">
                  <div className="text-xs font-bold text-blue-950 dark:text-blue-200 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
                    Why Recommended for You (Explainable Non-LLM Match)
                  </div>
                  <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                    {topCard.compatibilityReasons.map((reason, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-blue-600 font-bold">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Optional Local ML Feature Breakdown Inspector */}
                  {showRankingMath && (
                    <div className="pt-3 mt-3 border-t border-blue-200/60 dark:border-blue-900/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                      <div>
                        <span className="text-slate-500 block font-sans">Objective</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {topCard.featureBreakdown.mode === 'peer' ? 'Peer Affinity' : 'Team Role Gap'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block font-sans">
                          {topCard.featureBreakdown.primaryFitLabel}
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {topCard.featureBreakdown.interestOrRoleSim}% overlap
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block font-sans">TF-IDF Cosine</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {topCard.featureBreakdown.tfidfThemeSim}% similarity
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block font-sans">Cold-Start Rule</span>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          {topCard.featureBreakdown.coldStartRedistributed
                            ? 'Weights Redistributed'
                            : 'Standard Weights'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Roles, Skills & Availability Metadata */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1.5">
                    <span className="text-slate-400 font-medium block">
                      {topCard.type === 'person' ? 'Roles Can Contribute' : 'Roles Needed by Team'}
                    </span>
                    <div className="text-slate-900 dark:text-slate-100 font-semibold">
                      {topCard.rolesOfferedOrNeeded.join(' · ')}
                    </div>
                    {topCard.rolesWantToLearn && topCard.rolesWantToLearn.length > 0 && (
                      <div className="text-slate-500 dark:text-slate-400">
                        Wants to explore/learn: {topCard.rolesWantToLearn.join(' · ')}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-slate-400 font-medium block">
                      Skills & Domain Tags
                    </span>
                    <div className="text-slate-800 dark:text-slate-200 font-medium">
                      {topCard.skills.join(' · ')}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-400 font-medium block">
                      Event Availability Windows
                    </span>
                    <div className="text-slate-700 dark:text-slate-300">
                      {topCard.availabilitySummary || 'Flexible across hackathon hours'}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-400 font-medium block">
                      Collaboration Preferences
                    </span>
                    <div className="text-slate-700 dark:text-slate-300">
                      {topCard.workingStyle.join(' · ')}
                    </div>
                  </div>
                </div>

                {/* Project & Coursework Evidence */}
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                    {topCard.type === 'person'
                      ? 'Observable Project & Coursework Evidence'
                      : 'Planned Prototype Direction'}
                  </span>
                  {topCard.featuredEvidence.map((ev, i) => (
                    <div
                      key={i}
                      className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 rounded-lg space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {ev.title}
                        </span>
                        {ev.isCoursework && (
                          <span className="text-xs text-slate-500">Coursework / Lab Project</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">{ev.description}</p>
                    </div>
                  ))}
                </div>

                {/* Optional Technical Opener Draft Note before clicking Interested / Apply */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Optional Technical Icebreaker / Application Note (Editable, Never Auto-Sent Without Action)
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {topCard.icebreakerDrafts.map((draft, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setApplicationNote(draft)}
                        className="text-left px-2.5 py-1 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md cursor-pointer"
                      >
                        Use Draft {i + 1}: “{draft.slice(0, 68)}...”
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={applicationNote}
                    onChange={(e) => setApplicationNote(e.target.value)}
                    placeholder="Optional note to attach when expressing interest or applying..."
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>

                {/* Non-Gesture Action Bar (Pass / Interested / Block) */}
                <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                  {topCard.type === 'person' ? (
                    <button
                      type="button"
                      onClick={() => onBlockUser(topCard.id)}
                      className="text-xs text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      Block & Hide Candidate
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">
                      Team applications require leader approval
                    </span>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        onSwipeDecision(topCard, 'passed');
                        setApplicationNote('');
                      }}
                      className="px-5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      Pass (Hide Card)
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onSwipeDecision(topCard, 'interested', applicationNote.trim() || undefined);
                        setApplicationNote('');
                      }}
                      className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      {topCard.type === 'team'
                        ? 'Apply to Join Team'
                        : viewerActiveTeam && viewerActiveTeam.leaderId === currentUser.uid
                        ? `Invite to ${viewerActiveTeam.name.split(' (')[0]}`
                        : 'Express Interest'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Comparison Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeCards.map((card) => (
                <div
                  key={card.id}
                  className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
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
                          {card.remainingSlots} slots open
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg">
                      {card.compatibilityReasons.map((r, i) => (
                        <div key={i}>• {r}</div>
                      ))}
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
                      {card.skills.join(' · ')}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => onSwipeDecision(card, 'passed')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer"
                    >
                      Pass
                    </button>
                    <button
                      onClick={() => onSwipeDecision(card, 'interested')}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      {card.type === 'team' ? 'Apply to Team' : 'Interested'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
