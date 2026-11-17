import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  ExternalLink,
  Lock,
  LogOut,
  MessageSquare,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  Vote,
  X,
} from 'lucide-react';
import {
  Conversation,
  Hackathon,
  JoinRequest,
  Membership,
  Message,
  Profile,
  Team,
  TeamProposal,
  TeamRegistration,
  TeamRegistrationStatus,
  User,
} from '../types/domain';
import { computeTeamCombinedCapabilities } from '../services/matchingEngine';

interface TeamsAndRequestsViewProps {
  currentUser: User;
  hackathons: Hackathon[];
  selectedHackathonId?: string;
  onSelectHackathon?: (hackathonId: string) => void;
  teams: Team[];
  memberships: Membership[];
  joinRequests: JoinRequest[];
  teamProposals?: TeamProposal[];
  teamRegistrations?: TeamRegistration[];
  conversations?: Conversation[];
  messages?: Message[];
  users: User[];
  profiles?: Record<string, Profile>;
  onUpdateTeamDetails?: (
    teamId: string,
    updates: {
      name?: string;
      pitch?: string;
      projectIdea?: string | null;
      rolesNeeded?: string[];
      targetSize?: number;
    }
  ) => Promise<void> | void;
  onVoteTeamProposal?: (
    proposalId: string,
    decision: 'approve' | 'reject'
  ) => Promise<void> | void;
  onRespondTeamProposal?: (
    proposalId: string,
    decision: 'accept' | 'decline'
  ) => Promise<void> | void;
  onLeaveTeam?: (teamId: string) => Promise<void> | void;
  onUpdateTeamRegistration?: (
    teamId: string,
    payload: {
      registrationStatus: TeamRegistrationStatus;
      externalRegistrationReference?: string | null;
      confirmationNotes?: string | null;
    }
  ) => Promise<void> | void;
  onSendTeamMessage?: (teamId: string, body: string) => Promise<void> | void;
  onRefreshTeamMessages?: (teamId: string) => Promise<void> | void;
  onResolveJoinRequest?: (
    requestId: string,
    decision: 'accept' | 'reject'
  ) => void;
  onOpenDiscover?: () => void;
}

const REGISTRATION_STATUS_LABELS: Record<
  TeamRegistrationStatus,
  { label: string; badgeClass: string }
