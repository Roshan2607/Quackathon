import React from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  GitMerge,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  AuditLog,
  EventCandidate,
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
  onApproveCandidate: (candidateId: string) => void;
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
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="pb-6 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Staged Event Ingestion Pipeline · Provenance, Duplicate Merge & Source Diff Verification
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Admin Event Review & Trust Moderation Queue
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-3xl">
            Per Invariant 8: An ingested or student-submitted event is never public until approved. Source changes to dates, venues, deadlines, or team sizes stay staged as diffs until verified here.
          </p>
        </div>

        <div className="text-xs text-slate-500 font-mono shrink-0">
          Operator: {currentUser.displayName} {currentUser.isAdmin ? '(Admin Verified)' : '(Viewing in Demo Mode)'}
        </div>
      </div>

      {/* Staged Event Candidates Queue */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Staged Event Candidates ({candidates.length})
        </h2>

        <div className="grid grid-cols-1 gap-4">
          {candidates.map((cand) => {
            const duplicateTarget = cand.duplicateOfHackathonId
              ? hackathons.find((h) => h.id === cand.duplicateOfHackathonId)
              : undefined;
            const diffTarget = cand.updatesExistingHackathonId
              ? hackathons.find((h) => h.id === cand.updatesExistingHackathonId)
              : undefined;

            return (
              <div
                key={cand.id}
                className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    {/* Metadata line */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono uppercase font-semibold text-slate-800 dark:text-slate-200">
                        Status: {cand.reviewStatus}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Source: {cand.source}</span>
                      <span aria-hidden="true">·</span>
                      <span>Classified Type: {cand.eventType.toUpperCase()}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          cand.matchable
                            ? 'text-emerald-600 font-semibold'
                            : 'text-amber-600 font-semibold'
                        }
                      >
                        Matchable: {cand.matchable ? 'YES' : 'NO (Workshop / Talk / Solo)'}
                      </span>
                    </div>

                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {cand.title}
                    </h3>

                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {cand.description}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
                      <div>
                        <span className="text-slate-400 block">Proposed Team Size</span>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {cand.teamSize.min !== null && cand.teamSize.max !== null
                            ? `${cand.teamSize.min}–${cand.teamSize.max} members`
                            : 'Not yet confirmed (null)'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Proposed Dates & Campus</span>
                        <span className="font-mono text-slate-800 dark:text-slate-200">
                          {cand.startAt ? cand.startAt.slice(0, 10) : 'Unknown'} ·{' '}
                          {cand.venue.campus ?? 'Unknown Campus'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Fingerprint</span>
                        <span className="font-mono text-[11px] text-slate-500 break-all">
                          {cand.externalFingerprint}
                        </span>
                      </div>
                    </div>

                    {/* Proposed Before/After Diffs (Acceptance Criterion #4) */}
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
                      <div className="space-y-1 pt-1">
                        {cand.warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Reviewer Actions */}
                  {cand.reviewStatus === 'new' || cand.reviewStatus === 'needs_confirmation' ? (
                    <div className="flex flex-wrap lg:flex-col items-stretch gap-2 shrink-0">
                      {duplicateTarget ? (
                        <button
                          onClick={() =>
                            onMergeDuplicateCandidate(cand.id, duplicateTarget.id)
                          }
                          className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <GitMerge className="w-3.5 h-3.5" />
                          Merge Provenance into Live Event
                        </button>
                      ) : diffTarget ? (
                        <button
                          onClick={() => onApplyDiffCandidate(cand.id, diffTarget.id)}
                          className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Verify & Apply Source Diff
                        </button>
                      ) : (
                        <button
                          onClick={() => onApproveCandidate(cand.id)}
                          className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Approve & Publish to Catalog
                        </button>
                      )}

                      <button
                        onClick={() => onRejectCandidate(cand.id)}
                        className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        Reject Candidate
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs font-mono uppercase text-slate-400">
                      Resolved ({cand.reviewStatus})
                    </span>
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
