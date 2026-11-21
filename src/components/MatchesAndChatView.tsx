import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Heart,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  CandidateCard,
  Conversation,
  Hackathon,
  Interest,
  JoinRequest,
  Membership,
  Message,
  Profile,
  Team,
  TeamProposal,
  User,
} from '../types/domain';
import { StudentAvatar } from './StudentAvatar';

interface MatchesAndChatViewProps {
  currentUser: User;
  selectedHackathonId?: string;
  conversations: Conversation[];
  messages: Message[];
  interests?: Interest[];
  teamProposals?: TeamProposal[];
  users: User[];
  profiles: Record<string, Profile>;
  hackathons: Hackathon[];
  joinRequests?: JoinRequest[];
  teams?: Team[];
  memberships?: Membership[];
  onSendMessage: (conversationId: string, body: string) => void;
  onSwipeBack?: (
    targetUid: string,
    hackathonId: string
  ) => Promise<void> | void;
  onRefreshMatchesAndMessages?: () => Promise<void> | void;
  onOpenMyTeam?: () => void;
  onResolveJoinRequest?: (
    requestId: string,
    decision: 'accept' | 'reject'
  ) => void;
  onCreateTeam?: (params: {
    hackathonId: string;
    name: string;
    pitch: string;
    projectIdea: string;
    rolesNeeded: string[];
    customSpecializations: string[];
    targetSize: number;
  }) => void;
  onReportTarget: (params: {
    targetType: 'user' | 'team' | 'message';
    targetId: string;
    targetLabel: string;
    reason: string;
  }) => void;
  onSwipeDecision?: (
    card: CandidateCard,
    decision: 'interested' | 'passed'
  ) => void;
}

