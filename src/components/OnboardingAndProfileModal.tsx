import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  ExecutionMode,
  FeaturedProject,
  Profile,
  ProfileEvidenceDraft,
  User,
} from '../types/domain';
import {
  INTEREST_TAXONOMY,
  ROLE_TAXONOMY,
  WORK_STYLE_TAXONOMY,
} from '../data/seedData';
import {
  runBoundedGitHubEnrichmentDraft,
  runLiveGitHubAndGeminiEnrichment,
} from '../services/adapters';
import { Modal } from './Modal';

interface OnboardingAndProfileModalProps {
  currentUser: User;
  profile: Profile;
  executionMode: ExecutionMode;
  onSaveProfile: (updated: Profile) => void;
  onClose: () => void;
}

type OnboardingStep = 1 | 2 | 3;

export const OnboardingAndProfileModal: React.FC<OnboardingAndProfileModalProps> = ({
  currentUser,
  profile,
  executionMode,
  onSaveProfile,
  onClose,
}) => {
  const draftStorageKey = `quackathon_profile_draft_${currentUser.uid}`;

  const [step, setStep] = useState<OnboardingStep>(1);
  const [hasSavedDraftInStorage, setHasSavedDraftInStorage] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);

  // Step 1 — About You
  const [headline, setHeadline] = useState(profile.headline);
  const [interestTags, setInterestTags] = useState<string[]>(profile.interestTags);
  const [skillTags, setSkillTags] = useState<string[]>(profile.skillTags);
  const [newSkillInput, setNewSkillInput] = useState('');
  const [preferredRoles, setPreferredRoles] = useState<string[]>(profile.preferredRoles);

  // Step 2 — Your Work (Optional projects & GitHub import)
  const [featuredProjects, setFeaturedProjects] = useState<FeaturedProject[]>(
    profile.featuredProjects
  );
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [githubUsername, setGithubUsername] = useState(profile.githubUsername ?? '');
  const [isImportingGithub, setIsImportingGithub] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState<ProfileEvidenceDraft | null>(null);
  const [editableDraftProjTitle, setEditableDraftProjTitle] = useState('');
  const [editableDraftProjDesc, setEditableDraftProjDesc] = useState('');
  const [draftApprovedMsg, setDraftApprovedMsg] = useState<string | null>(null);

  // Step 3 — Preferences & Collapsible Advanced Settings
  const [workingStyleTags, setWorkingStyleTags] = useState<string[]>(profile.workingStyleTags);
  const [rolesWantToLearn, setRolesWantToLearn] = useState<string[]>(profile.rolesWantToLearn);
  const [icebreakerPrompt, setIcebreakerPrompt] = useState(profile.icebreakerPrompt ?? '');
  const [visibility, setVisibility] = useState<'public_verified_students' | 'hidden'>(
    profile.visibility
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [about, setAbout] = useState(profile.about);
  const [isFirstTimeHacker, setIsFirstTimeHacker] = useState(Boolean(profile.isFirstTimeHacker));
  const [simulateMaliciousReadme, setSimulateMaliciousReadme] = useState(false);

  // Load saved draft if available
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) {
        setHasSavedDraftInStorage(true);
      }
    } catch {
      // Ignore storage errors
    }
  }, [draftStorageKey]);

  const handleRestoreDraft = () => {
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.headline !== undefined) setHeadline(parsed.headline);
      if (Array.isArray(parsed.interestTags)) setInterestTags(parsed.interestTags);
      if (Array.isArray(parsed.skillTags)) setSkillTags(parsed.skillTags);
      if (Array.isArray(parsed.preferredRoles)) setPreferredRoles(parsed.preferredRoles);
      if (Array.isArray(parsed.featuredProjects)) setFeaturedProjects(parsed.featuredProjects);
      if (parsed.githubUsername !== undefined) setGithubUsername(parsed.githubUsername);
      if (Array.isArray(parsed.workingStyleTags)) setWorkingStyleTags(parsed.workingStyleTags);
      if (Array.isArray(parsed.rolesWantToLearn)) setRolesWantToLearn(parsed.rolesWantToLearn);
      if (parsed.icebreakerPrompt !== undefined) setIcebreakerPrompt(parsed.icebreakerPrompt);
      if (parsed.visibility) setVisibility(parsed.visibility);
      if (parsed.about !== undefined) setAbout(parsed.about);
      if (typeof parsed.isFirstTimeHacker === 'boolean') {
        setIsFirstTimeHacker(parsed.isFirstTimeHacker);
      }
      setDraftNotice('Restored your saved draft.');
      setHasSavedDraftInStorage(false);
    } catch {
      setDraftNotice('Could not restore saved draft.');
    }
  };

  const handleSaveDraft = () => {
    try {
      const payload = {
        headline,
        interestTags,
        skillTags,
        preferredRoles,
        featuredProjects,
        githubUsername,
        workingStyleTags,
        rolesWantToLearn,
        icebreakerPrompt,
        visibility,
        about,
        isFirstTimeHacker,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(draftStorageKey, JSON.stringify(payload));
      setDraftNotice('Draft saved! You can safely close this window and resume later.');
    } catch {
      setDraftNotice('Could not save draft to browser storage.');
    }
  };

  const isDirty =
    headline !== profile.headline ||
    about !== profile.about ||
    icebreakerPrompt !== (profile.icebreakerPrompt ?? '') ||
    visibility !== profile.visibility ||
    isFirstTimeHacker !== Boolean(profile.isFirstTimeHacker) ||
    interestTags.join(',') !== profile.interestTags.join(',') ||
    skillTags.join(',') !== profile.skillTags.join(',') ||
    preferredRoles.join(',') !== profile.preferredRoles.join(',') ||
    rolesWantToLearn.join(',') !== profile.rolesWantToLearn.join(',') ||
    workingStyleTags.join(',') !== profile.workingStyleTags.join(',') ||
    featuredProjects.length !== profile.featuredProjects.length;

  const toggleItem = (list: string[], item: string, max?: number): string[] => {
    if (list.includes(item)) {
      return list.filter((x) => x !== item);
    }
    if (max && list.length >= max) return list;
    return [...list, item];
  };

  const handleAddSkill = () => {
    const raw = newSkillInput.trim();
    if (!raw) return;
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = Array.from(new Set([...skillTags, ...parts]));
    setSkillTags(merged);
    setNewSkillInput('');
  };

  const handleAddManualProject = () => {
    if (!newProjTitle.trim() || !newProjDesc.trim()) return;
    setFeaturedProjects([
      ...featuredProjects,
      {
        id: `proj_manual_${Date.now()}`,
        title: newProjTitle.trim(),
        description: newProjDesc.trim(),
        tags: interestTags.slice(0, 2),
        isCourseworkOrIdea: true,
      },
    ]);
    setNewProjTitle('');
    setNewProjDesc('');
  };

  const handleRunGitHubImport = async (modeOverride?: ExecutionMode) => {
    const modeToUse = modeOverride ?? executionMode;
    const targetUsername = githubUsername.trim() || 'Roshan2607';
    setGithubUsername(targetUsername);
    setGithubError(null);
    setDraftApprovedMsg(null);
    setIsImportingGithub(true);

    try {
      if (modeToUse === 'live' && !simulateMaliciousReadme) {
        const res = await runLiveGitHubAndGeminiEnrichment({
          uid: currentUser.uid,
          githubUsername: targetUsername,
        });
        if (!res.ok || !res.draft) {
          setGithubError(res.errorMessage ?? 'Live GitHub/Gemini import failed.');
          setIsImportingGithub(false);
          return;
        }
        setEvidenceDraft(res.draft);
        setEditableDraftProjTitle(res.draft.suggestedProject.title);
        setEditableDraftProjDesc(res.draft.suggestedProject.description);
      } else {
        const demoDraft = runBoundedGitHubEnrichmentDraft({
          uid: currentUser.uid,
          githubUsername: targetUsername,
          simulateMaliciousReadme,
        });
        setEvidenceDraft(demoDraft);
        setEditableDraftProjTitle(demoDraft.suggestedProject.title);
        setEditableDraftProjDesc(demoDraft.suggestedProject.description);
      }
    } catch (err: unknown) {
      setGithubError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImportingGithub(false);
    }
  };

  const handleToggleDraftSkill = (skillName: string) => {
    if (!evidenceDraft) return;
    setEvidenceDraft({
      ...evidenceDraft,
      suggestedSkills: evidenceDraft.suggestedSkills.map((s) =>
        s.name === skillName ? { ...s, approved: !s.approved } : s
      ),
    });
  };

  const handleApplyApprovedDraft = () => {
    if (!evidenceDraft) return;
    const approvedSkillNames = evidenceDraft.suggestedSkills
      .filter((s) => s.approved)
      .map((s) => s.name);

    const mergedSkills = Array.from(new Set([...skillTags, ...approvedSkillNames]));
    setSkillTags(mergedSkills);

    if (evidenceDraft.suggestedProject.approved && editableDraftProjTitle.trim()) {
      const exists = featuredProjects.some(
        (p) => p.title.toLowerCase() === editableDraftProjTitle.trim().toLowerCase()
      );
      if (!exists) {
        setFeaturedProjects([
          ...featuredProjects,
          {
            id: `proj_gh_${Date.now()}`,
            title: editableDraftProjTitle.trim(),
            description: editableDraftProjDesc.trim(),
            sourceUrl: evidenceDraft.suggestedProject.sourceUrl,
            tags: evidenceDraft.suggestedProject.tags,
          },
        ]);
      }
    }

    setDraftApprovedMsg(
      `Added ${approvedSkillNames.length} approved skill(s) and project summary to your profile.`
    );
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.removeItem(draftStorageKey);
    } catch {
      // Ignore storage errors
    }
    onSaveProfile({
      ...profile,
      headline: headline.trim() || profile.headline,
      about: about.trim() || profile.about,
      interestTags,
      preferredRoles,
      rolesWantToLearn,
      skillTags,
      workingStyleTags,
      icebreakerPrompt: icebreakerPrompt.trim() || undefined,
      githubUsername: githubUsername.trim() || undefined,
      isFirstTimeHacker,
      visibility,
      featuredProjects,
      updatedAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <Modal
      title="Edit Builder Profile"
      subtitle={`${currentUser.displayName} · Complete at your own pace or save a draft for later`}
      onClose={onClose}
      hasUnsavedChanges={isDirty && !draftNotice}
      maxWidthClass="max-w-2xl"
    >
      {/* Saved Draft Banner */}
      {hasSavedDraftInStorage && (
        <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between gap-3 text-xs">
          <span className="text-blue-900 dark:text-blue-200 font-medium">
            You have an unsaved profile draft from an earlier session.
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRestoreDraft}
              className="px-2.5 py-1 bg-blue-600 text-white font-semibold rounded-md cursor-pointer"
            >
              Restore Draft
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem(draftStorageKey);
                setHasSavedDraftInStorage(false);
              }}
              className="px-2 py-1 text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {draftNotice && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{draftNotice}</span>
        </div>
      )}

      {/* Progressive 3-Step Stepper */}
      <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
        {(
          [
            { num: 1, title: 'Step 1 · About You', sub: 'Headline, roles & skills' },
            { num: 2, title: 'Step 2 · Your Work', sub: 'Projects & optional GitHub' },
            { num: 3, title: 'Step 3 · Preferences', sub: 'Work style & icebreaker' },
          ] as { num: OnboardingStep; title: string; sub: string }[]
        ).map((item) => {
          const active = step === item.num;
          return (
            <button
              key={item.num}
              type="button"
              onClick={() => setStep(item.num)}
              className={`p-2.5 rounded-lg text-left transition-colors cursor-pointer ${
                active
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <div className="text-xs font-bold">{item.title}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
                {item.sub}
              </div>
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSave} className="space-y-5 text-xs">
        {/* ================================================================
            STEP 1 — ABOUT YOU
           ================================================================ */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                Builder Headline
              </label>
              <input
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="e.g., Backend & ML builder looking for a Frontend teammate"
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                A short one-liner shown at the top of your card.
              </span>
            </div>

            <div className="space-y-2">
              <label className="block font-semibold text-slate-800 dark:text-slate-200">
                What are you excited to build? (Choose up to 5 interests)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {INTEREST_TAXONOMY.map((tag) => {
                  const selected = interestTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setInterestTags(toggleItem(interestTags, tag, 5))}
                      className={`px-2.5 py-1.5 rounded-md border transition-colors cursor-pointer ${
                        selected
                          ? 'bg-blue-600 text-white border-blue-600 font-medium'
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block font-semibold text-slate-800 dark:text-slate-200">
                Preferred Roles (Choose up to 3 roles you can contribute)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ROLE_TAXONOMY.map((role) => {
                  const selected = preferredRoles.includes(role);
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setPreferredRoles(toggleItem(preferredRoles, role, 3))}
                      className={`px-2.5 py-1.5 rounded-md border cursor-pointer ${
                        selected
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 font-medium'
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {role}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block font-semibold text-slate-800 dark:text-slate-200">
                Your Skills & Tools
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {skillTags.map((sk) => (
                  <button
                    key={sk}
                    type="button"
                    onClick={() => setSkillTags(skillTags.filter((s) => s !== sk))}
                    className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-800 dark:text-slate-200 rounded-md inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>{sk}</span>
                    <X className="w-3 h-3 text-slate-400" />
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newSkillInput}
                  onChange={(e) => setNewSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      handleAddSkill();
                    }
                  }}
                  placeholder="Type a skill (e.g., React, Python, ESP32) and press Enter..."
                  className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
                <button
                  type="button"
                  onClick={handleAddSkill}
                  className="px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-medium rounded-lg cursor-pointer"
                >
                  Add Skill
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================
            STEP 2 — YOUR WORK (Optional Projects & GitHub Import)
           ================================================================ */}
        {step === 2 && (
          <div className="space-y-5">
            {/* Manual Projects Section */}
            <div className="space-y-2.5">
              <div>
                <label className="block font-semibold text-slate-800 dark:text-slate-200">
                  Projects, Coursework, or Ideas (Optional)
                </label>
                <p className="text-slate-500 text-[11px]">
                  Class assignments, lab experiments, and hackathon ideas all count—no polished portfolio required.
                </p>
              </div>

              {featuredProjects.length > 0 && (
                <div className="space-y-2">
                  {featuredProjects.map((fp) => (
                    <div
                      key={fp.id}
                      className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {fp.title}
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                          {fp.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setFeaturedProjects(featuredProjects.filter((p) => p.id !== fp.id))
                        }
                        aria-label={`Remove ${fp.title}`}
                        className="text-slate-400 hover:text-red-600 cursor-pointer p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="p-3.5 bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5">
                <input
                  type="text"
                  value={newProjTitle}
                  onChange={(e) => setNewProjTitle(e.target.value)}
                  placeholder="Project or lab title (e.g., Ultrasonic Room Counter)"
                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProjDesc}
                    onChange={(e) => setNewProjDesc(e.target.value)}
                    placeholder="One sentence describing what you built or learned..."
                    className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={handleAddManualProject}
                    className="px-3 py-1.5 font-semibold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Optional GitHub Import & AI Suggestions */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-blue-600" />
                    Import from GitHub (Optional)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Suggests skills and project summaries from your public repositories. Nothing is added until you approve it.
                  </p>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  {executionMode === 'live' ? 'Live API Mode' : 'Demo Mode'}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={githubUsername}
                  onChange={(e) => setGithubUsername(e.target.value)}
                  placeholder="Enter GitHub username (e.g., Roshan2607)"
                  className="flex-1 px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={isImportingGithub}
                  onClick={() => handleRunGitHubImport()}
                  className="px-4 py-2 font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-lg cursor-pointer whitespace-nowrap inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isImportingGithub ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Fetching...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      {executionMode === 'live'
                        ? 'Import Live GitHub + Gemini'
                        : 'Preview Suggestions (Demo)'}
                    </>
                  )}
                </button>
              </div>

              {githubError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2 text-red-800 dark:text-red-200">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <div>
                    <span className="font-semibold block">GitHub / Gemini Import Error</span>
                    <span>{githubError}</span>
                  </div>
                </div>
              )}

              {evidenceDraft && (
                <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      Review Suggested Additions ({evidenceDraft.isLiveApiResult ? 'Live API Result' : 'Demo Preview'})
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Uncheck anything you don't want on your profile
                    </span>
                  </div>

                  {/* Suggested Skills Checkboxes */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block">
                      Suggested Skills:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {evidenceDraft.suggestedSkills.map((sk) => (
                        <label
                          key={sk.name}
                          className={`px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-2 cursor-pointer ${
                            sk.approved
                              ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-300 dark:border-blue-800 text-blue-900 dark:text-blue-200'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={sk.approved}
                            onChange={() => handleToggleDraftSkill(sk.name)}
                          />
                          <span className="font-medium">{sk.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Editable Suggested Project */}
                  <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <label className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={evidenceDraft.suggestedProject.approved}
                        onChange={() =>
                          setEvidenceDraft({
                            ...evidenceDraft,
                            suggestedProject: {
                              ...evidenceDraft.suggestedProject,
                              approved: !evidenceDraft.suggestedProject.approved,
                            },
                          })
                        }
                      />
                      Include Suggested Project Summary (Editable):
                    </label>
                    {evidenceDraft.suggestedProject.approved && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editableDraftProjTitle}
                          onChange={(e) => setEditableDraftProjTitle(e.target.value)}
                          className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                        />
                        <input
                          type="text"
                          value={editableDraftProjDesc}
                          onChange={(e) => setEditableDraftProjDesc(e.target.value)}
                          className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                        />
                      </div>
                    )}
                  </div>

                  {draftApprovedMsg && (
                    <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{draftApprovedMsg}</span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleApplyApprovedDraft}
                      className="px-3.5 py-1.5 font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Add Approved Items to Profile
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================
            STEP 3 — PREFERENCES & COLLAPSIBLE ADVANCED SETTINGS
           ================================================================ */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="block font-semibold text-slate-800 dark:text-slate-200">
                How do you like collaborating?
              </label>
              <div className="flex flex-wrap gap-1.5">
                {WORK_STYLE_TAXONOMY.map((ws) => {
                  const active = workingStyleTags.includes(ws);
                  return (
                    <button
                      key={ws}
                      type="button"
                      onClick={() => setWorkingStyleTags(toggleItem(workingStyleTags, ws, 3))}
                      className={`px-2.5 py-1.5 rounded-md border cursor-pointer ${
                        active
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 font-medium'
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {ws}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block font-semibold text-slate-800 dark:text-slate-200">
                Roles you want to explore or learn (Optional)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ROLE_TAXONOMY.map((role) => {
                  const selected = rolesWantToLearn.includes(role);
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setRolesWantToLearn(toggleItem(rolesWantToLearn, role, 3))}
                      className={`px-2.5 py-1.5 rounded-md border cursor-pointer ${
                        selected
                          ? 'bg-emerald-600 text-white border-emerald-600 font-medium'
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {role}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                  Profile Visibility
                </label>
                <select
                  value={visibility}
                  onChange={(e) =>
                    setVisibility(e.target.value as 'public_verified_students' | 'hidden')
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  <option value="public_verified_students">Visible to Verified PES Students</option>
                  <option value="hidden">Hidden / Pause Discovery</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                  Optional Technical Icebreaker
                </label>
                <input
                  type="text"
                  value={icebreakerPrompt}
                  onChange={(e) => setIcebreakerPrompt(e.target.value)}
                  placeholder="e.g., I build the API; you make it look great?"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Collapsible Advanced Settings */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 font-medium cursor-pointer"
              >
                {showAdvanced ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                Advanced & Experience Settings (Optional)
              </button>

              {showAdvanced && (
                <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Extended Bio / About Notes
                    </label>
                    <textarea
                      rows={2}
                      value={about}
                      onChange={(e) => setAbout(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={isFirstTimeHacker}
                        onChange={(e) => setIsFirstTimeHacker(e.target.checked)}
                      />
                      <span>I am a first-time hacker (prioritize interest & schedule match)</span>
                    </label>

                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-500">
                      <input
                        type="checkbox"
                        checked={simulateMaliciousReadme}
                        onChange={(e) => setSimulateMaliciousReadme(e.target.checked)}
                      />
                      <span>Test README sanitization in Demo Mode</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Navigation & Save Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Save Draft for Later
            </button>
          </div>

          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((step - 1) as OnboardingStep)}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                ← Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep((step + 1) as OnboardingStep)}
                className="px-4 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 rounded-lg cursor-pointer"
              >
                Next Step →
              </button>
            ) : null}
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
            >
              Save Profile
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
