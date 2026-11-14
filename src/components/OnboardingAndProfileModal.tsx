import React, { useEffect, useState } from 'react';
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
  Github,
  Check,
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Bookmark,
} from 'lucide-react';
import {
  fetchLiveGitHubRepositoriesDeterministically,
  runBoundedGitHubEnrichmentDraft,
  runLiveGitHubAndGeminiEnrichment,
} from '../services/adapters';
import { Modal } from './Modal';

interface ChipListEditorProps {
  label: string;
  hint?: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}

/**
 * Compact chip editor used by the optional profile fields. Keeps the student
 * UX short: type, press Add, remove with the × on a chip.
 */
const ChipListEditor: React.FC<ChipListEditorProps> = ({
  label,
  hint,
  placeholder,
  values,
  onChange,
}) => {
  const [draft, setDraft] = useState('');

  const addValue = () => {
    const trimmed = draft.trim();
    if (
      trimmed &&
      !values.some((v) => v.toLowerCase() === trimmed.toLowerCase())
    ) {
      onChange([...values, trimmed]);
      setDraft('');
    }
  };

  return (
    <div>
      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
        {label}
        {hint && (
          <span className="ml-1 font-normal text-slate-400">{hint}</span>
        )}
      </label>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium"
            >
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                className="text-slate-400 hover:text-red-600 cursor-pointer"
                aria-label={`Remove ${value}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addValue();
            }
          }}
          placeholder={placeholder}
          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
        />
        <button
          type="button"
          onClick={addValue}
          className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
        >
          Add
        </button>
      </div>
    </div>
  );
};

interface PortfolioLink {
  label: string;
  url: string;
}

const PortfolioLinkEditor: React.FC<{
  links: PortfolioLink[];
  onChange: (links: PortfolioLink[]) => void;
}> = ({ links, onChange }) => {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  const addLink = () => {
    const trimmedLabel = label.trim();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    onChange([
      ...links,
      {
        label: trimmedLabel || trimmedUrl,
        url: trimmedUrl,
      },
    ]);
    setLabel('');
    setUrl('');
  };

  return (
    <div>
      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
        Portfolio Links
        <span className="ml-1 font-normal text-slate-400">(Optional)</span>
      </label>
      {links.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {links.map((link, index) => (
            <div
              key={`${link.url}-${index}`}
              className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400"
            >
              <span className="truncate">
                <strong className="text-slate-700 dark:text-slate-300">
                  {link.label}
                </strong>{' '}
                · {link.url}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChange(links.filter((_, i) => i !== index))
                }
                className="text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                aria-label="Remove portfolio link"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. GitHub)"
          className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
        />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
        />
        <button
          type="button"
          onClick={addLink}
          className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
        >
          Add
        </button>
      </div>
    </div>
  );
};

interface OnboardingAndProfileModalProps {
  currentUser: User;
  profile: Profile;
  executionMode: ExecutionMode;
  isInline?: boolean;
  onSaveProfile: (
    updatedProfile: Profile,
    updatedPrivacy: User['privacyPreferences']
  ) => void;
  onClose: () => void;
  onNotify?: (msg: string) => void;
}

export const OnboardingAndProfileModal: React.FC<OnboardingAndProfileModalProps> = ({
  currentUser,
  profile,
  executionMode,
  isInline = false,
  onSaveProfile,
  onClose,
  onNotify,
}) => {
  const draftStorageKey = `quackathon_profile_draft_${currentUser.uid}`;

  const loadInitialProfile = (): Profile => {
    try {
      const saved = localStorage.getItem(draftStorageKey);
      if (saved) {
        return { ...profile, ...JSON.parse(saved) };
      }
    } catch {
      // Ignore corrupt draft
    }
    return profile;
  };

  const initial = loadInitialProfile();

  // Essential fields shown initially
  const [headline, setHeadline] = useState(initial.headline);
  const [interestTags, setInterestTags] = useState<string[]>(initial.interestTags);
  const [customInterestInput, setCustomInterestInput] = useState('');
  const [skillTags, setSkillTags] = useState<string[]>(initial.skillTags);
  const [customSkillInput, setCustomSkillInput] = useState('');
  const [preferredRoles, setPreferredRoles] = useState<string[]>(
    initial.preferredRoles
  );
  const [featuredProjects, setFeaturedProjects] = useState<FeaturedProject[]>(
    initial.featuredProjects
  );

  // Add Project inline state
  const [showAddProjectForm, setShowAddProjectForm] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjTags, setNewProjTags] = useState('');

  // Progressive disclosure expandable sections
  const [showGitHubSection, setShowGitHubSection] = useState(false);
  const [showPreferencesSection, setShowPreferencesSection] = useState(false);
  const [showAdvancedSection, setShowAdvancedSection] = useState(false);

  // GitHub & AI Suggestions state
  const [githubUsername, setGithubUsername] = useState(
    initial.githubUsername ?? ''
  );
  const [enrichmentDraft, setEnrichmentDraft] =
    useState<ProfileEvidenceDraft | null>(null);
  const [isFetchingGitHub, setIsFetchingGitHub] = useState(false);
  const [isEnhancingWithAI, setIsEnhancingWithAI] = useState(false);
  const [githubStatusError, setGithubStatusError] = useState<string | null>(null);

  // Collaboration Preferences & Advanced Options
  const [about, setAbout] = useState(initial.about);
  const [rolesWantToLearn, setRolesWantToLearn] = useState<string[]>(
    initial.rolesWantToLearn
  );
  const [workingStyleTags, setWorkingStyleTags] = useState<string[]>(
    initial.workingStyleTags
  );
  const [icebreakerPrompt, setIcebreakerPrompt] = useState(
    initial.icebreakerPrompt ?? ''
  );
  const [isFirstTimeHacker, setIsFirstTimeHacker] = useState(
    Boolean(initial.isFirstTimeHacker)
  );
  const [visibility, setVisibility] = useState<Profile['visibility']>(
    initial.visibility
  );
  const [privacyPreferences, setPrivacyPreferences] = useState<
    User['privacyPreferences']
  >(currentUser.privacyPreferences);

  // Interest-first profile detail (persisted server-side)
  const [projectDomains, setProjectDomains] = useState<string[]>(
    initial.projectDomains ?? []
  );
  const [topicsToExplore, setTopicsToExplore] = useState<string[]>(
    initial.topicsToExplore ?? []
  );
  const [hackathonGoals, setHackathonGoals] = useState<string[]>(
    initial.hackathonGoals ?? []
  );
  const [portfolioLinks, setPortfolioLinks] = useState<
    { label: string; url: string }[]
  >(initial.portfolioLinks ?? []);

  useEffect(() => {
    setHeadline(profile.headline);
    setInterestTags(profile.interestTags);
    setSkillTags(profile.skillTags);
    setPreferredRoles(profile.preferredRoles);
    setFeaturedProjects(profile.featuredProjects);
    setGithubUsername(profile.githubUsername ?? '');
    setAbout(profile.about);
    setRolesWantToLearn(profile.rolesWantToLearn);
    setWorkingStyleTags(profile.workingStyleTags);
    setIcebreakerPrompt(profile.icebreakerPrompt ?? '');
    setIsFirstTimeHacker(Boolean(profile.isFirstTimeHacker));
    setVisibility(profile.visibility);
    setPrivacyPreferences(currentUser.privacyPreferences);
    setProjectDomains(profile.projectDomains ?? []);
    setTopicsToExplore(profile.topicsToExplore ?? []);
    setHackathonGoals(profile.hackathonGoals ?? []);
    setPortfolioLinks(profile.portfolioLinks ?? []);
  }, [currentUser.uid, profile, currentUser.privacyPreferences]);

  const toggleItem = (
    item: string,
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    if (list.includes(item)) {
      setter(list.filter((i) => i !== item));
    } else {
      setter([...list, item]);
    }
  };

  const handleAddCustomInterest = () => {
    const trimmed = customInterestInput.trim();
    if (trimmed && !interestTags.includes(trimmed)) {
      setInterestTags([...interestTags, trimmed]);
      setCustomInterestInput('');
    }
  };

  const handleAddCustomSkill = () => {
    const trimmed = customSkillInput.trim();
    if (trimmed && !skillTags.includes(trimmed)) {
      setSkillTags([...skillTags, trimmed]);
      setCustomSkillInput('');
    }
  };

  const handleAddProject = () => {
    if (!newProjTitle.trim() || !newProjDesc.trim()) return;
    const proj: FeaturedProject = {
      id: `proj_${Date.now()}`,
      title: newProjTitle.trim(),
      description: newProjDesc.trim(),
      tags: newProjTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    setFeaturedProjects([...featuredProjects, proj]);
    setNewProjTitle('');
    setNewProjDesc('');
    setNewProjTags('');
    setShowAddProjectForm(false);
    onNotify?.('Project added to profile.');
  };

  // Requirement #7: Fast deterministic GitHub import WITHOUT Gemini initially
  const handleRunDeterministicGitHubImport = async () => {
    const username = githubUsername.trim();
    if (!username) {
      setGithubStatusError('Enter your GitHub username first.');
      return;
    }
    setIsFetchingGitHub(true);
    setGithubStatusError(null);
    try {
      if (executionMode === 'live') {
        const res = await fetchLiveGitHubRepositoriesDeterministically({
          uid: currentUser.uid,
          githubUsername: username,
        });
        if (res.ok && res.draft) {
          setEnrichmentDraft(res.draft);
          onNotify?.(
            `Fetched ${
              res.rawGitHubPayload?.repositories?.length ?? 0
            } public repositories from GitHub. Select items to include.`
          );
          return;
        }
        setGithubStatusError(
          res.errorMessage || 'Could not fetch GitHub repositories for this username.'
        );
        return;
      }

      const demoDraft = runBoundedGitHubEnrichmentDraft({
        uid: currentUser.uid,
        githubUsername: username,
      });
      setEnrichmentDraft(demoDraft);
      onNotify?.('Loaded sample repository suggestions. Check items to include.');
    } finally {
      setIsFetchingGitHub(false);
    }
  };

  // Requirement #7: Optional Gemini enhancement with strict timeout & fallback
  const handleEnhanceWithAI = async () => {
    const username = githubUsername.trim();
    if (!username) {
      setGithubStatusError('Enter your GitHub username first.');
      return;
    }
    setIsEnhancingWithAI(true);
    setGithubStatusError(null);
    try {
      const res = await runLiveGitHubAndGeminiEnrichment({
        uid: currentUser.uid,
        githubUsername: username,
        useGemini: true,
      });
      if (res.ok && res.draft) {
        setEnrichmentDraft(res.draft);
        onNotify?.(
          res.errorMessage
            ? res.errorMessage
            : 'Enhanced repository descriptions with AI. Review and approve items before adding.'
        );
        return;
      }
      setGithubStatusError(
        res.errorMessage || 'AI enhancement is unavailable right now.'
      );
    } finally {
      setIsEnhancingWithAI(false);
    }
  };

  const toggleSuggestedSkill = (idx: number) => {
    if (!enrichmentDraft) return;
    const next = [...enrichmentDraft.suggestedSkills];
    next[idx] = { ...next[idx], approved: !next[idx].approved };
    setEnrichmentDraft({ ...enrichmentDraft, suggestedSkills: next });
  };

  const toggleSuggestedProject = (idx: number) => {
    if (!enrichmentDraft || !enrichmentDraft.suggestedProjects) return;
    const next = [...enrichmentDraft.suggestedProjects];
    next[idx] = { ...next[idx], approved: !next[idx].approved };
    setEnrichmentDraft({
      ...enrichmentDraft,
      suggestedProjects: next,
      suggestedProject: next[0]
        ? {
            ...next[0],
            sourceUrl:
              next[0].sourceUrl ??
              (githubUsername.trim()
                ? `https://github.com/${githubUsername.trim()}`
                : ''),
          }
        : enrichmentDraft.suggestedProject,
    });
  };

  const handleApplyApprovedSuggestions = () => {
    if (!enrichmentDraft) return;
    const approvedSkills = enrichmentDraft.suggestedSkills
      .filter((s) => s.approved)
      .map((s) => s.name);
    setSkillTags(Array.from(new Set([...skillTags, ...approvedSkills])));

    const newProjects: FeaturedProject[] = [];
    if (
      enrichmentDraft.suggestedProjects &&
      enrichmentDraft.suggestedProjects.length > 0
    ) {
      for (const sp of enrichmentDraft.suggestedProjects) {
        if (sp.approved) {
          newProjects.push({
            id: `gh_proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: sp.title,
            description: sp.description,
            sourceUrl: sp.sourceUrl,
            tags: sp.tags,
          });
        }
      }
    } else if (enrichmentDraft.suggestedProject?.approved) {
      newProjects.push({
        id: `gh_proj_${Date.now()}`,
        title: enrichmentDraft.suggestedProject.title,
        description: enrichmentDraft.suggestedProject.description,
        sourceUrl: enrichmentDraft.suggestedProject.sourceUrl,
        tags: enrichmentDraft.suggestedProject.tags,
      });
    }

    if (newProjects.length > 0) {
      const existingTitles = new Set(
        featuredProjects.map((p) => p.title.toLowerCase())
      );
      const unique = newProjects.filter(
        (p) => !existingTitles.has(p.title.toLowerCase())
      );
      setFeaturedProjects([...featuredProjects, ...unique]);
    }

    setEnrichmentDraft(null);
    onNotify?.(
      `Applied ${approvedSkills.length} approved skill(s) and ${newProjects.length} project(s) to your profile.`
    );
  };

  const buildUpdatedProfile = (): Profile => ({
    ...profile,
    headline: headline.trim() || 'PES University Builder',
    about: about.trim(),
    interestTags,
    skillTags,
    // "What I like building" defaults to the selected interests so the
    // matching engine always has a domain signal.
    projectDomains:
      projectDomains.length > 0 ? projectDomains : interestTags,
    topicsToExplore,
    preferredRoles:
      preferredRoles.length > 0 ? preferredRoles : ['Generalist'],
    rolesWantToLearn,
    workingStyleTags,
    hackathonGoals,
    portfolioLinks,
    featuredProjects,
    githubUsername: githubUsername.trim() || undefined,
    icebreakerPrompt: icebreakerPrompt.trim() || undefined,
    isFirstTimeHacker,
    visibility,
    updatedAt: new Date().toISOString(),
  });

  const handleSaveDraft = () => {
    try {
      localStorage.setItem(
        draftStorageKey,
        JSON.stringify(buildUpdatedProfile())
      );
      onNotify?.('Draft saved locally.');
    } catch {
      onNotify?.('Could not save draft.');
    }
  };

  const handleSaveFinal = () => {
    const updated = buildUpdatedProfile();
    try {
      localStorage.removeItem(draftStorageKey);
    } catch {
      // ignore
    }
    onSaveProfile(updated, privacyPreferences);
    if (!isInline) {
      onClose();
    }
  };

  const formContent = (
    <div className="space-y-5">
      {/* 1. Headline */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
          Headline
        </label>
        <input
          type="text"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="e.g., First-year CSE exploring Frontend & Applied AI"
          className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-slate-100"
        />
      </div>

      {/* 2. Interests */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
          Interests
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {INTEREST_TAXONOMY.map((interest) => {
            const active = interestTags.includes(interest);
            return (
              <button
                key={interest}
                type="button"
                onClick={() =>
                  toggleItem(interest, interestTags, setInterestTags)
                }
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                }`}
              >
                {interest}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={customInterestInput}
            onChange={(e) => setCustomInterestInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' &&
              (e.preventDefault(), handleAddCustomInterest())
            }
            placeholder="Add custom interest..."
            className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          />
          <button
            type="button"
            onClick={handleAddCustomInterest}
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            Add
          </button>
        </div>
      </div>

      {/* 3. Skills & Preferred Roles */}
      <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Preferred Roles
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ROLE_TAXONOMY.map((role) => {
              const active = preferredRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() =>
                    toggleItem(role, preferredRoles, setPreferredRoles)
                  }
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {role}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Skills & Tools
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {skillTags.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium"
              >
                {skill}
                <button
                  type="button"
                  onClick={() =>
                    setSkillTags(skillTags.filter((s) => s !== skill))
                  }
                  className="text-slate-400 hover:text-red-600 cursor-pointer"
                  aria-label={`Remove ${skill}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={customSkillInput}
              onChange={(e) => setCustomSkillInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                (e.preventDefault(), handleAddCustomSkill())
              }
              placeholder="Add a language, framework, or tool..."
              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
            <button
              type="button"
              onClick={handleAddCustomSkill}
              className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              Add Skill
            </button>
          </div>
        </div>
      </div>

      {/* 4. Projects (Optional) */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Projects{' '}
            <span className="text-slate-400 font-normal">(Optional)</span>
          </label>
          {!showAddProjectForm && (
            <button
              type="button"
              onClick={() => setShowAddProjectForm(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Project
            </button>
          )}
        </div>

        {featuredProjects.length > 0 ? (
          <div className="space-y-2 mb-2">
            {featuredProjects.map((proj) => (
              <div
                key={proj.id}
                className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {proj.title}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                    {proj.description}
                  </p>
                  {proj.tags.length > 0 && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      {proj.tags.join(' · ')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setFeaturedProjects(
                      featuredProjects.filter((p) => p.id !== proj.id)
                    )
                  }
                  className="text-slate-400 hover:text-red-600 p-1 shrink-0 cursor-pointer"
                  title="Remove project"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          !showAddProjectForm && (
            <p className="text-xs text-slate-500">
              No projects listed yet. Class projects or side builds are optional.
            </p>
          )
        )}

        {showAddProjectForm && (
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={newProjTitle}
                onChange={(e) => setNewProjTitle(e.target.value)}
                placeholder="Project title"
                className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
              />
              <input
                type="text"
                value={newProjTags}
                onChange={(e) => setNewProjTags(e.target.value)}
                placeholder="Tags (comma separated)"
                className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
              />
            </div>
            <input
              type="text"
              value={newProjDesc}
              onChange={(e) => setNewProjDesc(e.target.value)}
              placeholder="One-line description of what you built"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddProjectForm(false)}
                className="px-2.5 py-1 rounded text-xs text-slate-600 dark:text-slate-400 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddProject}
                className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Expandable Section 1: GitHub Enrichment & Optional AI Suggestions */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowGitHubSection(!showGitHubSection)}
          className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Github className="w-3.5 h-3.5" />
            Import from GitHub & AI Suggestions (Optional)
          </span>
          {showGitHubSection ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showGitHubSection && (
          <div className="p-3.5 bg-white dark:bg-slate-900 space-y-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={githubUsername}
                onChange={(e) => setGithubUsername(e.target.value)}
                placeholder="GitHub username (e.g., Roshan2607)"
                className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
              />
              <button
                type="button"
                disabled={isFetchingGitHub || isEnhancingWithAI}
                onClick={handleRunDeterministicGitHubImport}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Github className="w-3.5 h-3.5" />
                {isFetchingGitHub ? 'Fetching Repos...' : 'Import from GitHub (Fast)'}
              </button>
              <button
                type="button"
                disabled={isFetchingGitHub || isEnhancingWithAI}
                onClick={handleEnhanceWithAI}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                title="Optional: Use Gemini to summarize repositories and suggest skills"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                {isEnhancingWithAI ? 'Enhancing...' : 'Enhance with AI'}
              </button>
            </div>

            {githubStatusError && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {githubStatusError}
              </p>
            )}

            {enrichmentDraft && (
              <div className="p-3 rounded-lg bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 block">
                      Review & Approve Suggestions
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Nothing is added until you select items and click Add Selected.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyApprovedSuggestions}
                    className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Add Selected
                  </button>
                </div>

                {enrichmentDraft.suggestedSkills.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Suggested Languages & Topics
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {enrichmentDraft.suggestedSkills.map((s, idx) => (
                        <button
                          key={s.name}
                          type="button"
                          onClick={() => toggleSuggestedSkill(idx)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border cursor-pointer ${
                            s.approved
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300'
                          }`}
                        >
                          <Check className="w-3 h-3" />
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {enrichmentDraft.suggestedProjects &&
                  enrichmentDraft.suggestedProjects.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        Public Repositories ({enrichmentDraft.suggestedProjects.length})
                      </div>
                      {enrichmentDraft.suggestedProjects.map((proj, idx) => (
                        <div
                          key={`${proj.title}_${idx}`}
                          className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {proj.title}
                            </span>
                            <label className="inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer">
                              <input
                                type="checkbox"
                                checked={proj.approved}
                                onChange={() => toggleSuggestedProject(idx)}
                              />
                              Include
                            </label>
                          </div>
                          <p className="text-slate-600 dark:text-slate-400">
                            {proj.description}
                          </p>
                          {proj.tags.length > 0 && (
                            <p className="text-[11px] text-slate-400">
                              {proj.tags.join(' · ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expandable Section 2: Collaboration Preferences */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPreferencesSection(!showPreferencesSection)}
          className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
        >
          <span>Collaboration Style & Roles to Explore</span>
          {showPreferencesSection ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showPreferencesSection && (
          <div className="p-3.5 bg-white dark:bg-slate-900 space-y-3 border-t border-slate-200 dark:border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Working Style
              </label>
              <div className="flex flex-wrap gap-1.5">
                {WORK_STYLE_TAXONOMY.map((style) => {
                  const active = workingStyleTags.includes(style);
                  return (
                    <button
                      key={style}
                      type="button"
                      onClick={() =>
                        toggleItem(
                          style,
                          workingStyleTags,
                          setWorkingStyleTags
                        )
                      }
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border cursor-pointer ${
                        active
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200'
                      }`}
                    >
                      {style}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Roles You Want to Learn
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ROLE_TAXONOMY.map((role) => {
                  const active = rolesWantToLearn.includes(role);
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() =>
                        toggleItem(
                          role,
                          rolesWantToLearn,
                          setRolesWantToLearn
                        )
                      }
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border cursor-pointer ${
                        active
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white dark:bg-slate-900 text-slate-600 border-slate-200'
                      }`}
                    >
                      {role}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={isFirstTimeHacker}
                onChange={(e) => setIsFirstTimeHacker(e.target.checked)}
              />
              I am a first-time hacker (show beginner-friendly badge)
            </label>
          </div>
        )}
      </div>

      {/* Expandable Section 3: Advanced & Privacy Settings */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvancedSection(!showAdvancedSection)}
          className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
        >
          <span>Bio, Icebreaker & Privacy Options</span>
          {showAdvancedSection ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showAdvancedSection && (
          <div className="p-3.5 bg-white dark:bg-slate-900 space-y-3 border-t border-slate-200 dark:border-slate-800 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Short Bio
              </label>
              <textarea
                rows={2}
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Conversation Icebreaker
              </label>
              <input
                type="text"
                value={icebreakerPrompt}
                onChange={(e) => setIcebreakerPrompt(e.target.value)}
                placeholder="What part of the stack do you want to own?"
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>

            <ChipListEditor
              label="What I like building"
              hint="(Optional)"
              placeholder="e.g., Real-time transit telemetry"
              values={projectDomains}
              onChange={setProjectDomains}
            />

            <ChipListEditor
              label="Topics I want to explore"
              hint="(Optional)"
              placeholder="e.g., Rust, LLM evaluation"
              values={topicsToExplore}
              onChange={setTopicsToExplore}
            />

            <ChipListEditor
              label="Hackathon goals"
              hint="(Optional)"
              placeholder="e.g., Ship a usable app"
              values={hackathonGoals}
              onChange={setHackathonGoals}
            />

            <PortfolioLinkEditor
              links={portfolioLinks}
              onChange={setPortfolioLinks}
            />

            <div className="flex items-center justify-between pt-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Profile Visibility
              </span>
              <select
                value={visibility}
                onChange={(e) =>
                  setVisibility(e.target.value as Profile['visibility'])
                }
                className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="public_verified_students">
                  Visible to Verified PES Students
                </option>
                <option value="hidden">Hidden from Discover</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={privacyPreferences.academyAnnouncementsOptIn}
                onChange={(e) =>
                  setPrivacyPreferences({
                    ...privacyPreferences,
                    academyAnnouncementsOptIn: e.target.checked,
                  })
                }
              />
              Consent to fetch PESU Academy announcements when signed in with PESU OAuth
            </label>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleSaveDraft}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Bookmark className="w-3.5 h-3.5" />
          Save Draft
        </button>

        <button
          type="button"
          onClick={handleSaveFinal}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
        >
          Save Profile
        </button>
      </div>
    </div>
  );

  if (isInline) {
    return (
      <div className="max-w-2xl mx-auto bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5">
        <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Builder Profile
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {currentUser.displayName} · {currentUser.campus} · {currentUser.program}
          </p>
        </div>
        {formContent}
      </div>
    );
  }

  return (
    <Modal
      title="Edit Builder Profile"
      subtitle={`${currentUser.displayName} · ${currentUser.campus}`}
      onClose={onClose}
      maxWidthClass="max-w-xl"
    >
      {formContent}
    </Modal>
  );
};