export const MatchesAndChatView: React.FC<MatchesAndChatViewProps> = React.memo(
  ({
    currentUser,
    selectedHackathonId,
    interests = [],
    teamProposals = [],
    users,
    profiles,
    hackathons,
    teams = [],
    memberships = [],
    onSwipeBack,
    onRefreshMatchesAndMessages,
    onOpenMyTeam,
  }) => {
    const [shortlistTab, setShortlistTab] = useState<
      'mutual' | 'incoming' | 'interested'
    >('mutual');

    useEffect(() => {
      if (!onRefreshMatchesAndMessages) return;
      const interval = setInterval(() => {
        void onRefreshMatchesAndMessages();
      }, 8000);
      return () => clearInterval(interval);
    }, [onRefreshMatchesAndMessages]);

    // Compute the 3 Shortlist sections from interests
    const { interestedList, incomingList, mutualMatchesList } = useMemo(() => {
      const userSwipes = interests.filter(
        (i) =>
          i.targetType === 'user' &&
          i.decision === 'interested' &&
          (!selectedHackathonId || i.hackathonId === selectedHackathonId)
      );

      const outgoingByPair = new Map<string, Interest>();
      const incomingByPair = new Map<string, Interest>();

      for (const sw of userSwipes) {
        if (sw.fromUid === currentUser.uid) {
          outgoingByPair.set(`${sw.hackathonId}:${sw.targetId}`, sw);
        } else if (sw.targetId === currentUser.uid) {
          incomingByPair.set(`${sw.hackathonId}:${sw.fromUid}`, sw);
        }
      }

      const interestedItems: Array<{
        key: string;
        uid: string;
        hackathonId: string;
        user?: User;
        profile?: Profile;
        swipedAt: string;
        note?: string;
        isMutual: boolean;
      }> = [];

      const incomingItems: Array<{
        key: string;
        uid: string;
        hackathonId: string;
        user?: User;
        profile?: Profile;
        swipedAt: string;
        note?: string;
        isMutual: boolean;
      }> = [];

      const mutualItems: Array<{
        key: string;
        uid: string;
        hackathonId: string;
        user?: User;
        profile?: Profile;
        swipedAt: string;
        team?: Team;
        proposal?: TeamProposal;
      }> = [];

      for (const [pairKey, out] of outgoingByPair.entries()) {
        const otherUid = out.targetId;
        const u = users.find((usr) => usr.uid === otherUid);
        const p = profiles[otherUid];
        const inc = incomingByPair.get(pairKey);
        const isMutual = Boolean(inc);

        interestedItems.push({
          key: pairKey,
          uid: otherUid,
          hackathonId: out.hackathonId,
          user: u,
          profile: p,
          swipedAt: out.createdAt,
          note: out.note,
          isMutual,
        });

        if (isMutual) {
          const sharedTeam = teams.find((t) => {
            if (t.hackathonId !== out.hackathonId || t.status === 'dissolved')
              return false;
            const activeUids = memberships
              .filter((m) => m.teamId === t.id && m.status === 'active')
              .map((m) => m.uid);
            return (
              activeUids.includes(currentUser.uid) &&
              activeUids.includes(otherUid)
            );
          });
          const activeProp = teamProposals.find(
            (tp) =>
              tp.hackathonId === out.hackathonId &&
              (tp.candidateUid === otherUid ||
                tp.candidateUid === currentUser.uid)
          );
          mutualItems.push({
            key: pairKey,
            uid: otherUid,
            hackathonId: out.hackathonId,
            user: u,
            profile: p,
            swipedAt:
              inc!.createdAt > out.createdAt ? inc!.createdAt : out.createdAt,
            team: sharedTeam,
            proposal: activeProp,
          });
        }
      }

      for (const [pairKey, inc] of incomingByPair.entries()) {
        const otherUid = inc.fromUid;
        const u = users.find((usr) => usr.uid === otherUid);
        const p = profiles[otherUid];
        if (u && u.privacyPreferences?.profileVisible === false) continue;
        const isMutual = outgoingByPair.has(pairKey);
        incomingItems.push({
          key: pairKey,
          uid: otherUid,
          hackathonId: inc.hackathonId,
          user: u,
          profile: p,
          swipedAt: inc.createdAt,
          note: inc.note,
          isMutual,
        });
      }

      return {
        interestedList: interestedItems,
        incomingList: incomingItems,
        mutualMatchesList: mutualItems,
      };
    }, [
      interests,
      selectedHackathonId,
      currentUser.uid,
      users,
      profiles,
      teams,
      memberships,
      teamProposals,
    ]);

    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Clean Page Header */}
        <div className="pb-3 border-b border-[#e9e5dd]">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1c1b1b]">
            Matches &amp; Shortlist
          </h1>
        </div>

        {/* 3-Tab Shortlist Switcher */}
        <div className="space-y-4">
          <div
            role="tablist"
            aria-label="Shortlist categories"
            className="flex items-center gap-2 border-b border-[#e9e5dd] pb-3 overflow-x-auto"
          >
            <button
              type="button"
              role="tab"
              aria-selected={shortlistTab === 'mutual'}
              data-testid="shortlist-tab-mutual"
              onClick={() => setShortlistTab('mutual')}
              className={`quack-chip px-4 py-2 rounded-full text-xs cursor-pointer whitespace-nowrap flex items-center gap-1.5 border ${
                shortlistTab === 'mutual'
                  ? 'bg-[#ffd84d] border-[#e5be35] text-[#1c1b1b] font-bold shadow-2xs'
                  : 'bg-white text-[#746e65] hover:bg-[#f6f3eb] border-[#e9e5dd] font-medium'
              }`}
            >
              <span>Mutual Matches</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[11px] tabular-nums ${
                  shortlistTab === 'mutual'
                    ? 'bg-[#ffe892] text-[#1c1b1b]'
                    : 'bg-[#f6f3f2] text-[#746e65]'
                }`}
              >
                {mutualMatchesList.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={shortlistTab === 'incoming'}
              data-testid="shortlist-tab-incoming"
              onClick={() => setShortlistTab('incoming')}
              className={`quack-chip px-4 py-2 rounded-full text-xs cursor-pointer whitespace-nowrap flex items-center gap-1.5 border ${
                shortlistTab === 'incoming'
                  ? 'bg-[#ffd84d] border-[#e5be35] text-[#1c1b1b] font-bold shadow-2xs'
                  : 'bg-white text-[#746e65] hover:bg-[#f6f3eb] border-[#e9e5dd] font-medium'
              }`}
            >
              <span>Interested in You</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[11px] tabular-nums ${
                  shortlistTab === 'incoming'
                    ? 'bg-[#ffe892] text-[#1c1b1b]'
                    : 'bg-[#f6f3f2] text-[#746e65]'
                }`}
              >
                {incomingList.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={shortlistTab === 'interested'}
              data-testid="shortlist-tab-interested"
              onClick={() => setShortlistTab('interested')}
              className={`quack-chip px-4 py-2 rounded-full text-xs cursor-pointer whitespace-nowrap flex items-center gap-1.5 border ${
                shortlistTab === 'interested'
                  ? 'bg-[#ffd84d] border-[#e5be35] text-[#1c1b1b] font-bold shadow-2xs'
                  : 'bg-white text-[#746e65] hover:bg-[#f6f3eb] border-[#e9e5dd] font-medium'
              }`}
            >
              <span>Interested</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[11px] tabular-nums ${
                  shortlistTab === 'interested'
                    ? 'bg-[#ffe892] text-[#1c1b1b]'
                    : 'bg-[#f6f3f2] text-[#746e65]'
                }`}
              >
                {interestedList.length}
              </span>
            </button>
          </div>

          {shortlistTab === 'mutual' && (
            <div className="space-y-3">
              {mutualMatchesList.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#746e65] bg-white rounded-2xl border border-[#e9e5dd] p-8 space-y-2">
                  <Users className="w-8 h-8 text-[#746e65]/50 mx-auto" />
                  <h3 className="font-bold text-sm text-[#1c1b1b]">
                    No mutual matches yet
                  </h3>
                  <p className="max-w-md mx-auto">
                    When you and another student both swipe right on each other, your mutual match appears here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {mutualMatchesList.map((item) => {
                    const hack = hackathons.find(
                      (h) => h.id === item.hackathonId
                    );
                    return (
                      <div
                        key={item.key}
                        className="quack-interactive-card p-4 rounded-2xl border border-[#e9e5dd] bg-white space-y-3 text-xs"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <StudentAvatar
                              uid={item.uid}
                              name={item.user?.displayName ?? item.uid}
                              size="md"
                              className="mt-0.5"
                            />
                            <div className="min-w-0">
                              <span className="text-[11px] text-[#725c00] font-semibold block truncate">
                                {hack?.name ?? item.hackathonId}
                              </span>
                              <h4 className="text-sm font-bold text-[#1c1b1b] truncate">
                                {item.user?.displayName ?? item.uid}
                              </h4>
                              <p className="text-[#746e65] truncate">
                                {item.profile?.preferredRoles.join(' · ') ||
                                  'Student Builder'}
                              </p>
                            </div>
                          </div>

                          {item.team ? (
                            <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold text-[11px] shrink-0">
                              Teammates ({item.team.memberCount}/{item.team.targetSize})
                            </span>
                          ) : item.proposal ? (
                            <span className="px-2.5 py-1 rounded-full bg-[#fff3c9] border border-[#f0d98c] text-[#725c00] font-semibold text-[11px] shrink-0">
                              Proposal: {item.proposal.status.replace(/_/g, ' ')}
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full bg-[#fff3c9] border border-[#f0d98c] text-[#725c00] font-semibold text-[11px] shrink-0">
                              Mutual Match
                            </span>
                          )}
                        </div>

                        {item.profile && item.profile.skillTags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {item.profile.skillTags.slice(0, 4).map((s) => (
                              <span
                                key={s}
                                className="inline-flex bg-[#f6f3f2] border border-[#e9e5dd] text-[#4d4634] rounded-lg px-2.5 py-0.5 text-[11px]"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="pt-2.5 border-t border-[#f1ede6] flex items-center justify-between gap-2">
                          <span className="text-[11px] text-[#746e65]">
                            Matched {new Date(item.swipedAt).toLocaleDateString()}
                          </span>
                          {onOpenMyTeam && (
                            <button
                              type="button"
                              onClick={onOpenMyTeam}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-[#1c1b1b] text-xs font-bold transition-colors duration-150 shadow-2xs cursor-pointer"
                            >
                              <span>{item.team ? 'Open My Team' : 'View Team Status'}</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {shortlistTab === 'incoming' && (
            <div className="space-y-3">
              {incomingList.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#746e65] bg-white rounded-2xl border border-[#e9e5dd] p-8 space-y-2">
                  <UserPlus className="w-8 h-8 text-[#746e65]/50 mx-auto" />
                  <h3 className="font-bold text-sm text-[#1c1b1b]">
                    No incoming student interests yet
                  </h3>
                  <p className="max-w-md mx-auto">
                    Students who express interest in teaming with you will appear here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {incomingList.map((item) => {
                    const hack = hackathons.find(
                      (h) => h.id === item.hackathonId
                    );
                    return (
                      <div
                        key={item.key}
                        className="quack-interactive-card p-4 rounded-2xl border border-[#e9e5dd] bg-white space-y-3 text-xs"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <StudentAvatar
                              uid={item.uid}
                              name={item.user?.displayName ?? item.uid}
                              size="md"
                              className="mt-0.5"
                            />
                            <div className="min-w-0">
                              <span className="text-[11px] text-[#725c00] font-semibold block truncate">
                                {hack?.name ?? item.hackathonId}
                              </span>
                              <h4 className="font-bold text-sm text-[#1c1b1b] truncate">
                                {item.user?.displayName ?? item.uid}
                              </h4>
                              <p className="text-[#746e65] truncate">
                                {item.profile?.preferredRoles.join(' · ') ||
                                  'Student'}
                              </p>
                            </div>
                          </div>

                          {item.isMutual ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold text-[11px] shrink-0">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Matched
                            </span>
                          ) : onSwipeBack ? (
                            <button
                              type="button"
                              data-testid={`match-back-${item.uid}`}
                              onClick={() =>
                                void onSwipeBack(item.uid, item.hackathonId)
                              }
                              className="px-3.5 py-1.5 rounded-lg bg-[#ffd84d] hover:bg-[#ffe06b] border border-[#e5be35] text-[#1c1b1b] font-bold text-xs shadow-2xs inline-flex items-center gap-1 cursor-pointer transition-colors duration-150 shrink-0"
                            >
                              <Heart className="w-3.5 h-3.5 fill-current" />
                              <span>Match Back</span>
                            </button>
                          ) : null}
                        </div>

                        {item.profile && item.profile.skillTags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {item.profile.skillTags.slice(0, 4).map((s) => (
                              <span
                                key={s}
                                className="inline-flex bg-[#f6f3f2] border border-[#e9e5dd] text-[#4d4634] rounded-lg px-2.5 py-0.5 text-[11px]"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        )}

                        {item.note && (
                          <p className="text-[#4d4634] italic bg-[#faf8f2] border border-[#e9e5dd] p-2.5 rounded-lg">
                            &ldquo;{item.note}&rdquo;
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {shortlistTab === 'interested' && (
            <div className="space-y-3">
              {interestedList.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#746e65] bg-white rounded-2xl border border-[#e9e5dd] p-8 space-y-2">
                  <Heart className="w-8 h-8 text-[#746e65]/50 mx-auto" />
                  <h3 className="font-bold text-sm text-[#1c1b1b]">
                    No outgoing interests yet
                  </h3>
                  <p className="max-w-md mx-auto">
                    Profiles you swipe right on in Discover will be saved here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {interestedList.map((item) => {
                    const hack = hackathons.find(
                      (h) => h.id === item.hackathonId
                    );
                    return (
                      <div
                        key={item.key}
                        className="quack-interactive-card p-4 rounded-2xl border border-[#e9e5dd] bg-white space-y-3 text-xs"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <StudentAvatar
                              uid={item.uid}
                              name={item.user?.displayName ?? item.uid}
                              size="md"
                              className="mt-0.5"
                            />
                            <div className="min-w-0">
                              <span className="text-[11px] text-[#725c00] font-semibold block truncate">
                                {hack?.name ?? item.hackathonId}
                              </span>
                              <h4 className="font-bold text-sm text-[#1c1b1b] truncate">
                                {item.user?.displayName ?? item.uid}
                              </h4>
                              <p className="text-[#746e65] truncate">
                                {item.profile?.preferredRoles.join(' · ') ||
                                  'Student'}
                              </p>
                            </div>
                          </div>

                          <span className="px-2.5 py-1 rounded-full bg-[#f6f3f2] border border-[#e9e5dd] text-[#4d4634] font-semibold text-[11px] shrink-0">
                            {item.isMutual ? 'Mutual Match' : 'Awaiting Response'}
                          </span>
                        </div>

                        {item.profile && item.profile.skillTags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {item.profile.skillTags.slice(0, 4).map((s) => (
                              <span
                                key={s}
                                className="inline-flex bg-[#f6f3f2] border border-[#e9e5dd] text-[#4d4634] rounded-lg px-2.5 py-0.5 text-[11px]"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);
