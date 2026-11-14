import React, { useState } from 'react';
import {
  AuditLog,
  CampusType,
  EventCandidate,
  EventSourceType,
  EventType,
  ExecutionMode,
  Hackathon,
  ReportRecord,
  User,
} from '../types/domain';
import { VerifyUrlResponse } from '../types/apiContracts';
import {
  CheckCircle2,
  XCircle,
  Edit3,
  GitMerge,
  Globe,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
} from 'lucide-react';
import { verifyLiveEventUrl } from '../services/adapters';

interface AdminReviewQueueViewProps {
  currentUser: User;
  executionMode: ExecutionMode;
  candidates: EventCandidate[];
  hackathons: Hackathon[];
  reports: ReportRecord[];
  auditLogs: AuditLog[];
  onApproveCandidate: (
    candidateId: string,
    overrides?: {
      minTeamSize: number | null;
      maxTeamSize: number | null;
      eventType: EventType;
      matchable: boolean;
      campus: CampusType | null;
    }
  ) => void;
  onRejectCandidate: (candidateId: string) => void;
  onMergeDuplicateCandidate: (candidateId: string) => void;
  onApplySourceDiffCandidate: (candidateId: string) => void;
  onResolveReport: (
    reportId: string,
    resolution: 'resolved_dismissed' | 'resolved_actioned'
  ) => void;
  onBackToApp?: () => void;
}

