import React, { useMemo, useState } from 'react';
import {
  ExecutionMode,
  FeaturedProject,
  Profile,
  ProfileEvidenceDraft,
  User,
} from '../types/domain';
import { GitHubRepositoryItem } from '../types/apiContracts';
import { WORK_STYLE_TAXONOMY } from '../data/seedData';
import {
  QUICK_INTEREST_OPTIONS,
  QUICK_ROLE_OPTIONS,
  QUICK_SKILL_OPTIONS,
} from './QuickOnboardingView';
import { normalizeHumanDisplayName } from '../lib/displayName';
import {
  Github,
  Check,
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Search,
  ExternalLink,
  Shield,
  X,
  Loader2,
} from 'lucide-react';
import {
  fetchLiveGitHubRepositoriesDeterministically,
  runLiveGitHubAndGeminiEnrichment,
} from '../services/adapters';
import { Modal } from './Modal';
import { StudentAvatar } from './StudentAvatar';

interface OnboardingAndProfileModalProps {
  currentUser: User;
  profile: Profile;
  executionMode: ExecutionMode;
  isInline?: boolean;
  onSaveProfile: (
    updatedProfile: Profile,
    updatedPrivacy: User['privacyPreferences'],
    updatedDisplayName?: string
  ) => void;
  onClose: () => void;
  onNotify?: (msg: string) => void;
}

const MAX_FEATURED_PROJECTS = 3;

export const OnboardingAndProfileModal: React.FC<
  OnboardingAndProfileModalProps
