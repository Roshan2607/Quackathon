import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Flag,
  Heart,
  MessageSquare,
  Send,
  Sparkles,
  UserCheck,
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
  // Optional unused legacy compatibility props
  onSwipeDecision?: (
    card: CandidateCard,
    decision: 'interested' | 'passed'
  ) => void;
}

const DEFAULT_ICEBREAKERS = [
  'Which track or problem statement are you most excited to build for?',
  'Do you prefer building a fast end-to-end prototype first or splitting frontend/backend APIs?',
  'What times this week work best for a quick 15-minute sync?',
];

export const MatchesAndChatView: React.FC<MatchesAndChatViewProps> = React.memo(
  ({
    currentUser,
    selectedHackathonId,
    conversations,
    messages,
    interests = [],
    teamProposals = [],
    users,
    profiles,
    hackathons,
    teams = [],
    memberships = [],
    onSendMessage,
    onSwipeBack,
    onRefreshMatchesAndMessages,
    onOpenMyTeam,
    onReportTarget,
  }) => {
    const [activeSection, setActiveSection] = useState<'shortlist' | 'chat'>(
      'shortlist'
    );
    const [shortlistTab, setShortlistTab] = useState<
      'mutual' | 'interested' | 'incoming'
    >('mutual');

    const myConversations = useMemo(
      () =>
        conversations.filter((c) =>
          c.participantUids.includes(currentUser.uid)
        ),
      [conversations, currentUser.uid]
    );

    const [selectedConvId, setSelectedConvId] = useState<string>(
      myConversations[0]?.id ?? ''
    );
    const [draftText, setDraftText] = useState('');
    const [showIcebreakers, setShowIcebreakers] = useState(false);

    // Poll messages every 4 seconds only while chat is open
    useEffect(() => {
      if (!onRefreshMatchesAndMessages) return;
      const interval = setInterval(() => {
        void onRefreshMatchesAndMessages();
      }, 4000);
      return () => clearInterval(interval);
    }, [onRefreshMatchesAndMessages]);

    // Compute the 3 Shortlist sections from PostgreSQL-persisted `interests`
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
        conversationId?: string;
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
          const conv = myConversations.find(
            (c) =>
              c.type === 'direct_match' &&
              c.hackathonId === out.hackathonId &&
              c.participantUids.includes(otherUid)
          );
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
            swipedAt: inc!.createdAt > out.createdAt ? inc!.createdAt : out.createdAt,
            conversationId: conv?.id,
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
      myConversations,
      teams,
      memberships,
      teamProposals,
    ]);

    const activeConv =
      myConversations.find((c) => c.id === selectedConvId) ??
      myConversations[0];
    const activeHackathon = activeConv
      ? hackathons.find((h) => h.id === activeConv.hackathonId)
      : undefined;

    const partnerUid = activeConv?.participantUids.find(
      (uid) => uid !== currentUser.uid
    );
    const partnerProfile = partnerUid ? profiles[partnerUid] : undefined;

    const threadMessages = activeConv
      ? messages.filter((m) => m.conversationId === activeConv.id)
      : [];

    const handleSend = (e: React.FormEvent) => {
      e.preventDefault();
      if (!activeConv || !draftText.trim()) return;
      onSendMessage(activeConv.id, draftText.trim());
      setDraftText('');
    };

    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Top Context & Mode Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#f1ede6]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-[#fdaa40]" />
              <span className="text-xs font-medium text-[#746e65]">
                {activeHackathon?.name || 'PESU Chapter'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1c1b1b]">
              Matches &amp; Shortlist
            </h1>
          </div>

          <div className="flex items-center p-1 bg-[#f6f3f2] rounded-xl border border-[#e9e5dd] self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveSection('shortlist')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeSection === 'shortlist'
                  ? 'bg-white text-[#1c1b1b] shadow-xs'
                  : 'text-[#746e65] hover:text-[#1c1b1b]'
              }`}
            >
              Shortlist ({mutualMatchesList.length + interestedList.length + incomingList.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('chat')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeSection === 'chat'
                  ? 'bg-white text-[#1c1b1b] shadow-xs'
                  : 'text-[#746e65] hover:text-[#1c1b1b]'
              }`}
            >
              Messages ({myConversations.length})
            </button>
          </div>
        </div>

        {activeSection === 'shortlist' ? (
          /* 3-Section Shortlist Workspace (Stitch matches_and_shortlist) */
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-[#e9e5dd] pb-3 overflow-x-auto">
              <button
                type="button"
                data-testid="shortlist-tab-mutual"
                onClick={() => setShortlistTab('mutual')}
                className={`px-4 py-2 rounded-full text-xs transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  shortlistTab === 'mutual'
                    ? 'bg-[#ffd84d] text-[#292210] font-bold shadow-xs'
                    : 'bg-white text-[#746e65] hover:bg-[#f6f3eb] border border-[#e9e5dd] font-medium'
                }`}
              >
                <span>Mutual Matches</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  shortlistTab === 'mutual' ? 'bg-[#ffeaa0]' : 'bg-[#f1eee8]'
                }`}>
                  {mutualMatchesList.length}
                </span>
              </button>

              <button
                type="button"
                data-testid="shortlist-tab-incoming"
                onClick={() => setShortlistTab('incoming')}
                className={`px-4 py-2 rounded-full text-xs transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  shortlistTab === 'incoming'
                    ? 'bg-[#ffd84d] text-[#292210] font-bold shadow-xs'
                    : 'bg-white text-[#746e65] hover:bg-[#f6f3eb] border border-[#e9e5dd] font-medium'
                }`}
              >
                <span>Interested in You</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  shortlistTab === 'incoming' ? 'bg-[#ffeaa0]' : 'bg-[#f1eee8]'
                }`}>
                  {incomingList.length}
                </span>
              </button>

              <button
                type="button"
                data-testid="shortlist-tab-interested"
                onClick={() => setShortlistTab('interested')}
                className={`px-4 py-2 rounded-full text-xs transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  shortlistTab === 'interested'
                    ? 'bg-[#ffd84d] text-[#292210] font-bold shadow-xs'
                    : 'bg-white text-[#746e65] hover:bg-[#f6f3eb] border border-[#e9e5dd] font-medium'
                }`}
              >
                <span>Interested</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  shortlistTab === 'interested' ? 'bg-[#ffeaa0]' : 'bg-[#f1eee8]'
                }`}>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {mutualMatchesList.map((item) => {
                      const hack = hackathons.find(
                        (h) => h.id === item.hackathonId
                      );
                      return (
                        <div
                          key={item.key}
                          className="p-4 rounded-xl border border-[#e9e5dd] bg-white shadow-xs space-y-3 text-xs"
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
                              <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold text-[11px]">
                                Teammates ({item.team.memberCount}/{item.team.targetSize})
                              </span>
                            ) : item.proposal ? (
                              <span className="px-2.5 py-1 rounded-full bg-[#fff3c9] border border-[#ffd84d]/60 text-[#725c00] font-semibold text-[11px]">
                                Proposal: {item.proposal.status.replace(/_/g, ' ')}
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full bg-[#fff3c9] border border-[#ffd84d]/60 text-[#725c00] font-semibold text-[11px]">
                                Mutual Match
                              </span>
                            )}
                          </div>

                          {item.profile && item.profile.skillTags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {item.profile.skillTags.slice(0, 4).map((s) => (
                                <span
                                  key={s}
                                  className="inline-flex bg-[#f6f3f2] text-[#4d4634] rounded-full px-2.5 py-0.5 text-[11px]"
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="pt-2 border-t border-[#f1ede6] flex items-center justify-between">
                            <span className="text-[11px] text-[#746e65]">
                              Matched {new Date(item.swipedAt).toLocaleDateString()}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveSection('chat');
                                if (item.conversationId) {
                                  setSelectedConvId(item.conversationId);
                                }
                              }}
                              className="px-3.5 py-1.5 rounded-lg bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] text-xs font-bold transition-all shadow-xs cursor-pointer"
                            >
                              Chat
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-center text-xs text-[#746e65] pt-2">
                  Matches are separate from team invitations and approvals.
                </p>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {incomingList.map((item) => {
                      const hack = hackathons.find(
                        (h) => h.id === item.hackathonId
                      );
                      return (
                        <div
                          key={item.key}
                          className="p-4 rounded-xl border border-[#e9e5dd] bg-white shadow-xs space-y-3 text-xs"
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
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 font-semibold text-[11px]">
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
                                className="px-3.5 py-1.5 rounded-lg bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold text-xs shadow-xs inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Heart className="w-3.5 h-3.5 fill-current" />
                                <span>Review Interest</span>
                              </button>
                            ) : null}
                          </div>

                          {item.profile && item.profile.skillTags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {item.profile.skillTags.slice(0, 4).map((s) => (
                                <span
                                  key={s}
                                  className="inline-flex bg-[#f6f3f2] text-[#4d4634] rounded-full px-2.5 py-0.5 text-[11px]"
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}

                          {item.note && (
                            <p className="text-[#4d4634] italic bg-[#f6f3f2] p-2.5 rounded-lg">
                              &ldquo;{item.note}&rdquo;
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-center text-xs text-[#746e65] pt-2">
                  Mutual interest doesn't automatically add someone to an existing team.
                </p>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {interestedList.map((item) => {
                      const hack = hackathons.find(
                        (h) => h.id === item.hackathonId
                      );
                      return (
                        <div
                          key={item.key}
                          className="p-4 rounded-xl border border-[#e9e5dd] bg-white shadow-xs space-y-3 text-xs"
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

                            <span className="px-2.5 py-1 rounded-full bg-[#f6f3f2] text-[#4d4634] font-semibold text-[11px]">
                              {item.isMutual ? 'Mutual Match' : 'Awaiting Response'}
                            </span>
                          </div>

                          {item.profile && item.profile.skillTags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {item.profile.skillTags.slice(0, 4).map((s) => (
                                <span
                                  key={s}
                                  className="inline-flex bg-[#f6f3f2] text-[#4d4634] rounded-full px-2.5 py-0.5 text-[11px]"
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
                <p className="text-center text-xs text-[#746e65] pt-2">
                  People you've shown interest in.
                </p>
              </div>
            )}
          </div>
        ) : /* Direct & Team Conversations Workspace (Stitch chat_direct_team_conversations) */
        myConversations.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#e9e5dd] p-12 text-center space-y-2 shadow-xs">
            <MessageSquare className="w-8 h-8 text-[#746e65]/50 mx-auto" />
            <h3 className="text-base font-bold text-[#1c1b1b]">
              No conversations yet
            </h3>
            <p className="text-xs text-[#746e65] max-w-sm mx-auto">
              Mutual connections with students and formed team rosters appear here automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-4 h-[calc(100vh-210px)] min-h-[560px]">
            {/* Left Column: Conversations Pane */}
            <aside className="col-span-12 lg:col-span-5 flex flex-col bg-white rounded-2xl border border-[#e9e5dd] shadow-xs overflow-hidden">
              <div className="p-4 border-b border-[#f1ede6] flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <h3 className="font-bold text-sm text-[#1c1b1b]">
                    Messages
                  </h3>
                  <span className="text-xs text-[#746e65]">
                    {myConversations.length} channels
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {myConversations.map((conv) => {
                  const hack = hackathons.find(
                    (h) => h.id === conv.hackathonId
                  );
                  const isSelected = activeConv?.id === conv.id;
                  const otherUid = conv.participantUids.find(
                    (uid) => uid !== currentUser.uid
                  );

                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => setSelectedConvId(conv.id)}
                      className={`w-full text-left p-3 rounded-xl transition-all flex items-start gap-3 cursor-pointer ${
                        isSelected
                          ? 'bg-[#ffd84d]/20 border border-[#fdaa40]/40'
                          : 'hover:bg-[#f6f3eb] border border-transparent'
                      }`}
                    >
                      <StudentAvatar
                        uid={otherUid ?? conv.id}
                        name={conv.title}
                        size="md"
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-bold text-xs sm:text-sm text-[#1c1b1b] truncate">
                            {conv.title}
                          </span>
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-[#ffd84d] text-[#1a1a1a]">
                            Channel
                          </span>
                        </div>
                        <div className="text-xs text-[#746e65] truncate">
                          {hack?.name ?? conv.hackathonId}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Right Column: Active Conversation Thread */}
            <div className="col-span-12 lg:col-span-7 bg-white rounded-2xl border border-[#e9e5dd] shadow-xs flex flex-col overflow-hidden">
              {activeConv ? (
                <>
                  <div className="p-3.5 border-b border-[#f1ede6] flex items-center justify-between gap-3 bg-[#faf8f2]">
                    <div className="flex items-center gap-3 min-w-0">
                      <StudentAvatar
                        uid={partnerUid ?? activeConv.id}
                        name={activeConv.title}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <h4 className="font-bold text-[#1c1b1b] text-sm truncate">
                          {activeConv.title}
                        </h4>
                        <p className="text-xs text-[#746e65] truncate">
                          {activeHackathon?.name ?? activeConv.hackathonId}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onReportTarget({
                          targetType: 'message',
                          targetId: activeConv.id,
                          targetLabel: activeConv.title,
                          reason: 'Reported conversation from Matches',
                        })
                      }
                      className="p-1.5 rounded-lg text-[#746e65] hover:text-rose-600 transition-colors"
                      title="Report Conversation"
                    >
                      <Flag className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Messages Scrollable Stream */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
                    {threadMessages.length === 0 ? (
                      <div className="py-12 text-center text-xs text-[#746e65] space-y-1">
                        <p className="font-semibold text-[#1c1b1b]">
                          Start the conversation
                        </p>
                        <p>Say hi and discuss what you'd like to build together!</p>
                      </div>
                    ) : (
                      threadMessages.map((msg) => {
                        const isMe = msg.senderUid === currentUser.uid;
                        return (
                          <div
                            key={msg.id}
                            className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[78%] rounded-2xl px-4 py-2 text-xs leading-relaxed ${
                                isMe
                                  ? 'bg-[#ffd84d] text-[#1a1a1a] rounded-br-xs font-medium shadow-xs'
                                  : 'bg-[#f6f3f2] text-[#1c1b1b] rounded-bl-xs border border-[#e9e5dd]'
                              }`}
                            >
                              <p>{msg.body}</p>
                              <span
                                className={`block text-[9px] mt-1 ${
                                  isMe ? 'text-[#725c00]' : 'text-[#746e65]'
                                }`}
                              >
                                {new Date(msg.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Message Input Bar */}
                  <form
                    onSubmit={handleSend}
                    className="p-3 border-t border-[#f1ede6] bg-[#faf8f2] flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      placeholder="Type a message..."
                      className="flex-1 bg-white border border-[#e9e5dd] rounded-xl px-4 py-2 text-xs text-[#1c1b1b] placeholder:text-[#746e65] focus:outline-none focus:ring-1 focus:ring-[#725c00]"
                    />
                    <button
                      type="submit"
                      disabled={!draftText.trim()}
                      className="px-4 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-[#746e65]">
                  Select a channel to view messages
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );

  }
);