> = {
  forming: {
    label: 'Forming Roster',
    badgeClass:
      'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  },
  ready_to_register: {
    label: 'Ready to Register',
    badgeClass:
      'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
  registration_in_progress: {
    label: 'Registration in Progress',
    badgeClass:
      'bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  },
  registered: {
    label: 'Officially Registered',
    badgeClass:
      'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
  },
  registration_closed: {
    label: 'Registration Closed',
    badgeClass:
      'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  },
};

export const TeamsAndRequestsView: React.FC<TeamsAndRequestsViewProps> =
  React.memo(
    ({
      currentUser,
      hackathons,
      selectedHackathonId,
      onSelectHackathon,
      teams,
      memberships,
      joinRequests,
      teamProposals = [],
      teamRegistrations = [],
      conversations = [],
      messages = [],
      users,
      profiles = {},
      onUpdateTeamDetails,
      onVoteTeamProposal,
      onRespondTeamProposal,
      onLeaveTeam,
      onUpdateTeamRegistration,
      onSendTeamMessage,
      onRefreshTeamMessages,
      onResolveJoinRequest,
      onOpenDiscover,
    }) => {
      // Active memberships for the current student
      const myActiveMemberships = useMemo(
        () =>
          memberships.filter(
            (m) => m.uid === currentUser.uid && m.status === 'active'
          ),
        [memberships, currentUser.uid]
      );

      const myTeams = useMemo(() => {
        const teamIds = new Set(myActiveMemberships.map((m) => m.teamId));
        return teams.filter(
          (t) => teamIds.has(t.id) && t.status !== 'dissolved'
        );
      }, [myActiveMemberships, teams]);

      const [activeTeamId, setActiveTeamId] = useState<string>(
        () =>
          myTeams.find((t) => t.hackathonId === selectedHackathonId)?.id ??
          myTeams[0]?.id ??
          ''
      );

      useEffect(() => {
        const teamForSelectedHackathon = myTeams.find(
          (t) => t.hackathonId === selectedHackathonId
        );
        if (teamForSelectedHackathon) {
          setActiveTeamId(teamForSelectedHackathon.id);
        } else if (
          myTeams.length > 0 &&
          !myTeams.some((t) => t.id === activeTeamId)
        ) {
          setActiveTeamId(myTeams[0].id);
        } else if (myTeams.length === 0) {
          setActiveTeamId('');
        }
      }, [myTeams, selectedHackathonId, activeTeamId]);

      const selectedTeam =
        myTeams.find((t) => t.id === activeTeamId) ?? myTeams[0] ?? null;

      // Edit team name / pitch / projectIdea inline state
      const [isEditingTeam, setIsEditingTeam] = useState(false);
      const [editName, setEditName] = useState('');
      const [editPitch, setEditPitch] = useState('');
      const [editProjectIdea, setEditProjectIdea] = useState('');

      // Registration confirmation form state
      const [regReferenceInput, setRegReferenceInput] = useState('');
      const [regNotesInput, setRegNotesInput] = useState('');
      const [showRegForm, setShowRegForm] = useState(false);

      // Team Chat message draft state
      const [chatDraft, setChatDraft] = useState('');
      const [sendingChat, setSendingChat] = useState(false);

      // Poll team chat messages every 4 seconds only while viewing My Team with an active team
      useEffect(() => {
        if (!selectedTeam || !onRefreshTeamMessages) return;
        const interval = setInterval(() => {
          void onRefreshTeamMessages(selectedTeam.id);
        }, 4000);
        return () => clearInterval(interval);
      }, [selectedTeam, onRefreshTeamMessages]);

      const startEditingTeam = (team: Team) => {
        setEditName(team.name);
        setEditPitch(team.pitch);
        setEditProjectIdea(team.projectIdea ?? '');
        setIsEditingTeam(true);
      };

      const handleSaveTeamEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTeam || !onUpdateTeamDetails || !editName.trim()) return;
        await onUpdateTeamDetails(selectedTeam.id, {
          name: editName.trim(),
          pitch: editPitch.trim() || selectedTeam.pitch,
          projectIdea: editProjectIdea.trim() || null,
        });
        setIsEditingTeam(false);
      };

      const handleSendChat = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTeam || !chatDraft.trim() || sendingChat) return;
        const body = chatDraft.trim();
        setSendingChat(true);
        try {
          if (onSendTeamMessage) {
            await onSendTeamMessage(selectedTeam.id, body);
          }
          setChatDraft('');
        } finally {
          setSendingChat(false);
        }
      };

      // Incoming invitations where the current user is the candidate
      const incomingCandidateInvitations = useMemo(
        () =>
          teamProposals.filter(
            (tp) =>
              tp.candidateUid === currentUser.uid &&
              (tp.status === 'invited' ||
                tp.status === 'pending_votes')
          ),
        [teamProposals, currentUser.uid]
      );

      // Legacy pending join requests (if any exist from earlier records)
      const pendingJoinRequests = useMemo(
        () =>
          joinRequests.filter((req) => {
            if (req.status !== 'pending') return false;
            const team = teams.find((t) => t.id === req.teamId);
            if (!team) return false;
            return (
              team.leaderId === currentUser.uid ||
              req.applicantUid === currentUser.uid
            );
          }),
        [joinRequests, teams, currentUser.uid]
      );

      const teamHackathon = selectedTeam
        ? hackathons.find((h) => h.id === selectedTeam.hackathonId)
        : hackathons.find((h) => h.id === selectedHackathonId) ?? hackathons[0];

      const rosterMemberships = useMemo(
        () =>
          selectedTeam
            ? memberships.filter(
                (m) => m.teamId === selectedTeam.id && m.status === 'active'
              )
            : [],
        [selectedTeam, memberships]
      );

      const maxAllowedSize = useMemo(() => {
        const eventMax =
          teamHackathon?.maxTeamSize && teamHackathon.maxTeamSize > 0
            ? Math.min(4, teamHackathon.maxTeamSize)
            : 4;
        return selectedTeam
          ? Math.min(eventMax, selectedTeam.targetSize || 4)
          : eventMax;
      }, [teamHackathon, selectedTeam]);

      const minRequiredSize = useMemo(() => {
        const eventMin =
          teamHackathon?.minTeamSize && teamHackathon.minTeamSize > 0
            ? teamHackathon.minTeamSize
            : 2;
        return Math.min(eventMin, maxAllowedSize);
      }, [teamHackathon, maxAllowedSize]);

      const teamCapabilities = useMemo(() => {
        const viewerProf = profiles[currentUser.uid];
        if (!selectedTeam || !teamHackathon || !viewerProf) return null;
        return computeTeamCombinedCapabilities({
          viewerUid: currentUser.uid,
          viewerProfile: viewerProf,
          hackathon: teamHackathon,
          allTeams: teams,
          allMemberships: memberships,
          allProfiles: Object.values(profiles),
        });
      }, [
        selectedTeam,
        teamHackathon,
        profiles,
        currentUser.uid,
        teams,
        memberships,
      ]);

      const proposalsForSelectedTeam = useMemo(
        () =>
          selectedTeam
            ? teamProposals.filter((tp) => tp.teamId === selectedTeam.id)
            : [],
        [selectedTeam, teamProposals]
      );

      const activeProposalsForSelectedTeam = useMemo(
        () =>
          proposalsForSelectedTeam.filter(
            (tp) =>
              tp.status === 'pending_votes' || tp.status === 'invited'
          ),
        [proposalsForSelectedTeam]
      );

      const resolvedProposalsForSelectedTeam = useMemo(
        () =>
          proposalsForSelectedTeam.filter(
            (tp) =>
              tp.status !== 'pending_votes' && tp.status !== 'invited'
          ),
        [proposalsForSelectedTeam]
      );

      const registrationRecord = useMemo(() => {
        if (!selectedTeam) return null;
        const found = teamRegistrations.find(
          (tr) => tr.teamId === selectedTeam.id
        );
        if (found) return found;
        const memberCount = rosterMemberships.length;
        const eligible =
          Boolean(teamHackathon?.matchable ?? true) &&
          memberCount >= minRequiredSize &&
          memberCount <= maxAllowedSize;
        const computedStatus: TeamRegistrationStatus = eligible
          ? 'ready_to_register'
          : 'forming';
        const reasonText = eligible
          ? `Your team has ${memberCount}/${maxAllowedSize} members (meets minimum of ${minRequiredSize}) and is ready to register.`
          : `Need at least ${minRequiredSize} members before registering (currently ${memberCount}/${maxAllowedSize}).`;
        return {
          teamId: selectedTeam.id,
          hackathonId: selectedTeam.hackathonId,
          registrationStatus: computedStatus,
          minRequiredMembers: minRequiredSize,
          maxAllowedMembers: maxAllowedSize,
          currentMemberCount: memberCount,
          isEligibleToRegister: eligible,
          readinessReason: reasonText,
          minTeamSizeSnapshot: minRequiredSize,
          maxTeamSizeSnapshot: maxAllowedSize,
          memberCountAtCheck: memberCount,
          eligibleToRegister: eligible,
          eligibilityReason: reasonText,
          officialRegistrationUrl:
            teamHackathon?.registrationUrl ??
            teamHackathon?.verifiedCanonicalUrl ??
            null,
          externalRegistrationReference: null,
          confirmationNotes: null,
          registeredByUid: null,
          registeredAt: null,
          updatedAt: selectedTeam.createdAt,
        } satisfies TeamRegistration;
      }, [
        selectedTeam,
        teamRegistrations,
        rosterMemberships.length,
        teamHackathon,
        minRequiredSize,
        maxAllowedSize,
      ]);

      const teamConversation = useMemo(() => {
        if (!selectedTeam) return null;
        return (
          conversations.find(
            (c) => c.type === 'team_roster' && c.teamId === selectedTeam.id
          ) ?? null
        );
      }, [selectedTeam, conversations]);

      const teamChatMessages = useMemo(() => {
        if (!teamConversation) return [];
        return messages.filter((m) => m.conversationId === teamConversation.id);
      }, [teamConversation, messages]);

      return (
        <div className="space-y-5">
          {/* Top Bar: My Team Overview & Active Roster Switcher */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" />
                <span>My Team & Roster Governance</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Mutual student matches automatically form a 2-person team. Grow
                your team up to 4 students with unanimous member approval.
              </p>
            </div>

            {myTeams.length > 1 && (
              <select
                aria-label="Select Active Team"
                value={selectedTeam?.id ?? ''}
                onChange={(e) => {
                  const nextTeam = myTeams.find((t) => t.id === e.target.value);
                  setActiveTeamId(e.target.value);
                  if (nextTeam && onSelectHackathon) {
                    onSelectHackathon(nextTeam.hackathonId);
                  }
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
              >
                {myTeams.map((t) => {
                  const h = hackathons.find((hk) => hk.id === t.hackathonId);
                  return (
                    <option key={t.id} value={t.id}>
                      {t.name.split(' (')[0]} · {h?.name ?? t.hackathonId} (
                      {t.memberCount}/{t.targetSize})
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Incoming Team Invitations (Competing Invitations Banner for Candidates) */}
          {incomingCandidateInvitations.length > 0 && (
            <div
              data-testid="incoming-team-invitations"
              className="bg-blue-50/70 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-900 p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300">
                  <UserPlus className="w-4 h-4" />
                  <span>
                    Team Invitations & Proposals for You (
                    {incomingCandidateInvitations.length})
                  </span>
                </div>
                {incomingCandidateInvitations.filter(
                  (i) => i.status === 'invited'
                ).length > 1 && (
                  <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                    Multiple teams invited you — accepting one automatically
                    declines competing offers for that hackathon.
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {incomingCandidateInvitations.map((inv) => {
                  const team = teams.find((t) => t.id === inv.teamId);
                  const hack = hackathons.find((h) => h.id === inv.hackathonId);
                  const proposer = users.find(
                    (u) => u.uid === inv.proposerUid
                  );
                  const isReadyToAccept = inv.status === 'invited';

                  return (
                    <div
                      key={inv.id}
                      className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800/80 space-y-2.5 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[11px] text-slate-500">
                            {hack?.name ?? inv.hackathonId}
                          </span>
                          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {team?.name ?? 'Student Team'}
                          </h4>
                          <p className="text-slate-500">
                            Proposed by{' '}
                            {proposer?.displayName ?? inv.proposerUid} · Role:{' '}
                            <strong>{inv.proposedRole}</strong>
                          </p>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${
                            isReadyToAccept
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300'
                          }`}
                        >
                          {isReadyToAccept
                            ? 'Unanimously Approved · Invited'
                            : `Awaiting Team Votes (${inv.votes.filter((v) => v.decision === 'approve').length}/${inv.requiredVoterUids.length})`}
                        </span>
                      </div>

                      {inv.note && (
                        <p className="text-slate-600 dark:text-slate-300 italic">
                          &ldquo;{inv.note}&rdquo;
                        </p>
                      )}

                      {isReadyToAccept && onRespondTeamProposal ? (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            data-testid={`accept-invitation-${inv.id}`}
                            onClick={() =>
                              void onRespondTeamProposal(inv.id, 'accept')
                            }
                            className="flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Accept & Join Team</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`decline-invitation-${inv.id}`}
                            onClick={() =>
                              void onRespondTeamProposal(inv.id, 'decline')
                            }
                            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium cursor-pointer"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          Once all current members of{' '}
                          {team?.name ?? 'this team'} vote to approve, you will
                          be able to accept and join.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Main Team Content or Empty State */}
          {!selectedTeam ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-3">
              <Users className="w-8 h-8 text-slate-400 mx-auto" />
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                You aren&apos;t on an active team yet
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Swipe right on students you want to build with in Discover. When
                another student swipes right on you too, Quackathon
                automatically forms your 2-person team and opens your Team Chat!
              </p>
              {onOpenDiscover && (
                <button
                  type="button"
                  onClick={onOpenDiscover}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Discover Students</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left 7 Columns: Team Roster, Capabilities, Proposals & Registration */}
              <div className="lg:col-span-7 space-y-5">
                {/* 1. Team Identity & Roster Card */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                        {teamHackathon?.name ?? selectedTeam.hackathonId}
                      </span>
                      {!isEditingTeam ? (
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                            {selectedTeam.name}
                          </h3>
                          {onUpdateTeamDetails && (
                            <button
                              type="button"
                              onClick={() => startEditingTeam(selectedTeam)}
                              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                              title="Edit team name & project idea"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {selectedTeam.status === 'full' ||
                      rosterMemberships.length >= maxAllowedSize ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300 font-mono tabular-nums">
                          <Lock className="w-3.5 h-3.5" />
                          <span>
                            Full ({rosterMemberships.length}/{maxAllowedSize})
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-xs font-semibold text-blue-800 dark:text-blue-300 font-mono tabular-nums">
                          <Users className="w-3.5 h-3.5" />
                          <span>
                            {rosterMemberships.length}/{maxAllowedSize} Members
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Inline Team Edit Form */}
                  {isEditingTeam ? (
                    <form
                      onSubmit={(e) => void handleSaveTeamEdit(e)}
                      className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3 text-xs"
                    >
                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Team Name
                        </label>
                        <input
                          type="text"
                          required
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Team Pitch / Goal
                        </label>
                        <input
                          type="text"
                          value={editPitch}
                          onChange={(e) => setEditPitch(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Project Idea / Problem Track
                        </label>
                        <input
                          type="text"
                          value={editProjectIdea}
                          onChange={(e) => setEditProjectIdea(e.target.value)}
                          placeholder="What problem statement or prototype are you building?"
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setIsEditingTeam(false)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer"
                        >
                          Save Changes
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <p>{selectedTeam.pitch}</p>
                      {selectedTeam.projectIdea && (
                        <p className="text-slate-500">
                          <strong>Project Idea:</strong>{' '}
                          {selectedTeam.projectIdea}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Active Team Members List */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Current Team Roster ({rosterMemberships.length}/
                        {maxAllowedSize})
                      </span>
                      <span className="text-slate-400">
                        Max 4 students per team
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {rosterMemberships.map((m) => {
                        const u = users.find((usr) => usr.uid === m.uid);
                        const p = profiles[m.uid];
                        return (
                          <div
                            key={m.id}
                            className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-1 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                {(u?.displayName ?? m.uid).replace(
                                  ' (Synthetic Demo)',
                                  ''
                                )}
                              </span>
                              {selectedTeam.leaderId === m.uid && (
                                <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                                  Lead
                                </span>
                              )}
                            </div>
                            <div className="text-slate-500">
                              {m.role}
                              {u?.campus ? ` · ${u.campus}` : ''}
                            </div>
                            {p && p.skillTags.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {p.skillTags.slice(0, 4).map((skill) => (
                                  <span
                                    key={skill}
                                    className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] text-slate-700 dark:text-slate-300"
                                  >
                                    {skill}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Combined Skills & Missing Capabilities */}
                  {teamCapabilities && (
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                          Combined Team Skills
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {Array.from(teamCapabilities.combinedSkills)
                            .slice(0, 8)
                            .map((sk) => (
                              <span
                                key={sk}
                                className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                              >
                                {sk}
                              </span>
                            ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                          Complementary Roles to Recruit
                        </span>
                        {teamCapabilities.missingRoles.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {teamCapabilities.missingRoles.map((role) => (
                              <span
                                key={role}
                                className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-medium"
                              >
                                + {role}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            All core roles covered!
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Leave Team Footer */}
                  {onLeaveTeam && (
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-400">
                        {registrationRecord?.registrationStatus === 'registered'
                          ? 'Roster is locked because the team is marked as officially registered.'
                          : 'Need to switch teams? Leaving reopens your discovery feed.'}
                      </span>
                      <button
                        type="button"
                        data-testid="leave-team-btn"
                        disabled={
                          registrationRecord?.registrationStatus ===
                          'registered'
                        }
                        onClick={() => void onLeaveTeam(selectedTeam.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Leave Team</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Pending Candidate Proposals & Unanimous Member Voting */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <Vote className="w-4 h-4 text-blue-600" />
                        <span>
                          Candidate Proposals & Unanimous Team Voting (
                          {activeProposalsForSelectedTeam.length})
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        When a team member and a student mutually swipe right, a
                        proposal is created here. Every current team member must
                        approve before the candidate is invited.
                      </p>
                    </div>
                  </div>

                  {activeProposalsForSelectedTeam.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-center text-xs text-slate-500">
                      No active candidate proposals right now. Swipe right on
                      students in Discover to propose new teammates!
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activeProposalsForSelectedTeam.map((prop) => {
                        const candidateUser = users.find(
                          (u) => u.uid === prop.candidateUid
                        );
                        const candidateProf = profiles[prop.candidateUid];
                        const proposerUser = users.find(
                          (u) => u.uid === prop.proposerUid
                        );
                        const approvedCount = prop.votes.filter(
                          (v) => v.decision === 'approve'
                        ).length;
                        const totalRequired = prop.requiredVoterUids.length;
                        const myVote = prop.votes.find(
                          (v) => v.voterUid === currentUser.uid
                        );

                        return (
                          <div
                            key={prop.id}
                            data-testid={`team-proposal-${prop.id}`}
                            className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-3 text-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                                  {candidateUser?.displayName ??
                                    prop.candidateUid}
                                </div>
                                <div className="text-slate-500">
                                  Proposed by{' '}
                                  {proposerUser?.displayName ??
                                    prop.proposerUid}{' '}
                                  · Role: <strong>{prop.proposedRole}</strong>
                                </div>
                                {candidateProf &&
                                  candidateProf.skillTags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-1.5">
                                      {candidateProf.skillTags
                                        .slice(0, 6)
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
                              </div>

                              <span
                                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-semibold shrink-0 ${
                                  prop.status === 'invited'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
                                    : 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300'
                                }`}
                              >
                                {prop.status === 'invited'
                                  ? 'Invited · Awaiting Candidate'
                                  : `${approvedCount}/${totalRequired} Approved`}
                              </span>
                            </div>

                            {/* Member Vote Breakdown */}
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              {prop.requiredVoterUids.map((voterUid) => {
                                const voter = users.find(
                                  (u) => u.uid === voterUid
                                );
                                const voteObj = prop.votes.find(
                                  (v) => v.voterUid === voterUid
                                );
                                return (
                                  <span
                                    key={voterUid}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                                      voteObj?.decision === 'approve'
                                        ? 'bg-emerald-100/80 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                                        : 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                    }`}
                                  >
                                    {voteObj?.decision === 'approve' ? (
                                      <CheckCircle2 className="w-3 h-3" />
                                    ) : null}
                                    <span>
                                      {(voter?.displayName ?? voterUid).split(
                                        ' '
                                      )[0]}
                                      :{' '}
                                      {voteObj?.decision === 'approve'
                                        ? 'Approved'
                                        : 'Pending'}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>

                            {/* Vote Buttons for Current Member */}
                            {prop.status === 'pending_votes' &&
                              onVoteTeamProposal && (
                                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                                  <span className="text-slate-500">
                                    {myVote?.decision === 'approve'
                                      ? 'You approved this candidate. Waiting for remaining teammates.'
                                      : 'Your vote is required to invite this candidate:'}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {myVote?.decision !== 'approve' && (
                                      <button
                                        type="button"
                                        data-testid={`approve-proposal-${prop.id}`}
                                        onClick={() =>
                                          void onVoteTeamProposal(
                                            prop.id,
                                            'approve'
                                          )
                                        }
                                        className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                                      >
                                        <UserCheck className="w-3.5 h-3.5" />
                                        <span>Approve</span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      data-testid={`reject-proposal-${prop.id}`}
                                      onClick={() =>
                                        void onVoteTeamProposal(
                                          prop.id,
                                          'reject'
                                        )
                                      }
                                      className="px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 font-medium inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                      <span>Reject</span>
                                    </button>
                                  </div>
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {resolvedProposalsForSelectedTeam.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs">
                      <span className="text-[11px] font-semibold text-slate-400">
                        Past Proposal Outcomes
                      </span>
                      {resolvedProposalsForSelectedTeam
                        .slice(0, 4)
                        .map((prop) => {
                          const candidate = users.find(
                            (u) => u.uid === prop.candidateUid
                          );
                          return (
                            <div
                              key={prop.id}
                              className="flex items-center justify-between text-slate-500 py-0.5"
                            >
                              <span>
                                {candidate?.displayName ?? prop.candidateUid}
                              </span>
                              <span className="capitalize font-medium">
                                {prop.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {/* Legacy Join Requests Fallback */}
                  {pendingJoinRequests.length > 0 && onResolveJoinRequest && (
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <span className="text-xs font-semibold text-slate-500 block">
                        Direct Join Requests ({pendingJoinRequests.length})
                      </span>
                      {pendingJoinRequests.map((req) => {
                        const applicant = users.find(
                          (u) => u.uid === req.applicantUid
                        );
                        return (
                          <div
                            key={req.id}
                            className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between gap-2 text-xs"
                          >
                            <span>
                              <strong>
                                {applicant?.displayName ?? req.applicantUid}
                              </strong>{' '}
                              ({req.proposedRole})
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  onResolveJoinRequest(req.id, 'accept')
                                }
                                className="px-2.5 py-1 rounded bg-blue-600 text-white font-semibold cursor-pointer"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onResolveJoinRequest(req.id, 'reject')
                                }
                                className="px-2.5 py-1 rounded border border-slate-300 text-slate-600 cursor-pointer"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 3. Hackathon Registration Readiness & Official Registration Tracker (Part E) */}
                {registrationRecord && (
                  <div
                    data-testid="team-registration-card"
                    className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          <ClipboardCheck className="w-4 h-4 text-emerald-600" />
                          <span>Hackathon Registration Readiness</span>
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {registrationRecord.eligibilityReason}
                        </p>
                      </div>

                      <span
                        className={`px-2.5 py-1 rounded-lg border text-xs font-semibold shrink-0 ${
                          REGISTRATION_STATUS_LABELS[
                            registrationRecord.registrationStatus
                          ].badgeClass
                        }`}
                      >
                        {
                          REGISTRATION_STATUS_LABELS[
                            registrationRecord.registrationStatus
                          ].label
                        }
                      </span>
                    </div>

                    {registrationRecord.externalRegistrationReference && (
                      <div className="p-3 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 text-xs space-y-0.5">
                        <div className="font-semibold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-indigo-600" />
                          <span>
                            Registration Reference:{' '}
                            {registrationRecord.externalRegistrationReference}
                          </span>
                        </div>
                        {registrationRecord.confirmationNotes && (
                          <p className="text-slate-600 dark:text-slate-300">
                            {registrationRecord.confirmationNotes}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                      {registrationRecord.officialRegistrationUrl ? (
                        <a
                          href={registrationRecord.officialRegistrationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold hover:opacity-90"
                        >
                          <span>Open Official Event Registration Page</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      ) : (
                        <span className="text-slate-400">
                          Official registration URL not yet published on event
                          listing.
                        </span>
                      )}

                      {onUpdateTeamRegistration && (
                        <div className="flex flex-wrap items-center gap-2">
                          {registrationRecord.eligibleToRegister &&
                            registrationRecord.registrationStatus !==
                              'registered' && (
                              <button
                                type="button"
                                data-testid="open-mark-registered-btn"
                                onClick={() => setShowRegForm(!showRegForm)}
                                className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                              >
                                {showRegForm
                                  ? 'Cancel'
                                  : 'Record Official Registration'}
                              </button>
                            )}

                          {registrationRecord.registrationStatus ===
                            'registered' && (
                            <button
                              type="button"
                              onClick={() =>
                                void onUpdateTeamRegistration(selectedTeam.id, {
                                  registrationStatus: 'ready_to_register',
                                })
                              }
                              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer"
                            >
                              Unlock / Amend Registration
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {showRegForm && onUpdateTeamRegistration && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void onUpdateTeamRegistration(selectedTeam.id, {
                            registrationStatus: 'registered',
                            externalRegistrationReference:
                              regReferenceInput.trim() || null,
                            confirmationNotes: regNotesInput.trim() || null,
                          });
                          setShowRegForm(false);
                        }}
                        className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2.5 text-xs"
                      >
                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            External Registration ID / Team Code (Optional)
                          </label>
                          <input
                            type="text"
                            value={regReferenceInput}
                            onChange={(e) =>
                              setRegReferenceInput(e.target.value)
                            }
                            placeholder="e.g., UNSTOP-2026-9941 or Devfolio Team Link"
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            Confirmation Notes (Optional)
                          </label>
                          <input
                            type="text"
                            value={regNotesInput}
                            onChange={(e) => setRegNotesInput(e.target.value)}
                            placeholder="e.g., Submitted by team lead on official portal"
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="submit"
                            data-testid="confirm-mark-registered-btn"
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                          >
                            Confirm Team Registered
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>

              {/* Right 5 Columns: Embedded Team Group Chat (Part D.3) */}
              <div className="lg:col-span-5">
                <div
                  data-testid="team-chat-panel"
                  className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col h-[580px]"
                >
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-blue-600" />
                        <span>Team Chat · {selectedTeam.name.split(' (')[0]}</span>
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Private to your {rosterMemberships.length} active team
                        members · Auto-syncs every 4s
                      </p>
                    </div>
                  </div>

                  {/* Persistent Team Messages Feed */}
                  <div className="flex-1 p-4 overflow-y-auto space-y-2.5 bg-slate-50/40 dark:bg-slate-950/30">
                    {teamChatMessages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center text-xs text-slate-400 space-y-1">
                        <MessageSquare className="w-6 h-6 text-slate-300" />
                        <p>
                          Say hello to your teammates and coordinate your
                          hackathon problem track!
                        </p>
                      </div>
                    ) : (
                      teamChatMessages.map((msg) => {
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
                              className={`max-w-[85%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                                isMe
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              {msg.body}
                            </div>
                            <span className="text-[10px] text-slate-400 mt-0.5 px-1">
                              {sender?.displayName ?? msg.senderUid} ·{' '}
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Team Chat Composer */}
                  <form
                    onSubmit={(e) => void handleSendChat(e)}
                    className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2"
                  >
                    <input
                      type="text"
                      data-testid="team-chat-input"
                      value={chatDraft}
                      onChange={(e) => setChatDraft(e.target.value)}
                      placeholder="Message your team..."
                      className="flex-1 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      data-testid="team-chat-send-btn"
                      disabled={!chatDraft.trim() || sendingChat}
                      className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send</span>
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
  );
