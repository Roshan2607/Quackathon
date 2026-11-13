import React, { useState } from 'react';
import {
  Ban,
  Flag,
  Lock,
  MessageSquare,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  Conversation,
  Hackathon,
  Message,
  Profile,
  User,
} from '../types/domain';
import { generateTechnicalIcebreakerDrafts } from '../services/matchingEngine';

interface MatchesAndChatViewProps {
  currentUser: User;
  users: User[];
  profiles: Record<string, Profile>;
  hackathons: Hackathon[];
  conversations: Conversation[];
  messages: Message[];
  onSendMessage: (conversationId: string, body: string) => void;
  onBlockUser: (targetUid: string) => void;
  onReportTarget: (targetType: 'user' | 'team' | 'message', targetId: string, targetLabel: string, reason: string) => void;
}

export const MatchesAndChatView: React.FC<MatchesAndChatViewProps> = ({
  currentUser,
  users,
  profiles,
  hackathons,
  conversations,
  messages,
  onSendMessage,
  onBlockUser,
  onReportTarget,
}) => {
  // Authorized conversations only: user must be in participantUids (Section 11 & Section 12)
  const myConversations = conversations.filter((c) =>
    c.participantUids.includes(currentUser.uid)
  );

  const [selectedConvId, setSelectedConvId] = useState<string>(
    myConversations[0]?.id ?? ''
  );
  const [draftBody, setDraftBody] = useState('');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');

  const activeConv =
    myConversations.find((c) => c.id === selectedConvId) ?? myConversations[0];

  const activeMessages = activeConv
    ? messages.filter((m) => m.conversationId === activeConv.id)
    : [];

  const counterpartUid = activeConv?.participantUids.find(
    (uid) => uid !== currentUser.uid
  );
  const counterpartUser = counterpartUid
    ? users.find((u) => u.uid === counterpartUid)
    : undefined;
  const counterpartProfile = counterpartUid
    ? profiles[counterpartUid]
    : undefined;
  const viewerProfile = profiles[currentUser.uid];

  const icebreakerSuggestions =
    viewerProfile && counterpartProfile && counterpartUser
      ? generateTechnicalIcebreakerDrafts({
          viewerProfile,
          targetTitle: counterpartUser.displayName,
          targetProjects: counterpartProfile.featuredProjects,
          sharedInterests: counterpartProfile.interestTags.filter((t) =>
            viewerProfile.interestTags.includes(t)
          ),
          complementaryRoles: counterpartProfile.preferredRoles,
          customPrompt: counterpartProfile.icebreakerPrompt,
        })
      : [
          'Hey team! Shall we align on our repo structure and API contracts for the first 4 hours?',
          'Which problem statement track are we locking in before check-in?',
        ];

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !draftBody.trim()) return;
    onSendMessage(activeConv.id, draftBody.trim());
    setDraftBody('');
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Post-Acceptance Messaging Only · Zero Unsolicited DMs
          </p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Mutual Matches & Team Channels
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
            Conversations unlock only after mutual interest or approved team membership. Technical icebreakers are generated from approved project/interest tags as editable drafts and are never auto-sent.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Lock className="w-3.5 h-3.5 text-emerald-600" />
          <span>Access-controlled to verified conversation members</span>
        </div>
      </div>

      {myConversations.length === 0 ? (
        <div className="p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-2">
          <MessageSquare className="w-7 h-7 text-slate-400 mx-auto" />
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">
            No Unlocked Conversations Yet
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Express interest in the Discover tab (e.g., Meera Nair has already expressed interest in Arjun Rao, and Vikram Hegde has expressed interest in Rohan Kulkarni) or approve a team join request to unlock a channel.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Thread List */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800 self-start">
            {myConversations.map((conv) => {
              const hack = hackathons.find((h) => h.id === conv.hackathonId);
              const isSelected = activeConv?.id === conv.id;
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConvId(conv.id)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50/70 dark:bg-blue-950/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      {conv.type === 'team_roster' ? 'Team Roster Chat' : '1-to-1 Mutual Match'}
                    </span>
                    <span>{hack?.name.split(' — ')[0]}</span>
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {conv.title}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Active Conversation Window */}
          {activeConv && (
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col justify-between min-h-[480px]">
              {/* Thread Header with Safety Controls */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {activeConv.title}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Participants:{' '}
                    {activeConv.participantUids
                      .map((uid) => users.find((u) => u.uid === uid)?.displayName ?? uid)
                      .join(' · ')}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setReportModalOpen(true)}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-amber-600 bg-slate-100 dark:bg-slate-800 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    Report
                  </button>
                  {counterpartUid && (
                    <button
                      onClick={() => onBlockUser(counterpartUid)}
                      className="px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      Block User
                    </button>
                  )}
                </div>
              </div>

              {/* Message History */}
              <div className="p-4 space-y-3 flex-1 overflow-y-auto max-h-80">
                {activeMessages.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-500">
                    Connection unlocked! Choose an optional technical icebreaker draft below or write your own opener.
                  </div>
                ) : (
                  activeMessages.map((msg) => {
                    const sender = users.find((u) => u.uid === msg.senderUid);
                    const isMe = msg.senderUid === currentUser.uid;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        <div className="text-xs text-slate-400 mb-1">
                          {sender?.displayName ?? msg.senderUid} ·{' '}
                          <span className="font-mono tabular-nums">
                            {msg.createdAt.slice(11, 16)}
                          </span>
                        </div>
                        <div
                          className={`px-3.5 py-2.5 rounded-xl text-xs max-w-lg ${
                            isMe
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {msg.body}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Template Technical Icebreaker Drafts + Message Composer */}
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3 bg-slate-50/50 dark:bg-slate-900">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    <span>Project & Interest Technical Icebreaker Drafts (Click to populate editor — never auto-sent):</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {icebreakerSuggestions.map((draft, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setDraftBody(draft)}
                        className="text-left px-2.5 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-slate-700 dark:text-slate-300 rounded-md cursor-pointer"
                      >
                        “{draft}”
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleSend} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    placeholder="Edit icebreaker draft or write a message..."
                    className="flex-1 px-3.5 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send Message
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Report Modal */}
      {reportModalOpen && activeConv && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Submit Safety Report to Moderator Queue
            </h3>
            <p className="text-xs text-slate-500">
              Reporting {activeConv.title}. Reports are logged privately for moderator review without user confrontation.
            </p>
            <textarea
              rows={3}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Describe the issue (spam, unsolicited external links, harassment)..."
              className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setReportModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!reportReason.trim()) return;
                  onReportTarget(
                    counterpartUid ? 'user' : 'team',
                    counterpartUid ?? activeConv.id,
                    activeConv.title,
                    reportReason.trim()
                  );
                  setReportReason('');
                  setReportModalOpen(false);
                }}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
              >
                Submit Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
