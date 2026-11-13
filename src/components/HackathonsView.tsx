import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileSearch,
  FileText,
  Image as ImageIcon,
  Link2Off,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Upload,
  Users,
} from 'lucide-react';
import {
  CampusType,
  EventCandidate,
  EventType,
  ExecutionMode,
  Hackathon,
  PrivateAcademyHint,
  User,
} from '../types/domain';
import { DeveloperDiagnosticTelemetry } from '../types/apiContracts';
import {
  classifyEventCandidateText,
  extractLiveEventFileMetadata,
  extractLiveEventUrlMetadata,
  extractPublicEventPreview,
} from '../services/adapters';
import { INTEREST_TAXONOMY } from '../data/seedData';
import { Modal } from './Modal';

interface HackathonsViewProps {
  currentUser: User;
  executionMode: ExecutionMode;
  hackathons: Hackathon[];
  selectedHackathonId: string;
  privateHints: PrivateAcademyHint[];
  onSelectHackathonForDiscovery: (hackathonId: string) => void;
  onToggleAcademyScope: (scope: 'announcements' | 'timetable') => void;
  onSubmitEventCandidate: (candidate: EventCandidate) => void;
}

const ALLOWED_UPLOAD_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Generates a real PNG data URL of a synthetic hackathon poster on an HTML5 canvas
 * so the user can test the multimodal poster upload pipeline with 1 click.
 */
function createSamplePosterDataUrl(): {
  fileName: string;
  mimeType: string;
  base64Data: string;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, 720, 480);
    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('PES QUANTUM & AI HACKATHON 2026', 40, 70);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = '20px sans-serif';
    ctx.fillText('Organizer: PES Quantum Computing & CSE Club', 40, 120);
    ctx.fillText('Dates: 2026-12-27 to 2026-12-28 (24-Hour Onsite Hackathon)', 40, 165);
    ctx.fillText('Registration Deadline: 2026-12-23', 40, 205);
    ctx.fillText('Venue: MRD Auditorium, RR Campus, Bengaluru', 40, 245);
    ctx.fillText('Team Size: Minimum 2 to Maximum 4 students per team', 40, 285);
    ctx.fillText('Eligibility: All undergraduate engineering students', 40, 325);
    ctx.fillText('Themes: Applied AI/ML, Systems/Cloud, Security/CTFs', 40, 365);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '16px monospace';
    ctx.fillText('Official Page: https://events.pes.edu/11515/', 40, 415);
  }
  const dataUrl = canvas.toDataURL('image/png');
  return {
    fileName: 'PES_Quantum_AI_Hackathon_2026_Poster.png',
    mimeType: 'image/png',
    base64Data: dataUrl,
  };
}

/**
 * Generates a valid PDF brochure containing embedded selectable text (`BT ... ET`)
 * so the server-side deterministic PDF text parser can extract fields without calling Gemini.
 */
