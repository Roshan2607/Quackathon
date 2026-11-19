import React, { useEffect, useMemo, useState } from 'react';
import {
  ExecutionMode,
  FeaturedProject,
  Profile,
  ProfileEvidenceDraft,
  User,
} from '../types/domain';
import { GitHubRepositoryItem } from '../types/apiContracts';
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
  Search,
  GitFork,
  ExternalLink,
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

function normalizeRepoIdentity(repo: {
  url?: string;
  htmlUrl?: string;
  sourceUrl?: string;
  name?: string;
  title?: string;
}, fallbackOwner?: string): string {
  const rawUrl = (repo.url || repo.htmlUrl || repo.sourceUrl || '').trim();
  if (rawUrl) {
    return rawUrl.toLowerCase().replace(/\/+$/, '');
  }
  const repoName = (repo.name || repo.title || '').trim().toLowerCase();
  const owner = (fallbackOwner || '').trim().toLowerCase();
  return owner ? `https://github.com/${owner}/${repoName}` : repoName;
}

type RepoFilterTab = 'all' | 'original' | 'forks';

export const QUICK_INTEREST_OPTIONS = [
  'AI/ML',
  'Web Development',
  'Cybersecurity',
  'Robotics',
  'Data Science',
  'Design',
  'Cloud & DevOps',
  'Mobile Apps',
  'Open Source Systems',
  'Blockchain',
];

export const QUICK_SKILL_OPTIONS = [
  'Python',
  'JavaScript',
  'React',
  'TypeScript',
  'Node.js',
  'SQL',
  'C++',
  'Figma',
  'Docker',
  'Go',
  'PyTorch',
  'Java',
];

export const QUICK_ROLE_OPTIONS = [
  'Frontend',
  'Backend',
  'ML/Data',
  'Design',
  'Hardware',
  'Flexible',
];

interface OnboardingAndProfileModalProps {
  currentUser: User;
  profile: Profile;
  executionMode: ExecutionMode;
  isInline?: boolean;
  isQuickSetup?: boolean;
  onSaveProfile: (
    updatedProfile: Profile,
    updatedPrivacy: User['privacyPreferences'],
    displayName?: string
  ) => void;
  onClose: () => void;
  onNotify?: (msg: string) => void;
}

