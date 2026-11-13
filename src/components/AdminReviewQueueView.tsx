import React, { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  FileText,
  GitMerge,
  Link2Off,
  MapPin,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  AuditLog,
  CampusType,
  EventCandidate,
  EventType,
  Hackathon,
  ReportRecord,
  User,
} from '../types/domain';

interface AdminReviewQueueViewProps {
  currentUser: User;
  candidates: EventCandidate[];
  hackathons: Hackathon[];
  reports: ReportRecord[];
  auditLogs: AuditLog[];
  onApproveCandidate: (candidateId: string, overrides?: Partial<EventCandidate>) => void;
  onRejectCandidate: (candidateId: string) => void;
  onMergeDuplicateCandidate: (candidateId: string, targetHackathonId: string) => void;
  onApplyDiffCandidate: (candidateId: string, targetHackathonId: string) => void;
  onResolveReport: (reportId: string, resolution: 'resolved_dismissed' | 'resolved_actioned') => void;
}

export const AdminReviewQueueView: React.FC<AdminReviewQueueViewProps> = ({
  currentUser,
  candidates,
  hackathons,
  reports,
  auditLogs,
  onApproveCandidate,
  onRejectCandidate,
  onMergeDuplicateCandidate,
  onApplyDiffCandidate,
  onResolveReport,
}) => {
  // Track which candidate is currently being edited inline before approval
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<EventCandidate> | null>(null);
  const [expandedDiagnosticsIds, setExpandedDiagnosticsIds] = useState<Record<string, boolean>>({});

  const startEditingCandidate = (cand: EventCandidate) => {
    setEditingCandidateId(cand.id);
    setEditDraft({
      title: cand.title,
      description: cand.description,
      organizer: cand.organizer,
      eventType: cand.eventType,
      matchable: cand.matchable,
      startAt: cand.startAt,
      endAt: cand.endAt,
      registrationDeadline: cand.registrationDeadline,
      venue: { ...cand.venue },
      teamSize: { ...cand.teamSize },
      verifiedCanonicalUrl: cand.verifiedCanonicalUrl ?? null,
      registrationUrl: cand.registrationUrl ?? null,
      eligibilityNotes: cand.eligibilityNotes ?? null,
      themes: [...cand.themes],
    });
  };

  const toggleDiagnostics = (id: string) => {
    setExpandedDiagnosticsIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="pb-6 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Event Moderation & Field Verification
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Admin Event Review Queue
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-3xl">
            Review submitted or ingested events, edit extracted fields if needed, and approve them into the live hackathon directory.
          </p>
        </div>

        <div className="text-xs text-slate-500 font-mono shrink-0">
          Reviewer: {currentUser.displayName} {currentUser.isAdmin ? '(Admin Verified)' : '(Demo Mode)'}
        </div>
      </div>

      {/* Staged Event Candidates Queue */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Staged Event Submissions ({candidates.length})
        </h2>

        <div className="grid grid-cols-1 gap-4">
          {candidates.map((cand) => {
            const duplicateTarget = cand.duplicateOfHackathonId
              ? hackathons.find((h) => h.id === cand.duplicateOfHackathonId)
              : undefined;
            const diffTarget = cand.updatesExistingHackathonId
              ? hackathons.find((h) => h.id === cand.updatesExistingHackathonId)
              : undefined;

            const isEditing = editingCandidateId === cand.id && editDraft !== null;
            const isDiagnosticsOpen = Boolean(expandedDiagnosticsIds[cand.id]);

            const statusBadgeStyles =
              cand.reviewStatus === 'approved'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : cand.reviewStatus === 'rejected' || cand.reviewStatus === 'superseded'
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800';

            return (
              <div
                key={cand.id}
                className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4"
              >
                {/* Prominent Core Summary Row (Requirement #7: Event title, date, venue, team size, source, approval status) */}
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
                  <div className="space-y-3 flex-1">
                    {/* Approval Status + Category + Source Pill Row */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`px-2.5 py-0.5 font-semibold uppercase rounded-md border ${statusBadgeStyles}`}
                      >
                        {cand.reviewStatus.replace('_', ' ')}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 font-semibold rounded-md ${
                          cand.matchable
                            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {cand.eventType.toUpperCase()} · {cand.matchable ? 'Team Matchable' : 'Non-Team Event'}
                      </span>
                      {cand.organizer && (
                        <span className="text-slate-500 dark:text-slate-400">
                          by <strong className="text-slate-700 dark:text-slate-200">{cand.organizer}</strong>
                        </span>
                      )}
                    </div>

                    {/* Title & Description */}
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {cand.title}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                        {cand.description}
                      </p>
                    </div>

                    {/* 4 Key Operational Fields Grid: Date, Venue, Team Size, Source Link */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 rounded-lg text-xs">
                      <div className="space-y-0.5">
                        <span className="text-slate-400 font-medium inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" /> Event Date & Deadline
                        </span>
                        <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {cand.startAt ? cand.startAt.slice(0, 10) : 'Unknown Date'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Reg Deadline: {cand.registrationDeadline ? cand.registrationDeadline.slice(0, 10) : 'Unknown'}
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-slate-400 font-medium inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" /> Venue & Campus
                        </span>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {cand.venue.campus ?? 'Campus Unspecified'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {cand.venue.name ?? 'Room / hall unknown'}
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-slate-400 font-medium inline-flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" /> Team Size Bounds
                        </span>
                        <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {cand.teamSize.min !== null && cand.teamSize.max !== null
                            ? `${cand.teamSize.min}–${cand.teamSize.max} members`
                            : 'Not confirmed (null)'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {cand.eligibilityNotes ?? 'Eligibility not specified'}
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-slate-400 font-medium block">
                          Source & Verification
                        </span>
                        {cand.verifiedCanonicalUrl ? (
                          <a
                            href={cand.verifiedCanonicalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-1 break-all"
                          >
                            Verified Event Page
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        ) : cand.uploadedAttachment ? (
                          <span className="text-slate-700 dark:text-slate-300 font-medium inline-flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            {cand.uploadedAttachment.fileName}
                          </span>
                        ) : (
                          <span className="text-slate-500 inline-flex items-center gap-1">
                            <Link2Off className="w-3.5 h-3.5 shrink-0" />
                            Source unavailable
                          </span>
                        )}
                        <div className="text-[11px] text-slate-500">
                          Channel: {cand.source} ({cand.sourceUrlStatus ?? 'unavailable'})
                        </div>
                      </div>
                    </div>

                    {/* Proposed Before/After Diffs */}
                    {cand.proposedDiffs && cand.proposedDiffs.length > 0 && (
                      <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg space-y-2 text-xs">
                        <div className="font-bold text-amber-900 dark:text-amber-200">
                          Source Update Diff Detected for {diffTarget?.name ?? cand.updatesExistingHackathonId}
                        </div>
                        {cand.proposedDiffs.map((d, i) => (
                          <div key={i} className="space-y-0.5 font-mono">
                            <div className="text-slate-700 dark:text-slate-300">
                              <span className="font-bold">{d.field}:</span>{' '}
                              <span className="line-through text-red-600">{d.previousVerifiedValue}</span>{' '}
                              → <span className="text-emerald-700 dark:text-emerald-400 font-bold">{d.newProposedValue}</span>
                            </div>
                            <div className="font-sans text-slate-500">Evidence: “{d.evidenceExcerpt}”</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Warnings */}
                    {cand.warnings.length > 0 && (
                      <div className="space-y-1">
                        {cand.warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Reviewer Primary Actions */}
                  {cand.reviewStatus === 'new' || cand.reviewStatus === 'needs_confirmation' ? (
                    <div className="flex flex-wrap lg:flex-col items-stretch gap-2 shrink-0 min-w-[210px]">
                      {duplicateTarget ? (
                        <button
                          onClick={() =>
                            onMergeDuplicateCandidate(cand.id, duplicateTarget.id)
                          }
                          className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <GitMerge className="w-3.5 h-3.5" />
                          Merge into Live Event
                        </button>
                      ) : diffTarget ? (
                        <button
                          onClick={() => onApplyDiffCandidate(cand.id, diffTarget.id)}
                          className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Verify & Apply Diff
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            onApproveCandidate(
                              cand.id,
                              isEditing && editDraft ? editDraft : undefined
                            )
                          }
                          className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {isEditing ? 'Save Edits & Approve' : 'Approve & Publish'}
                        </button>
                      )}

                      {!duplicateTarget && !diffTarget && (
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditing) {
                              setEditingCandidateId(null);
                              setEditDraft(null);
                            } else {
                              startEditingCandidate(cand);
                            }
                          }}
                          className="px-3.5 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          {isEditing ? 'Cancel Field Edits' : 'Edit Fields Before Approval'}
                        </button>
                      )}

                      <button
                        onClick={() => onRejectCandidate(cand.id)}
                        className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        Reject Submission
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs font-mono uppercase text-slate-400">
                      Resolved ({cand.reviewStatus})
                    </span>
                  )}
                </div>

                {/* Inline Field Editor for Admins Before Approving (Requirement #7) */}
                {isEditing && editDraft && (
                  <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-xl space-y-4 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        Edit / Correct Extracted Event Fields Before Publishing
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Leave unknown dates or team sizes blank (`null`)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Event Title
                        </label>
                        <input
                          type="text"
                          value={editDraft.title ?? ''}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, title: e.target.value })
                          }
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Organizer
                        </label>
                        <input
                          type="text"
                          value={editDraft.organizer ?? ''}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, organizer: e.target.value })
                          }
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Event Category
                        </label>
                        <select
                          value={editDraft.eventType ?? 'hackathon'}
                          onChange={(e) => {
                            const cat = e.target.value as EventType;
                            setEditDraft({
                              ...editDraft,
                              eventType: cat,
                              matchable:
                                cat === 'hackathon' ||
                                cat === 'ideathon' ||
                                cat === 'buildathon' ||
                                cat === 'team_competition',
                            });
                          }}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        >
                          <option value="hackathon">Hackathon (Team Matchable)</option>
                          <option value="buildathon">Buildathon (Team Matchable)</option>
                          <option value="ideathon">Ideathon (Team Matchable)</option>
                          <option value="ctf">CTF</option>
                          <option value="workshop">Workshop (Non-Matchable)</option>
                          <option value="tech_talk">Tech Talk (Non-Matchable)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Campus
                        </label>
                        <select
                          value={editDraft.venue?.campus ?? 'RR Campus'}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              venue: {
                                name: editDraft.venue?.name ?? null,
                                campus: e.target.value as CampusType,
                              },
                            })
                          }
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        >
                          <option value="RR Campus">RR Campus</option>
                          <option value="EC Campus">EC Campus</option>
                          <option value="Online / Multi-Campus">Online / Multi-Campus</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Venue Hall / Room
                        </label>
                        <input
                          type="text"
                          value={editDraft.venue?.name ?? ''}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              venue: {
                                campus: editDraft.venue?.campus ?? 'RR Campus',
                                name: e.target.value.trim() || null,
                              },
                            })
                          }
                          placeholder="Unknown if blank"
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Start Date (ISO or YYYY-MM-DD)
                        </label>
                        <input
                          type="text"
                          value={editDraft.startAt ?? ''}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              startAt: e.target.value.trim() || null,
                            })
                          }
                          placeholder="e.g. 2026-04-18"
                          className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Min Team Size
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={editDraft.teamSize?.min ?? ''}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              teamSize: {
                                min: e.target.value ? Number(e.target.value) : null,
                                max: editDraft.teamSize?.max ?? null,
                              },
                            })
                          }
                          placeholder="null"
                          className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Max Team Size
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={editDraft.teamSize?.max ?? ''}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              teamSize: {
                                min: editDraft.teamSize?.min ?? null,
                                max: e.target.value ? Number(e.target.value) : null,
                              },
                            })
                          }
                          placeholder="null"
                          className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Verified Canonical Event URL
                        </label>
                        <input
                          type="url"
                          value={editDraft.verifiedCanonicalUrl ?? ''}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              verifiedCanonicalUrl: e.target.value.trim() || null,
                              sourceUrlStatus: e.target.value.trim() ? 'verified' : 'unavailable',
                            })
                          }
                          placeholder="https://events.pes.edu/... or leave empty if unavailable"
                          className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Registration URL
                        </label>
                        <input
                          type="url"
                          value={editDraft.registrationUrl ?? ''}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              registrationUrl: e.target.value.trim() || null,
                            })
                          }
                          placeholder="Optional registration link"
                          className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Expandable Technical Diagnostics, Fingerprints, Classification Scores & Raw Provenance (Requirement #7) */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => toggleDiagnostics(cand.id)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {isDiagnosticsOpen ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                    {isDiagnosticsOpen
                      ? 'Hide Technical Diagnostics, Fingerprints & Raw Provenance'
                      : 'Show Technical Diagnostics, Fingerprints & Raw Provenance'}
                  </button>

                  {isDiagnosticsOpen && (
                    <div className="mt-3 p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2 text-xs font-mono">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <span className="text-slate-400">Deduplication Fingerprint: </span>
                          <span className="text-slate-700 dark:text-slate-300 break-all">
                            {cand.externalFingerprint}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400">Classifier Gate & Confidence: </span>
                          <span className="text-slate-700 dark:text-slate-300">
                            ruleGate={String(cand.classification.ruleGatePassed)} · score=
                            {Math.round(cand.classification.mlScore * 100)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400">Original Submission URL: </span>
                          <span className="text-slate-700 dark:text-slate-300 break-all">
                            {cand.originalSubmissionUrl ?? cand.sourceUrl ?? 'null'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400">Verified Canonical URL: </span>
                          <span className="text-slate-700 dark:text-slate-300 break-all">
                            {cand.verifiedCanonicalUrl ?? 'null'} ({cand.sourceUrlStatus ?? 'unavailable'})
                          </span>
                        </div>
                      </div>
                      <div className="font-sans text-slate-600 dark:text-slate-400">
                        <span className="font-semibold">Classification Rationale: </span>
                        {cand.classification.reason}
                      </div>
                      <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-[11px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                        {JSON.stringify(cand.fieldEvidence, null, 2)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Safety Reports & Operator Audit Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Trust & Safety Reports ({reports.length})
          </h3>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {reports.map((rep) => (
              <div key={rep.id} className="py-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    Target: {rep.targetLabel} ({rep.targetType})
                  </span>
                  <span className="font-mono uppercase text-slate-500">{rep.status}</span>
                </div>
                <p className="text-slate-600 dark:text-slate-300">Reason: {rep.reason}</p>
                {rep.status === 'open' && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => onResolveReport(rep.id, 'resolved_actioned')}
                      className="px-2.5 py-1 bg-red-600 text-white font-semibold rounded-md cursor-pointer"
                    >
                      Action & Restrict
                    </button>
                    <button
                      onClick={() => onResolveReport(rep.id, 'resolved_dismissed')}
                      className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Operator & Transaction Audit Log
          </h3>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-64 overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="py-2.5 text-xs space-y-0.5">
                <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {log.action}
                  </span>
                  <span>{log.createdAt.slice(0, 19).replace('T', ' ')}</span>
                </div>
                <p className="text-slate-600 dark:text-slate-300">{log.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
