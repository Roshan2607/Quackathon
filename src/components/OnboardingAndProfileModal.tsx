import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  GitBranch,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
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
import { runBoundedGitHubEnrichmentDraft } from '../services/adapters';

interface OnboardingAndProfileModalProps {
  currentUser: User;
  profile: Profile;
  onSaveProfile: (updated: Profile) => void;
  onClose: () => void;
}

export const OnboardingAndProfileModal: React.FC<OnboardingAndProfileModalProps> = ({
  currentUser,
  profile,
  onSaveProfile,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'onboarding' | 'github_ai'>('onboarding');

  // Editable Profile State
  const [headline, setHeadline] = useState(profile.headline);
  const [about, setAbout] = useState(profile.about);
  const [interestTags, setInterestTags] = useState<string[]>(profile.interestTags);
  const [preferredRoles, setPreferredRoles] = useState<string[]>(profile.preferredRoles);
  const [rolesWantToLearn, setRolesWantToLearn] = useState<string[]>(profile.rolesWantToLearn);
  const [skillTags, setSkillTags] = useState<string[]>(profile.skillTags);
  const [newSkillInput, setNewSkillInput] = useState('');
  const [workingStyleTags, setWorkingStyleTags] = useState<string[]>(profile.workingStyleTags);
  const [icebreakerPrompt, setIcebreakerPrompt] = useState(profile.icebreakerPrompt ?? '');
  const [isFirstTimeHacker, setIsFirstTimeHacker] = useState(Boolean(profile.isFirstTimeHacker));
  const [visibility, setVisibility] = useState<'public_verified_students' | 'hidden'>(
    profile.visibility
  );
  const [featuredProjects, setFeaturedProjects] = useState<FeaturedProject[]>(
    profile.featuredProjects
  );
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');

  // GitHub + Bounded Gemini Draft Review State
  const [githubUsername, setGithubUsername] = useState(
    profile.githubUsername ?? 'arjun-pes-demo'
  );
  const [simulateMaliciousReadme, setSimulateMaliciousReadme] = useState(false);
  const [evidenceDraft, setEvidenceDraft] = useState<ProfileEvidenceDraft | null>(null);
  const [draftApprovedMsg, setDraftApprovedMsg] = useState<string | null>(null);

  const toggleItem = (list: string[], item: string, max?: number): string[] => {
    if (list.includes(item)) {
      return list.filter((x) => x !== item);
    }
    if (max && list.length >= max) return list;
    return [...list, item];
  };

  const handleRunGitHubImport = () => {
    setDraftApprovedMsg(null);
    const draft = runBoundedGitHubEnrichmentDraft({
      uid: currentUser.uid,
      githubUsername,
      simulateMaliciousReadme,
    });
    setEvidenceDraft(draft);
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

    let nextProjects = [...featuredProjects];
    if (evidenceDraft.suggestedProject.approved) {
      const exists = nextProjects.some(
        (p) => p.title === evidenceDraft.suggestedProject.title
      );
      if (!exists) {
        nextProjects = [
          ...nextProjects,
          {
            id: `proj_gh_${Date.now()}`,
            title: evidenceDraft.suggestedProject.title,
            description: evidenceDraft.suggestedProject.description,
            sourceUrl: evidenceDraft.suggestedProject.sourceUrl,
            tags: evidenceDraft.suggestedProject.tags,
          },
        ];
        setFeaturedProjects(nextProjects);
      }
    }

    setDraftApprovedMsg(
      `Published ${approvedSkillNames.length} user-approved skills to your profile draft. Unchecked suggestions were discarded and will never appear publicly.`
    );
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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
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
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-3xl w-full p-6 space-y-5 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <p className="text-xs text-slate-500">
              Interest-First Onboarding & Mandatory AI Evidence Review · {currentUser.displayName}
            </p>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Edit Builder Profile & GitHub Enrichment
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setActiveTab('onboarding')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
              activeTab === 'onboarding'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            1. Guided Interest & Role Onboarding (No GitHub Required)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('github_ai')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer inline-flex items-center gap-1.5 ${
              activeTab === 'github_ai'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            2. Consented GitHub Import + Gemini Review Gate
          </button>
        </div>

        {activeTab === 'onboarding' ? (
          <form onSubmit={handleSave} className="space-y-5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                  One-Line Builder Headline
                </label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex flex-col justify-between">
                <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                  Profile Discovery Visibility & Experience Mode
                </label>
                <div className="flex items-center gap-3">
                  <select
                    value={visibility}
                    onChange={(e) =>
                      setVisibility(e.target.value as 'public_verified_students' | 'hidden')
                    }
                    className="px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="public_verified_students">Visible to Verified PES Students</option>
                    <option value="hidden">Private / Hidden from Discovery</option>
                  </select>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={isFirstTimeHacker}
                      onChange={(e) => setIsFirstTimeHacker(e.target.checked)}
                    />
                    First-time hacker (Cold-start boost)
                  </label>
                </div>
              </div>
            </div>

            {/* Q1: What are you excited to build? */}
            <div className="space-y-2">
              <label className="block font-semibold text-slate-800 dark:text-slate-200">
                Q1. What are you excited to build? (Choose up to 5 problem domains — powers Interest Circles & 35% peer matching)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {INTEREST_TAXONOMY.map((tag) => {
                  const selected = interestTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setInterestTags(toggleItem(interestTags, tag, 5))}
                      className={`px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                        selected
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Q2: Roles can contribute vs wants to learn */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block font-semibold text-slate-800 dark:text-slate-200">
                  Q2a. Roles you can contribute right now:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_TAXONOMY.map((role) => {
                    const selected = preferredRoles.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => setPreferredRoles(toggleItem(preferredRoles, role, 3))}
                        className={`px-2.5 py-1 rounded-md border cursor-pointer ${
                          selected
                            ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900'
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
                  Q2b. Roles you want to learn / explore:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_TAXONOMY.map((role) => {
                    const selected = rolesWantToLearn.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => setRolesWantToLearn(toggleItem(rolesWantToLearn, role, 3))}
                        className={`px-2.5 py-1 rounded-md border cursor-pointer ${
                          selected
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {role}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Approved Skills */}
            <div className="space-y-2">
              <label className="block font-semibold text-slate-800 dark:text-slate-200">
                Approved Skill Tags (Click any tag to remove; AI suggestions never appear without your approval)
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
                <div className="inline-flex items-center gap-1">
                  <input
                    type="text"
                    value={newSkillInput}
                    onChange={(e) => setNewSkillInput(e.target.value)}
                    placeholder="Add skill (e.g., Rust)"
                    className="px-2.5 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newSkillInput.trim() && !skillTags.includes(newSkillInput.trim())) {
                        setSkillTags([...skillTags, newSkillInput.trim()]);
                        setNewSkillInput('');
                      }
                    }}
                    className="px-2.5 py-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Q3: What have you worked on? (Coursework, labs, or GitHub projects) */}
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="block font-semibold text-slate-800 dark:text-slate-200">
                Q3. What have you worked on? (GitHub repos, class assignments, lab experiments, or ideas all count)
              </label>
              <div className="space-y-2">
                {featuredProjects.map((fp) => (
                  <div
                    key={fp.id}
                    className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg flex items-start justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">{fp.title}</div>
                      <p className="text-slate-600 dark:text-slate-300 mt-0.5">{fp.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setFeaturedProjects(featuredProjects.filter((p) => p.id !== fp.id))
                      }
                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <input
                    type="text"
                    value={newProjTitle}
                    onChange={(e) => setNewProjTitle(e.target.value)}
                    placeholder="Project or coursework title..."
                    className="px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                  <input
                    type="text"
                    value={newProjDesc}
                    onChange={(e) => setNewProjDesc(e.target.value)}
                    placeholder="One concrete sentence on what it does..."
                    className="px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={handleAddManualProject}
                    className="px-3 py-1.5 font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Project / Lab
                  </button>
                </div>
              </div>
            </div>

            {/* Q4 & Technical One-Liner */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-800 dark:text-slate-200">
                  Q4. Collaboration Preferences:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {WORK_STYLE_TAXONOMY.map((ws) => {
                    const active = workingStyleTags.includes(ws);
                    return (
                      <button
                        key={ws}
                        type="button"
                        onClick={() => setWorkingStyleTags(toggleItem(workingStyleTags, ws, 3))}
                        className={`px-2.5 py-1 rounded-md border cursor-pointer ${
                          active
                            ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900'
                            : 'bg-white dark:bg-slate-950 text-slate-600 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {ws}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-800 dark:text-slate-200">
                  Optional Technical One-Liner / Opener:
                </label>
                <input
                  type="text"
                  value={icebreakerPrompt}
                  onChange={(e) => setIcebreakerPrompt(e.target.value)}
                  placeholder="e.g., I can build the API; you make it look less like a Swagger screenshot?"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 font-medium text-slate-600 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
              >
                Save & Publish Approved Profile
              </button>
            </div>
          </form>
        ) : (
          /* Tab 2: Consented GitHub Import + Bounded Gemini JSON Schema Review */
          <div className="space-y-5 text-xs">
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
              <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-blue-600" />
                Section 8 Bounded AI Enrichment & Untrusted README Guard
              </div>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                Gemini is called only on onboarding import or manual refresh using a strict JSON Schema—never on every swipe. Imported repository text is treated as untrusted input, and every suggested skill or project requires your explicit review before appearing publicly.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <input
                type="text"
                value={githubUsername}
                onChange={(e) => setGithubUsername(e.target.value)}
                placeholder="GitHub username"
                className="flex-1 px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-slate-900 dark:text-slate-100"
              />
              <label className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simulateMaliciousReadme}
                  onChange={(e) => setSimulateMaliciousReadme(e.target.checked)}
                />
                Simulate Malicious README Prompt Injection
              </label>
              <button
                type="button"
                onClick={handleRunGitHubImport}
                className="px-4 py-2 font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-lg cursor-pointer whitespace-nowrap"
              >
                Fetch Public Repos & Extract Draft
              </button>
            </div>

            {evidenceDraft && (
              <div className="p-5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <span className="font-mono text-slate-500 block">
                      Source: {evidenceDraft.sourceUrl}
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      Private AI Extraction Draft (Not Public Until You Approve)
                    </h3>
                  </div>
                  <span className="text-amber-600 font-semibold">Mandatory User Review</span>
                </div>

                <p className="text-slate-600 dark:text-slate-300">
                  {evidenceDraft.rawEvidenceSummary}
                </p>

                {evidenceDraft.sanitizedWarnings.length > 0 && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg space-y-1 text-amber-900 dark:text-amber-200">
                    {evidenceDraft.sanitizedWarnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                    Review Suggested Skills (Uncheck any inaccurate or low-confidence attribution):
                  </span>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                    {evidenceDraft.suggestedSkills.map((sk) => (
                      <label
                        key={sk.name}
                        className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900"
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={sk.approved}
                            onChange={() => handleToggleDraftSkill(sk.name)}
                          />
                          <div>
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              {sk.name}
                            </span>{' '}
                            <span className="text-slate-400">({sk.category})</span>
                            <p className="text-slate-500">Evidence: {sk.reason}</p>
                          </div>
                        </div>
                        <span
                          className={`font-mono uppercase text-[11px] font-semibold ${
                            sk.confidence === 'high'
                              ? 'text-emerald-600'
                              : sk.confidence === 'medium'
                              ? 'text-blue-600'
                              : 'text-amber-600'
                          }`}
                        >
                          {sk.confidence} confidence
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {draftApprovedMsg && (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{draftApprovedMsg}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleApplyApprovedDraft}
                    className="px-4 py-2 font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve Selected Items into Profile
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