function createSamplePdfBrochurePayload(): {
  fileName: string;
  mimeType: string;
  base64Data: string;
} {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << >> /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 495 >>
stream
BT
(Title: PES Autonomous Systems & AI Buildathon 2026) Tj
(Organizer: PES Robotics & AI Society) Tj
(Start Date: 2026-11-21) Tj
(End Date: 2026-11-22) Tj
(Registration Deadline: 2026-11-18) Tj
(Venue: MRD Auditorium, RR Campus, Bengaluru) Tj
(Team Size: 2 to 4 members per team) Tj
(Eligibility: Open to all B.Tech students across RR and EC campuses) Tj
(Tracks: Applied AI/ML, Robotics/Edge Hardware, Developer Tools) Tj
(Official Website: https://events.pes.edu/11515/) Tj
ET
endstream
endobj
%%EOF`;
  const base64Data = `data:application/pdf;base64,${window.btoa(pdfContent)}`;
  return {
    fileName: 'PES_Autonomous_Systems_Brochure_2026.pdf',
    mimeType: 'application/pdf',
    base64Data,
  };
}

export const HackathonsView: React.FC<HackathonsViewProps> = ({
  currentUser,
  executionMode,
  hackathons,
  selectedHackathonId,
  privateHints,
  onSelectHackathonForDiscovery,
  onToggleAcademyScope,
  onSubmitEventCandidate,
}) => {
  const [catalogFilter, setCatalogFilter] = useState<'matchable' | 'non_matchable' | 'all'>('matchable');
  const [campusFilter, setCampusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProvenanceId, setExpandedProvenanceId] = useState<string | null>(null);

  // Suggest Event Modal State (Supports URL, PDF/Image Upload, and Manual Entry)
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [sourceTab, setSourceTab] = useState<'url' | 'file' | 'manual'>('url');
  const [urlInput, setUrlInput] = useState('https://events.pes.edu/11515/');
  const [isExtracting, setIsExtracting] = useState(false);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionDiagnostics, setExtractionDiagnostics] =
    useState<DeveloperDiagnosticTelemetry | null>(null);
  const [showDiagnosticsDrawer, setShowDiagnosticsDrawer] = useState(false);

  // Uploaded file state + preserved payload for 1-click Retry without re-uploading
  const [uploadedFileMeta, setUploadedFileMeta] = useState<{
    fileName: string;
    mimeType: string;
    byteSize: number;
    extractedEvidenceQuote?: string;
  } | null>(null);
  const [lastUploadedPayload, setLastUploadedPayload] = useState<{
    fileName: string;
    mimeType: string;
    base64Data: string;
  } | null>(null);

  // Editable Preview Fields (Requirement #3)
  const [draftTitle, setDraftTitle] = useState('');
  const [draftOrganizer, setDraftOrganizer] = useState('');
  const [draftCategory, setDraftCategory] = useState<EventType>('hackathon');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftCampus, setDraftCampus] = useState<CampusType>('RR Campus');
  const [draftVenueName, setDraftVenueName] = useState('');
  const [draftFormat, setDraftFormat] = useState<'onsite' | 'online' | 'hybrid' | 'unknown'>('onsite');
  const [draftStartAt, setDraftStartAt] = useState('');
  const [draftEndAt, setDraftEndAt] = useState('');
  const [draftDeadline, setDraftDeadline] = useState('');
  const [draftMinTeam, setDraftMinTeam] = useState<string>('');
  const [draftMaxTeam, setDraftMaxTeam] = useState<string>('');
  const [draftEligibility, setDraftEligibility] = useState('');
  const [draftRegistrationUrl, setDraftRegistrationUrl] = useState('');
  const [draftOfficialSourceUrl, setDraftOfficialSourceUrl] = useState('');
  const [draftVerifiedCanonicalUrl, setDraftVerifiedCanonicalUrl] = useState<string | null>(null);
  const [draftThemes, setDraftThemes] = useState<string[]>(['Applied AI/ML', 'Climate/Civic Tech']);

  const userPrivateHints = privateHints.filter((h) => h.ownerUid === currentUser.uid);

  const filteredHackathons = hackathons.filter((h) => {
    if (catalogFilter === 'matchable' && !h.matchable) return false;
    if (catalogFilter === 'non_matchable' && h.matchable) return false;
    if (campusFilter !== 'ALL' && h.venue.campus !== campusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = h.name.toLowerCase().includes(q);
      const matchTheme = h.themes.some((t) => t.toLowerCase().includes(q));
      const matchOrg = h.organizer.toLowerCase().includes(q);
      if (!matchName && !matchTheme && !matchOrg) return false;
    }
    return true;
  });

  const applyExtractedDraftToForm = (draft: Partial<EventCandidate>, warnings: string[]) => {
    setPreviewWarnings(warnings);
    setDraftTitle(draft.title ?? '');
    setDraftOrganizer(draft.organizer ?? '');
    setDraftCategory(draft.eventType ?? 'hackathon');
    setDraftDescription(draft.description ?? '');
    setDraftCampus((draft.venue?.campus as CampusType) ?? 'RR Campus');
    setDraftVenueName(draft.venue?.name ?? '');
    setDraftFormat(draft.format ?? 'unknown');
    setDraftStartAt(draft.startAt ?? '');
    setDraftEndAt(draft.endAt ?? '');
    setDraftDeadline(draft.registrationDeadline ?? '');
    setDraftMinTeam(
      draft.teamSize?.min !== null && draft.teamSize?.min !== undefined
        ? String(draft.teamSize.min)
        : ''
    );
    setDraftMaxTeam(
      draft.teamSize?.max !== null && draft.teamSize?.max !== undefined
        ? String(draft.teamSize.max)
        : ''
    );
    setDraftEligibility(draft.eligibilityNotes ?? '');
    setDraftRegistrationUrl(draft.registrationUrl ?? '');
    setDraftOfficialSourceUrl(draft.originalSubmissionUrl ?? draft.sourceUrl ?? '');
    setDraftVerifiedCanonicalUrl(draft.verifiedCanonicalUrl ?? null);
    if (draft.themes && draft.themes.length > 0) {
      setDraftThemes(draft.themes);
    }
    if (draft.uploadedAttachment) {
      setUploadedFileMeta(draft.uploadedAttachment);
    }
  };

  const handleRunUrlPreview = async (targetUrl?: string, forceMode?: ExecutionMode) => {
    if (isExtracting) return;
    const urlToTest = targetUrl ?? urlInput;
    if (targetUrl) setUrlInput(targetUrl);
    const activeMode = forceMode ?? executionMode;

    setExtractionError(null);
    setExtractionDiagnostics(null);
    setPreviewWarnings([]);
    setIsExtracting(true);

    try {
      if (activeMode === 'live') {
        const liveRes = await extractLiveEventUrlMetadata(urlToTest);
        if (liveRes.diagnostics) {
          setExtractionDiagnostics(liveRes.diagnostics);
        }
        if (!liveRes.ok || !liveRes.draft) {
          setExtractionError(
            liveRes.errorMessage ?? 'Could not extract live metadata. You can still enter fields manually below.'
          );
          setDraftOfficialSourceUrl(urlToTest);
          setDraftVerifiedCanonicalUrl(null);
          return;
        }
        applyExtractedDraftToForm(liveRes.draft, liveRes.warnings);
      } else {
        const result = extractPublicEventPreview(urlToTest);
        if (!result.validation.allowed) {
          setExtractionError(result.validation.blockedReason ?? 'Blocked by policy gate.');
        }
        applyExtractedDraftToForm(result.draft, result.warnings);
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (isExtracting) return;
    setExtractionError(null);
    setExtractionDiagnostics(null);
    setPreviewWarnings([]);

    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      setExtractionError(
        `Unsupported file format (${file.type || 'unknown'}). Please upload a PDF brochure or PNG/JPG/WebP poster.`
      );
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setExtractionError(
        `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 10 MB security limit.`
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = String(reader.result ?? '');
      await processUploadedFilePayload({
        fileName: file.name,
        mimeType: file.type,
        base64Data,
      });
    };
    reader.readAsDataURL(file);
  };

  const processUploadedFilePayload = async (payload: {
    fileName: string;
    mimeType: string;
    base64Data: string;
  }) => {
    if (isExtracting) return;
    setLastUploadedPayload(payload);
    setIsExtracting(true);
    setExtractionError(null);
    setExtractionDiagnostics(null);
    try {
      const res = await extractLiveEventFileMetadata(payload);
      if (res.diagnostics) {
        setExtractionDiagnostics(res.diagnostics);
      }
      if (!res.ok || !res.draft) {
        setExtractionError(
          res.errorMessage ??
            "AI extraction is temporarily unavailable. Your poster was accepted, but its details couldn't be extracted. Retry extraction or enter the information manually."
        );
        setUploadedFileMeta({
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          byteSize: Math.round((payload.base64Data.length * 3) / 4),
        });
        return;
      }
      applyExtractedDraftToForm(res.draft, res.warnings);
    } finally {
      setIsExtracting(false);
    }
  };

  const liveClassification = classifyEventCandidateText({
    title: draftTitle || 'Untitled Candidate',
    description: draftDescription,
    minTeamSize: draftMinTeam ? Number(draftMinTeam) : null,
    maxTeamSize: draftMaxTeam ? Number(draftMaxTeam) : null,
  });

  const handleStageCandidate = (e: React.FormEvent) => {
    e.preventDefault();
    if (isExtracting || !draftTitle.trim()) return;

    const minVal = draftMinTeam.trim() ? Number(draftMinTeam) : null;
    const maxVal = draftMaxTeam.trim() ? Number(draftMaxTeam) : null;

    const effectiveEventType =
      draftCategory !== 'hackathon' ? draftCategory : liveClassification.eventType;
    const isMatchable =
      effectiveEventType !== 'workshop' &&
      effectiveEventType !== 'tech_talk' &&
      maxVal !== 1 &&
      liveClassification.matchable;

    const newCandidate: EventCandidate = {
      id: `cand_user_${Date.now()}`,
      source: uploadedFileMeta ? 'uploaded_brochure_or_poster' : 'submitted_public_url',
      sourceUrl: draftVerifiedCanonicalUrl ?? (draftOfficialSourceUrl.trim() || undefined),
      originalSubmissionUrl: draftOfficialSourceUrl.trim() || null,
      verifiedCanonicalUrl: draftVerifiedCanonicalUrl,
      sourceUrlStatus: draftVerifiedCanonicalUrl
        ? 'verified'
        : draftOfficialSourceUrl.trim()
        ? 'unverified'
        : 'unavailable',
      uploadedAttachment: uploadedFileMeta ?? undefined,
      submittedByUid: currentUser.uid,
      externalFingerprint: `${(draftOrganizer || 'org').toLowerCase().replace(/\s+/g, '_')}__${draftTitle
        .toLowerCase()
        .replace(/\s+/g, '_')}__${draftStartAt || 'unknown_date'}`,
      title: draftTitle.trim(),
      organizer: draftOrganizer.trim() || 'Student-Submitted Organizer (Unverified)',
      eventType: effectiveEventType,
      matchable: isMatchable,
      themes: draftThemes,
      description:
        draftDescription.trim() ||
        'Student-submitted event candidate staged for moderator verification.',
      startAt: draftStartAt.trim() || null,
      endAt: draftEndAt.trim() || null,
      registrationDeadline: draftDeadline.trim() || null,
      timezone: 'Asia/Kolkata',
      venue: {
        campus: draftCampus,
        name: draftVenueName.trim() || null,
      },
      format: draftFormat,
      teamSize: {
        min: minVal,
        max: maxVal,
      },
      registrationUrl: draftRegistrationUrl.trim() || null,
      eligibilityNotes: draftEligibility.trim() || null,
      fieldEvidence: {
        submission: [
          {
            sourceUrl:
              draftVerifiedCanonicalUrl ??
              (uploadedFileMeta
                ? `attachment://${uploadedFileMeta.fileName}`
                : draftOfficialSourceUrl.trim() || 'manual-submission'),
            excerpt:
              uploadedFileMeta?.extractedEvidenceQuote ??
              `Submitted by ${currentUser.displayName}; pending moderator verification.`,
          },
        ],
      },
      classification: {
        ruleGatePassed: isMatchable,
        mlScore: liveClassification.mlScore,
        reason: liveClassification.reason,
      },
      reviewStatus: minVal === null || maxVal === null ? 'needs_confirmation' : 'new',
      warnings: [
        ...(minVal === null || maxVal === null
          ? ['Team size constraints are unconfirmed (null). Reviewer must verify before enforcing capacity.']
          : []),
        ...(!isMatchable
          ? [`Classified as ${effectiveEventType} (matchable = false).`]
          : []),
      ],
      lastSeenAt: new Date().toISOString(),
    };

    onSubmitEventCandidate(newCandidate);
    setShowSuggestModal(false);
    setUploadedFileMeta(null);
  };

  const hasUnsavedSuggestEdits = Boolean(
    draftTitle.trim() || draftDescription.trim() || uploadedFileMeta
  );

  return (
    <div className="space-y-8">
      {/* Top Section Header & Action */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            PES University Verified Event Catalog · Source-Attributed Directory
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Select a Hackathon to Build For
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-2xl">
            Every matchable event has verified team rules or explicit unconfirmed flags. Submit missing hackathons via public URLs, PDF brochures, or image posters.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => {
              setShowSuggestModal(true);
              setSourceTab('url');
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Suggest a Hackathon (URL / Poster / PDF)
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg self-start">
          <button
            onClick={() => setCatalogFilter('matchable')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              catalogFilter === 'matchable'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Team-Matchable Hackathons ({hackathons.filter((h) => h.matchable).length})
          </button>
          <button
            onClick={() => setCatalogFilter('non_matchable')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              catalogFilter === 'non_matchable'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Workshops, Talks & Solo Contests ({hackathons.filter((h) => !h.matchable).length})
          </button>
          <button
            onClick={() => setCatalogFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              catalogFilter === 'all'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            All Events ({hackathons.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            {['ALL', 'RR Campus', 'EC Campus', 'Online / Multi-Campus'].map((campus) => (
              <button
                key={campus}
                onClick={() => setCampusFilter(campus)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  campusFilter === campus
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {campus === 'ALL' ? 'All Campuses' : campus.replace(' / Multi-Campus', '')}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by theme or title..."
              className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>
      </div>

      {/* Main Hackathon Cards List */}
      <div className="grid grid-cols-1 gap-4">
        {filteredHackathons.map((h) => {
          const isSelected = h.id === selectedHackathonId;
          const isUnconfirmedBounds = h.minTeamSize === null || h.maxTeamSize === null;
          const provenanceKeys = Object.keys(h.fieldProvenance);

          // Requirement #4: Only link to an event-specific verified canonical URL; otherwise display "Source unavailable"
          const verifiedSourceHref =
            (h.sourceUrlStatus === 'verified' || h.sourceUrlStatus === 'redirected_valid') &&
            h.verifiedCanonicalUrl
              ? h.verifiedCanonicalUrl
              : null;

          return (
            <div
              key={h.id}
              className={`p-6 bg-white dark:bg-slate-900 border rounded-xl transition-colors ${
                isSelected
                  ? 'border-blue-600 dark:border-blue-500'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                <div className="space-y-2.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">
                      {h.eventType.replace('_', ' ')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{h.venue.campus ?? 'Campus Not Confirmed'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{h.format.toUpperCase()}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {h.startAt ? h.startAt.slice(0, 10) : 'Date Not Confirmed'}
                    </span>
                    <span aria-hidden="true">·</span>
                    {h.matchable ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Team Matching Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Non-Matchable ({h.eventType === 'ctf' ? 'Solo CTF' : 'Workshop / Talk'})
                      </span>
                    )}
                  </div>

                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
                    {h.name}
                  </h2>

                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-3xl">
                    {h.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 pt-1">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Tracks & Themes:</span>
                    {h.themes.map((theme, idx) => (
                      <React.Fragment key={theme}>
                        <span>{theme}</span>
                        {idx < h.themes.length - 1 && <span aria-hidden="true">·</span>}
                      </React.Fragment>
                    ))}
                  </div>

                  <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-slate-400 block">Team Size Bounds</span>
                      {isUnconfirmedBounds ? (
                        <span className="font-medium text-amber-700 dark:text-amber-400 inline-flex items-center gap-1 mt-0.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Not yet confirmed
                        </span>
                      ) : (
                        <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
                          {h.minTeamSize === h.maxTeamSize
                            ? `${h.maxTeamSize} member (Solo)`
                            : `${h.minTeamSize} – ${h.maxTeamSize} members`}
                        </span>
                      )}
                    </div>

                    <div>
                      <span className="text-slate-400 block">Venue & Registration Deadline</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300 mt-0.5 block">
                        {h.venue.name ?? 'Venue room not yet confirmed'} ·{' '}
                        <span className="font-mono tabular-nums">
                          {h.registrationDeadline
                            ? `Closes ${h.registrationDeadline.slice(0, 10)}`
                            : 'Deadline not yet confirmed'}
                        </span>
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block">Organizer & Source Status</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300 mt-0.5 block">
                        {h.organizer}
                      </span>
                    </div>
                  </div>

                  {/* Expandable Source Provenance Drawer */}
                  {expandedProvenanceId === h.id && (
                    <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2 text-xs">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        Event Link Provenance & Classification Details
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px] bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-800">
                        <div>
                          <span className="text-slate-400 block font-sans">Original Submission URL:</span>
                          <span className="text-slate-700 dark:text-slate-300 break-all">
                            {h.originalSubmissionUrl ?? 'None (Offline/Brochure)'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-sans">Verified Canonical URL:</span>
                          <span className="text-slate-700 dark:text-slate-300 break-all">
                            {h.verifiedCanonicalUrl ?? 'Source unavailable'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-sans">Registration URL:</span>
                          <span className="text-slate-700 dark:text-slate-300 break-all">
                            {h.registrationUrl ?? 'Source unavailable'}
                          </span>
                        </div>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">
                        <span className="font-medium">Classifier Verdict:</span> {h.classification.reason}
                      </p>
                      {provenanceKeys.length > 0 && (
                        <div className="space-y-1 pt-1">
                          {provenanceKeys.map((fieldKey) => {
                            const entry = h.fieldProvenance[fieldKey];
                            return (
                              <div key={fieldKey} className="text-slate-600 dark:text-slate-300">
                                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                                  {fieldKey}:
                                </span>{' '}
                                “{entry.excerpt}” —{' '}
                                <span className="text-slate-500">[{entry.sourceUrl}]</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Action Column */}
                <div className="flex flex-row lg:flex-col items-stretch sm:items-end justify-between gap-2.5 shrink-0">
                  {h.matchable ? (
                    <button
                      onClick={() => onSelectHackathonForDiscovery(h.id)}
                      className={`px-4 py-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center justify-center gap-2 ${
                        isSelected
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      {isSelected ? 'Active in Discovery →' : 'Browse People & Teams'}
                    </button>
                  ) : (
                    <span className="px-3 py-2 text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-lg whitespace-nowrap shrink-0">
                      Team Assembly Disabled
                    </span>
                  )}

                  <div className="flex items-center gap-3 text-xs">
                    <button
                      onClick={() =>
                        setExpandedProvenanceId(expandedProvenanceId === h.id ? null : h.id)
                      }
                      className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 underline underline-offset-4 cursor-pointer whitespace-nowrap"
                    >
                      {expandedProvenanceId === h.id ? 'Hide Provenance' : 'Source Provenance'}
                    </button>

                    {verifiedSourceHref ? (
                      <a
                        href={verifiedSourceHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap font-medium"
                      >
                        Verified Event Page
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span
                        title="No verified event-specific web page URL is available for this listing"
                        className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500 whitespace-nowrap"
                      >
                        <Link2Off className="w-3 h-3" />
                        Source unavailable
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Private PESU Academy Opt-In Hints Panel */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
              <Lock className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />
              <span>PESU OAuth2 Scoped Resource Boundary (`announcements:read` · Private by Default)</span>
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Personal Academy Event Hints for {currentUser.displayName}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 max-w-3xl">
              Opting into <code className="font-mono">announcements:read</code> surfaces hackathon hints strictly inside your own session—your account is never used as a shared campus crawler or republished without independent verification.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onToggleAcademyScope('announcements')}
              className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                currentUser.privacyPreferences.academyAnnouncementsOptIn
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {currentUser.privacyPreferences.academyAnnouncementsOptIn
                ? 'announcements:read Consented (Click to Revoke)'
                : 'Opt In to announcements:read'}
            </button>
          </div>
        </div>

        {currentUser.privacyPreferences.academyAnnouncementsOptIn ? (
          userPrivateHints.length > 0 ? (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800 pt-3">
              {userPrivateHints.map((hint) => (
                <div key={hint.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {hint.noticeTitle}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Detected Date: <span className="font-mono tabular-nums">{hint.detectedDateHint}</span> · Scope: <span className="font-mono">{hint.scopeUsed}</span> · {hint.note}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowSuggestModal(true);
                      setSourceTab('url');
                      setDraftTitle(hint.noticeTitle.replace('[Private Academy Notice] ', ''));
                      if (hint.publicLinkFound) {
                        setUrlInput(hint.publicLinkFound);
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Suggest with Organizer Link / Flyer
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
              No unindexed team competition notices found in your personal Academy feed today.
            </p>
          )
        ) : (
          <p className="text-xs text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
            Academy announcement scanning is currently off for your account.
          </p>
        )}
      </div>

      {/* Standardized Modal: Suggest a Hackathon (URL + PDF Brochure + Image Poster + Manual) */}
      {showSuggestModal && (
        <Modal
          title="Suggest a Hackathon"
          subtitle="Submit via public event URL, PDF brochure, image poster (PNG/JPG/WebP), or manual entry. Review extracted fields before staging."
          onClose={() => setShowSuggestModal(false)}
          hasUnsavedChanges={hasUnsavedSuggestEdits}
          maxWidthClass="max-w-3xl"
        >
          {/* Input Source Mode Tabs */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setSourceTab('url')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  sourceTab === 'url'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                1. Public Event URL
              </button>
              <button
                type="button"
                onClick={() => setSourceTab('file')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  sourceTab === 'file'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                2. Upload Poster / PDF Brochure
              </button>
              <button
                type="button"
                onClick={() => setSourceTab('manual')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  sourceTab === 'manual'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                3. Direct Manual Entry
              </button>
            </div>

            <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              Mode: {executionMode === 'live' ? 'Live Server Extraction' : 'Demo Presets'}
            </span>
          </div>

          {/* Tab 1: URL Extraction */}
          {sourceTab === 'url' && (
            <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="flex flex-wrap gap-1.5 text-xs">
                <span className="font-semibold text-slate-600 dark:text-slate-400 mr-1 self-center">
                  Quick Presets:
                </span>
                <button
                  type="button"
                  onClick={() => handleRunUrlPreview('https://events.pes.edu/11515/')}
                  className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md cursor-pointer"
                >
                  PES Event #11515
                </button>
                <button
                  type="button"
                  onClick={() => handleRunUrlPreview('https://unstop.com/hackathons/smart-mobility-pes-2026')}
                  className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md cursor-pointer"
                >
                  Unstop (Missing Team Size)
                </button>
                <button
                  type="button"
                  onClick={() => handleRunUrlPreview('http://169.254.169.254/latest/meta-data/iam')}
                  className="px-2.5 py-1 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-md cursor-pointer"
                >
                  SSRF Gate Test
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://events.pes.edu/11515/ or organizer URL..."
                  className="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={isExtracting}
                  onClick={() => handleRunUrlPreview()}
                  className="px-4 py-2 text-xs font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <FileSearch className="w-3.5 h-3.5" />
                      {executionMode === 'live' ? 'Extract Live URL' : 'Extract Preview'}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Tab 2: Poster (PNG/JPG/WebP) or PDF Brochure Upload */}
          {sourceTab === 'file' && (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="font-bold text-slate-900 dark:text-slate-100 block">
                    Upload Event Brochure (PDF) or Poster (PNG, JPG, WebP · Max 10 MB)
                  </span>
                  <span className="text-slate-500">
                    PDFs with selectable text use deterministic zero-LLM extraction first; image posters use Gemini multimodal vision with bounded retry and fallback.
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isExtracting}
                    onClick={() => {
                      const samplePdf = createSamplePdfBrochurePayload();
                      processUploadedFilePayload(samplePdf);
                    }}
                    className="px-3 py-1.5 font-semibold text-emerald-700 dark:text-emerald-300 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Test Sample PDF (0 LLM Calls)
                  </button>

                  <button
                    type="button"
                    disabled={isExtracting}
                    onClick={() => {
                      const sample = createSamplePosterDataUrl();
                      processUploadedFilePayload(sample);
                    }}
                    className="px-3 py-1.5 font-semibold text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    Test Sample Poster (Vision)
                  </button>
                </div>
              </div>

              <label className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950 hover:border-blue-500 transition-colors cursor-pointer">
                <Upload className="w-5 h-5 text-slate-400 mb-1.5" />
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  Click to select a PDF brochure or PNG/JPG/WebP poster
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  Validated for MIME type and size (&le; 10 MB)
                </span>
                <input
                  type="file"
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={isExtracting}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f);
                  }}
                />
              </label>

              {uploadedFileMeta && (
                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200">
                    <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      Attached: <strong>{uploadedFileMeta.fileName}</strong> ({uploadedFileMeta.mimeType})
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {lastUploadedPayload && (
                      <button
                        type="button"
                        disabled={isExtracting}
                        onClick={() => processUploadedFilePayload(lastUploadedPayload)}
                        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isExtracting ? 'animate-spin' : ''}`} />
                        Retry Extraction
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedFileMeta(null);
                        setLastUploadedPayload(null);
                      }}
                      className="text-slate-500 hover:text-red-600 underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Extraction Error or Policy Block Notice */}
          {extractionError && (
            <div className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg space-y-2 text-xs text-red-800 dark:text-red-300">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Extraction Notice</span>
                    <p className="mt-0.5">{extractionError}</p>
                  </div>
                </div>

                {lastUploadedPayload && sourceTab === 'file' && (
                  <button
                    type="button"
                    disabled={isExtracting}
                    onClick={() => processUploadedFilePayload(lastUploadedPayload)}
                    className="px-3 py-1.5 font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isExtracting ? 'animate-spin' : ''}`} />
                    Retry Extraction
                  </button>
                )}
              </div>

              {extractionDiagnostics && (
                <div className="pt-2 border-t border-red-200/70 dark:border-red-800/70">
                  <button
                    type="button"
                    onClick={() => setShowDiagnosticsDrawer((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-[11px] font-mono underline cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    {showDiagnosticsDrawer ? 'Hide Developer Diagnostics' : 'Show Developer Diagnostics'}
                  </button>
                  {showDiagnosticsDrawer && (
                    <div className="mt-2 p-2.5 bg-white/90 dark:bg-slate-900/90 border border-red-200 dark:border-red-900 rounded font-mono text-[11px] text-slate-700 dark:text-slate-300 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div>
                        <span className="text-slate-400 block">Service:</span>
                        {extractionDiagnostics.serviceName}
                      </div>
                      <div>
                        <span className="text-slate-400 block">HTTP Status:</span>
                        {extractionDiagnostics.httpStatus}
                      </div>
                      <div>
                        <span className="text-slate-400 block">Error Category:</span>
                        {extractionDiagnostics.errorCategory}
                      </div>
                      <div>
                        <span className="text-slate-400 block">Model Used:</span>
                        {extractionDiagnostics.modelUsed ?? 'none (deterministic)'}
                      </div>
                      <div>
                        <span className="text-slate-400 block">Retry Attempts:</span>
                        {extractionDiagnostics.retryAttempts}
                      </div>
                      <div>
                        <span className="text-slate-400 block">Duration / Request ID:</span>
                        {extractionDiagnostics.durationMs} ms · {extractionDiagnostics.requestId ?? 'n/a'}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {previewWarnings.length > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg space-y-1 text-xs text-amber-800 dark:text-amber-300">
              {previewWarnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Editable Preview Form (All 10 Required Fields) */}
          <form onSubmit={handleStageCandidate} className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 dark:text-slate-100">
                Editable Event Preview (Missing fields stay unconfirmed — never guessed)
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                Classifier: {liveClassification.eventType.toUpperCase()} ({liveClassification.matchable ? 'Matchable' : 'Non-Matchable'})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Event Name *
                </label>
                <input
                  type="text"
                  required
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="e.g., PES Quantum & AI Hackathon 2026"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Event Category
                </label>
                <select
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value as EventType)}
                  className="w-full px-2.5 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  <option value="hackathon">Hackathon</option>
                  <option value="buildathon">Buildathon</option>
                  <option value="ideathon">Ideathon</option>
                  <option value="ctf">CTF</option>
                  <option value="team_competition">Team Competition</option>
                  <option value="workshop">Workshop (Non-Matchable)</option>
                  <option value="tech_talk">Tech Talk / Seminar (Non-Matchable)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Organizer / Club
                </label>
                <input
                  type="text"
                  value={draftOrganizer}
                  onChange={(e) => setDraftOrganizer(e.target.value)}
                  placeholder="Unknown if blank"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Campus
                </label>
                <select
                  value={draftCampus}
                  onChange={(e) => setDraftCampus(e.target.value as CampusType)}
                  className="w-full px-2.5 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  <option value="RR Campus">RR Campus</option>
                  <option value="EC Campus">EC Campus</option>
                  <option value="Online / Multi-Campus">Online / Multi-Campus</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Venue / Building (Optional)
                </label>
                <input
                  type="text"
                  value={draftVenueName}
                  onChange={(e) => setDraftVenueName(e.target.value)}
                  placeholder="Not yet confirmed"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Dates & Team Sizes */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Start Date/Time
                </label>
                <input
                  type="text"
                  value={draftStartAt}
                  onChange={(e) => setDraftStartAt(e.target.value)}
                  placeholder="YYYY-MM-DD"
                  className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  End Date/Time
                </label>
                <input
                  type="text"
                  value={draftEndAt}
                  onChange={(e) => setDraftEndAt(e.target.value)}
                  placeholder="YYYY-MM-DD"
                  className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Reg. Deadline
                </label>
                <input
                  type="text"
                  value={draftDeadline}
                  onChange={(e) => setDraftDeadline(e.target.value)}
                  placeholder="Unconfirmed"
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
                  value={draftMinTeam}
                  onChange={(e) => setDraftMinTeam(e.target.value)}
                  placeholder="Unknown"
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
                  value={draftMaxTeam}
                  onChange={(e) => setDraftMaxTeam(e.target.value)}
                  placeholder="Unknown"
                  className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Themes / Problem Statements & Description
              </label>
              <textarea
                rows={2}
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                placeholder="Summary of problem statements, tracks, or rules..."
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {INTEREST_TAXONOMY.slice(0, 8).map((theme) => {
                  const active = draftThemes.includes(theme);
                  return (
                    <button
                      key={theme}
                      type="button"
                      onClick={() =>
                        setDraftThemes(
                          active
                            ? draftThemes.filter((t) => t !== theme)
                            : [...draftThemes, theme]
                        )
                      }
                      className={`px-2 py-0.5 rounded border text-[11px] cursor-pointer ${
                        active
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-900 text-slate-600 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {theme}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Eligibility, Registration URL & Official Source URL */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Eligibility Requirements
                </label>
                <input
                  type="text"
                  value={draftEligibility}
                  onChange={(e) => setDraftEligibility(e.target.value)}
                  placeholder="e.g., Open to all PES students"
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Registration URL
                </label>
                <input
                  type="text"
                  value={draftRegistrationUrl}
                  onChange={(e) => setDraftRegistrationUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Official Source URL
                </label>
                <input
                  type="text"
                  value={draftOfficialSourceUrl}
                  onChange={(e) => setDraftOfficialSourceUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-2.5 py-1.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowSuggestModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
              >
                Submit Candidate to Review Queue
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