> = ({
  currentUser,
  profile,
  executionMode,
  isInline = false,
  onSaveProfile,
  onClose,
  onNotify,
}) => {
  const [displayName, setDisplayName] = useState(
    currentUser.needsDisplayNameSetup ? '' : currentUser.displayName
  );
  const [nameError, setNameError] = useState<string | null>(null);

  const [interestTags, setInterestTags] = useState<string[]>(
    profile.interestTags ?? []
  );
  const [skillTags, setSkillTags] = useState<string[]>(profile.skillTags ?? []);
  const [customSkillInput, setCustomSkillInput] = useState('');
  const [preferredRoles, setPreferredRoles] = useState<string[]>(
    profile.preferredRoles ?? []
  );

  // Progressive disclosure sections (collapsed by default)
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [showPrivacySettings, setShowPrivacySettings] = useState(false);

  // Optional More Details fields
  const [headline, setHeadline] = useState(profile.headline ?? '');
  const [about, setAbout] = useState(profile.about ?? '');
  const [isFirstTimeHacker, setIsFirstTimeHacker] = useState(
    Boolean(profile.isFirstTimeHacker)
  );
  const [githubUsername, setGithubUsername] = useState(
    profile.githubUsername ?? ''
  );
  const [featuredProjects, setFeaturedProjects] = useState<FeaturedProject[]>(
    (profile.featuredProjects ?? []).slice(0, MAX_FEATURED_PROJECTS)
  );
  const [portfolioLinks, setPortfolioLinks] = useState<
    { label: string; url: string }[]
  >(profile.portfolioLinks ?? []);
  const [workingStyleTags, setWorkingStyleTags] = useState<string[]>(
    profile.workingStyleTags ?? []
  );
  const [rolesWantToLearn, setRolesWantToLearn] = useState<string[]>(
    profile.rolesWantToLearn ?? []
  );
  const [icebreakerPrompt, setIcebreakerPrompt] = useState(
    profile.icebreakerPrompt ?? ''
  );

  // Manual project input
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjUrl, setNewProjUrl] = useState('');

  // Portfolio link input
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');

  // GitHub picker state (user explicitly selects up to 3 repos; never auto-displays all)
  const [githubRepos, setGithubRepos] = useState<GitHubRepositoryItem[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState('');

  // Optional AI enrichment (strictly inside More Details with explicit consent + review)
  const [aiConsentChecked, setAiConsentChecked] = useState(
    Boolean(currentUser.privacyPreferences?.aiEnrichmentConsent)
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState<{
    draft: ProfileEvidenceDraft;
    suggestedBio?: string;
    suggestedIcebreaker?: string;
  } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Privacy preferences
  const [profileVisible, setProfileVisible] = useState(
    currentUser.privacyPreferences?.profileVisible !== false &&
      profile.visibility !== 'hidden'
  );
  const [academyOptIn, setAcademyOptIn] = useState(
    Boolean(currentUser.privacyPreferences?.academyAnnouncementsOptIn)
  );

  const interestOptions = useMemo(() => {
    const merged = new Set<string>([...QUICK_INTEREST_OPTIONS, ...interestTags]);
    return Array.from(merged);
  }, [interestTags]);

  const roleOptions = useMemo(() => {
    const merged = new Set<string>([...QUICK_ROLE_OPTIONS, ...preferredRoles]);
    return Array.from(merged);
  }, [preferredRoles]);

  const customSkillsOnly = useMemo(
    () =>
      skillTags.filter(
        (sk) =>
          !QUICK_SKILL_OPTIONS.some(
            (preset) => preset.toLowerCase() === sk.toLowerCase()
          )
      ),
    [skillTags]
  );

  const filteredGithubRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return githubRepos;
    return githubRepos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        (r.language ?? '').toLowerCase().includes(q)
    );
  }, [githubRepos, repoSearch]);

  const toggleInterest = (tag: string) => {
    setInterestTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      if (prev.length >= 3) return prev;
      return [...prev, tag];
    });
  };

  const toggleSkill = (sk: string) => {
    setSkillTags((prev) =>
      prev.includes(sk) ? prev.filter((s) => s !== sk) : [...prev, sk]
    );
  };

  const handleAddCustomSkill = () => {
    const trimmed = customSkillInput.trim();
    if (!trimmed) return;
    if (!skillTags.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setSkillTags((prev) => [...prev, trimmed]);
    }
    setCustomSkillInput('');
  };

  const toggleRole = (role: string) => {
    setPreferredRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [role]
    );
  };

  const toggleWorkStyle = (style: string) => {
    setWorkingStyleTags((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
  };

  const handleFetchGithubRepos = async () => {
    const handle = githubUsername.trim().replace(/^@/, '');
    if (!handle) {
      setGithubError('Enter a GitHub username first.');
      return;
    }
    setGithubLoading(true);
    setGithubError(null);
    try {
      const res = await fetchLiveGitHubRepositoriesDeterministically({
        uid: currentUser.uid,
        githubUsername: handle,
      });
      if (!res.ok || !res.repositories) {
        setGithubError(res.errorMessage || 'Could not load public repositories.');
        setGithubRepos([]);
      } else {
        setGithubRepos(res.repositories);
        if (res.repositories.length === 0) {
          setGithubError('No public repositories found for this username.');
        }
      }
    } catch {
      setGithubError('Unable to reach GitHub right now.');
    } finally {
      setGithubLoading(false);
    }
  };

  const isRepoFeatured = (repo: GitHubRepositoryItem) => {
    const targetUrl = (repo.htmlUrl || '').toLowerCase().replace(/\/+$/, '');
    return featuredProjects.some(
      (p) =>
        (p.sourceUrl &&
          p.sourceUrl.toLowerCase().replace(/\/+$/, '') === targetUrl) ||
        p.title.toLowerCase() === repo.name.toLowerCase()
    );
  };

  const toggleRepoFeatured = (repo: GitHubRepositoryItem) => {
    const targetUrl = (repo.htmlUrl || '').toLowerCase().replace(/\/+$/, '');
    const exists = isRepoFeatured(repo);
    if (exists) {
      setFeaturedProjects((prev) =>
        prev.filter(
          (p) =>
            !(
              (p.sourceUrl &&
                p.sourceUrl.toLowerCase().replace(/\/+$/, '') === targetUrl) ||
              p.title.toLowerCase() === repo.name.toLowerCase()
            )
        )
      );
      return;
    }
    if (featuredProjects.length >= MAX_FEATURED_PROJECTS) {
      onNotify?.(
        `You can feature up to ${MAX_FEATURED_PROJECTS} projects. Deselect one first.`
      );
      return;
    }
    const proj: FeaturedProject = {
      id: `gh_${repo.name}_${Date.now()}`,
      title: repo.name,
      description:
        repo.description?.trim() ||
        `Public GitHub repository (${repo.language || 'Code'})`,
      tags: Array.from(
        new Set([repo.language, ...(repo.topics ?? [])].filter(Boolean) as string[])
      ).slice(0, 5),
      sourceUrl: repo.htmlUrl,
    };
    setFeaturedProjects((prev) => [...prev, proj]);
  };

  const handleAddManualProject = () => {
    if (!newProjTitle.trim()) return;
    if (featuredProjects.length >= MAX_FEATURED_PROJECTS) {
      onNotify?.(`You can feature up to ${MAX_FEATURED_PROJECTS} projects.`);
      return;
    }
    setFeaturedProjects((prev) => [
      ...prev,
      {
        id: `manual_${Date.now()}`,
        title: newProjTitle.trim(),
        description: newProjDesc.trim(),
        tags: [],
        sourceUrl: newProjUrl.trim() || undefined,
      },
    ]);
    setNewProjTitle('');
    setNewProjDesc('');
    setNewProjUrl('');
  };

  const handleAddPortfolioLink = () => {
    const url = newLinkUrl.trim();
    if (!url) return;
    setPortfolioLinks((prev) => [
      ...prev,
      { label: newLinkLabel.trim() || url, url },
    ]);
    setNewLinkLabel('');
    setNewLinkUrl('');
  };

  const handleRunOptionalAiEnrichment = async () => {
    if (!aiConsentChecked) {
      setAiError('Please enable consent above before requesting an AI draft.');
      return;
    }
    const handle = githubUsername.trim().replace(/^@/, '');
    if (!handle) {
      setAiError('Enter your GitHub username above to draft suggestions.');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiDraft(null);
    try {
      const selectedRepos = githubRepos.filter((repo) => isRepoFeatured(repo));
      const result = await runLiveGitHubAndGeminiEnrichment({
        uid: currentUser.uid,
        githubUsername: handle,
        selectedRepositories: selectedRepos.length > 0 ? selectedRepos : undefined,
        useGemini: true,
      });
      if (!result.ok || !result.draft) {
        setAiError(result.errorMessage || 'Could not generate a draft right now.');
      } else {
        setAiDraft({
          draft: result.draft,
          suggestedBio: result.suggestedBio,
          suggestedIcebreaker: result.suggestedIcebreaker,
        });
      }
    } catch {
      setAiError('Enrichment service unavailable.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiDraft = () => {
    if (!aiDraft) return;
    if (aiDraft.suggestedBio) setAbout(aiDraft.suggestedBio);
    if (aiDraft.suggestedIcebreaker) {
      setIcebreakerPrompt(aiDraft.suggestedIcebreaker);
    }
    if (aiDraft.draft.suggestedSkills.length > 0) {
      const names = aiDraft.draft.suggestedSkills.map((s) => s.name);
      setSkillTags((prev) => Array.from(new Set([...prev, ...names])));
    }
    setAiDraft(null);
    onNotify?.('Draft suggestions applied. Review and click Save Profile to persist.');
  };

  const handleSave = () => {
    setNameError(null);
    let updatedDisplayName: string | undefined;

    const trimmedName = displayName.trim();
    const currentIsPlaceholder = Boolean(currentUser.needsDisplayNameSetup);
    if (trimmedName && (currentIsPlaceholder || trimmedName !== currentUser.displayName)) {
      const normalized = normalizeHumanDisplayName(trimmedName);
      if (!normalized) {
        setNameError(
          'Enter a real display name (cannot be an SRN/PRN or email address).'
        );
        return;
      }
      updatedDisplayName = normalized;
    } else if (currentIsPlaceholder && trimmedName.length === 0) {
      // Optional; leave as-is if untouched
      updatedDisplayName = undefined;
    }

    const updatedProfile: Profile = {
      ...profile,
      uid: currentUser.uid,
      headline: headline.trim(),
      about: about.trim(),
      skillTags,
      interestTags,
      projectDomains:
        interestTags.length > 0 ? interestTags : profile.projectDomains ?? [],
      preferredRoles,
      rolesWantToLearn,
      workingStyleTags,
      featuredProjects: featuredProjects.slice(0, MAX_FEATURED_PROJECTS),
      portfolioLinks,
      githubUsername: githubUsername.trim().replace(/^@/, '') || undefined,
      icebreakerPrompt: icebreakerPrompt.trim() || undefined,
      isFirstTimeHacker,
      visibility: profileVisible ? 'public_verified_students' : 'hidden',
      updatedAt: new Date().toISOString(),
    };

    const updatedPrivacy: User['privacyPreferences'] = {
      ...currentUser.privacyPreferences,
      profileVisible,
      githubConsent: Boolean(githubUsername.trim()),
      aiEnrichmentConsent: aiConsentChecked,
      academyAnnouncementsOptIn: academyOptIn,
      onboardingCompleted: true,
      ...(updatedDisplayName ? { customDisplayNameSet: true } : {}),
    };

    onSaveProfile(updatedProfile, updatedPrivacy, updatedDisplayName);
  };

  const formContent = (
    <div className="space-y-6">
      {/* Core Essentials */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
        <div className="flex items-center gap-3.5">
          <StudentAvatar
            uid={currentUser.uid}
            name={displayName || currentUser.displayName}
            size="lg"
          />
          <div>
            <h2 className="text-lg font-bold text-slate-900">Your Profile</h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Keep your name, interests, skills, and role up to date for better teammate recommendations.
            </p>
          </div>
        </div>

        {/* Display Name */}
        <div>
          <label
            htmlFor="profile-display-name"
            className="block text-sm font-semibold text-slate-900"
          >
            Display Name
          </label>
          <p className="text-xs text-slate-500 mt-0.5">
            Shown on your profile, teammate cards, and messages. Your PESU SRN is never shown publicly.
          </p>
          <input
            id="profile-display-name"
            type="text"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder="Your full name"
            maxLength={60}
            className="mt-2 w-full max-w-md rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          {nameError && (
            <p className="mt-1.5 text-xs text-rose-600">{nameError}</p>
          )}
        </div>

        {/* A. Interests */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label className="text-sm font-semibold text-slate-900">
              Interests
            </label>
            <span className="text-xs text-slate-500">
              Up to 3 ({interestTags.length}/3)
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {interestOptions.map((interest) => {
              const active = interestTags.includes(interest);
              const disabled = !active && interestTags.length >= 3;
              return (
                <button
                  key={interest}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleInterest(interest)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : disabled
                      ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {active && <Check className="w-3.5 h-3.5" />}
                  <span>{interest}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* B. Skills */}
        <div>
          <label className="block text-sm font-semibold text-slate-900">
            Skills
          </label>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {QUICK_SKILL_OPTIONS.map((sk) => {
              const active = skillTags.includes(sk);
              return (
                <button
                  key={sk}
                  type="button"
                  onClick={() => toggleSkill(sk)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {active && <Check className="w-3.5 h-3.5" />}
                  <span>{sk}</span>
                </button>
              );
            })}
            {customSkillsOnly.map((sk) => (
              <span
                key={sk}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-600 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700"
              >
                <span>{sk}</span>
                <button
                  type="button"
                  onClick={() => toggleSkill(sk)}
                  aria-label={`Remove ${sk}`}
                  className="text-indigo-500 hover:text-indigo-800 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex gap-2 max-w-md">
            <input
              type="text"
              value={customSkillInput}
              onChange={(e) => setCustomSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustomSkill();
                }
              }}
              placeholder="Add custom skill (e.g. Go, Tailwind, ROS2)"
              className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <button
              type="button"
              onClick={handleAddCustomSkill}
              disabled={!customSkillInput.trim()}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* C. Preferred Role */}
        <div>
          <label className="block text-sm font-semibold text-slate-900">
            Preferred Role
          </label>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {roleOptions.map((role) => {
              const active = preferredRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={`rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {role}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Collapsible More Details (Progressive Disclosure) */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMoreDetails((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <div>
            <div className="text-sm font-semibold text-slate-900">
              More Details (Optional)
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Headline, bio, GitHub featured projects (up to 3), portfolio, collaboration style
            </div>
          </div>
          {showMoreDetails ? (
            <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          )}
        </button>

        {showMoreDetails && (
          <div className="px-6 pb-6 pt-2 border-t border-slate-100 space-y-6">
            {/* Headline & Bio */}
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-800">
                  Headline
                </label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="e.g. Full-stack & ML student building fast prototypes"
                  maxLength={120}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-800">
                  About Me
                </label>
                <textarea
                  rows={3}
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  placeholder="What do you like building during hackathons?"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <label className="inline-flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFirstTimeHacker}
                  onChange={(e) => setIsFirstTimeHacker(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>This is my first hackathon</span>
              </label>
            </div>

            {/* GitHub & Featured Projects (max 3) */}
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Github className="w-4 h-4 text-slate-600" />
                  <span>Featured Projects (Up to {MAX_FEATURED_PROJECTS})</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Optionally link GitHub to pick up to {MAX_FEATURED_PROJECTS} repositories, or add a project manually. Repositories are never added automatically.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={githubUsername}
                  onChange={(e) => setGithubUsername(e.target.value)}
                  placeholder="GitHub username (optional)"
                  className="flex-1 min-w-[200px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <button
                  type="button"
                  onClick={handleFetchGithubRepos}
                  disabled={githubLoading || !githubUsername.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                >
                  {githubLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  <span>Browse Repositories</span>
                </button>
              </div>

              {githubError && (
                <p className="text-xs text-amber-700">{githubError}</p>
              )}

              {githubRepos.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700">
                      Select up to {MAX_FEATURED_PROJECTS} to feature ({featuredProjects.length}/{MAX_FEATURED_PROJECTS} selected)
                    </span>
                    <input
                      type="text"
                      value={repoSearch}
                      onChange={(e) => setRepoSearch(e.target.value)}
                      placeholder="Filter repos..."
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-slate-200/70 rounded-lg border border-slate-200 bg-white">
                    {filteredGithubRepos.slice(0, 20).map((repo) => {
                      const selected = isRepoFeatured(repo);
                      return (
                        <div
                          key={repo.name}
                          className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 truncate">
                              {repo.name}
                            </div>
                            {repo.description && (
                              <div className="text-xs text-slate-500 truncate">
                                {repo.description}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleRepoFeatured(repo)}
                            className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer ${
                              selected
                                ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {selected ? 'Selected' : 'Select'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Current Featured Projects List */}
              {featuredProjects.length > 0 && (
                <div className="space-y-2">
                  {featuredProjects.map((proj) => (
                    <div
                      key={proj.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {proj.title}
                          </span>
                          {proj.sourceUrl && (
                            <a
                              href={proj.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-0.5"
                            >
                              <span>Link</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        {proj.description && (
                          <p className="text-xs text-slate-600 mt-0.5">
                            {proj.description}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setFeaturedProjects((prev) =>
                            prev.filter((p) => p.id !== proj.id)
                          )
                        }
                        aria-label={`Remove ${proj.title}`}
                        className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Manual Add Project */}
              {featuredProjects.length < MAX_FEATURED_PROJECTS && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={newProjTitle}
                    onChange={(e) => setNewProjTitle(e.target.value)}
                    placeholder="Project title"
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <input
                    type="text"
                    value={newProjDesc}
                    onChange={(e) => setNewProjDesc(e.target.value)}
                    placeholder="Short description"
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={newProjUrl}
                      onChange={(e) => setNewProjUrl(e.target.value)}
                      placeholder="URL (optional)"
                      className="flex-1 min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={handleAddManualProject}
                      disabled={!newProjTitle.trim()}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer shrink-0"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {/* Optional AI Enrichment (strictly opt-in with explicit review) */}
              {executionMode === 'live' && githubUsername.trim() && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                  <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aiConsentChecked}
                      onChange={(e) => setAiConsentChecked(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>
                      Allow optional AI summary drafting from my public GitHub profile (you will review before anything is applied).
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={!aiConsentChecked || aiLoading}
                    onClick={handleRunOptionalAiEnrichment}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                  >
                    {aiLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    )}
                    <span>Draft Suggestions for Review</span>
                  </button>
                  {aiError && (
                    <p className="text-xs text-amber-700">{aiError}</p>
                  )}
                  {aiDraft && (
                    <div className="rounded-lg border border-indigo-200 bg-white p-3 space-y-2 text-xs">
                      <div className="font-semibold text-slate-900">
                        Review Draft Suggestions
                      </div>
                      {aiDraft.suggestedBio && (
                        <p className="text-slate-700">
                          <span className="font-medium">About:</span>{' '}
                          {aiDraft.suggestedBio}
                        </p>
                      )}
                      {aiDraft.suggestedIcebreaker && (
                        <p className="text-slate-700">
                          <span className="font-medium">Icebreaker:</span>{' '}
                          {aiDraft.suggestedIcebreaker}
                        </p>
                      )}
                      {aiDraft.draft.suggestedSkills.length > 0 && (
                        <p className="text-slate-700">
                          <span className="font-medium">Skills:</span>{' '}
                          {aiDraft.draft.suggestedSkills
                            .map((s) => s.name)
                            .join(', ')}
                        </p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleApplyAiDraft}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 cursor-pointer"
                        >
                          Apply Draft
                        </button>
                        <button
                          type="button"
                          onClick={() => setAiDraft(null)}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Portfolio Links */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <label className="block text-sm font-semibold text-slate-900">
                Portfolio Links
              </label>
              {portfolioLinks.length > 0 && (
                <div className="space-y-1.5">
                  {portfolioLinks.map((link, idx) => (
                    <div
                      key={`${link.url}-${idx}`}
                      className="flex items-center justify-between gap-2 text-sm text-slate-700"
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:underline truncate"
                      >
                        {link.label}
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          setPortfolioLinks((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        className="text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newLinkLabel}
                  onChange={(e) => setNewLinkLabel(e.target.value)}
                  placeholder="Label (e.g. Portfolio, LinkedIn)"
                  className="w-44 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
                <input
                  type="url"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 min-w-[180px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
                <button
                  type="button"
                  onClick={handleAddPortfolioLink}
                  disabled={!newLinkUrl.trim()}
                  className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Collaboration Style & Icebreaker */}
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-900">
                  Collaboration Style
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WORK_STYLE_TAXONOMY.map((style) => {
                    const active = workingStyleTags.includes(style);
                    return (
                      <button
                        key={style}
                        type="button"
                        onClick={() => toggleWorkStyle(style)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium cursor-pointer ${
                          active
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {style}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-800">
                  Roles to Explore
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {QUICK_ROLE_OPTIONS.map((role) => {
                    const active = rolesWantToLearn.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() =>
                          setRolesWantToLearn((prev) =>
                            prev.includes(role)
                              ? prev.filter((r) => r !== role)
                              : [...prev, role]
                          )
                        }
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium cursor-pointer ${
                          active
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {role}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-800">
                  Conversation Starter / Icebreaker
                </label>
                <input
                  type="text"
                  value={icebreakerPrompt}
                  onChange={(e) => setIcebreakerPrompt(e.target.value)}
                  placeholder="e.g. Ask me about shipping real-time web apps in 24 hours"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Collapsible Privacy & Account Settings */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPrivacySettings((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <Shield className="w-4 h-4 text-slate-500 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Privacy &amp; Account Settings
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Control profile visibility and optional PESU Academy features
              </div>
            </div>
          </div>
          {showPrivacySettings ? (
            <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          )}
        </button>

        {showPrivacySettings && (
          <div className="px-6 pb-6 pt-3 border-t border-slate-100 space-y-4">
            <label className="flex items-start gap-3 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={profileVisible}
                onChange={(e) => setProfileVisible(e.target.checked)}
                className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="font-medium text-slate-900 block">
                  Visible in teammate discovery
                </span>
                <span className="text-xs text-slate-500">
                  Allow other verified PESU students to see your profile card in Discover. Your SRN is always hidden.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={academyOptIn}
                onChange={(e) => setAcademyOptIn(e.target.checked)}
                className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="font-medium text-slate-900 block">
                  Enable private PESU Academy announcements section
                </span>
                <span className="text-xs text-slate-500">
                  Opt in to view your own private PESU Academy notices inside the Hackathons tab.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>

      {/* Single Primary Action */}
      <div className="flex items-center justify-end gap-3">
        {!isInline && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 transition-colors cursor-pointer"
        >
          <span>Save Profile</span>
        </button>
      </div>
    </div>
  );

  if (isInline) {
    return <div className="max-w-3xl mx-auto">{formContent}</div>;
  }

  return (
    <Modal onClose={onClose} title="Edit Profile">
      {formContent}
    </Modal>
  );
};
