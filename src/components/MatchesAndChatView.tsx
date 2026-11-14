import React, { useState } from 'react';
import {
  Conversation,
  Hackathon,
  JoinRequest,
  Membership,
  Message,
  Profile,
  Team,
  User,
} from '../types/domain';
import {
  ROLE_TAXONOMY,
  SUGGESTED_CUSTOM_SPECIALIZATIONS,
} from '../data/seedData';
import {
  MessageSquare,
  Send,
  Sparkles,
  Check,
  X,
  Flag,
  Plus,
  Users,
} from 'lucide-react';
import { Modal } from './Modal';

interface MatchesAndChatViewProps {
  currentUser: User;
  conversations: Conversation[];
  messages: Message[];
  users: User[];
  profiles: Record<string, Profile>;
  hackathons: Hackathon[];
  joinRequests?: JoinRequest[];
  teams?: Team[];
  memberships?: Membership[];
  onSendMessage: (conversationId: string, body: string) => void;
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
}

const DEFAULT_ICEBREAKERS = [
  'Which track or problem statement are you most excited to build for?',
  'Do you prefer building a fast end-to-end prototype first or splitting frontend/backend APIs?',
  'What times this week work best for a quick 15-minute sync?',
];

export const MatchesAndChatView: React.FC<MatchesAndChatViewProps> = React.memo(
  ({
    currentUser,
    conversations,
    messages,
    users,
    profiles,
    hackathons,
    joinRequests = [],
    teams = [],
    memberships = [],
    onSendMessage,
    onResolveJoinRequest,
    onCreateTeam,
    onReportTarget,
  }) => {
    const myConversations = conversations.filter((c) =>
      c.participantUids.includes(currentUser.uid)
    );
    const [selectedConvId, setSelectedConvId] = useState<string>(
      myConversations[0]?.id ?? ''
    );
    const [draftText, setDraftText] = useState('');
    const [showIcebreakers, setShowIcebreakers] = useState(false);

    // Create Team Modal State
    const matchableHackathons = hackathons.filter((h) => h.matchable);
    const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
    const [teamHackathonId, setTeamHackathonId] = useState<string>(
      matchableHackathons[0]?.id ?? ''
    );
    const [teamName, setTeamName] = useState('');
    const [teamPitch, setTeamPitch] = useState('');
    const [projectIdea, setProjectIdea] = useState('');
    const [rolesNeeded, setRolesNeeded] = useState<string[]>([
      'Backend / APIs',
      'Frontend / UI',
    ]);
    const [customSpecs, setCustomSpecs] = useState<string[]>([]);
    const [targetSize, setTargetSize] = useState<number>(4);

    // Pending invitations or applications relevant to currentUser
    const pendingInvites = joinRequests.filter((req) => {
      if (req.status !== 'pending') return false;
      const team = teams.find((t) => t.id === req.teamId);
      if (!team) return false;
      return (
        team.leaderId === currentUser.uid ||
        req.applicantUid === currentUser.uid
      );
    });

    // Active teams the user belongs to
    const myActiveMemberships = memberships.filter(
      (m) => m.uid === currentUser.uid && m.status === 'active'
    );

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

    const toggleListItem = (
      item: string,
      list: string[],
      setter: React.Dispatch<React.SetStateAction<string[]>>
    ) => {
      if (list.includes(item)) {
        setter(list.filter((i) => i !== item));
      } else {
        setter([...list, item]);
      }
    };

    const handleCreateTeamSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const targetHackId = teamHackathonId || matchableHackathons[0]?.id;
      if (!targetHackId || !teamName.trim() || !teamPitch.trim() || !onCreateTeam)
        return;

      onCreateTeam({
        hackathonId: targetHackId,
        name: teamName.trim(),
        pitch: teamPitch.trim(),
        projectIdea: projectIdea.trim(),
        rolesNeeded:
          rolesNeeded.length > 0 ? rolesNeeded : ['Generalist'],
        customSpecializations: customSpecs,
        targetSize,
      });

      setTeamName('');
      setTeamPitch('');
      setProjectIdea('');
      setShowCreateTeamModal(false);
    };

    return (
      <div className="space-y-4">
        {/* Top Bar: My Active Teams & Create Team Action */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              <span>Matches, Join Requests & Teams</span>
            </h2>
            {myActiveMemberships.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {myActiveMemberships.map((m) => {
                  const t = teams.find((team) => team.id === m.teamId);
                  const h = hackathons.find((hack) => hack.id === m.hackathonId);
                  if (!t) return null;
                  return (
                    <span
                      key={m.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200"
                    >
                      <strong>{t.name}</strong> ({t.memberCount}/{t.targetSize}) ·{' '}
                      <span className="text-slate-500">
                        {h?.name ?? m.hackathonId}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Not in an active team yet. Connect with builders in Discover or create a team for an upcoming hackathon.
              </p>
            )}
          </div>

          {onCreateTeam && matchableHackathons.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (!teamHackathonId && matchableHackathons[0]) {
                  setTeamHackathonId(matchableHackathons[0].id);
                }
                setShowCreateTeamModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Team
            </button>
          )}
        </div>

        {/* Pending Invitations & Requests Section */}
        {pendingInvites.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Pending Invitations & Applications ({pendingInvites.length})
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {pendingInvites.map((req) => {
                const team = teams.find((t) => t.id === req.teamId);
                const applicant = users.find((u) => u.uid === req.applicantUid);
                const canDecide =
                  (req.direction === 'application' &&
                    team?.leaderId === currentUser.uid) ||
                  (req.direction === 'invitation' &&
                    req.applicantUid === currentUser.uid);

                return (
                  <div
                    key={req.id}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                        {req.direction === 'application'
                          ? `${
                              applicant?.displayName ?? req.applicantUid
                            } applied to ${team?.name}`
                          : `${team?.name} invited you (${req.proposedRole})`}
                      </div>
                      {req.message && (
                        <p className="text-slate-600 dark:text-slate-400 truncate mt-0.5">
                          &ldquo;{req.message}&rdquo;
                        </p>
                      )}
                    </div>

                    {canDecide && onResolveJoinRequest && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onResolveJoinRequest(req.id, 'accept')
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold whitespace-nowrap cursor-pointer"
                        >
                          <Check className="w-3 h-3" /> Accept
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onResolveJoinRequest(req.id, 'reject')
                          }
                          className="p-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-200 text-slate-600 cursor-pointer"
                          title="Decline"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Matches & Messages Workspace */}
        {myConversations.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-2">
            <MessageSquare className="w-8 h-8 text-slate-400 mx-auto" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              No conversations yet
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Mutual connections with students and accepted team rosters appear here automatically.
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
                  {/* Conversation Header */}
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

                  {/* Messages Feed */}
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

                  {/* Optional Icebreaker Drawer */}
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

                  {/* Composer */}
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

        {/* Create Team Modal */}
        {showCreateTeamModal && (
          <Modal
            title="Create a Hackathon Team"
            subtitle="Recruit teammates by needed roles and technical specializations."
            onClose={() => setShowCreateTeamModal(false)}
            maxWidthClass="max-w-lg"
          >
            <form onSubmit={handleCreateTeamSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Hackathon *
                </label>
                <select
                  value={teamHackathonId}
                  onChange={(e) => setTeamHackathonId(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  {matchableHackathons.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} (Max {h.maxTeamSize ?? 4} members)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Team Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g., NeuralForge"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Target Size
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={6}
                    value={targetSize}
                    onChange={(e) => setTargetSize(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Team Pitch *
                </label>
                <input
                  type="text"
                  required
                  value={teamPitch}
                  onChange={(e) => setTeamPitch(e.target.value)}
                  placeholder="What are you building and who are you looking for?"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Project Idea (Optional)
                </label>
                <input
                  type="text"
                  value={projectIdea}
                  onChange={(e) => setProjectIdea(e.target.value)}
                  placeholder="Optional technical direction or problem statement"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Roles Needed
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_TAXONOMY.map((role) => {
                    const active = rolesNeeded.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() =>
                          toggleListItem(role, rolesNeeded, setRolesNeeded)
                        }
                        className={`px-2.5 py-1 rounded-lg font-medium border cursor-pointer ${
                          active
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {role}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Specializations (Optional)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_CUSTOM_SPECIALIZATIONS.slice(0, 6).map((spec) => {
                    const active = customSpecs.includes(spec);
                    return (
                      <button
                        key={spec}
                        type="button"
                        onClick={() =>
                          toggleListItem(spec, customSpecs, setCustomSpecs)
                        }
                        className={`px-2 py-1 rounded-md font-medium border cursor-pointer ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white dark:bg-slate-900 text-slate-600 border-slate-200'
                        }`}
                      >
                        {spec}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
                >
                  Create Team
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    );
  }
);
