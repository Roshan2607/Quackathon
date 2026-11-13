import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Edit3,
  LogOut,
  Plus,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import {
  Hackathon,
  JoinRequest,
  Membership,
  Team,
  User,
} from '../types/domain';
import {
  ROLE_TAXONOMY,
  SUGGESTED_CUSTOM_SPECIALIZATIONS,
} from '../data/seedData';
import { Modal } from './Modal';

interface TeamsAndRequestsViewProps {
  currentUser: User;
  hackathons: Hackathon[];
  selectedHackathonId: string;
  teams: Team[];
  memberships: Membership[];
  joinRequests: JoinRequest[];
  users: User[];
  lastTransactionBanner: {
    type: 'success' | 'error' | 'warning';
    title: string;
    detail: string;
  } | null;
  onClearTransactionBanner: () => void;
  onCreateTeam: (params: {
    hackathonId: string;
    name: string;
    pitch: string;
    projectIdea: string;
    rolesNeeded: string[];
    customSpecializations: string[];
    desiredDomains: string[];
    targetSize: number;
  }) => void;
  onUpdateTeam?: (
    teamId: string,
    updates: {
      name: string;
      pitch: string;
      rolesNeeded: string[];
      customSpecializations: string[];
    }
  ) => void;
  onResolveJoinRequest: (requestId: string, decision: 'accepted' | 'rejected') => void;
  onSimulateLastSlotRace: (teamId: string) => void;
  onSimulateDoubleTeamAttempt: (hackathonId: string) => void;
  onLeaveTeam: (hackathonId: string, teamId: string) => void;
}

