import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
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
import { StudentAvatar } from './StudentAvatar';

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
      'bg-[#fff3c9] text-[#725c00] border-[#ffd84d]',
  },
  ready_to_register: {
    label: 'Ready to Register',
    badgeClass:
      'bg-[#e6f4ea] text-[#137333] border-[#ceead6]',
  },
  registration_in_progress: {
    label: 'Registration in Progress',
    badgeClass:
      'bg-[#fff3c9] text-[#725c00] border-[#f0d98c]',
  },
  registered: {
    label: 'Officially Registered',
    badgeClass:
      'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  registration_closed: {
    label: 'Registration Closed',
    badgeClass:
      'bg-[#f6f3f2] text-[#746e65] border-[#e9e5dd]',
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
        <div className="space-y-6 max-w-5xl mx-auto">
          {/* Top Bar: Canary Minimal My Team Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#e9e5dd]">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1c1b1b]">
                  My Team
                </h1>
                {selectedTeam && (
                  <span className="px-2.5 py-0.5 rounded-full bg-[#ffd84d] text-[#1c1b1b] text-xs font-semibold">
                    {rosterMemberships.length} of {maxAllowedSize} members
                  </span>
                )}
              </div>
              {selectedTeam && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#746e65]">
                  <span className="font-semibold text-[#1c1b1b]">
                    {selectedTeam.name.split(' (')[0]}
                  </span>
                  <span>•</span>
                  <span>{teamHackathon?.name ?? selectedTeam.hackathonId}</span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#ffd84d]/30 text-[#1c1b1b] text-xs font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#d97706]" />
                    {registrationRecord?.registrationStatus === 'registered' ? 'Registered' : 'Forming'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 self-start md:self-auto">
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
                  className="px-3 py-2 rounded-xl border border-[#e9e5dd] bg-white text-xs font-semibold text-[#1c1b1b] shadow-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                >
                  {myTeams.map((t) => {
                    const h = hackathons.find((hk) => hk.id === t.hackathonId);
                    return (
                      <option key={t.id} value={t.id}>
                        {t.name.split(' (')[0]} · {h?.name ?? t.hackathonId} ({t.memberCount}/{t.targetSize})
                      </option>
                    );
                  })}
                </select>
              )}

              {selectedTeam && onUpdateTeamDetails && (
                <button
                  type="button"
                  onClick={() => {
                    if (isEditingTeam) {
                      setIsEditingTeam(false);
                    } else {
                      startEditingTeam(selectedTeam);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-[#f6f3f2] text-[#1c1b1b] text-xs font-semibold transition-colors cursor-pointer border border-[#e9e5dd] shadow-xs"
                >
                  <Edit3 className="w-3.5 h-3.5 text-[#746e65]" />
                  <span>{isEditingTeam ? 'Close Edit' : 'Edit Team Details'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Incoming Candidate Invitations Banner */}
          {incomingCandidateInvitations.length > 0 && (
            <div
              data-testid="incoming-team-invitations"
              className="bg-[#fff9e6] rounded-2xl border border-[#ffd84d] p-5 space-y-3.5 shadow-xs"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#725c00]">
                  <UserPlus className="w-4 h-4 text-[#725c00]" />
                  <span>
                    Team Invitations &amp; Proposals for You ({incomingCandidateInvitations.length})
                  </span>
                </div>
                {incomingCandidateInvitations.filter((i) => i.status === 'invited').length > 1 && (
                  <span className="text-xs font-medium text-[#875200]">
                    Multiple offers: accepting one automatically declines others for that hackathon.
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {incomingCandidateInvitations.map((inv) => {
                  const team = teams.find((t) => t.id === inv.teamId);
                  const hack = hackathons.find((h) => h.id === inv.hackathonId);
                  const proposer = users.find((u) => u.uid === inv.proposerUid);
                  const isReadyToAccept = inv.status === 'invited';

                  return (
                    <div
                      key={inv.id}
                      className="p-4 rounded-xl bg-white border border-[#e9e5dd] space-y-2.5 text-xs shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[11px] text-[#746e65]">
                            {hack?.name ?? inv.hackathonId}
                          </span>
                          <h4 className="text-sm font-bold text-[#1c1b1b]">
                            {team?.name ?? 'Student Team'}
                          </h4>
                          <p className="text-[#746e65]">
                            Proposed by {proposer?.displayName ?? inv.proposerUid} · Role: <strong>{inv.proposedRole}</strong>
                          </p>
                        </div>

                        <span
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                            isReadyToAccept
                              ? 'bg-[#e6f4ea] text-[#137333] border border-[#ceead6]'
                              : 'bg-[#fff3c9] text-[#725c00] border border-[#ffd84d]'
                          }`}
                        >
                          {isReadyToAccept
                            ? 'Approved · Invited'
                            : `Awaiting Votes (${inv.votes.filter((v) => v.decision === 'approve').length}/${inv.requiredVoterUids.length})`}
                        </span>
                      </div>

                      {inv.note && (
                        <p className="text-[#4d4634] italic bg-[#faf8f2] p-2 rounded-lg border border-[#e9e5dd]/60">
                          &ldquo;{inv.note}&rdquo;
                        </p>
                      )}

                      {isReadyToAccept && onRespondTeamProposal ? (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            data-testid={`accept-invitation-${inv.id}`}
                            onClick={() => void onRespondTeamProposal(inv.id, 'accept')}
                            className="px-3.5 py-1.5 rounded-lg bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold text-xs shadow-xs cursor-pointer"
                          >
                            Accept &amp; Join Team
                          </button>
                          <button
                            type="button"
                            data-testid={`decline-invitation-${inv.id}`}
                            onClick={() => void onRespondTeamProposal(inv.id, 'decline')}
                            className="px-3.5 py-1.5 rounded-lg border border-[#e9e5dd] hover:bg-[#f6f3f2] text-[#746e65] font-semibold text-xs cursor-pointer"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <p className="text-[11px] text-[#746e65]">
                          Once all current members vote to approve, you will be able to join.
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
            <div className="bg-white rounded-2xl border border-[#e9e5dd] p-10 text-center space-y-4 max-w-lg mx-auto shadow-xs">
              <div className="w-16 h-16 rounded-full bg-[#ffd84d]/40 flex items-center justify-center mx-auto text-[#725c00]">
                <Users className="w-8 h-8 text-[#725c00]" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-[#1c1b1b]">
                  You aren&apos;t on an active team yet
                </h3>
                <p className="text-xs text-[#746e65] leading-relaxed">
                  Swipe right on students you want to build with in Discover. When another student swipes right on you too, Quackathon automatically forms your 2-person team!
                </p>
              </div>
              {onOpenDiscover && (
                <button
                  type="button"
                  onClick={onOpenDiscover}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] text-xs font-bold shadow-xs cursor-pointer transition-all"
                >
                  <Sparkles className="w-4 h-4 text-[#725c00]" />
                  <span>Discover Students</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* STITCH SCREEN: 4-Slot Roster 2x2 Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Active Locked Team Members */}
                {rosterMemberships.map((m) => {
                  const u = users.find((usr) => usr.uid === m.uid);
                  const p = profiles[m.uid];
                  const isLead = selectedTeam.leaderId === m.uid;

                  return (
                    <div
                      key={m.id}
                      className="bg-white p-5 rounded-2xl flex flex-col justify-between shadow-xs border border-[#e9e5dd] space-y-3"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <StudentAvatar
                              uid={m.uid}
                              name={u?.displayName ?? m.uid}
                              size="md"
                            />
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-sm text-[#1c1b1b] truncate">
                                  {(u?.displayName ?? m.uid).replace(' (Synthetic Demo)', '')}
                                </span>
                                {isLead && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#ffd84d]/40 text-[#725c00] text-[10px] font-bold">
                                    Team Lead
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-[#746e65]">
                                {u?.graduationYear ? `Class of ${u.graduationYear}` : 'PES Student'}{' '}
                                {u?.campus ? `· ${u.campus}` : ''}
                              </span>
                            </div>
                          </div>
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f6f3f2] text-[#746e65] text-[11px] font-medium border border-[#e9e5dd]">
                            <Lock className="w-3 h-3 text-[#746e65]" />
                            <span>Locked</span>
                          </span>
                        </div>

                        <div className="pt-1">
                          <span className="text-[10px] font-semibold text-[#746e65] uppercase tracking-wider block mb-0.5">
                            Focus Area
                          </span>
                          <p className="text-xs font-semibold text-[#1c1b1b]">
                            {m.role || p?.preferredRoles?.[0] || 'Full Stack Engineer'}
                          </p>
                        </div>

                        {p && p.skillTags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {p.skillTags.slice(0, 4).map((skill) => (
                              <span
                                key={skill}
                                className="px-2.5 py-1 rounded-full bg-[#f6f3f2] text-[#4d4634] text-[11px] font-medium border border-[#e9e5dd]/60"
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Open Slots up to maxAllowedSize (e.g. Slot #4 Seeking Teammate) */}
                {Array.from({ length: Math.max(0, maxAllowedSize - rosterMemberships.length) }).map((_, idx) => {
                  const slotNum = rosterMemberships.length + idx + 1;
                  const neededRole =
                    selectedTeam.rolesNeeded?.[idx] ||
                    teamCapabilities?.missingRoles?.[idx] ||
                    'Teammate Needed';

                  return (
                    <div
                      key={`open-slot-${slotNum}`}
                      className="bg-white p-5 rounded-2xl flex flex-col justify-between shadow-xs border-2 border-dashed border-[#ffd84d] relative overflow-hidden space-y-3"
                    >
                      <div className="absolute inset-0 bg-[#ffd84d]/10 pointer-events-none" />
                      <div className="relative z-10 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-[#ffe07e]/40 flex items-center justify-center shrink-0 text-[#725c00]">
                              <UserPlus className="w-5 h-5 text-[#725c00]" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-bold text-sm text-[#1c1b1b]">
                                Slot #{slotNum} · Open
                              </span>
                              <span className="text-xs text-[#875200] font-medium">
                                {neededRole}
                              </span>
                            </div>
                          </div>
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#ffd84d] text-[#1c1b1b] text-[11px] font-bold">
                            Seeking
                          </span>
                        </div>

                        <div className="pt-1">
                          <span className="text-[10px] font-semibold text-[#746e65] uppercase tracking-wider block mb-0.5">
                            Target Focus
                          </span>
                          <p className="text-xs text-[#1c1b1b]">
                            {selectedTeam.pitch || 'Looking for passionate PES students to complete our roster.'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-[#e9e5dd]/60 relative z-10 flex flex-wrap items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f6f3f2] text-[#746e65] text-[11px] font-medium border border-[#e9e5dd]/60">
                          <Clock className="w-3 h-3 text-[#746e65]" />
                          <span>
                            {activeProposalsForSelectedTeam.length > 0
                              ? `${activeProposalsForSelectedTeam.length} invite pending review`
                              : '0 invites pending'}
                          </span>
                        </div>
                        {onOpenDiscover && (
                          <button
                            type="button"
                            onClick={onOpenDiscover}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold text-xs shadow-xs transition-colors cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Invite from Discover</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Roster Status Subtext */}
              <div className="p-3 text-center rounded-xl bg-[#f6f3f2] border border-[#e9e5dd] text-xs text-[#746e65]">
                Status: <span className="font-bold text-[#1c1b1b]">{registrationRecord?.registrationStatus === 'registered' ? 'Registered' : 'Forming'}</span> ({rosterMemberships.length}/{maxAllowedSize} members) → Next: <span className="font-bold text-[#1c1b1b]">{registrationRecord?.registrationStatus === 'registered' ? 'Ready for Hackathon Event Day' : 'Ready to Register. Hackathon registration requires final submission by Team Lead once team is full.'}</span>
              </div>

              {/* Inline Team Edit Form (if active) */}
              {isEditingTeam && (
                <form
                  onSubmit={(e) => void handleSaveTeamEdit(e)}
                  className="p-5 rounded-2xl bg-white border border-[#e9e5dd] space-y-3.5 text-xs shadow-xs"
                >
                  <h4 className="text-sm font-bold text-[#1c1b1b]">Edit Team Information</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-[#1c1b1b] mb-1">
                        Team Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#e9e5dd] bg-[#faf8f2] text-xs text-[#1c1b1b] focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-[#1c1b1b] mb-1">
                        Team Pitch / Goal
                      </label>
                      <input
                        type="text"
                        value={editPitch}
                        onChange={(e) => setEditPitch(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#e9e5dd] bg-[#faf8f2] text-xs text-[#1c1b1b] focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-[#1c1b1b] mb-1">
                      Project Idea / Problem Track
                    </label>
                    <input
                      type="text"
                      value={editProjectIdea}
                      onChange={(e) => setEditProjectIdea(e.target.value)}
                      placeholder="What problem statement or prototype are you building?"
                      className="w-full px-3 py-2 rounded-xl border border-[#e9e5dd] bg-[#faf8f2] text-xs text-[#1c1b1b] focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingTeam(false)}
                      className="px-4 py-2 rounded-xl border border-[#e9e5dd] text-[#746e65] hover:text-[#1c1b1b] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold cursor-pointer shadow-xs"
                    >
                      Save Changes
                    </button>
                  </div>
                </form>
              )}

              {/* 2-Column Split: Governance / Capabilities / Proposals on Left, Team Chat on Right */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left 7 Columns: Capabilities, Proposals, Registration, Governance */}
                <div className="lg:col-span-7 space-y-5">
                  {/* Combined Skills & Complementary Roles */}
                  {teamCapabilities && (
                    <div className="bg-white rounded-2xl border border-[#e9e5dd] p-5 space-y-3.5 shadow-xs">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#725c00]" />
                        <h3 className="text-sm font-bold text-[#1c1b1b]">
                          Team Skill Coverage &amp; Complementary Roles
                        </h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-[11px] font-semibold text-[#746e65] uppercase tracking-wider block mb-1.5">
                            Combined Team Skills
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {Array.from(teamCapabilities.combinedSkills)
                              .slice(0, 8)
                              .map((sk) => (
                                <span
                                  key={sk}
                                  className="px-2 py-0.5 rounded-full bg-[#f6f3f2] text-[#4d4634] border border-[#e9e5dd]/60"
                                >
                                  {sk}
                                </span>
                              ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-[11px] font-semibold text-[#746e65] uppercase tracking-wider block mb-1.5">
                            Complementary Roles to Recruit
                          </span>
                          {teamCapabilities.missingRoles.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {teamCapabilities.missingRoles.map((role) => (
                                <span
                                  key={role}
                                  className="px-2 py-0.5 rounded-full bg-[#fff3c9] border border-[#ffd84d] text-[#725c00] font-semibold"
                                >
                                  + {role}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[#137333] font-medium">
                              All core roles covered!
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Candidate Proposals & Unanimous Team Voting */}
                  <div className="bg-white rounded-2xl border border-[#e9e5dd] p-5 space-y-3.5 shadow-xs">
                    <div>
                      <h3 className="text-sm font-bold text-[#1c1b1b] flex items-center gap-2">
                        <Vote className="w-4 h-4 text-[#725c00]" />
                        <span>
                          Candidate Proposals &amp; Unanimous Team Voting ({activeProposalsForSelectedTeam.length})
                        </span>
                      </h3>
                      <p className="text-xs text-[#746e65] mt-0.5">
                        When a teammate and candidate match, a proposal is created. Every current member must vote to approve.
                      </p>
                    </div>

                    {activeProposalsForSelectedTeam.length === 0 ? (
                      <div className="p-4 rounded-xl bg-[#faf8f2] text-center text-xs text-[#746e65] border border-[#e9e5dd]">
                        No active candidate proposals. Find and swipe on students in Discover to propose new teammates!
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {activeProposalsForSelectedTeam.map((prop) => {
                          const candidateUser = users.find((u) => u.uid === prop.candidateUid);
                          const candidateProf = profiles[prop.candidateUid];
                          const proposerUser = users.find((u) => u.uid === prop.proposerUid);
                          const approvedCount = prop.votes.filter((v) => v.decision === 'approve').length;
                          const totalRequired = prop.requiredVoterUids.length;
                          const myVote = prop.votes.find((v) => v.voterUid === currentUser.uid);

                          return (
                            <div
                              key={prop.id}
                              data-testid={`team-proposal-${prop.id}`}
                              className="p-4 rounded-xl border border-[#e9e5dd] bg-[#faf8f2] space-y-3 text-xs"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="font-bold text-sm text-[#1c1b1b]">
                                    {candidateUser?.displayName ?? prop.candidateUid}
                                  </div>
                                  <div className="text-[#746e65]">
                                    Proposed by {proposerUser?.displayName ?? prop.proposerUid} · Role: <strong>{prop.proposedRole}</strong>
                                  </div>
                                  {candidateProf && candidateProf.skillTags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-1.5">
                                      {candidateProf.skillTags.slice(0, 5).map((sk) => (
                                        <span
                                          key={sk}
                                          className="px-2 py-0.5 rounded-full bg-white border border-[#e9e5dd] text-[11px] text-[#4d4634]"
                                        >
                                          {sk}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                <span
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                                    prop.status === 'invited'
                                      ? 'bg-[#e6f4ea] text-[#137333] border border-[#ceead6]'
                                      : 'bg-[#fff3c9] text-[#725c00] border border-[#ffd84d]'
                                  }`}
                                >
                                  {prop.status === 'invited'
                                    ? 'Unanimously Approved'
                                    : `Pending Votes (${approvedCount}/${totalRequired})`}
                                </span>
                              </div>

                              <div className="p-2.5 rounded-lg bg-white border border-[#e9e5dd] space-y-1 text-[11px]">
                                <span className="font-semibold text-[#1c1b1b]">Team Member Votes:</span>
                                <div className="flex flex-wrap gap-2">
                                  {prop.requiredVoterUids.map((vUid) => {
                                    const voter = users.find((u) => u.uid === vUid);
                                    const vVote = prop.votes.find((v) => v.voterUid === vUid);
                                    return (
                                      <span
                                        key={vUid}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${
                                          vVote?.decision === 'approve'
                                            ? 'bg-[#e6f4ea] text-[#137333]'
                                            : vVote?.decision === 'reject'
                                            ? 'bg-rose-50 text-rose-700'
                                            : 'bg-[#f6f3f2] text-[#746e65]'
                                        }`}
                                      >
                                        {vVote?.decision === 'approve' && <Check className="w-3 h-3 text-[#137333]" />}
                                        {vVote?.decision === 'reject' && <X className="w-3 h-3 text-rose-700" />}
                                        <span>{voter?.displayName ?? vUid}</span>
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>

                              {prop.status === 'pending_votes' && onVoteTeamProposal && (
                                <div className="flex items-center gap-2 pt-1 border-t border-[#e9e5dd]">
                                  {myVote ? (
                                    <span className="text-[11px] text-[#746e65]">
                                      You voted: <strong className="capitalize">{myVote.decision}</strong>
                                    </span>
                                  ) : (
                                    <>
                                      <span className="text-[11px] text-[#746e65] mr-auto">Your vote is required:</span>
                                      <button
                                        type="button"
                                        data-testid={`vote-approve-${prop.id}`}
                                        onClick={() => void onVoteTeamProposal(prop.id, 'approve')}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold text-xs cursor-pointer shadow-xs"
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                        <span>Approve</span>
                                      </button>
                                      <button
                                        type="button"
                                        data-testid={`vote-reject-${prop.id}`}
                                        onClick={() => void onVoteTeamProposal(prop.id, 'reject')}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#e9e5dd] hover:bg-rose-50 hover:text-rose-700 text-[#746e65] font-semibold text-xs cursor-pointer"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                        <span>Reject</span>
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Legacy Join Requests Fallback */}
                  {pendingJoinRequests.length > 0 && (
                    <div className="bg-white rounded-2xl border border-[#e9e5dd] p-5 space-y-3.5 shadow-xs">
                      <div>
                        <h3 className="text-sm font-bold text-[#1c1b1b] flex items-center gap-2">
                          <UserCheck className="w-4 h-4 text-[#725c00]" />
                          <span>Direct Join Requests ({pendingJoinRequests.length})</span>
                        </h3>
                        <p className="text-xs text-[#746e65] mt-0.5">
                          Requests submitted before unanimous team matching was initialized.
                        </p>
                      </div>

                      <div className="space-y-2.5">
                        {pendingJoinRequests.map((req) => {
                          const sender = users.find((u) => u.uid === req.applicantUid);
                          const prof = profiles[req.applicantUid];

                          return (
                            <div
                              key={req.id}
                              className="p-3.5 rounded-xl border border-[#e9e5dd] bg-[#faf8f2] flex items-center justify-between gap-3 text-xs"
                            >
                              <div>
                                <span className="font-bold text-[#1c1b1b]">
                                  {sender?.displayName ?? req.applicantUid}
                                </span>
                                <span className="text-[#746e65] ml-2">Role: {req.proposedRole}</span>
                                {prof && prof.skillTags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 pt-1">
                                    {prof.skillTags.slice(0, 3).map((sk) => (
                                      <span key={sk} className="px-2 py-0.5 rounded-full bg-white border border-[#e9e5dd] text-[10px]">
                                        {sk}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {onResolveJoinRequest && (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => onResolveJoinRequest(req.id, 'accept')}
                                    className="px-3 py-1.5 rounded-lg bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold text-xs cursor-pointer shadow-xs"
                                  >
                                    Accept
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onResolveJoinRequest(req.id, 'reject')}
                                    className="px-3 py-1.5 rounded-lg border border-[#e9e5dd] hover:bg-rose-50 text-[#746e65] text-xs cursor-pointer"
                                  >
                                    Decline
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Hackathon Registration Readiness & Official Registration Tracker */}
                  {registrationRecord && (
                    <div
                      data-testid="team-registration-card"
                      className="bg-white rounded-2xl border border-[#e9e5dd] p-5 space-y-3.5 shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-[#1c1b1b] flex items-center gap-2">
                            <ClipboardCheck className="w-4 h-4 text-[#137333]" />
                            <span>Hackathon Registration Readiness</span>
                          </h3>
                          <p className="text-xs text-[#746e65] mt-0.5">
                            {registrationRecord.eligibilityReason}
                          </p>
                        </div>

                        <span
                          className={`px-2.5 py-1 rounded-full border text-xs font-semibold shrink-0 ${
                            REGISTRATION_STATUS_LABELS[registrationRecord.registrationStatus].badgeClass
                          }`}
                        >
                          {REGISTRATION_STATUS_LABELS[registrationRecord.registrationStatus].label}
                        </span>
                      </div>

                      {registrationRecord.externalRegistrationReference && (
                        <div className="p-3 rounded-xl bg-[#faf8f2] border border-[#e9e5dd] text-xs space-y-0.5">
                          <div className="font-semibold text-[#1c1b1b] flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4 text-[#725c00]" />
                            <span>
                              Registration Reference: {registrationRecord.externalRegistrationReference}
                            </span>
                          </div>
                          {registrationRecord.confirmationNotes && (
                            <p className="text-[#746e65]">
                              {registrationRecord.confirmationNotes}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#e9e5dd] text-xs">
                        {registrationRecord.officialRegistrationUrl ? (
                          <a
                            href={registrationRecord.officialRegistrationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1c1b1b] text-white font-semibold hover:opacity-90"
                          >
                            <span>Open Event Registration Portal</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-[#746e65]">
                            Registration portal link pending.
                          </span>
                        )}

                        {onUpdateTeamRegistration &&
                          selectedTeam.leaderId === currentUser.uid &&
                          registrationRecord.registrationStatus !== 'registered' && (
                            <button
                              type="button"
                              data-testid="open-mark-registered-btn"
                              onClick={() => setShowRegForm(!showRegForm)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold shadow-xs cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Submit Registration Confirmation</span>
                            </button>
                          )}
                      </div>

                      {showRegForm && onUpdateTeamRegistration && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void onUpdateTeamRegistration(selectedTeam.id, {
                              registrationStatus: 'registered',
                              externalRegistrationReference: regReferenceInput.trim() || null,
                              confirmationNotes: regNotesInput.trim() || null,
                            });
                            setShowRegForm(false);
                          }}
                          className="p-4 rounded-xl bg-[#faf8f2] border border-[#ffd84d] space-y-3 text-xs"
                        >
                          <h4 className="font-bold text-[#1c1b1b]">
                            Confirm Official Hackathon Registration
                          </h4>
                          <div>
                            <label className="block text-[#1c1b1b] font-medium mb-1">
                              Confirmation ID / Team Reference Number
                            </label>
                            <input
                              type="text"
                              value={regReferenceInput}
                              onChange={(e) => setRegReferenceInput(e.target.value)}
                              placeholder="e.g. PES-HACK-8842"
                              className="w-full px-3 py-1.5 rounded-lg border border-[#e9e5dd] bg-white text-xs text-[#1c1b1b] focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                            />
                          </div>
                          <div>
                            <label className="block text-[#1c1b1b] font-medium mb-1">
                              Confirmation Notes (Optional)
                            </label>
                            <input
                              type="text"
                              value={regNotesInput}
                              onChange={(e) => setRegNotesInput(e.target.value)}
                              placeholder="e.g. Verified by Hackathon Lead"
                              className="w-full px-3 py-1.5 rounded-lg border border-[#e9e5dd] bg-white text-xs text-[#1c1b1b] focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                            />
                          </div>
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setShowRegForm(false)}
                              className="px-3 py-1.5 rounded-lg border border-[#e9e5dd] text-[#746e65] cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              data-testid="confirm-mark-registered-btn"
                              className="px-3.5 py-1.5 rounded-lg bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold cursor-pointer"
                            >
                              Lock &amp; Confirm Registered
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}

                  {/* Leave Team Button */}
                  {onLeaveTeam && (
                    <div className="p-4 rounded-2xl bg-white border border-[#e9e5dd] flex items-center justify-between gap-3 text-xs shadow-xs">
                      <span className="text-[#746e65]">
                        {registrationRecord?.registrationStatus === 'registered'
                          ? 'Roster locked because team is officially registered.'
                          : 'Need to switch teams? Leaving reopens your discovery feed.'}
                      </span>
                      <button
                        type="button"
                        data-testid="leave-team-btn"
                        disabled={registrationRecord?.registrationStatus === 'registered'}
                        onClick={() => void onLeaveTeam(selectedTeam.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Leave Team</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Right 5 Columns: Embedded Team Group Chat */}
                <div className="lg:col-span-5">
                  <div
                    data-testid="team-chat-panel"
                    className="bg-white rounded-2xl border border-[#e9e5dd] flex flex-col h-[600px] shadow-xs overflow-hidden"
                  >
                    <div className="p-4 border-b border-[#e9e5dd] flex items-center justify-between gap-2 bg-white">
                      <div>
                        <h3 className="text-sm font-bold text-[#1c1b1b] flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-[#725c00]" />
                          <span>Team Chat · {selectedTeam.name.split(' (')[0]}</span>
                        </h3>
                        <p className="text-[11px] text-[#746e65]">
                          Private to your {rosterMemberships.length} active team members
                        </p>
                      </div>
                    </div>

                    {/* Messages Feed */}
                    <div className="flex-1 p-4 overflow-y-auto space-y-2.5 bg-[#faf8f2]">
                      {teamChatMessages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center text-xs text-[#746e65] space-y-2">
                          <div className="w-10 h-10 rounded-full bg-[#ffd84d]/30 flex items-center justify-center text-[#725c00]">
                            <MessageSquare className="w-5 h-5 text-[#725c00]" />
                          </div>
                          <p>Say hello to your teammates and plan your hackathon project!</p>
                        </div>
                      ) : (
                        teamChatMessages.map((msg) => {
                          const isMe = msg.senderUid === currentUser.uid;
                          const sender = users.find((u) => u.uid === msg.senderUid);
                          return (
                            <div
                              key={msg.id}
                              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                                  isMe
                                    ? 'bg-[#ffd84d] text-[#1c1b1b] rounded-tr-xs font-medium shadow-2xs'
                                    : 'bg-white text-[#1c1b1b] rounded-tl-xs border border-[#e9e5dd] shadow-2xs'
                                }`}
                              >
                                {msg.body}
                              </div>
                              <span className="text-[10px] text-[#746e65] mt-0.5 px-1">
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
                      className="p-3 border-t border-[#e9e5dd] bg-white flex items-center gap-2"
                    >
                      <input
                        type="text"
                        data-testid="team-chat-input"
                        value={chatDraft}
                        onChange={(e) => setChatDraft(e.target.value)}
                        placeholder="Message your team..."
                        className="flex-1 bg-[#faf8f2] border border-[#e9e5dd] rounded-xl px-4 py-2 text-xs text-[#1c1b1b] placeholder:text-[#746e65] focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                      />
                      <button
                        type="submit"
                        data-testid="team-chat-send-btn"
                        disabled={!chatDraft.trim() || sendingChat}
                        className="px-4 py-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] font-bold text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
  );
