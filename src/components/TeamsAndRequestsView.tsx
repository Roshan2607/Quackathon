import React, { useState } from 'react';
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
import {
  Users,
  Plus,
  Lock,
  Check,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Modal } from './Modal';

interface TeamsAndRequestsViewProps {
  currentUser: User;
  hackathons: Hackathon[];
  teams: Team[];
  memberships: Membership[];
  joinRequests: JoinRequest[];
  users: User[];
  onCreateTeam: (params: {
    hackathonId: string;
    name: string;
    pitch: string;
    projectIdea: string;
    rolesNeeded: string[];
    customSpecializations: string[];
    targetSize: number;
  }) => void;
  onResolveJoinRequest: (
    requestId: string,
    decision: 'accept' | 'reject'
  ) => void;
  onSimulateConcurrentLastSlotRace: () => void;
  onSimulateDoubleTeamAttempt: () => void;
}

export const TeamsAndRequestsView: React.FC<TeamsAndRequestsViewProps> = React.memo(
  ({
    currentUser,
    hackathons,
    teams,
    memberships,
    joinRequests,
    users,
    onCreateTeam,
    onResolveJoinRequest,
    onSimulateConcurrentLastSlotRace,
    onSimulateDoubleTeamAttempt,
  }) => {
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showAdvancedLab, setShowAdvancedLab] = useState(false);

    const matchableHackathons = hackathons.filter((h) => h.matchable);
    const [selectedHackathonId, setSelectedHackathonId] = useState(
      matchableHackathons[0]?.id || 'hack_terrapthon_26'
    );
    const [teamName, setTeamName] = useState('');
    const [pitch, setPitch] = useState('');
    const [projectIdea, setProjectIdea] = useState('');
    const [rolesNeeded, setRolesNeeded] = useState<string[]>([
      'Frontend',
      'Backend',
    ]);
    const [customSpecializations, setCustomSpecializations] = useState<
      string[]
    >([]);
    const [customSpecInput, setCustomSpecInput] = useState('');
    const [targetSize, setTargetSize] = useState<number>(4);

    // Active teams where currentUser is a member
    const myMemberships = memberships.filter(
      (m) => m.uid === currentUser.uid && m.status === 'active'
    );
    const myTeamIds = new Set(myMemberships.map((m) => m.teamId));
    const myTeams = teams.filter(
      (t) => myTeamIds.has(t.id) || t.leaderId === currentUser.uid
    );

    // Join requests relevant to currentUser (either leader of the team or the applicant)
    const relevantRequests = joinRequests.filter((req) => {
      const team = teams.find((t) => t.id === req.teamId);
      if (!team) return false;
      return (
        team.leaderId === currentUser.uid ||
        req.applicantUid === currentUser.uid
      );
    });

    const pendingRequests = relevantRequests.filter(
      (r) => r.status === 'pending'
    );
    const resolvedRequests = relevantRequests.filter(
      (r) => r.status !== 'pending'
    );

    const toggleRole = (role: string) => {
      if (rolesNeeded.includes(role)) {
        setRolesNeeded(rolesNeeded.filter((r) => r !== role));
      } else {
        setRolesNeeded([...rolesNeeded, role]);
      }
    };

    const toggleSpec = (spec: string) => {
      if (customSpecializations.includes(spec)) {
        setCustomSpecializations(
          customSpecializations.filter((s) => s !== spec)
        );
      } else {
        setCustomSpecializations([...customSpecializations, spec]);
      }
    };

    const handleAddCustomSpec = () => {
      const trimmed = customSpecInput.trim();
      if (trimmed && !customSpecializations.includes(trimmed)) {
        setCustomSpecializations([...customSpecializations, trimmed]);
        setCustomSpecInput('');
      }
    };

    const handleSubmitTeam = (e: React.FormEvent) => {
      e.preventDefault();
      if (!teamName.trim() || !pitch.trim()) return;
      onCreateTeam({
        hackathonId: selectedHackathonId,
        name: teamName.trim(),
        pitch: pitch.trim(),
        projectIdea: projectIdea.trim(),
        rolesNeeded,
        customSpecializations,
        targetSize,
      });
      setTeamName('');
      setPitch('');
      setProjectIdea('');
      setCustomSpecializations([]);
      setShowCreateModal(false);
    };

    return (
      <div className="space-y-4">
        {/* Top Action Bar */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              My Teams
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Manage your hackathon rosters, applications, and invitations.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Team
          </button>
        </div>

        {/* Main Two-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left 2 Columns: Active Teams */}
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 px-1">
              Active Rosters ({myTeams.length})
            </h3>

            {myTeams.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2.5">
                <Users className="w-7 h-7 text-slate-400 mx-auto" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  You aren&apos;t in any teams yet
                </p>
                <p className="text-xs text-slate-500">
                  Create a team or apply to an open team in Discover.
                </p>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create a Team
                </button>
              </div>
            ) : (
              myTeams.map((team) => {
                const hackathon = hackathons.find(
                  (h) => h.id === team.hackathonId
                );
                const rosterMembers = memberships.filter(
                  (m) => m.teamId === team.id && m.status === 'active'
                );
                const openSlots = Math.max(
                  0,
                  team.targetSize - team.memberCount
                );

                return (
                  <div
                    key={team.id}
                    className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {hackathon?.name ?? team.hackathonId}
                        </span>
                        <h4 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                          {team.name}
                        </h4>
                      </div>

                      {team.status === 'full' || openSlots === 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-400 font-mono tabular-nums shrink-0">
                          <Lock className="w-3.5 h-3.5" /> Full ({team.memberCount}/
                          {team.targetSize})
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums shrink-0">
                          {openSlots} {openSlots === 1 ? 'slot' : 'slots'} open (
                          {team.memberCount}/{team.targetSize})
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {team.pitch}
                    </p>

                    {/* Roster Members */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="text-xs font-semibold text-slate-500 mb-2">
                        Members
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {rosterMembers.map((m) => {
                          const u = users.find((user) => user.uid === m.uid);
                          return (
                            <div
                              key={m.id}
                              className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                  {(u?.displayName ?? m.uid).replace(
                                    ' (Synthetic Demo)',
                                    ''
                                  )}
                                  {team.leaderId === m.uid && (
                                    <span className="ml-1 text-[11px] font-normal text-blue-600 dark:text-blue-400">
                                      (Lead)
                                    </span>
                                  )}
                                </div>
                                <div className="text-slate-500">{m.role}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {team.rolesNeeded.length > 0 && openSlots > 0 && (
                      <div className="text-xs text-slate-600 dark:text-slate-400 pt-1">
                        <strong className="text-slate-800 dark:text-slate-200">
                          Looking for:
                        </strong>{' '}
                        {team.rolesNeeded.join(' · ')}
                        {team.customSpecializations &&
                          team.customSpecializations.length > 0 && (
                            <span className="text-slate-500">
                              {' '}
                              ({team.customSpecializations.join(' · ')})
                            </span>
                          )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Right Column: Pending Requests & Invitations */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 px-1">
              Pending Requests ({pendingRequests.length})
            </h3>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              {pendingRequests.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  No pending requests right now.
                </p>
              ) : (
                pendingRequests.map((req) => {
                  const team = teams.find((t) => t.id === req.teamId);
                  const applicant = users.find(
                    (u) => u.uid === req.applicantUid
                  );
                  const canDecide =
                    (req.direction === 'application' &&
                      team?.leaderId === currentUser.uid) ||
                    (req.direction === 'invitation' &&
                      req.applicantUid === currentUser.uid);

                  return (
                    <div
                      key={req.id}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2 text-xs"
                    >
                      <div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {req.direction === 'application'
                            ? `${(
                                applicant?.displayName ?? req.applicantUid
                              ).replace(' (Synthetic Demo)', '')} → ${
                                team?.name.split(' (')[0]
                              }`
                            : `${team?.name.split(' (')[0]} invited ${(
                                applicant?.displayName ?? 'You'
                              ).replace(' (Synthetic Demo)', '')}`}
                        </div>
                        <div className="text-slate-500">
                          Role: {req.proposedRole}
                        </div>
                      </div>

                      {req.message && (
                        <p className="text-slate-600 dark:text-slate-300 italic">
                          &ldquo;{req.message}&rdquo;
                        </p>
                      )}

                      {canDecide ? (
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              onResolveJoinRequest(req.id, 'accept')
                            }
                            className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onResolveJoinRequest(req.id, 'reject')
                            }
                            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-slate-400">
                          Awaiting response
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {resolvedRequests.length > 0 && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
                  <div className="text-[11px] font-semibold text-slate-400">
                    Recent Decisions
                  </div>
                  {resolvedRequests.slice(0, 4).map((req) => {
                    const team = teams.find((t) => t.id === req.teamId);
                    const applicant = users.find(
                      (u) => u.uid === req.applicantUid
                    );
                    return (
                      <div
                        key={req.id}
                        className="flex items-center justify-between text-slate-600 dark:text-slate-400 py-0.5"
                      >
                        <span className="truncate">
                          {(
                            applicant?.displayName ?? req.applicantUid
                          ).replace(' (Synthetic Demo)', '')}{' '}
                          · {team?.name.split(' (')[0]}
                        </span>
                        <span className="text-[11px] font-semibold capitalize shrink-0">
                          {req.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible Roster Safeguards Section */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvancedLab(!showAdvancedLab)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-500 hover:bg-slate-50 cursor-pointer"
          >
            <span>Advanced: Roster Capacity & Concurrency Checks</span>
            {showAdvancedLab ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showAdvancedLab && (
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <p className="text-slate-600 dark:text-slate-400">
                Verify that simultaneous accepts on the last open slot never exceed team capacity and that students cannot join two teams in the same hackathon.
              </p>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onSimulateConcurrentLastSlotRace}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Test Last-Slot Race
                </button>
                <button
                  type="button"
                  onClick={onSimulateDoubleTeamAttempt}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Test Duplicate Membership Guard
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Create Team Modal */}
        {showCreateModal && (
          <Modal
            title="Create a New Team"
            subtitle="Recruit teammates for an upcoming hackathon."
            onClose={() => setShowCreateModal(false)}
            maxWidthClass="max-w-lg"
          >
            <form onSubmit={handleSubmitTeam} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Hackathon
                  </label>
                  <select
                    value={selectedHackathonId}
                    onChange={(e) => setSelectedHackathonId(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {matchableHackathons.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Target Team Size
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
                  Team Name *
                </label>
                <input
                  type="text"
                  required
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="e.g., GridPulse Telemetry"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pitch / What You Are Building *
                </label>
                <textarea
                  rows={2}
                  required
                  value={pitch}
                  onChange={(e) => setPitch(e.target.value)}
                  placeholder="Describe your idea and what teammates will work on..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Roles Needed
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_TAXONOMY.map((role) => {
                    const active = rolesNeeded.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => toggleRole(role)}
                        className={`px-2.5 py-1 rounded-lg font-medium border whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-900 text-slate-600 border-slate-200'
                        }`}
                      >
                        {role}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Specializations (Optional)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {SUGGESTED_CUSTOM_SPECIALIZATIONS.map((spec) => {
                    const active = customSpecializations.includes(spec);
                    return (
                      <button
                        key={spec}
                        type="button"
                        onClick={() => toggleSpec(spec)}
                        className={`px-2.5 py-1 rounded-lg font-medium border whitespace-nowrap shrink-0 cursor-pointer ${
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
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customSpecInput}
                    onChange={(e) => setCustomSpecInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' &&
                      (e.preventDefault(), handleAddCustomSpec())
                    }
                    placeholder="Add custom specialization..."
                    className="flex-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomSpec}
                    className="px-3 py-1 rounded bg-slate-100 text-slate-700 font-medium cursor-pointer"
                  >
                    Add
                  </button>
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
