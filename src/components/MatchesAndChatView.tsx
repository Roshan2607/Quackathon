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
      <div className="space-y-5">
        {/* Top Bar: Shortlist vs. Direct & Team Messages Switcher */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Heart className="w-4 h-4 text-blue-600" />
              <span>Matches, Shortlist & Conversations</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Track everyone you expressed interest in, students interested in
              you, and your mutual matches.
            </p>
          </div>

          <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveSection('shortlist')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                activeSection === 'shortlist'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Shortlist ({mutualMatchesList.length} Mutual ·{' '}
              {interestedList.length} Outgoing · {incomingList.length} Incoming)
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('chat')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                activeSection === 'chat'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Messages ({myConversations.length})
            </button>
          </div>
        </div>

        {activeSection === 'shortlist' ? (
          /* 3-Section Shortlist Workspace (Part D.1) */
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <button
                type="button"
                data-testid="shortlist-tab-mutual"
                onClick={() => setShortlistTab('mutual')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                  shortlistTab === 'mutual'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Mutual Matches ({mutualMatchesList.length})</span>
              </button>

              <button
                type="button"
                data-testid="shortlist-tab-interested"
                onClick={() => setShortlistTab('interested')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                  shortlistTab === 'interested'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <Heart className="w-3.5 h-3.5" />
                <span>Interested ({interestedList.length})</span>
              </button>

              <button
                type="button"
                data-testid="shortlist-tab-incoming"
                onClick={() => setShortlistTab('incoming')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                  shortlistTab === 'incoming'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Interested in You ({incomingList.length})</span>
              </button>
            </div>

            {shortlistTab === 'mutual' && (
              <div className="space-y-3">
                {mutualMatchesList.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 space-y-1">
                    <Users className="w-7 h-7 text-slate-400 mx-auto mb-1" />
                    <p className="font-semibold text-slate-700 dark:text-slate-300">
                      No mutual matches yet
                    </p>
                    <p>
                      When you and another student both swipe right on each
                      other, your mutual match and automatic team appear here.
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
                          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2.5 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                                {hack?.name ?? item.hackathonId}
                              </span>
                              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {item.user?.displayName ?? item.uid}
                              </h4>
                              <p className="text-slate-500">
                                {item.profile?.preferredRoles.join(' · ') ||
                                  'Student Builder'}
                              </p>
                            </div>

                            {item.team ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                                Teammates ({item.team.memberCount}/
                                {item.team.targetSize})
                              </span>
                            ) : item.proposal ? (
                              <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-semibold text-[11px]">
                                Proposal:{' '}
                                {item.proposal.status.replace(/_/g, ' ')}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-[11px]">
                                Mutual Match
                              </span>
                            )}
                          </div>

                          {item.profile &&
                            item.profile.skillTags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {item.profile.skillTags
                                  .slice(0, 5)
                                  .map((sk) => (
                                    <span
                                      key={sk}
                                      className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px]"
                                    >
                                      {sk}
                                    </span>
                                  ))}
                              </div>
                            )}

                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                            {item.conversationId && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedConvId(item.conversationId!);
                                  setActiveSection('chat');
                                }}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                              >
                                Message
                              </button>
                            )}
                            {onOpenMyTeam && (
                              <button
                                type="button"
                                onClick={onOpenMyTeam}
                                className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
                              >
                                View in My Team
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

            {shortlistTab === 'interested' && (
              <div className="space-y-3">
                {interestedList.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500">
                    You haven&apos;t swiped right on any students yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {interestedList.map((item) => {
                      const hack = hackathons.find(
                        (h) => h.id === item.hackathonId
                      );
                      return (
                        <div
                          key={item.key}
                          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <span className="text-[11px] text-slate-500">
                              {hack?.name ?? item.hackathonId}
                            </span>
                            <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                              {item.user?.displayName ?? item.uid}
                            </div>
                            <div className="text-slate-500">
                              {item.profile?.preferredRoles.join(' · ') ||
                                'Student'}
                            </div>
                          </div>

                          <span
                            className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] ${
                              item.isMutual
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {item.isMutual
                              ? 'Mutual Match'
                              : 'Awaiting Response'}
                          </span>
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
                  <p className="py-8 text-center text-xs text-slate-500">
                    No incoming student interests yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {incomingList.map((item) => {
                      const hack = hackathons.find(
                        (h) => h.id === item.hackathonId
                      );
                      return (
                        <div
                          key={item.key}
                          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2.5 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-[11px] text-blue-600 dark:text-blue-400">
                                {hack?.name ?? item.hackathonId}
                              </span>
                              <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                                {item.user?.displayName ?? item.uid}
                              </div>
                              <div className="text-slate-500">
                                {item.profile?.preferredRoles.join(' · ') ||
                                  'Student'}
                              </div>
                            </div>

                            {item.isMutual ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-semibold text-[11px]">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Matched
                              </span>
                            ) : onSwipeBack ? (
                              <button
                                type="button"
                                data-testid={`match-back-${item.uid}`}
                                onClick={() =>
                                  void onSwipeBack(item.uid, item.hackathonId)
                                }
                                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Heart className="w-3.5 h-3.5" />
                                <span>Match Back</span>
                              </button>
                            ) : null}
                          </div>

                          {item.note && (
                            <p className="text-slate-600 dark:text-slate-300 italic">
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
          </div>
        ) : /* Direct & Team Conversations Workspace */
        myConversations.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-2">
            <MessageSquare className="w-8 h-8 text-slate-400 mx-auto" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              No conversations yet
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Mutual connections with students and formed team rosters appear
              here automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left Sidebar: Conversations */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Matches & Channels ({myConversations.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {myConversations.map((conv) => {
                  const hack = hackathons.find(
                    (h) => h.id === conv.hackathonId
                  );
                  const isSelected = activeConv?.id === conv.id;

                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => setSelectedConvId(conv.id)}
                      className={`w-full text-left p-3.5 transition-colors flex flex-col gap-0.5 cursor-pointer ${
                        isSelected
                          ? 'bg-slate-900 dark:bg-slate-800 text-white'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="font-bold text-xs sm:text-sm truncate">
                        {conv.title}
                      </div>
                      <div
                        className={`text-xs truncate ${
                          isSelected ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {hack?.name ?? conv.hackathonId}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right 2 Columns: Active Chat Thread */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col h-[520px]">
              {activeConv ? (
                <>
                  <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate">
                        {activeConv.title}
                      </h4>
                      <p className="text-xs text-slate-500 truncate">
                        {activeHackathon?.name ?? activeConv.hackathonId}
                      </p>
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
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-500 hover:text-red-600 cursor-pointer shrink-0"
                      title="Report conversation"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Report</span>
                    </button>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto space-y-2.5 bg-slate-50/40 dark:bg-slate-950/30">
                    {threadMessages.map((msg) => {
                      const isMe = msg.senderUid === currentUser.uid;
                      const sender = users.find(
                        (u) => u.uid === msg.senderUid
                      );
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${
                            isMe ? 'items-end' : 'items-start'
                          }`}
                        >
                          <div
                            className={`max-w-[80%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                              isMe
                                ? 'bg-blue-600 text-white'
                                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {msg.body}
                          </div>
                          <span className="text-[10px] text-slate-400 mt-0.5 px-1">
                            {sender?.displayName ?? msg.senderUid}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {showIcebreakers && (
                    <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-1.5">
                      {(partnerProfile?.icebreakerPrompt
                        ? [
                            partnerProfile.icebreakerPrompt,
                            ...DEFAULT_ICEBREAKERS.slice(0, 2),
                          ]
                        : DEFAULT_ICEBREAKERS
                      ).map((prompt, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            onSendMessage(activeConv.id, prompt);
                            setShowIcebreakers(false);
                          }}
                          className="text-left text-[11px] bg-white dark:bg-slate-900 hover:bg-blue-50 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                        >
                          &ldquo;{prompt}&rdquo;
                        </button>
                      ))}
                    </div>
                  )}

                  <form
                    onSubmit={handleSend}
                    className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => setShowIcebreakers(!showIcebreakers)}
                      title="Suggested Icebreakers"
                      className={`px-2.5 py-2 rounded-lg border text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                        showIcebreakers
                          ? 'bg-blue-50 border-blue-300 text-blue-800'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      <span className="hidden sm:inline">Icebreakers</span>
                    </button>
                    <input
                      type="text"
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      placeholder="Write a message..."
                      className="flex-1 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Send
                    </button>
                  </form>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  }
);