export const AdminReviewQueueView: React.FC<AdminReviewQueueViewProps> = React.memo(
  ({
    candidates,
    hackathons,
    reports,
    auditLogs,
    onApproveCandidate,
    onRejectCandidate,
    onMergeDuplicateCandidate,
    onApplySourceDiffCandidate,
    onResolveReport,
    onBackToApp,
  }) => {
    const [activeSection, setActiveSection] = useState<
      'EVENTS' | 'REPORTS' | 'AUDIT'
    >('EVENTS');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [expandedDetailIds, setExpandedDetailIds] = useState<
      Record<string, boolean>
    >({});

    // Inline Edit State
    const [editMinSize, setEditMinSize] = useState<string>('2');
    const [editMaxSize, setEditMaxSize] = useState<string>('4');
    const [editEventType, setEditEventType] = useState<EventType>('hackathon');
    const [editMatchable, setEditMatchable] = useState<boolean>(true);
    const [editCampus, setEditCampus] = useState<CampusType>('RR Campus');

    // Live URL Verification State
    const [verifyingId, setVerifyingId] = useState<string | null>(null);
    const [verifyResults, setVerifyResults] = useState<
      Record<string, VerifyUrlResponse>
    >({});

    const toggleDetails = (id: string) => {
      setExpandedDetailIds((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    const startEditing = (cand: EventCandidate) => {
      setEditingId(cand.id);
      setEditMinSize(
        cand.teamSize.min !== null ? String(cand.teamSize.min) : ''
      );
      setEditMaxSize(
        cand.teamSize.max !== null ? String(cand.teamSize.max) : ''
      );
      setEditEventType(cand.eventType);
      setEditMatchable(cand.matchable);
      setEditCampus(cand.venue.campus ?? 'RR Campus');
    };

    const handleSaveAndApprove = (candId: string) => {
      onApproveCandidate(candId, {
        minTeamSize: editMinSize.trim() ? Number(editMinSize) : null,
        maxTeamSize: editMaxSize.trim() ? Number(editMaxSize) : null,
        eventType: editEventType,
        matchable: editMatchable,
        campus: editCampus,
      });
      setEditingId(null);
    };

    const handleVerifyUrl = async (cand: EventCandidate) => {
      const targetUrl =
        cand.sourceUrl || cand.originalSubmissionUrl || cand.registrationUrl;
      if (!targetUrl) return;
      setVerifyingId(cand.id);
      try {
        const res = await verifyLiveEventUrl(targetUrl);
        setVerifyResults((prev) => ({ ...prev, [cand.id]: res }));
        setExpandedDetailIds((prev) => ({ ...prev, [cand.id]: true }));
      } finally {
        setVerifyingId(null);
      }
    };

    const formatSourceLabel = (source: EventSourceType) => {
      switch (source) {
        case 'pes_public_events':
          return 'PES Public Events';
        case 'approved_organizer':
          return 'Organizer Feed';
        case 'submitted_public_url':
          return 'Student Link';
        case 'uploaded_brochure_or_poster':
          return 'Poster / PDF';
        case 'academy_opt_in_hint':
          return 'Academy Hint';
        default:
          return source;
      }
    };

    const openReportsCount = reports.filter((r) => r.status === 'open').length;
    const pendingCandidatesCount = candidates.filter(
      (c) => c.reviewStatus === 'new' || c.reviewStatus === 'needs_confirmation'
    ).length;

    return (
      <div className="space-y-4">
        {/* Compact Header Bar */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {onBackToApp && (
              <button
                type="button"
                onClick={onBackToApp}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Admin Event Review
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Review event candidates, source updates, and moderation reports.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveSection('EVENTS')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                activeSection === 'EVENTS'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Event Queue ({pendingCandidatesCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('REPORTS')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                activeSection === 'REPORTS'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Reports ({openReportsCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('AUDIT')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                activeSection === 'AUDIT'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Audit Log ({auditLogs.length})
            </button>
          </div>
        </div>

        {/* Section 1: Event Candidate Rows */}
        {activeSection === 'EVENTS' && (
          <div className="space-y-2.5">
            {candidates.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center">
                <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No event candidates in queue
                </p>
              </div>
            ) : (
              candidates.map((cand) => {
                const isEditing = editingId === cand.id;
                const isExpanded = Boolean(expandedDetailIds[cand.id]);
                const duplicateHackathon = cand.duplicateOfHackathonId
                  ? hackathons.find((h) => h.id === cand.duplicateOfHackathonId)
                  : undefined;
                const verifyRes = verifyResults[cand.id];
                const isResolved =
                  cand.reviewStatus === 'approved' ||
                  cand.reviewStatus === 'rejected' ||
                  cand.reviewStatus === 'superseded';

                return (
                  <div
                    key={cand.id}
                    className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3"
                  >
                    {/* Compact Row: Event Name, Date, Source, Status + Primary Actions */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {cand.title}
                          </h3>
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded capitalize whitespace-nowrap shrink-0 ${
                              cand.reviewStatus === 'approved'
                                ? 'bg-emerald-50 text-emerald-800'
                                : cand.reviewStatus === 'rejected'
                                ? 'bg-red-50 text-red-800'
                                : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            {cand.reviewStatus.replace('_', ' ')}
                          </span>
                        </div>

                        {/* Unboxed Metadata with Middot Separators */}
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>{cand.organizer}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">
                            {cand.startAt ? cand.startAt.slice(0, 10) : 'TBA'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Source: {formatSourceLabel(cand.source)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {cand.teamSize.min && cand.teamSize.max
                              ? `${cand.teamSize.min}–${cand.teamSize.max} members`
                              : 'Size unconfirmed'}
                          </span>
                        </div>
                      </div>

                      {/* Accessible Actions */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleDetails(cand.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-600 dark:text-slate-300 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {isExpanded ? (
                            <>
                              Hide Details <ChevronUp className="w-3.5 h-3.5" />
                            </>
                          ) : (
                            <>
                              Details <ChevronDown className="w-3.5 h-3.5" />
                            </>
                          )}
                        </button>

                        {!isEditing && !isResolved && (
                          <>
                            <button
                              type="button"
                              onClick={() => startEditing(cand)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-300 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Edit
                            </button>

                            {cand.updatesExistingHackathonId ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onApplySourceDiffCandidate(cand.id)
                                }
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Approve Diff
                              </button>
                            ) : cand.duplicateOfHackathonId ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onMergeDuplicateCandidate(cand.id)
                                }
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <GitMerge className="w-3.5 h-3.5" />
                                Merge Duplicate
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onApproveCandidate(cand.id)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Approve
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => onRejectCandidate(cand.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-700 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Inline Edit Override Form */}
                    {isEditing && (
                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg space-y-3 text-xs">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Campus
                            </label>
                            <select
                              value={editCampus}
                              onChange={(e) =>
                                setEditCampus(e.target.value as CampusType)
                              }
                              className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white dark:bg-slate-950"
                            >
                              <option value="RR Campus">RR Campus</option>
                              <option value="EC Campus">EC Campus</option>
                              <option value="Online / Multi-Campus">
                                Online / Multi
                              </option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Min Team
                            </label>
                            <input
                              type="number"
                              value={editMinSize}
                              onChange={(e) => setEditMinSize(e.target.value)}
                              className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white dark:bg-slate-950"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Max Team
                            </label>
                            <input
                              type="number"
                              value={editMaxSize}
                              onChange={(e) => setEditMaxSize(e.target.value)}
                              className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white dark:bg-slate-950"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Category
                            </label>
                            <select
                              value={editEventType}
                              onChange={(e) => {
                                const val = e.target.value as EventType;
                                setEditEventType(val);
                                setEditMatchable(
                                  val === 'hackathon' ||
                                    val === 'buildathon' ||
                                    val === 'ideathon' ||
                                    val === 'ctf'
                                );
                              }}
                              className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white dark:bg-slate-950"
                            >
                              <option value="hackathon">hackathon</option>
                              <option value="buildathon">buildathon</option>
                              <option value="ideathon">ideathon</option>
                              <option value="ctf">ctf</option>
                              <option value="workshop">workshop</option>
                              <option value="tech_talk">tech_talk</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <label className="inline-flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editMatchable}
                              onChange={(e) =>
                                setEditMatchable(e.target.checked)
                              }
                            />
                            Enable Team Matching in Discover
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1 rounded border border-slate-300 bg-white text-slate-700 cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveAndApprove(cand.id)}
                              className="px-3.5 py-1 rounded bg-emerald-600 text-white font-semibold cursor-pointer"
                            >
                              Save & Approve
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Expandable Details Section: Raw Extraction Data, Fingerprints, Confidence, Diagnostics & Provenance */}
                    {isExpanded && (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3 text-xs text-slate-600 dark:text-slate-300">
                        <p className="leading-relaxed">{cand.description}</p>

                        {cand.proposedDiffs && cand.proposedDiffs.length > 0 && (
                          <div className="p-3 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 space-y-1.5">
                            <div className="font-semibold text-amber-900 dark:text-amber-200">
                              Proposed Source Diffs
                            </div>
                            {cand.proposedDiffs.map((d, idx) => (
                              <div key={idx} className="text-[11px]">
                                <strong>{d.field}:</strong>{' '}
                                <span className="line-through text-slate-400">
                                  {d.previousVerifiedValue}
                                </span>{' '}
                                →{' '}
                                <span className="font-semibold text-emerald-700">
                                  {d.newProposedValue}
                                </span>{' '}
                                <span className="text-slate-500">
                                  ({d.evidenceExcerpt})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-[11px]">
                          <div>
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              Classifier & Confidence
                            </div>
                            <div className="mt-0.5">
                              Type: {cand.eventType} · Matchable:{' '}
                              {cand.matchable ? 'Yes' : 'No'}
                            </div>
                            <div>
                              Confidence:{' '}
                              {Math.round(cand.classification.mlScore * 100)}% (
                              {cand.classification.ruleGatePassed
                                ? 'Rule Gate Passed'
                                : 'Rule Gate Blocked'}
                              )
                            </div>
                            <div className="text-slate-500 mt-0.5">
                              {cand.classification.reason}
                            </div>
                          </div>

                          <div>
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              Fingerprint & Provenance
                            </div>
                            <div className="font-mono text-slate-600 dark:text-slate-400 break-all mt-0.5">
                              {cand.externalFingerprint}
                            </div>
                            {duplicateHackathon && (
                              <div className="text-amber-700 mt-1">
                                Matches: {duplicateHackathon.name}
                              </div>
                            )}
                            {cand.uploadedAttachment && (
                              <div className="mt-1 text-slate-500">
                                Attachment: {cand.uploadedAttachment.fileName}
                              </div>
                            )}
                          </div>

                          <div className="space-y-1.5">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              Source Diagnostics
                            </div>
                            {(cand.sourceUrl ||
                              cand.originalSubmissionUrl ||
                              cand.registrationUrl) && (
                              <button
                                type="button"
                                disabled={verifyingId === cand.id}
                                onClick={() => handleVerifyUrl(cand)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium cursor-pointer"
                              >
                                <Globe className="w-3 h-3" />
                                {verifyingId === cand.id
                                  ? 'Checking...'
                                  : 'Verify Source URL'}
                              </button>
                            )}
                            {Object.entries(cand.fieldEvidence).map(
                              ([field, entries]) => (
                                <div key={field} className="text-slate-500">
                                  <strong>{field}:</strong>{' '}
                                  {entries[0]?.excerpt}
                                </div>
                              )
                            )}
                          </div>
                        </div>

                        {verifyRes && (
                          <div
                            className={`p-2.5 rounded-lg border text-[11px] font-mono ${
                              verifyRes.ok
                                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                                : 'bg-red-50/70 border-red-200 text-red-900'
                            }`}
                          >
                            HTTP {verifyRes.httpStatus} · Status:{' '}
                            {verifyRes.status} · Canonical:{' '}
                            {verifyRes.verifiedCanonicalUrl ||
                              verifyRes.finalUrl ||
                              'N/A'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Section 2: Moderation Reports */}
        {activeSection === 'REPORTS' && (
          <div className="space-y-2.5">
            {reports.map((rep) => (
              <div
                key={rep.id}
                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    {rep.targetLabel} ({rep.targetType})
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                    {rep.reason}
                  </p>
                </div>

                {rep.status === 'open' ? (
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onResolveReport(rep.id, 'resolved_actioned')
                      }
                      className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold cursor-pointer"
                    >
                      Action Report
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onResolveReport(rep.id, 'resolved_dismissed')
                      }
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-400 font-semibold capitalize">
                    {rep.status.replace('_', ' ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Section 3: Audit Log */}
        {activeSection === 'AUDIT' && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 flex items-center justify-between gap-3"
              >
                <div>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {log.action}
                  </span>{' '}
                  — <span className="text-slate-600">{log.summary}</span>
                </div>
                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                  {log.createdAt.slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
);
