import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
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
  isHackathonEligibleForMatching,
  rankPeopleForHackathon,
} from '../services/matchingEngine';
import { formatEventDateDisplayIST } from '../lib/eventsAndAnnouncements';
import { filterUpcomingStudentHackathons } from '../lib/pagination';
import { StudentAvatar } from './StudentAvatar';
import { SelectMenu, SelectMenuOption } from './SelectMenu';
import { QUACKATHON_MINI_LOGO_SRC } from './LoginPage';
import {
  AlertTriangle,
  Calendar,
  Check,
  ExternalLink,
  FlaskConical,
  Github,
  Heart,
  RefreshCw,
  RotateCcw,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

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
  ) => void;
  onResetPassedCards?: (hackathonId: string) => Promise<void> | void;
  onBlockUser: (targetUid: string) => void;
  onOpenMyTeam?: () => void;
  onOpenProfile?: () => void;
  onOpenHackathons?: () => void;
  /** Strictly development-only testing mode hooks (never exposed in production) */
  devTestingAvailable?: boolean;
  devTestingActive?: boolean;
  onToggleDevTestingMode?: (enabled: boolean) => void;
  onResetDevTestingSandbox?: () => void;
}

export const DiscoverView: React.FC<DiscoverViewProps> = ({
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
  onOpenMyTeam,
  onOpenHackathons,
  devTestingAvailable = false,
  devTestingActive = false,
  onToggleDevTestingMode,
  onResetDevTestingSandbox,
}) => {
  const [exitingCard, setExitingCard] = useState<{
    id: string;
    direction: 'left' | 'right';
  } | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isJoiningPool, setIsJoiningPool] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // Separate upcoming matchable hackathons from closed/past ones
  const upcomingMatchableHackathons = useMemo(
    () =>
      filterUpcomingStudentHackathons(hackathons).filter((h) =>
        isHackathonEligibleForMatching(h)
      ),
    [hackathons]
  );

  // When in dev testing mode, only show the active matchable dev sandbox hackathon
  const selectableHackathons = useMemo(() => {
    if (devTestingActive) {
      return hackathons.filter((h) => isHackathonEligibleForMatching(h));
    }
    return upcomingMatchableHackathons;
  }, [devTestingActive, hackathons, upcomingMatchableHackathons]);

  const selectedHackathon = useMemo(() => {
    const exact = hackathons.find((h) => h.id === selectedHackathonId);
    if (exact && isHackathonEligibleForMatching(exact)) return exact;
    if (selectableHackathons.length > 0) return selectableHackathons[0];
    return exact ?? null;
  }, [hackathons, selectedHackathonId, selectableHackathons]);

  // Keep parent selectedHackathonId aligned with first upcoming matchable event when needed
  useEffect(() => {
    if (
      selectableHackathons.length > 0 &&
      (!selectedHackathonId ||
        !selectableHackathons.some((h) => h.id === selectedHackathonId))
    ) {
      onSelectHackathon(selectableHackathons[0].id);
    }
  }, [selectableHackathons, selectedHackathonId, onSelectHackathon]);

  const hackathonSelectOptions: SelectMenuOption[] = useMemo(
    () =>
      selectableHackathons.map((h) => ({
        value: h.id,
        label: h.name,
        description: formatEventDateDisplayIST(h),
        badge: devTestingActive ? 'Dev Test' : undefined,
      })),
    [selectableHackathons, devTestingActive]
  );

  const selectedHackathonEligible = useMemo(
    () =>
      selectedHackathon
        ? isHackathonEligibleForMatching(selectedHackathon)
        : false,
    [selectedHackathon]
  );

  // Real user explicit opt-in check (do NOT silently opt real users into discovery)
  const viewerParticipation = useMemo(
    () =>
      selectedHackathon
        ? participations.find(
            (p) =>
              p.uid === currentUser.uid &&
              p.hackathonId === selectedHackathon.id
          )
        : undefined,
    [participations, currentUser.uid, selectedHackathon]
  );

  const hasExplicitlyJoinedPool = Boolean(
    devTestingActive || viewerParticipation?.discoverable === true
  );

  // Viewer's active team for the selected hackathon
  const viewerActiveTeam = useMemo(() => {
    if (!selectedHackathon) return undefined;
    const myMem = memberships.find(
      (m) =>
        m.uid === currentUser.uid &&
        m.status === 'active' &&
        (m.hackathonId === selectedHackathon.id ||
          teams.some(
            (t) => t.id === m.teamId && t.hackathonId === selectedHackathon.id
          ))
    );
    if (myMem) {
      return teams.find(
        (t) =>
          t.id === myMem.teamId &&
          t.hackathonId === selectedHackathon.id &&
          t.status !== 'dissolved'
      );
    }
    return teams.find(
      (t) =>
        t.hackathonId === selectedHackathon.id &&
        t.leaderId === currentUser.uid &&
        t.status !== 'dissolved'
    );
  }, [memberships, teams, currentUser.uid, selectedHackathon]);

  const maxAllowedSize = selectedHackathon?.maxTeamSize ?? 4;
  const viewerTeamIsFull = Boolean(
    viewerActiveTeam &&
      (viewerActiveTeam.status === 'full' ||
        viewerActiveTeam.status === 'locked' ||
        viewerActiveTeam.memberCount >=
          Math.min(
            maxAllowedSize,
            viewerActiveTeam.targetSize || maxAllowedSize
          ))
  );

  const candidateCards = useMemo(() => {
    if (
      !selectedHackathon ||
      !selectedHackathonEligible ||
      !hasExplicitlyJoinedPool
    ) {
      return [];
    }
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
    selectedHackathonEligible,
    hasExplicitlyJoinedPool,
    users,
    profiles,
    participations,
    teams,
    memberships,
    interests,
    blocks,
  ]);

  const passedCountForSelected = useMemo(() => {
    if (!selectedHackathon) return 0;
    return interests.filter(
      (i) =>
        i.hackathonId === selectedHackathon.id &&
        i.fromUid === currentUser.uid &&
        i.targetType === 'user' &&
        i.decision === 'passed'
    ).length;
  }, [interests, selectedHackathon, currentUser.uid]);

  const swipedRightCountForSelected = useMemo(() => {
    if (!selectedHackathon) return 0;
    return interests.filter(
      (i) =>
        i.hackathonId === selectedHackathon.id &&
        i.fromUid === currentUser.uid &&
        i.targetType === 'user' &&
        i.decision === 'interested'
    ).length;
  }, [interests, selectedHackathon, currentUser.uid]);

  const topCard = candidateCards[0] ?? null;

  const triggerDecision = useCallback(
    (card: CandidateCard, decision: 'interested' | 'passed') => {
      if (exitingCard) return;
      setExitingCard({
        id: card.id,
        direction: decision === 'interested' ? 'right' : 'left',
      });
      setTimeout(() => {
        onSwipeDecision(card, decision);
        setExitingCard(null);
        setDragOffsetX(0);
      }, 175);
    },
    [exitingCard, onSwipeDecision]
  );

  // Keyboard accessibility: Left arrow = Pass, Right arrow = Interested
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!topCard || exitingCard) return;
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
        triggerDecision(topCard, 'passed');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        triggerDecision(topCard, 'interested');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [topCard, exitingCard, triggerDecision]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (
      (e.target as HTMLElement).closest('button, a') ||
      !topCard ||
      exitingCard
    ) {
      return;
    }
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    setDragOffsetX(e.clientX - dragStartRef.current.x);
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    dragStartRef.current = null;
    if (!topCard) {
      setDragOffsetX(0);
      return;
    }
    if (dragOffsetX > 95) {
      triggerDecision(topCard, 'interested');
    } else if (dragOffsetX < -95) {
      triggerDecision(topCard, 'passed');
    } else {
      setDragOffsetX(0);
    }
  };

  const handleJoinPool = async () => {
    if (!selectedHackathon || !selectedHackathonEligible || isJoiningPool) return;
    setIsJoiningPool(true);
    try {
      await onUpdateParticipation(selectedHackathon.id, {
        discoverable: true,
        intent: 'looking',
      });
    } finally {
      setIsJoiningPool(false);
    }
  };

  const renderTopCard = (card: CandidateCard) => {
    const candidateProfile = profiles[card.id];
    const isSyntheticTestUser = card.id.startsWith('dev_test_');
    const isExiting = exitingCard?.id === card.id;
    const tx = isExiting
      ? exitingCard.direction === 'right'
        ? 380
        : -380
      : dragOffsetX;
    const rot = isExiting
      ? exitingCard.direction === 'right'
        ? 11
        : -11
      : Math.max(-10, Math.min(10, dragOffsetX * 0.035));
    const rightOpacity = isExiting
      ? exitingCard.direction === 'right'
        ? 1
        : 0
      : Math.min(1, Math.max(0, (dragOffsetX - 24) / 80));
    const leftOpacity = isExiting
      ? exitingCard.direction === 'left'
        ? 1
        : 0
      : Math.min(1, Math.max(0, (-dragOffsetX - 24) / 80));

    return (
      <div
        key={card.id}
        data-testid={`discover-card-${card.id}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          transform: `translate3d(${tx}px, 0, 0) rotate(${rot}deg)`,
          opacity: isExiting ? 0 : 1,
          transition: isDragging
            ? 'none'
            : 'transform 175ms cubic-bezier(0.22, 1, 0.36, 1), opacity 175ms ease-out',
        }}
        className="quack-card-in relative select-none touch-pan-y bg-white rounded-3xl border border-[#e9e5dd] shadow-[0_14px_36px_-18px_rgba(36,33,28,0.16)] overflow-hidden cursor-grab active:cursor-grabbing"
      >
        {/* Directional Swipe Stamps */}
        {rightOpacity > 0.02 && (
          <div
            style={{ opacity: rightOpacity }}
            className="pointer-events-none absolute top-5 right-5 z-20 px-3.5 py-1.5 rounded-xl bg-[#ffd84d] border-2 border-[#725c00] text-[#1c1b1b] text-xs font-extrabold tracking-wider uppercase rotate-6 shadow-sm"
          >
            Interested
          </div>
        )}
        {leftOpacity > 0.02 && (
          <div
            style={{ opacity: leftOpacity }}
            className="pointer-events-none absolute top-5 left-5 z-20 px-3.5 py-1.5 rounded-xl bg-white border-2 border-rose-500 text-rose-700 text-xs font-extrabold tracking-wider uppercase -rotate-6 shadow-sm"
          >
            Pass
          </div>
        )}

        <div className="p-6 sm:p-7 space-y-5">
          {/* Student Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <StudentAvatar
                uid={card.id}
                name={card.title}
                size="lg"
                className="mt-0.5"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-[#1c1b1b] tracking-tight truncate">
                    {card.title}
                  </h2>
                  {isSyntheticTestUser && (
                    <span className="px-2 py-0.5 rounded-md bg-[#fff3c9] border border-[#f0d98c] text-[#725c00] text-[10px] font-bold uppercase tracking-wide">
                      Dev Test
                    </span>
                  )}
                </div>
                {card.rolesOfferedOrNeeded.length > 0 && (
                  <p className="text-xs font-semibold text-[#725c00] mt-0.5">
                    {card.rolesOfferedOrNeeded.join(' · ')}
                  </p>
                )}
              </div>
            </div>

            {card.overallScore !== undefined && (
              <span className="shrink-0 px-2.5 py-1 rounded-full bg-[#fff3c9] border border-[#f0d98c] text-[#725c00] text-xs font-bold tabular-nums">
                {Math.round(card.overallScore <= 1 ? card.overallScore * 100 : card.overallScore)}% match
              </span>
            )}
          </div>

          {/* Headline & Bio */}
          {(candidateProfile?.headline || candidateProfile?.about) && (
            <div className="space-y-1.5">
              {candidateProfile?.headline && (
                <p className="text-sm font-medium text-[#1c1b1b] leading-snug">
                  {candidateProfile.headline}
                </p>
              )}
              {candidateProfile?.about && (
                <p className="text-xs text-[#4d4634] leading-relaxed">
                  {candidateProfile.about}
                </p>
              )}
            </div>
          )}

          {/* Recommendation Highlights */}
          {card.compatibilityReasons.length > 0 && (
            <div className="rounded-xl bg-[#faf8f2] border border-[#e9e5dd] p-3.5 space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#725c00]">
                Why you match
              </div>
              <ul className="space-y-1 text-xs text-[#4d4634]">
                {card.compatibilityReasons.slice(0, 3).map((reason: string, idx: number) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-[#725c00] shrink-0 mt-0.5" />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Skills */}
          {card.skills.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-[#746e65] uppercase tracking-wider">
                Skills
              </div>
              <div className="flex flex-wrap gap-1.5">
                {card.skills.slice(0, 8).map((skill) => (
                  <span
                    key={skill}
                    className="px-2.5 py-1 rounded-lg bg-[#f6f3f2] border border-[#e9e5dd] text-[#24211c] text-xs font-medium"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Interests */}
          {((candidateProfile?.interestTags?.length ?? 0) > 0 || card.sharedInterests.length > 0) && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-[#746e65] uppercase tracking-wider">
                Interests
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(candidateProfile?.interestTags?.length
                  ? candidateProfile.interestTags
                  : card.sharedInterests
                )
                  .slice(0, 4)
                  .map((interest: string) => (
                    <span
                      key={interest}
                      className="px-2.5 py-1 rounded-lg bg-[#fff3c9]/65 border border-[#f2dc8c] text-[#564500] text-xs font-medium"
                    >
                      {interest}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Featured Projects & GitHub */}
          {candidateProfile &&
            (candidateProfile.featuredProjects.length > 0 ||
              candidateProfile.githubUsername) && (
              <div className="pt-3 border-t border-[#f1ede6] space-y-2">
                {candidateProfile.featuredProjects.slice(0, 2).map((proj) => (
                  <div
                    key={proj.id}
                    className="rounded-xl bg-[#faf8f2] border border-[#e9e5dd] px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#1c1b1b]">
                        {proj.title}
                      </span>
                      {proj.sourceUrl && (
                        <a
                          href={proj.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#725c00] hover:underline inline-flex items-center gap-0.5 text-[11px]"
                        >
                          <span>View</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    {proj.description && (
                      <p className="text-[#746e65] mt-0.5 leading-snug">
                        {proj.description}
                      </p>
                    )}
                  </div>
                ))}

                {candidateProfile.githubUsername && !isSyntheticTestUser && (
                  <a
                    href={`https://github.com/${candidateProfile.githubUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4d4634] hover:text-[#1c1b1b]"
                  >
                    <Github className="w-3.5 h-3.5" />
                    <span>github.com/{candidateProfile.githubUsername}</span>
                  </a>
                )}
              </div>
            )}

          {/* Swipe Actions */}
          <div className="pt-4 border-t border-[#f1ede6] flex items-center justify-center gap-4">
            <button
              type="button"
              data-testid="discover-pass-btn"
              onClick={() => triggerDecision(card, 'passed')}
              className="flex-1 max-w-[180px] inline-flex items-center justify-center gap-2 py-3 px-5 rounded-2xl border border-[#e9e5dd] bg-white hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 active:scale-[0.97] text-[#4d4634] text-sm font-bold transition-all duration-150 cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span>Pass</span>
            </button>

            <button
              type="button"
              data-testid="discover-interested-btn"
              onClick={() => triggerDecision(card, 'interested')}
              className="flex-1 max-w-[180px] inline-flex items-center justify-center gap-2 py-3 px-5 rounded-2xl bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] active:scale-[0.97] text-[#1c1b1b] text-sm font-bold shadow-xs transition-all duration-150 cursor-pointer"
            >
              <Heart className="w-4 h-4 fill-current" />
              <span>Interested</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header + Hackathon Selector + Dev Mode Control (Dev-only) */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1c1b1b]">
            Discover
          </h1>
          <p className="text-xs text-[#746e65] mt-0.5 tabular-nums">
            {candidateCards.length > 0
              ? `${candidateCards.length} ${
                  candidateCards.length === 1 ? 'student' : 'students'
                } available`
              : selectableHackathons.length === 0
              ? 'No upcoming hackathons active'
              : 'Teammate discovery'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {hackathonSelectOptions.length > 0 && selectedHackathon && (
            <SelectMenu
              value={selectedHackathon.id}
              options={hackathonSelectOptions}
              onChange={onSelectHackathon}
              ariaLabel="Select upcoming hackathon"
              className="w-60 sm:w-64"
              menuAlign="right"
            />
          )}

          {devTestingAvailable && onToggleDevTestingMode && (
            <button
              type="button"
              data-testid="toggle-dev-testing-mode"
              onClick={() => onToggleDevTestingMode(!devTestingActive)}
              className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                devTestingActive
                  ? 'bg-[#ffd84d] border-[#e5be35] text-[#1c1b1b]'
                  : 'bg-white border-[#e9e5dd] text-[#4d4634] hover:bg-[#f6f3eb]'
              }`}
              title="Isolated local development testing sandbox (never shown in production)"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span>{devTestingActive ? 'Exit Dev Test' : 'Dev Test Mode'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Isolated Dev Testing Mode Banner (Strictly Dev-Only) */}
      {devTestingAvailable && devTestingActive && (
        <div
          data-testid="dev-testing-banner"
          className="rounded-xl bg-[#fff3c9]/75 border border-[#f0d98c] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-[#564500]"
        >
          <div className="flex items-start gap-2">
            <FlaskConical className="w-4 h-4 text-[#875200] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-[#1c1b1b]">
                Development Testing Sandbox Active
              </span>
              <span className="block text-[11px] text-[#564500] mt-0.5">
                Swiping against 8 synthetic student profiles in isolated local state. 3 profiles already expressed interest in you for testing mutual matches &amp; team formation.
              </span>
            </div>
          </div>
          {onResetDevTestingSandbox && (
            <button
              type="button"
              onClick={onResetDevTestingSandbox}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-[#e5be35] text-[#1c1b1b] text-[11px] font-semibold hover:bg-[#faf8f2] transition-colors duration-150 cursor-pointer shrink-0 self-start sm:self-center"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reset Sandbox</span>
            </button>
          )}
        </div>
      )}

      {/* Active Team Banner */}
      {viewerActiveTeam && selectedHackathonEligible && (
        <div className="rounded-xl bg-white border border-[#e9e5dd] px-4 py-3 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <Users className="w-4 h-4 text-[#725c00] shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-[#1c1b1b] truncate block">
                Your team: {viewerActiveTeam.name} ({viewerActiveTeam.memberCount}/
                {viewerActiveTeam.targetSize})
              </span>
              <span className="text-[#746e65]">
                {viewerTeamIsFull
                  ? 'Your team is at full capacity.'
                  : 'Swipe right to propose adding another teammate.'}
              </span>
            </div>
          </div>
          {onOpenMyTeam && (
            <button
              type="button"
              onClick={onOpenMyTeam}
              className="px-3 py-1.5 rounded-lg bg-[#fff3c9] border border-[#f0d98c] text-[#725c00] font-semibold hover:bg-[#ffd84d] hover:text-[#1c1b1b] transition-colors duration-150 cursor-pointer shrink-0"
            >
              My Team
            </button>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* STATE 1: NO UPCOMING MATCHABLE HACKATHONS IN LIVE BACKEND            */}
      {/* ==================================================================== */}
      {selectableHackathons.length === 0 ? (
        <div className="bg-white rounded-3xl border border-[#e9e5dd] p-8 sm:p-10 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#fff3c9] border border-[#f0d98c] flex items-center justify-center p-2.5">
            <img
              src={QUACKATHON_MINI_LOGO_SRC}
              alt="Quackathon"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-bold text-[#1c1b1b]">
              No upcoming hackathons open for matching
            </h2>
            <p className="text-xs text-[#746e65] max-w-md mx-auto leading-relaxed">
              Teammate discovery opens automatically when an upcoming verified team hackathon is listed. Ended or closed competitions cannot be matched.
            </p>
          </div>

          <div className="flex items-center justify-center gap-2.5 flex-wrap pt-1">
            {onOpenHackathons && (
              <button
                type="button"
                onClick={onOpenHackathons}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-[#e9e5dd] bg-white hover:bg-[#f6f3eb] text-xs font-semibold text-[#1c1b1b] transition-colors duration-150 cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>View Hackathons</span>
              </button>
            )}
            {devTestingAvailable && onToggleDevTestingMode && (
              <button
                type="button"
                data-testid="empty-enable-dev-testing"
                onClick={() => onToggleDevTestingMode(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-xs font-bold text-[#1c1b1b] shadow-2xs transition-colors duration-150 cursor-pointer"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                <span>Test Swiping in Dev Sandbox</span>
              </button>
            )}
          </div>
        </div>
      ) : !selectedHackathon || !selectedHackathonEligible ? (
        /* ================================================================== */
        /* STATE 2: SELECTED HACKATHON ENDED OR CLOSED                        */
        /* ================================================================== */
        <div className="bg-white rounded-3xl border border-[#e9e5dd] p-8 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-[#fff3c9] border border-[#f0d98c] flex items-center justify-center text-[#875200]">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-[#1c1b1b]">
            Matching closed for {selectedHackathon?.name ?? 'this event'}
          </h2>
          <p className="text-xs text-[#746e65] max-w-md mx-auto leading-relaxed">
            Registration has closed or this event has ended. Select an upcoming hackathon to discover teammates.
          </p>
        </div>
      ) : !hasExplicitlyJoinedPool ? (
        /* ================================================================== */
        /* STATE 3: EXPLICIT OPT-IN REQUIRED FOR REAL USERS                   */
        /* ================================================================== */
        <div className="bg-white rounded-3xl border border-[#e9e5dd] p-8 sm:p-10 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#fff3c9] border border-[#f0d98c] flex items-center justify-center text-[#725c00]">
            <UserPlus className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-bold text-[#1c1b1b]">
              Join matching pool for {selectedHackathon.name}
            </h2>
            <p className="text-xs text-[#746e65] max-w-md mx-auto leading-relaxed">
              Your profile stays private until you explicitly join an event&apos;s teammate pool. Join to view compatible PESU builders for this hackathon.
            </p>
          </div>
          <button
            type="button"
            disabled={isJoiningPool}
            onClick={() => void handleJoinPool()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-[#1c1b1b] text-xs font-bold shadow-xs transition-colors duration-150 cursor-pointer disabled:opacity-60"
          >
            <UserPlus className="w-4 h-4" />
            <span>
              {isJoiningPool ? 'Joining...' : 'Join Teammate Matching Pool'}
            </span>
          </button>
        </div>
      ) : viewerTeamIsFull ? (
        /* ================================================================== */
        /* STATE 4: VIEWER'S TEAM IS ALREADY FULL                             */
        /* ================================================================== */
        <div className="bg-white rounded-3xl border border-[#e9e5dd] p-8 text-center space-y-3.5">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#fff3c9] border border-[#f0d98c] flex items-center justify-center p-2">
            <img
              src={QUACKATHON_MINI_LOGO_SRC}
              alt="Quackathon"
              className="w-full h-full object-contain"
            />
          </div>
          <h2 className="text-base font-bold text-[#1c1b1b]">
            Your team is full for {selectedHackathon.name}
          </h2>
          <p className="text-xs text-[#746e65] max-w-sm mx-auto">
            You have reached the maximum team size. Coordinate with your teammates in My Team.
          </p>
          {onOpenMyTeam && (
            <button
              type="button"
              onClick={onOpenMyTeam}
              className="px-4 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-[#1c1b1b] text-xs font-bold cursor-pointer"
            >
              Open My Team
            </button>
          )}
        </div>
      ) : topCard ? (
        /* ================================================================== */
        /* ACTIVE SWIPE DECK                                                  */
        /* ================================================================== */
        <div className="space-y-3">
          {renderTopCard(topCard)}
          <p className="text-center text-[11px] text-[#746e65]">
            Drag card or press <kbd className="px-1.5 py-0.5 rounded bg-white border border-[#e9e5dd] font-mono text-[10px]">←</kbd> to pass,{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-white border border-[#e9e5dd] font-mono text-[10px]">→</kbd> if interested
          </p>
        </div>
      ) : passedCountForSelected === 0 && swipedRightCountForSelected === 0 ? (
        /* ================================================================== */
        /* STATE 5A: NO OTHER ELIGIBLE STUDENTS IN POOL YET                   */
        /* ================================================================== */
        <div className="bg-white rounded-3xl border border-[#e9e5dd] p-8 sm:p-10 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#fff3c9] border border-[#f0d98c] flex items-center justify-center p-2.5">
            <img
              src={QUACKATHON_MINI_LOGO_SRC}
              alt="Quackathon"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-[#1c1b1b]">
              No other eligible students in {selectedHackathon.name} yet
            </h2>
            <p className="text-xs text-[#746e65] max-w-md mx-auto leading-relaxed">
              You&apos;re in the matching pool. As other verified PESU students join this hackathon, their ranked cards will appear here.
            </p>
          </div>
          {devTestingAvailable && !devTestingActive && onToggleDevTestingMode && (
            <button
              type="button"
              onClick={() => onToggleDevTestingMode(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-xs font-bold text-[#1c1b1b] cursor-pointer"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span>Test Swiping with Dev Sandbox</span>
            </button>
          )}
        </div>
      ) : (
        /* ================================================================== */
        /* STATE 5B: ALL AVAILABLE CANDIDATES REVIEWED                        */
        /* ================================================================== */
        <div className="bg-white rounded-3xl border border-[#e9e5dd] p-8 sm:p-10 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#fff3c9] border border-[#f0d98c] flex items-center justify-center p-2.5">
            <img
              src={QUACKATHON_MINI_LOGO_SRC}
              alt="Quackathon"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-[#1c1b1b]">
              You&apos;re all caught up for {selectedHackathon.name}
            </h2>
            <p className="text-xs text-[#746e65] max-w-md mx-auto">
              You have reviewed every eligible student currently in this event&apos;s pool.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2.5 flex-wrap pt-1">
            {passedCountForSelected > 0 && onResetPassedCards && (
              <button
                type="button"
                data-testid="reset-passed-students-btn"
                onClick={() => void onResetPassedCards(selectedHackathon.id)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-[#1c1b1b] text-xs font-bold shadow-2xs transition-colors duration-150 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>
                  Review {passedCountForSelected} Passed{' '}
                  {passedCountForSelected === 1 ? 'Student' : 'Students'} Again
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