export const TeamsAndRequestsView: React.FC<TeamsAndRequestsViewProps> = ({
  currentUser,
  hackathons,
  selectedHackathonId,
  teams,
  memberships,
  joinRequests,
  users,
  lastTransactionBanner,
  onClearTransactionBanner,
  onCreateTeam,
  onUpdateTeam,
  onResolveJoinRequest,
  onSimulateLastSlotRace,
  onSimulateDoubleTeamAttempt,
  onLeaveTeam,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

  const [createHackathonId, setCreateHackathonId] = useState(selectedHackathonId);
  const [teamName, setTeamName] = useState('');
  const [teamPitch, setTeamPitch] = useState('');
  const [projectIdea, setProjectIdea] = useState('');
  const [rolesNeeded, setRolesNeeded] = useState<string[]>(['Frontend', 'Product/UI Design']);
  const [customSpecializations, setCustomSpecializations] = useState<string[]>([]);
  const [specInput, setSpecInput] = useState('');
  const [desiredDomains] = useState<string[]>(['Applied AI/ML', 'Climate/Civic Tech']);
  const [targetSize, setTargetSize] = useState<number>(4);

  const myMemberships = memberships.filter(
    (m) => m.uid === currentUser.uid && m.status === 'active'
  );

  // Requests where currentUser is leader of the target team OR currentUser is the applicant/recipient
  const myTeamIds = new Set(
    teams.filter((t) => t.leaderId === currentUser.uid).map((t) => t.id)
  );

  const relevantRequests = joinRequests.filter(
    (req) => myTeamIds.has(req.teamId) || req.applicantUid === currentUser.uid
  );

  const selectedHackathonForCreate =
    hackathons.find((h) => h.id === createHackathonId) ?? hackathons[0];

  const isCreateEventUnconfirmed =
    selectedHackathonForCreate.minTeamSize === null ||
    selectedHackathonForCreate.maxTeamSize === null;

  const commitSpecializationTokens = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) return;

    setCustomSpecializations((prev) => {
      const existingLower = new Set(prev.map((item) => item.toLowerCase()));
      const additions: string[] = [];
      for (const p of parts) {
        if (!existingLower.has(p.toLowerCase())) {
          existingLower.add(p.toLowerCase());
          additions.push(p);
        }
      }
      return [...prev, ...additions];
    });
  };

  const handleSpecKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (specInput.trim()) {
        commitSpecializationTokens(specInput);
        setSpecInput('');
      }
    } else if (
      e.key === 'Backspace' &&
      !specInput &&
      customSpecializations.length > 0
    ) {
      setCustomSpecializations((prev) => prev.slice(0, -1));
    }
  };

  const handleRemoveSpecialization = (label: string) => {
    setCustomSpecializations((prev) => prev.filter((item) => item !== label));
  };

  const openCreateTeamModal = () => {
    setEditingTeamId(null);
    setCreateHackathonId(selectedHackathonId);
    const h = hackathons.find((ev) => ev.id === selectedHackathonId);
    if (h?.maxTeamSize) setTargetSize(h.maxTeamSize);
    setTeamName('');
    setTeamPitch('');
    setProjectIdea('');
    setRolesNeeded(['Frontend', 'Product/UI Design']);
    setCustomSpecializations([]);
    setSpecInput('');
    setShowCreateModal(true);
  };

  const openEditTeamModal = (team: Team) => {
    setEditingTeamId(team.id);
    setCreateHackathonId(team.hackathonId);
    setTeamName(team.name);
    setTeamPitch(team.pitch);
    setProjectIdea(team.projectIdea ?? '');
    setRolesNeeded([...team.rolesNeeded]);
    setCustomSpecializations([...(team.customSpecializations ?? [])]);
    setSpecInput('');
    setTargetSize(team.targetSize);
    setShowCreateModal(true);
  };

  const handleSubmitTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim() || !teamPitch.trim()) return;

    // Commit any pending text inside the specialization input
    const finalSpecs = [...customSpecializations];
    if (specInput.trim()) {
      for (const token of specInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (!finalSpecs.some((ex) => ex.toLowerCase() === token.toLowerCase())) {
          finalSpecs.push(token);
        }
      }
    }

    if (editingTeamId && onUpdateTeam) {
      onUpdateTeam(editingTeamId, {
        name: teamName.trim(),
        pitch: teamPitch.trim(),
        rolesNeeded,
        customSpecializations: finalSpecs,
      });
    } else {
      onCreateTeam({
        hackathonId: createHackathonId,
        name: teamName.trim(),
        pitch: teamPitch.trim(),
        projectIdea: projectIdea.trim(),
        rolesNeeded,
        customSpecializations: finalSpecs,
        desiredDomains,
        targetSize,
      });
    }

    setShowCreateModal(false);
    setEditingTeamId(null);
    setTeamName('');
    setTeamPitch('');
    setProjectIdea('');
    setCustomSpecializations([]);
    setSpecInput('');
  };

  const gridPulseTeam = teams.find((t) => t.id === 'team_gridpulse');

  const hasUnsavedChanges =
    teamName.trim().length > 0 ||
    teamPitch.trim().length > 0 ||
    specInput.trim().length > 0 ||
    customSpecializations.length > 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Deterministic Membership Keys (`hackathonId_uid`) · Atomic Roster Transactions
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            My Teams, Applications & Atomic Invariant Lab
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-2xl">
            At most one active team per student per hackathon. Leaders cannot claim members without consent, and accepting the final slot atomically expires competing pending requests.
          </p>
        </div>

        <button
          onClick={openCreateTeamModal}
          className="px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer self-start lg:self-auto"
        >
          <Plus className="w-4 h-4" />
          Create New Team for Event
        </button>
      </div>

      {/* Transaction Feedback Banner */}
      {lastTransactionBanner && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-4 text-xs ${
            lastTransactionBanner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : lastTransactionBanner.type === 'error'
              ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {lastTransactionBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="font-bold text-sm">{lastTransactionBanner.title}</div>
              <p className="leading-relaxed">{lastTransactionBanner.detail}</p>
            </div>
          </div>
          <button
            onClick={onClearTransactionBanner}
            className="text-xs underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Interactive Invariant & Concurrency Verification Lab */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-semibold">
              <Zap className="w-3.5 h-3.5" />
              <span>Section 12 Acceptance Test Runner — Concurrency & Domain Invariants</span>
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Test Atomic Last-Slot Race & Single-Team-Per-Hackathon Enforcement
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 max-w-3xl">
              Verify how the transactional membership service handles two simultaneous approvals for the last open slot on <span className="font-semibold">Team GridPulse (3/4 members)</span>, or attempts to join two active teams within the same hackathon.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              onClick={() => onSimulateLastSlotRace('team_gridpulse')}
              disabled={!gridPulseTeam || gridPulseTeam.memberCount >= gridPulseTeam.targetSize}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap"
            >
              Simulate Simultaneous Last-Slot Approval Race
            </button>
            <button
              onClick={() => onSimulateDoubleTeamAttempt('hack_terrapthon_26')}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
            >
              Test Double-Team Membership Guard
            </button>
          </div>
        </div>
      </div>

      {/* Active Team Memberships for Current User */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Your Active Team Rosters ({myMemberships.length})
        </h2>

        {myMemberships.length === 0 ? (
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-500 dark:text-slate-400">
            You have not joined a confirmed team yet. You can apply to a team in the Discover tab, accept an invitation below, or create your own team.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myMemberships.map((mem) => {
              const team = teams.find((t) => t.id === mem.teamId);
              const hack = hackathons.find((h) => h.id === mem.hackathonId);
              if (!team || !hack) return null;

              const rosterMembers = memberships.filter(
                (m) => m.teamId === team.id && m.status === 'active'
              );
              const isLeader = team.leaderId === currentUser.uid;

              return (
                <div
                  key={mem.id}
                  className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{hack.name.split(' — ')[0]}</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {team.memberCount} / {team.targetSize} Members ({team.status.toUpperCase()})
                      </span>
                    </div>

                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        {team.name}
                      </h3>
                      {isLeader && onUpdateTeam && (
                        <button
                          type="button"
                          onClick={() => openEditTeamModal(team)}
                          className="px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 rounded-md inline-flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Edit3 className="w-3 h-3" />
                          Edit Roles & Specs
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300">{team.pitch}</p>

                    {/* Complementary Roles & Custom Specializations */}
                    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                      <div>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          Complementary Roles Needed:{' '}
                        </span>
                        <span className="text-slate-600 dark:text-slate-400">
                          {team.rolesNeeded.join(' · ') || 'None specified'}
                        </span>
                      </div>

                      {team.customSpecializations && team.customSpecializations.length > 0 && (
                        <div className="space-y-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                            Specific Specializations Needed:
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {team.customSpecializations.map((spec) => (
                              <span
                                key={spec}
                                className="px-2 py-0.5 text-[11px] font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 rounded-md"
                              >
                                {spec}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                        Confirmed Roster (Deterministic Key `hackathonId_uid`):
                      </span>
                      {rosterMembers.map((rm) => {
                        const u = users.find((usr) => usr.uid === rm.uid);
                        return (
                          <div key={rm.id} className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                            <span>{u ? u.displayName : rm.uid}</span>
                            <span className="font-mono text-slate-500">{rm.role}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-xs text-slate-400 font-mono">{mem.id}</span>
                    <button
                      onClick={() => onLeaveTeam(mem.hackathonId, team.id)}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Leave Team
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Applications & Invitations Inbox */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Join Requests & Invitations Inbox ({relevantRequests.length})
        </h2>

        {relevantRequests.length === 0 ? (
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-500">
            No applications or invitations for this persona yet. Switch to Persona B (Ananya Sharma — Team Leader) or Persona A (Arjun Rao) in the top bar to test pending approvals.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
            {relevantRequests.map((req) => {
              const team = teams.find((t) => t.id === req.teamId);
              const applicant = users.find((u) => u.uid === req.applicantUid);
              const hack = hackathons.find((h) => h.id === req.hackathonId);

              const canCurrentUserApprove =
                req.status === 'pending' &&
                ((req.direction === 'application' && team?.leaderId === currentUser.uid) ||
                  (req.direction === 'invitation' && req.applicantUid === currentUser.uid));

              return (
                <div
                  key={req.id}
                  className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 uppercase">
                        {req.direction === 'application' ? 'Team Application' : 'Team Invitation'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{hack?.name.split(' — ')[0]}</span>
                      <span aria-hidden="true">·</span>
                      <span>Proposed Role: {req.proposedRole}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-semibold uppercase ${
                          req.status === 'accepted'
                            ? 'text-emerald-600'
                            : req.status === 'pending'
                            ? 'text-amber-600'
                            : 'text-slate-400'
                        }`}
                      >
                        Status: {req.status}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Candidate: {applicant?.displayName ?? req.applicantUid} → Team:{' '}
                      {team?.name.split(' (')[0] ?? req.teamId}{' '}
                      {team && (
                        <span className="font-mono tabular-nums text-xs font-normal text-slate-500">
                          ({team.memberCount}/{team.targetSize} members)
                        </span>
                      )}
                    </div>

                    {req.message && (
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        “{req.message}”
                      </p>
                    )}

                    {req.resolutionNote && (
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Transaction Audit: {req.resolutionNote}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {canCurrentUserApprove ? (
                      <>
                        <button
                          onClick={() => onResolveJoinRequest(req.id, 'rejected')}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          Decline
                        </button>
                        <button
                          onClick={() => onResolveJoinRequest(req.id, 'accepted')}
                          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {req.direction === 'application'
                            ? 'Approve into Roster (Atomic)'
                            : 'Accept Invitation (Atomic)'}
                        </button>
                      </>
                    ) : req.status === 'pending' ? (
                      <span className="text-xs text-slate-400">
                        Awaiting {req.direction === 'application' ? 'Team Leader' : 'Candidate'} action
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Standardized Create / Edit Team Modal (Requirement #5 & #6) */}
      {showCreateModal && (
        <Modal
          onClose={() => {
            setShowCreateModal(false);
            setEditingTeamId(null);
          }}
          title={editingTeamId ? 'Edit Team Roles & Specializations' : 'Create a Hackathon Team'}
          subtitle="Select standard roles and add custom specializations to rank complementary candidates."
          maxWidthClass="max-w-xl"
          hasUnsavedChanges={hasUnsavedChanges}
        >
          <form onSubmit={handleSubmitTeam} className="space-y-5">
            {!editingTeamId && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Select Hackathon
                </label>
                <select
                  value={createHackathonId}
                  onChange={(e) => {
                    setCreateHackathonId(e.target.value);
                    const found = hackathons.find((h) => h.id === e.target.value);
                    if (found?.maxTeamSize) setTargetSize(found.maxTeamSize);
                  }}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  {hackathons.filter((h) => h.matchable).map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} (
                      {h.minTeamSize && h.maxTeamSize
                        ? `${h.minTeamSize}–${h.maxTeamSize} members`
                        : 'Constraints Unconfirmed'}
                      )
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!editingTeamId && isCreateEventUnconfirmed ? (
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <span className="font-bold block">
                    Team Size Bounds Not Yet Confirmed
                  </span>
                  This event has <code className="font-mono">minTeamSize = null</code> and{' '}
                  <code className="font-mono">maxTeamSize = null</code>. We never guess numeric capacity limits; an organizer or admin must verify the event's team size in the Review Queue before fixed-capacity rosters can be locked.
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className={editingTeamId ? 'sm:col-span-3' : 'sm:col-span-2'}>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Team Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="e.g., SignalForge PES"
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  {!editingTeamId && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Target Size ({selectedHackathonForCreate.minTeamSize}–{selectedHackathonForCreate.maxTeamSize})
                      </label>
                      <input
                        type="number"
                        min={selectedHackathonForCreate.minTeamSize ?? 2}
                        max={selectedHackathonForCreate.maxTeamSize ?? 4}
                        value={targetSize}
                        onChange={(e) =>
                          setTargetSize(
                            Math.min(
                              selectedHackathonForCreate.maxTeamSize ?? 4,
                              Math.max(
                                selectedHackathonForCreate.minTeamSize ?? 2,
                                Number(e.target.value)
                              )
                            )
                          )
                        }
                        className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Team Pitch & What You Are Building *
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={teamPitch}
                    onChange={(e) => setTeamPitch(e.target.value)}
                    placeholder="Summarize your problem statement and current progress..."
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>

                {/* Complementary Roles Needed */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Complementary Roles Needed
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLE_TAXONOMY.map((role) => {
                      const selected = rolesNeeded.includes(role);
                      return (
                        <button
                          key={role}
                          type="button"
                          onClick={() =>
                            setRolesNeeded(
                              selected
                                ? rolesNeeded.filter((r) => r !== role)
                                : [...rolesNeeded, role]
                            )
                          }
                          className={`px-2.5 py-1 text-xs rounded-md border cursor-pointer transition-colors ${
                            selected
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

                {/* Custom Specializations Input (Requirement #5) */}
                <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Other specializations we're looking for
                    </label>
                    <span className="text-[11px] text-slate-400">
                      Press Enter or comma (,) to add chip
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg space-y-2">
                    {customSpecializations.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {customSpecializations.map((spec) => (
                          <span
                            key={spec}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-indigo-600 text-white rounded-md"
                          >
                            <span>{spec}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveSpecialization(spec)}
                              aria-label={`Remove ${spec}`}
                              className="hover:text-indigo-200 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <input
                      type="text"
                      value={specInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.includes(',')) {
                          commitSpecializationTokens(val);
                          setSpecInput('');
                        } else {
                          setSpecInput(val);
                        }
                      }}
                      onKeyDown={handleSpecKeyDown}
                      placeholder='e.g. "ROS2", "Verilog", "Figma", "Smart Contracts", "RAG", "Pitch Deck"...'
                      className="w-full px-2 py-1 text-xs bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none"
                    />
                  </div>

                  {/* Quick-add common custom specialization chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-slate-400 inline-flex items-center gap-1 mr-1">
                      <Sparkles className="w-3 h-3 text-indigo-500" />
                      Quick add:
                    </span>
                    {SUGGESTED_CUSTOM_SPECIALIZATIONS.map((suggestion) => {
                      const alreadyAdded = customSpecializations.some(
                        (s) => s.toLowerCase() === suggestion.toLowerCase()
                      );
                      return (
                        <button
                          key={suggestion}
                          type="button"
                          disabled={alreadyAdded}
                          onClick={() => commitSpecializationTokens(suggestion)}
                          className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                            alreadyAdded
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-800 cursor-default'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400 cursor-pointer'
                          }`}
                        >
                          + {suggestion}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                  >
                    {editingTeamId ? 'Save Team Changes' : 'Create Compliant Team'}
                  </button>
                </div>
              </>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
};
