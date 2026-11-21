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
  ShieldAlert,
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
  computeTeamCombinedCapabilities,
  isHackathonEligibleForMatching,
  rankPeopleForHackathon,
} from '../services/matchingEngine';
import { StudentAvatar } from './StudentAvatar';

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
  onOpenProfile?: () => void;
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
    onSwipeDecision,
    onResetPassedCards,
    onBlockUser,
    onOpenMyTeam,
    onOpenProfile,
  }) => {
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

    const selectedHackathon =
      hackathons.find((h) => h.id === selectedHackathonId) ?? hackathons[0];

    const viewerProfile = profiles[currentUser.uid];

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
        <div className="p-10 bg-white border border-slate-200 rounded-2xl text-center space-y-2">
          <Users className="w-8 h-8 text-slate-400 mx-auto" />
          <h2 className="text-base font-bold text-slate-900">
            No upcoming hackathons available
          </h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Browse the Hackathons tab or suggest an upcoming campus hackathon to start finding teammates.
          </p>
        </div>
      );
    }

    const viewerProfileRecord = profiles[currentUser.uid];
    const isSparseViewerProfile =
      (viewerProfileRecord?.skillTags?.length ?? 0) === 0 &&
      (viewerProfileRecord?.interestTags?.length ?? 0) === 0;
    const isEventMatchable = isHackathonEligibleForMatching(selectedHackathon);

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
        {isSparseViewerProfile && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200/80 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-950">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>
                Add a few interests, skills, or a preferred role in your profile to get stronger teammate recommendations.
              </span>
            </div>
            {onOpenProfile && (
              <button
                type="button"
                onClick={onOpenProfile}
                className="font-semibold text-indigo-700 hover:text-indigo-900 underline cursor-pointer shrink-0"
              >
                Update Profile
              </button>
            )}
          </div>
        )}

        {!isEventMatchable && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Registration is closed or this event has ended. New teammate matching is disabled — choose an upcoming hackathon to find teammates.
            </span>
          </div>
        )}

        {/* Discovery Sub-header: Single clean contextual strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-[#1c1b1b] tracking-tight">
              Discover
            </h1>
            <div className="relative inline-flex items-center">
              <select
                aria-label="Select Hackathon"
                value={selectedHackathon.id}
                onChange={(e) => onSelectHackathon(e.target.value)}
                className="text-xs font-semibold bg-white border border-[#e9e5dd] rounded-full px-3.5 py-1.5 text-[#1c1b1b] shadow-xs cursor-pointer appearance-none pr-7 focus:outline-none focus:ring-1 focus:ring-[#725c00]"
              >
                {hackathons.map((h) => {
                  const eligible = isHackathonEligibleForMatching(h);
                  return (
                    <option key={h.id} value={h.id}>
                      {h.name} {!eligible ? '(Closed)' : ''}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#746e65] absolute right-2.5 pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#746e65]">
            <span className="font-medium">
              Candidate {studentCards.length > 0 ? 1 : 0} of {studentCards.length}
            </span>
            {viewerActiveTeam && onOpenMyTeam && (
              <>
                <span>·</span>
                <button
                  type="button"
                  onClick={onOpenMyTeam}
                  className="font-semibold text-[#725c00] hover:underline cursor-pointer"
                >
                  My Team ({teamCapabilities?.memberCount ?? viewerActiveTeam.memberCount}/{maxTeamCapacity}) →
                </button>
              </>
            )}
          </div>
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
          /* All-Caught-Up State with Peaceful Vector Duck Mascot */
          <div className="w-full bg-white rounded-3xl p-8 sm:p-12 flex flex-col items-center text-center relative overflow-hidden shadow-sm border border-[#e9e5dd]">
            <div className="relative w-32 h-32 mb-4 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-[#f6f3f2] scale-95 transition-transform duration-500 hover:scale-100" />
              {/* Minimalist Vector Resting Duck */}
              <svg className="relative w-28 h-28 drop-shadow-sm" fill="none" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 92C32 90 44 94 60 92C76 90 88 94 102 92" stroke="#E5E2E1" strokeLinecap="round" strokeWidth="3" />
                <path d="M30 100C42 98 52 101 64 100C76 99 86 101 94 100" stroke="#F0EDED" strokeLinecap="round" strokeWidth="2.5" />
                <path d="M28 72C28 58 40 48 54 48H78C90 48 98 58 98 70C98 82 86 88 70 88H44C34 88 28 81 28 72Z" fill="#FFD84D" />
                <path d="M28 66C22 62 20 54 22 48C25 54 30 58 35 60L28 66Z" fill="#E9C339" />
                <path d="M46 64C46 59 52 55 62 55C72 55 78 61 78 67C78 74 70 77 60 77C50 77 46 71 46 64Z" fill="#F5CE40" />
                <circle cx="78" cy="40" fill="#FFD84D" r="18" />
                <path d="M92 40C98 40 105 42 107 45C104 48 97 49 92 48V40Z" fill="#FDAA40" />
                <path d="M81 38C81 35 85 35 85 38" stroke="#1C1B1B" strokeLinecap="round" strokeWidth="2" />
                <circle cx="76" cy="46" fill="#F7A53B" fillOpacity="0.5" r="3" />
                <path className="opacity-80" d="M96 24H101L96 30H101" stroke="#875200" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
              </svg>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-[#1c1b1b] tracking-tight">
              You're all caught up for {selectedHackathon.name}
            </h2>
            <p className="text-xs sm:text-sm text-[#746e65] mt-2 max-w-md leading-relaxed">
              You have reviewed all student profiles currently available for this hackathon. New student builders join daily.
            </p>

            <div className="mt-6 flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => onResetPassedCards(selectedHackathon.id)}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold text-xs shadow-xs inline-flex items-center justify-center gap-2 transition-transform cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Review Passed Students Again</span>
              </button>
              {onOpenMyTeam && (
                <button
                  type="button"
                  onClick={onOpenMyTeam}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#f6f3f2] hover:bg-[#eae7e7] text-[#1c1b1b] font-semibold text-xs border border-[#e9e5dd] transition-colors cursor-pointer"
                >
                  View My Team
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Primary Centered Focus Card Container */
          <div className="w-full max-w-2xl mx-auto relative">
            {/* Atmospheric Underlay Card Edge Stack */}
            <div className="absolute inset-0 translate-y-2 scale-[0.985] bg-[#f6f3f2] border border-[#e9e5dd] rounded-2xl -z-10 shadow-xs opacity-70 pointer-events-none" />

            {/* Active Profile Card */}
            <article
              data-testid="student-swipe-card"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUpOrCancel}
              onPointerCancel={handlePointerUpOrCancel}
              className={`w-full bg-white rounded-2xl shadow-sm border border-[#e9e5dd] p-6 sm:p-8 flex flex-col gap-5 select-none transition-transform duration-150 ${
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
                    className={`px-2.5 py-1 rounded-full border ${
                      dragOffsetX < -35
                        ? 'border-rose-500 text-rose-600 bg-rose-50 opacity-100'
                        : 'opacity-0'
                    }`}
                  >
                    Pass
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-full border ${
                      dragOffsetX > 35
                        ? 'border-emerald-500 text-emerald-600 bg-emerald-50 opacity-100'
                        : 'opacity-0'
                    }`}
                  >
                    Interested
                  </span>
                </div>
              )}

              {/* Student Profile Header Block */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-16 h-16 rounded-full bg-[#ffd84d]/30 border border-[#ffd84d]/50 flex items-center justify-center shrink-0 shadow-xs overflow-hidden">
                    <StudentAvatar
                      uid={topCard.id}
                      name={topCard.title}
                      size="lg"
                    />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h2 className="text-xl sm:text-2xl font-bold text-[#1c1b1b] tracking-tight truncate">
                        {topCard.title}
                      </h2>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#f6f3f2] text-[#615e56] text-[11px] font-medium border border-[#e9e5dd]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#875200]" />
                        Looking for team
                      </span>
                    </div>
                    <p className="text-xs text-[#746e65]">
                      {topCard.subtitle} · PES University ({topCardUser?.campus || 'RR Campus'})
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#fff3c9] text-[#725c00] font-mono tabular-nums text-xs font-bold border border-[#ffd84d]/60">
                    <Sparkles className="w-3.5 h-3.5 text-[#875200]" />
                    {topCard.featureBreakdown.totalScore ??
                      Math.round((topCard.overallScore ?? 0) * 100)}% Match
                  </span>
                </div>
              </div>

              {/* Concise Builder Bio in quotes */}
              <div className="pt-1">
                <p className="text-sm sm:text-base text-[#24211c] italic leading-relaxed">
                  &ldquo;{topCardProfile?.about || (topCard as { bio?: string }).bio || 'Passionate about building intuitive web experiences and scalable backends. Looking for a high-energy team.'}&rdquo;
                </p>
              </div>

              {/* Verified Core Stack */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-wider font-bold text-[#746e65]">
                  Core Stack
                </span>
                <div className="flex flex-wrap gap-2">
                  {topCard.skills.slice(0, 6).map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center px-3 py-1 rounded-full bg-[#f6f3f2] text-xs font-medium text-[#1c1b1b] hover:bg-[#eae7e7] transition-colors"
                    >
                      {skill}
                    </span>
                  ))}
                  {topCard.rolesOfferedOrNeeded.map((role) => (
                    <span
                      key={role}
                      className="inline-flex items-center px-3 py-1 rounded-full bg-[#fff3c9] text-xs font-bold text-[#272015] border border-[#ffd84d]/50"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>

              {/* Featured Project Row (if available) */}
              {topCard.featuredEvidence.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <span className="text-[11px] uppercase tracking-wider font-bold text-[#746e65]">
                    Featured Work
                  </span>
                  {topCard.featuredEvidence.slice(0, 1).map((ev, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3.5 rounded-xl bg-[#f6f3f2] border border-[#e9e5dd] hover:bg-[#eae7e7] transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0 shadow-xs text-[#875200]">
                          <FolderGit2 className="w-4 h-4" />
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0 text-xs">
                          <span className="font-bold text-[#1c1b1b]">{ev.title}</span>
                          <span className="text-[#746e65]">·</span>
                          <span className="text-[#875200] font-medium">
                            {(ev.tech ?? []).slice(0, 3).join(', ')}
                          </span>
                          <span className="text-[#746e65]">—</span>
                          <span className="text-[#746e65] truncate max-w-[220px]">
                            {ev.description}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Quiet Match Reason Callout */}
              {topCard.compatibilityReasons.length > 0 && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#ffd84d]/20 text-[#1c1b1b] border border-[#ffd84d]/30">
                  <div className="w-6 h-6 rounded-full bg-[#ffd84d] flex items-center justify-center shrink-0 text-[#725c00] mt-0.5">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex flex-col text-xs">
                    <span className="font-bold text-[#1c1b1b]">Why this match</span>
                    <p className="text-[#615e56] mt-0.5 leading-relaxed">
                      {topCard.compatibilityReasons[0]}
                    </p>
                  </div>
                </div>
              )}

              {/* Expandable Details: intro note & score breakdown */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setExpandedDetails(!expandedDetails)}
                  className="text-xs font-medium text-[#746e65] hover:text-[#1c1b1b] inline-flex items-center gap-1 cursor-pointer"
                >
                  {expandedDetails ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>Hide optional intro note &amp; weights</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>Add intro note or inspect match math</span>
                    </>
                  )}
                </button>

                {expandedDetails && (
                  <div className="mt-3 space-y-3 text-xs">
                    <div className="space-y-1.5">
                      <label className="font-semibold text-[#1c1b1b] block">
                        Optional intro note (sent when you both match)
                      </label>
                      <input
                        type="text"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="Write a quick note about what you want to build..."
                        className="w-full px-3.5 py-2 bg-[#f6f3f2] border border-[#e9e5dd] rounded-xl text-[#1c1b1b] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#725c00]"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => setShowScoreBreakdown(!showScoreBreakdown)}
                        className="text-[#746e65] hover:text-[#1c1b1b] cursor-pointer"
                      >
                        {showScoreBreakdown ? 'Hide weights' : 'Show weights (45 / 35 / 20)'}
                      </button>

                      <button
                        type="button"
                        onClick={() => onBlockUser(topCard.id)}
                        className="inline-flex items-center gap-1 text-[#746e65] hover:text-rose-600 cursor-pointer"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Block student</span>
                      </button>
                    </div>

                    {showScoreBreakdown && (
                      <div className="p-3 bg-[#f6f3f2] rounded-xl grid grid-cols-3 gap-2 font-mono tabular-nums text-[11px] text-[#615e56]">
                        <div>
                          <span className="block text-[#746e65]">Skill Complement</span>
                          <strong>
                            {topCard.featureBreakdown.skillComplementarityScore ??
                              topCard.featureBreakdown.interestOrRoleSim}%
                          </strong>
                        </div>
                        <div>
                          <span className="block text-[#746e65]">Shared Interests</span>
                          <strong>
                            {topCard.featureBreakdown.sharedInterestsScore ??
                              topCard.featureBreakdown.tfidfThemeSim}%
                          </strong>
                        </div>
                        <div>
                          <span className="block text-[#746e65]">Swipe Affinity</span>
                          <strong>
                            {topCard.featureBreakdown.pastSwipeAffinityScore ?? 50}%
                          </strong>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action Button Dock */}
              <div className="pt-2 flex items-center justify-between gap-3">
                {/* Pass Action Button */}
                <button
                  type="button"
                  data-testid="swipe-pass-btn"
                  disabled={submittingCardId === topCard.id}
                  onClick={() => void triggerSwipe('passed')}
                  title="Pass profile (Press Left Arrow)"
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#f6f3f2] hover:bg-[#eae7e7] text-[#4d4634] font-semibold text-xs sm:text-sm transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  <span>Pass</span>
                  <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] rounded bg-white text-[#746e65] shadow-xs font-mono">
                    ←
                  </kbd>
                </button>

                {/* Interested in Teaming Button */}
                <button
                  type="button"
                  data-testid="swipe-interested-btn"
                  disabled={submittingCardId === topCard.id}
                  onClick={() => void triggerSwipe('interested')}
                  title="Interested in teaming (Right Arrow)"
                  className="flex-[1.4] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold text-xs sm:text-sm shadow-sm transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50"
                >
                  <Heart className="w-4 h-4 fill-current text-[#1a1a1a]" />
                  <span>{interestedActionLabel}</span>
                  <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] rounded bg-white/70 text-[#1a1a1a] shadow-xs font-mono">
                    →
                  </kbd>
                </button>
              </div>
            </article>

            {/* Quiet Keyboard & Gestural Footer Hint */}
            <div className="mt-4 flex items-center justify-center gap-4 text-xs text-[#746e65]">
              <div className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-[#e9e5dd] shadow-xs text-[#1c1b1b] font-mono font-medium">
                  ←
                </kbd>
                <span>to pass</span>
              </div>
              <span className="text-[#dcd9d9]">•</span>
              <div className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-[#e9e5dd] shadow-xs text-[#1c1b1b] font-mono font-medium">
                  →
                </kbd>
                <span>to match</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);