export const OnboardingAndProfileModal: React.FC<OnboardingAndProfileModalProps> = ({
  currentUser,
  profile,
  executionMode,
  isInline = false,
  isQuickSetup = !isInline,
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

  // Display name & essential fields
  const [displayName, setDisplayName] = useState(currentUser.displayName || '');
  const [headline, setHeadline] = useState(initial.headline);
  const [about, setAbout] = useState(initial.about);
  const [isFirstTimeHacker, setIsFirstTimeHacker] = useState(
    Boolean(initial.isFirstTimeHacker)
  );
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

  // Progressive disclosure section toggle (collapsed in quick setup, expanded in inline profile)
  const [showMoreDetails, setShowMoreDetails] = useState(!isQuickSetup);

  // Add Project inline state
  const [showAddProjectForm, setShowAddProjectForm] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjTags, setNewProjTags] = useState('');

  // GitHub Import & "Choose your projects" modal state
  const [githubUsername, setGithubUsername] = useState(
    initial.githubUsername ?? ''
  );
  const [isFetchingGitHub, setIsFetchingGitHub] = useState(false);
  const [githubStatusError, setGithubStatusError] = useState<string | null>(null);
  const [showRepoPickerModal, setShowRepoPickerModal] = useState(false);
  const [fetchedRepos, setFetchedRepos] = useState<GitHubRepositoryItem[]>([]);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [repoFilterTab, setRepoFilterTab] = useState<RepoFilterTab>('original');
  const [selectedRepoKeys, setSelectedRepoKeys] = useState<Set<string>>(
    new Set()
  );

  // Optional AI Enrichment state ("Make my project descriptions better ✨")
  const [isEnhancingWithAI, setIsEnhancingWithAI] = useState(false);
  const [enrichmentDraft, setEnrichmentDraft] =
    useState<ProfileEvidenceDraft | null>(null);
  const [suggestedBioDraft, setSuggestedBioDraft] = useState<string>('');
  const [approveSuggestedBio, setApproveSuggestedBio] = useState(false);

  // Collapsed Advanced & Privacy sections
  const [showPreferencesSection, setShowPreferencesSection] = useState(false);
  const [showPrivacySection, setShowPrivacySection] = useState(false);

  // Advanced Collaboration Preferences & Privacy Options
  const [rolesWantToLearn, setRolesWantToLearn] = useState<string[]>(
    initial.rolesWantToLearn
  );
  const [workingStyleTags, setWorkingStyleTags] = useState<string[]>(
    initial.workingStyleTags
  );
  const [icebreakerPrompt, setIcebreakerPrompt] = useState(
    initial.icebreakerPrompt ?? ''
  );
  const [visibility, setVisibility] = useState<Profile['visibility']>(
    initial.visibility
  );
  const [privacyPreferences, setPrivacyPreferences] = useState<
    User['privacyPreferences']
  >(currentUser.privacyPreferences);
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
    setAbout(profile.about);
    setIsFirstTimeHacker(Boolean(profile.isFirstTimeHacker));
    setInterestTags(profile.interestTags);
    setSkillTags(profile.skillTags);
    setPreferredRoles(profile.preferredRoles);
    setFeaturedProjects(profile.featuredProjects);
    setGithubUsername(profile.githubUsername ?? '');
    setRolesWantToLearn(profile.rolesWantToLearn);
    setWorkingStyleTags(profile.workingStyleTags);
    setIcebreakerPrompt(profile.icebreakerPrompt ?? '');
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

  // Opens "Choose your projects" modal with all public GitHub repositories (0 Gemini calls)
  const handleImportFromGitHub = async () => {
    const username = githubUsername.trim().replace(/^@/, '');
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
          includeForks: true,
        });
        if (res.ok) {
          const allRepos =
            res.allRepositories ??
            res.repositories ??
            res.rawGitHubPayload?.allRepositories ??
            res.rawGitHubPayload?.repositories ??
            [];
          setFetchedRepos(allRepos);
          setRepoSearchQuery('');
          // Default to Original tab unless the user only has forks
          const hasOriginal = allRepos.some((r) => !r.fork);
          setRepoFilterTab(hasOriginal ? 'original' : 'all');

          // Pre-check repositories that are already in featuredProjects by URL/identity
          const existingKeys = new Set(
            featuredProjects.map((fp) => normalizeRepoIdentity(fp, username))
          );
          const initialSelected = new Set<string>();
          for (const repo of allRepos) {
            const key = normalizeRepoIdentity(repo, username);
            if (existingKeys.has(key)) {
              initialSelected.add(key);
            }
          }
          setSelectedRepoKeys(initialSelected);
          setShowRepoPickerModal(true);
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
      const sampleRepos: GitHubRepositoryItem[] = (
        demoDraft.suggestedProjects ?? [demoDraft.suggestedProject]
      ).map((p) => ({
        name: p.title,
        url: p.sourceUrl || `https://github.com/${username}/${p.title}`,
        htmlUrl: p.sourceUrl || `https://github.com/${username}/${p.title}`,
        description: p.description,
        language: p.tags[0] ?? 'TypeScript',
        topics: p.tags.slice(1),
        stars: 1,
        fork: false,
      }));
      setFetchedRepos(sampleRepos);
      setRepoSearchQuery('');
      setRepoFilterTab('original');
      setSelectedRepoKeys(new Set());
      setShowRepoPickerModal(true);
    } finally {
      setIsFetchingGitHub(false);
    }
  };

  const countsByTab = useMemo(() => {
    const total = fetchedRepos.length;
    const forks = fetchedRepos.filter((r) => Boolean(r.fork)).length;
    const original = total - forks;
    return { total, original, forks };
  }, [fetchedRepos]);

  const visiblePickerRepos = useMemo(() => {
    const cleanOwner = githubUsername.trim().replace(/^@/, '');
    const q = repoSearchQuery.trim().toLowerCase();
    return fetchedRepos.filter((repo) => {
      if (repoFilterTab === 'original' && repo.fork) return false;
      if (repoFilterTab === 'forks' && !repo.fork) return false;
      if (!q) return true;
      const hay = [
        repo.name,
        repo.description,
        repo.language ?? '',
        ...(repo.topics ?? []),
        normalizeRepoIdentity(repo, cleanOwner),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [fetchedRepos, githubUsername, repoFilterTab, repoSearchQuery]);

  const toggleRepoSelection = (repo: GitHubRepositoryItem) => {
    const cleanOwner = githubUsername.trim().replace(/^@/, '');
    const key = normalizeRepoIdentity(repo, cleanOwner);
    setSelectedRepoKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (next.size >= 3) {
          onNotify?.('You can select up to 3 featured projects.');
          return prev;
        }
        next.add(key);
      }
      return next;
    });
  };

  const handleSelectAllVisibleRepos = () => {
    const cleanOwner = githubUsername.trim().replace(/^@/, '');
    setSelectedRepoKeys((prev) => {
      const next = new Set(prev);
      for (const repo of visiblePickerRepos) {
        if (next.size >= 3) break;
        next.add(normalizeRepoIdentity(repo, cleanOwner));
      }
      if (visiblePickerRepos.length > 3) {
        onNotify?.('Selected the first 3 featured projects (maximum 3).');
      }
      return next;
    });
  };

  const handleClearRepoSelection = () => {
    setSelectedRepoKeys(new Set());
  };

  const handleAddSelectedProjectsFromModal = () => {
    const cleanOwner = githubUsername.trim().replace(/^@/, '');
    const selectedRepos = fetchedRepos.filter((repo) =>
      selectedRepoKeys.has(normalizeRepoIdentity(repo, cleanOwner))
    );

    if (selectedRepos.length === 0) {
      setShowRepoPickerModal(false);
      return;
    }

    const existingByIdentity = new Map<string, FeaturedProject>();
    for (const proj of featuredProjects) {
      existingByIdentity.set(normalizeRepoIdentity(proj, cleanOwner), proj);
    }

    const updatedProjects = [...featuredProjects];
    let addedCount = 0;

    for (const repo of selectedRepos) {
      const repoUrl =
        repo.url ||
        repo.htmlUrl ||
        `https://github.com/${cleanOwner}/${repo.name}`;
      const identityKey = normalizeRepoIdentity(
        { url: repoUrl, name: repo.name },
        cleanOwner
      );

      if (existingByIdentity.has(identityKey)) {
        continue;
      }

      const tags = Array.from(
        new Set([
          ...(repo.language ? [repo.language] : []),
          ...(repo.topics ?? []).slice(0, 4),
        ])
      );

      const newProj: FeaturedProject = {
        id: `gh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: repo.name,
        description:
          repo.description?.trim() ||
          `Public ${repo.language ? `${repo.language} ` : ''}repository on GitHub.`,
        sourceUrl: repoUrl,
        tags,
      };
      updatedProjects.push(newProj);
      existingByIdentity.set(identityKey, newProj);
      addedCount++;
    }

    setFeaturedProjects(updatedProjects);
    setShowRepoPickerModal(false);
    onNotify?.(
      addedCount > 0
        ? `Added ${addedCount} selected project${addedCount === 1 ? '' : 's'} to your profile.`
        : 'Selected projects are already in your profile.'
    );
  };

  // Optional Gemini enrichment strictly for the user's selected/featured projects
  const handleImproveSelectedProjectsWithAI = async () => {
    if (featuredProjects.length === 0) {
      setGithubStatusError(
        'Select or add at least one project first before improving descriptions.'
      );
      return;
    }

    const cleanOwner = githubUsername.trim().replace(/^@/, '') || 'builder';
    const selectedReposForAI: GitHubRepositoryItem[] = featuredProjects.map(
      (proj) => ({
        name: proj.title,
        url: proj.sourceUrl,
        htmlUrl: proj.sourceUrl,
        description: proj.description,
        language: proj.tags[0] ?? null,
        topics: proj.tags.slice(1),
      })
    );

    setIsEnhancingWithAI(true);
    setGithubStatusError(null);
    try {
      const res = await runLiveGitHubAndGeminiEnrichment({
        uid: currentUser.uid,
        githubUsername: cleanOwner,
        selectedRepositories: selectedReposForAI,
        useGemini: true,
      });

      if (res.ok && res.draft) {
        setEnrichmentDraft(res.draft);
        setSuggestedBioDraft(res.suggestedBio ?? '');
        setApproveSuggestedBio(false);
        onNotify?.(
          'Generated project description & skill suggestions. Review and approve what you want to keep.'
        );
        return;
      }

      setGithubStatusError(
        res.errorMessage || 'AI description helper is unavailable right now.'
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
    });
  };

  const updateSuggestedProjectDescription = (idx: number, newDesc: string) => {
    if (!enrichmentDraft || !enrichmentDraft.suggestedProjects) return;
    const next = [...enrichmentDraft.suggestedProjects];
    next[idx] = { ...next[idx], description: newDesc };
    setEnrichmentDraft({
      ...enrichmentDraft,
      suggestedProjects: next,
    });
  };

  const handleApplyApprovedSuggestions = () => {
    if (!enrichmentDraft) return;
    const approvedSkills = enrichmentDraft.suggestedSkills
      .filter((s) => s.approved)
      .map((s) => s.name);
    if (approvedSkills.length > 0) {
      setSkillTags(Array.from(new Set([...skillTags, ...approvedSkills])));
    }

    const cleanOwner = githubUsername.trim().replace(/^@/, '');
    let updatedProjectCount = 0;

    if (
      enrichmentDraft.suggestedProjects &&
      enrichmentDraft.suggestedProjects.length > 0
    ) {
      const nextProjects = [...featuredProjects];
      for (const sp of enrichmentDraft.suggestedProjects) {
        if (!sp.approved) continue;
        const spKey = normalizeRepoIdentity(sp, cleanOwner);
        const existingIdx = nextProjects.findIndex(
          (fp) =>
            normalizeRepoIdentity(fp, cleanOwner) === spKey ||
            fp.title.toLowerCase() === sp.title.toLowerCase()
        );
        if (existingIdx >= 0) {
          nextProjects[existingIdx] = {
            ...nextProjects[existingIdx],
            description: sp.description,
            tags:
              sp.tags && sp.tags.length > 0
                ? sp.tags
                : nextProjects[existingIdx].tags,
          };
        } else {
          nextProjects.push({
            id: `gh_ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: sp.title,
            description: sp.description,
            sourceUrl: sp.sourceUrl,
            tags: sp.tags,
          });
        }
        updatedProjectCount++;
      }
      setFeaturedProjects(nextProjects);
    }

    if (approveSuggestedBio && suggestedBioDraft.trim()) {
      setAbout(suggestedBioDraft.trim());
    }

    setEnrichmentDraft(null);
    setSuggestedBioDraft('');
    setApproveSuggestedBio(false);
    onNotify?.(
      `Applied ${approvedSkills.length} skill(s) and ${updatedProjectCount} improved project description(s).`
    );
  };

  const buildUpdatedProfile = (): Profile => ({
    ...profile,
    headline: headline.trim() || 'PES University Builder',
    about: about.trim(),
    interestTags,
    skillTags,
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

  const handleSaveFinal = () => {
    const updated = buildUpdatedProfile();
    try {
      localStorage.removeItem(draftStorageKey);
    } catch {
      // ignore
    }
    onSaveProfile(updated, privacyPreferences, displayName.trim() || undefined);
    if (!isInline) {
      onClose();
    }
  };

  const isUnsetDisplayName =
    !currentUser.displayName ||
    currentUser.displayName === 'PES Student' ||
    currentUser.displayName.startsWith('PES Student');

  const formContent = (
    <div className="space-y-4">
      {/* 1. Student Display Name */}
      <div className="space-y-1">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
          Display Name {isUnsetDisplayName && <span className="text-amber-500">*</span>}
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g., Roshan Kumar"
          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
        />
        <p className="text-[11px] text-slate-400">
          Your name as seen by prospective teammates. Verified SRNs/PRNs are kept private and never exposed publicly.
        </p>
      </div>

      {/* 2. Core Quick Setup: Interests, Skills & Preferred Role */}
      <div className="space-y-3.5 pt-3 border-t border-slate-100 dark:border-slate-800">
        {/* A. Interests (Up to 3) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              A. Interests <span className="text-slate-400 font-normal">(Choose up to 3)</span>
            </label>
            <span className="text-[11px] font-mono text-slate-400">
              {interestTags.length}/3 selected
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {QUICK_INTEREST_OPTIONS.map((interest) => {
              const active = interestTags.includes(interest);
              return (
                <button
                  key={interest}
                  type="button"
                  onClick={() => {
                    if (active) {
                      setInterestTags(interestTags.filter((i) => i !== interest));
                    } else if (interestTags.length >= 3) {
                      onNotify?.('You can select up to 3 interest areas.');
                    } else {
                      setInterestTags([...interestTags, interest]);
                    }
                  }}
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
                (e.preventDefault(),
                customInterestInput.trim() &&
                  (interestTags.length >= 3
                    ? onNotify?.('You can select up to 3 interest areas.')
                    : handleAddCustomInterest()))
              }
              placeholder="Or type a custom interest..."
              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                if (interestTags.length >= 3) {
                  onNotify?.('You can select up to 3 interest areas.');
                } else {
                  handleAddCustomInterest();
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>

        {/* B. Skills */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            B. Skills <span className="text-slate-400 font-normal">(Choose a few or type custom)</span>
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {QUICK_SKILL_OPTIONS.map((skill) => {
              const active = skillTags.includes(skill);
              return (
                <button
                  key={skill}
                  type="button"
                  onClick={() => {
                    if (active) {
                      setSkillTags(skillTags.filter((s) => s !== skill));
                    } else {
                      setSkillTags([...skillTags, skill]);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {skill}
                </button>
              );
            })}
          </div>
          {skillTags.filter((s) => !QUICK_SKILL_OPTIONS.includes(s)).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {skillTags
                .filter((s) => !QUICK_SKILL_OPTIONS.includes(s))
                .map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800 text-xs font-medium"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => setSkillTags(skillTags.filter((s) => s !== skill))}
                      className="text-blue-400 hover:text-red-600 cursor-pointer"
                      aria-label={`Remove ${skill}`}
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
              value={customSkillInput}
              onChange={(e) => setCustomSkillInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                (e.preventDefault(), handleAddCustomSkill())
              }
              placeholder="Add other skills (e.g. Kotlin, Solifity, Tailwind)..."
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

        {/* C. Preferred Role */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            C. Preferred Role <span className="text-slate-400 font-normal">(Primary focus on a team)</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ROLE_OPTIONS.map((role) => {
              const active = preferredRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => setPreferredRoles([role])}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 font-semibold shadow-xs'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {role}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. Progressive Disclosure: More Details & Portfolio (Optional) */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMoreDetails(!showMoreDetails)}
          className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
        >
          <span>More Details (Optional) — Bio, GitHub, Projects & Preferences</span>
          {showMoreDetails ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showMoreDetails && (
          <div className="p-3.5 bg-white dark:bg-slate-900 space-y-4 border-t border-slate-200 dark:border-slate-800 text-xs">
            {/* Headline & About */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Headline
                </label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="e.g., CSE builder into Backend APIs & Applied AI"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  About Me
                </label>
                <textarea
                  rows={2}
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  placeholder="Tell potential teammates about what you love building..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                />
                <div className="flex items-center gap-2 mt-1">
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isFirstTimeHacker}
                      onChange={(e) => setIsFirstTimeHacker(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    First hackathon? Let teammates know.
                  </label>
                </div>
              </div>
            </div>

            {/* Featured Projects (Max 3) & GitHub Import */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Featured Projects <span className="font-normal text-slate-400">(Up to 3)</span>
                </label>
                {!showAddProjectForm && (
                  <button
                    type="button"
                    onClick={() => setShowAddProjectForm(true)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
                  >
                    + Add Project Manually
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Github className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={githubUsername}
                    onChange={(e) => setGithubUsername(e.target.value)}
                    placeholder="GitHub username (e.g. octocat)"
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-950"
                  />
                </div>
                <button
                  type="button"
                  disabled={isFetchingGitHub}
                  onClick={handleImportFromGitHub}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Github className="w-3.5 h-3.5" />
                  {isFetchingGitHub ? 'Loading...' : 'Select Projects'}
                </button>
              </div>

              {featuredProjects.length > 0 && (
                <div className="space-y-1.5">
                  {featuredProjects.map((proj) => (
                    <div
                      key={proj.id}
                      className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {proj.title}
                          </span>
                          {proj.sourceUrl && (
                            <a
                              href={proj.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-400 hover:text-blue-600 shrink-0"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-1">
                          {proj.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setFeaturedProjects(featuredProjects.filter((p) => p.id !== proj.id))
                        }
                        className="text-slate-400 hover:text-red-600 p-1 shrink-0 cursor-pointer"
                        title="Remove project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* Optional AI Polish inside advanced details only */}
                  <div className="pt-1 flex justify-end">
                    <button
                      type="button"
                      disabled={isEnhancingWithAI}
                      onClick={handleImproveSelectedProjectsWithAI}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-blue-600 font-medium cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      {isEnhancingWithAI
                        ? 'Polishing descriptions...'
                        : 'Optionally polish descriptions with AI ✨'}
                    </button>
                  </div>
                </div>
              )}

              {showAddProjectForm && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
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
                    placeholder="Brief description of what you built"
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

            {/* Collaboration Style & Portfolio */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Collaboration Style
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {WORK_STYLE_TAXONOMY.map((style) => {
                    const active = workingStyleTags.includes(style);
                    return (
                      <button
                        key={style}
                        type="button"
                        onClick={() =>
                          toggleItem(style, workingStyleTags, setWorkingStyleTags)
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border cursor-pointer ${
                          active
                            ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {style}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Conversation Icebreaker
                </label>
                <input
                  type="text"
                  value={icebreakerPrompt}
                  onChange={(e) => setIcebreakerPrompt(e.target.value)}
                  placeholder="What part of the stack do you want to build together?"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                />
              </div>

              <PortfolioLinkEditor
                links={portfolioLinks}
                onChange={setPortfolioLinks}
              />
            </div>
          </div>
        )}
      </div>

      {/* 4. Privacy & Settings (Accessible, Defaults Preserved) */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPrivacySection(!showPrivacySection)}
          className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
        >
          <span>Privacy & Settings</span>
          {showPrivacySection ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showPrivacySection && (
          <div className="p-3.5 bg-white dark:bg-slate-900 space-y-3 border-t border-slate-200 dark:border-slate-800 text-xs">
            <div className="flex items-center justify-between">
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
              Fetch PESU Academy announcements when signed in with PESU OAuth
            </label>
          </div>
        )}
      </div>

      {/* 5. Footer Actions: Single Primary Action 'Continue' / 'Save Profile', Skip for now link */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        {!isInline ? (
          <button
            type="button"
            onClick={() => {
              onNotify?.(
                'Setup skipped. You can complete your profile anytime in Settings to get better recommendations.'
              );
              onClose();
            }}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 underline cursor-pointer"
          >
            Skip for now
          </button>
        ) : (
          <div />
        )}

        <button
          type="button"
          onClick={handleSaveFinal}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
        >
          {!isInline ? 'Continue' : 'Save Profile'}
        </button>
      </div>
    </div>
  );

  // "Choose your projects" GitHub Repository Selection Popup Modal
  const repoPickerModal = showRepoPickerModal ? (
    <Modal
      title="Choose your projects"
      subtitle={`@${githubUsername.trim().replace(/^@/, '')} · ${countsByTab.total} public repositories found`}
      onClose={() => setShowRepoPickerModal(false)}
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={repoSearchQuery}
            onChange={(e) => setRepoSearchQuery(e.target.value)}
            placeholder="Search repositories by name, language, or description..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>

        {/* Filter Tabs (All / Original / Forks) + Selection Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-50 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setRepoFilterTab('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                repoFilterTab === 'all'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              All ({countsByTab.total})
            </button>
            <button
              type="button"
              onClick={() => setRepoFilterTab('original')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                repoFilterTab === 'original'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Original ({countsByTab.original})
            </button>
            <button
              type="button"
              onClick={() => setRepoFilterTab('forks')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                repoFilterTab === 'forks'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Forks ({countsByTab.forks})
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={handleSelectAllVisibleRepos}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
            >
              Select all visible
            </button>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <button
              type="button"
              onClick={handleClearRepoSelection}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
            >
              Clear selection
            </button>
          </div>
        </div>

        {/* Scrollable Repository List */}
        <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
          {visiblePickerRepos.length > 0 ? (
            visiblePickerRepos.map((repo) => {
              const cleanOwner = githubUsername.trim().replace(/^@/, '');
              const repoKey = normalizeRepoIdentity(repo, cleanOwner);
              const isSelected = selectedRepoKeys.has(repoKey);
              return (
                <label
                  key={repoKey}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRepoSelection(repo)}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {repo.name}
                      </span>
                      {repo.language && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                          {repo.language}
                        </span>
                      )}
                      {repo.fork && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          <GitFork className="w-2.5 h-2.5" />
                          Fork
                        </span>
                      )}
                    </div>
                    {repo.description ? (
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                        {repo.description}
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-400 italic mt-0.5">
                        No description provided
                      </p>
                    )}
                  </div>
                </label>
              );
            })
          ) : (
            <div className="py-8 text-center text-xs text-slate-500">
              No repositories match your filter.
            </div>
          )}
        </div>

        {/* Footer with Selected Counter & Primary Action */}
        <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {selectedRepoKeys.size} project{selectedRepoKeys.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRepoPickerModal(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddSelectedProjectsFromModal}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
            >
              Add Selected Projects
            </button>
          </div>
        </div>
      </div>
    </Modal>
  ) : null;

  if (isInline) {
    return (
      <>
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
        {repoPickerModal}
      </>
    );
  }

  return (
    <>
      <Modal
        title="Edit Builder Profile"
        subtitle={`${currentUser.displayName} · ${currentUser.campus}`}
        onClose={onClose}
        maxWidthClass="max-w-xl"
      >
        {formContent}
      </Modal>
      {repoPickerModal}
    </>
  );
};
