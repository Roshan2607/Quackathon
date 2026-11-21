import React, { useMemo, useState } from 'react';
import {
  ExecutionMode,
  FeaturedProject,
  Profile,
  User,
} from '../types/domain';
import { GitHubRepositoryItem } from '../types/apiContracts';
import {
  QUICK_INTEREST_OPTIONS,
  QUICK_ROLE_OPTIONS,
  QUICK_SKILL_OPTIONS,
} from './QuickOnboardingView';
import {
  Github,
  Check,
  Plus,
  Trash2,
  ChevronDown,
  Search,
  ExternalLink,
  X,
  Loader2,
  BadgeCheck,
} from 'lucide-react';
import { fetchLiveGitHubRepositoriesDeterministically } from '../services/adapters';
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
  isInline = false,
  onSaveProfile,
  onClose,
  onNotify,
}) => {
  const [interestTags, setInterestTags] = useState<string[]>(
    profile.interestTags ?? []
  );
  const [skillTags, setSkillTags] = useState<string[]>(profile.skillTags ?? []);
  const [customSkillInput, setCustomSkillInput] = useState('');
  const [preferredRoles, setPreferredRoles] = useState<string[]>(
    profile.preferredRoles ?? []
  );

  // Progressive disclosure for optional project / link details
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  // Optional More Details fields
  const [headline, setHeadline] = useState(profile.headline ?? '');
  const [about, setAbout] = useState(profile.about ?? '');
  const [githubUsername, setGithubUsername] = useState(
    profile.githubUsername ?? ''
  );
  const [featuredProjects, setFeaturedProjects] = useState<FeaturedProject[]>(
    (profile.featuredProjects ?? []).slice(0, MAX_FEATURED_PROJECTS)
  );
  const [portfolioLinks, setPortfolioLinks] = useState<
    { label: string; url: string }[]
  >(profile.portfolioLinks ?? []);

  // Manual project input
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjUrl, setNewProjUrl] = useState('');

  // Portfolio link input
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');

  // GitHub picker state (user explicitly selects up to 3 repos)
  const [githubRepos, setGithubRepos] = useState<GitHubRepositoryItem[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState('');

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
        setGithubError(
          res.errorMessage || 'Could not load public repositories.'
        );
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
        new Set(
          [repo.language, ...(repo.topics ?? [])].filter(Boolean) as string[]
        )
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

  const handleSave = () => {
    // Preserve existing stored fields & privacy protections untouched
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
      featuredProjects: featuredProjects.slice(0, MAX_FEATURED_PROJECTS),
      portfolioLinks,
      githubUsername: githubUsername.trim().replace(/^@/, '') || undefined,
      updatedAt: new Date().toISOString(),
    };

    const updatedPrivacy: User['privacyPreferences'] = {
      ...currentUser.privacyPreferences,
      githubConsent: Boolean(githubUsername.trim()),
      onboardingCompleted: true,
    };

    onSaveProfile(updatedProfile, updatedPrivacy);
  };

  const readOnlyDisplayName = currentUser.displayName.replace(
    ' (Synthetic Demo)',
    ''
  );

  const formContent = (
    <div className="space-y-6">
      {isInline && (
        <div className="pb-2 border-b border-[#e9e5dd]">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1c1b1b]">
            Profile
          </h1>
        </div>
      )}

      {/* Core Profile Card */}
      <div className="bg-white border border-[#e9e5dd] rounded-2xl p-6 space-y-6">
        {/* Simplified Profile Header: Display Name + Consistent Avatar + Subtle Verified Indicator */}
        <div className="flex items-center gap-4 pb-5 border-b border-[#f1ede6]">
          <StudentAvatar
            uid={currentUser.uid}
            name={readOnlyDisplayName}
            size="lg"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-[#1c1b1b] truncate">
                {readOnlyDisplayName}
              </h2>
              {currentUser.verified && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#725c00]"
                  title="Verified PESU student"
                >
                  <BadgeCheck className="w-4 h-4 text-[#725c00]" />
                  <span>Verified</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* A. Interests / Domains */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label className="text-sm font-semibold text-[#1c1b1b]">
              Interests &amp; Domains
            </label>
            <span className="text-xs text-[#746e65] tabular-nums">
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
                  className={`quack-chip inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium cursor-pointer ${
                    active
                      ? 'border-[#e5be35] bg-[#ffd84d] text-[#1c1b1b] font-semibold shadow-2xs'
                      : disabled
                      ? 'border-[#e9e5dd] bg-[#f6f3f2] text-[#a8a29e] cursor-not-allowed'
                      : 'border-[#e9e5dd] bg-white text-[#24211c] hover:bg-[#f6f3eb] hover:border-[#d0c6ae]'
                  }`}
                >
                  {active && <Check className="w-3.5 h-3.5 text-[#1c1b1b]" />}
                  <span>{interest}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* B. Skills */}
        <div>
          <label className="block text-sm font-semibold text-[#1c1b1b]">
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
                  className={`quack-chip inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium cursor-pointer ${
                    active
                      ? 'border-[#e5be35] bg-[#ffd84d] text-[#1c1b1b] font-semibold shadow-2xs'
                      : 'border-[#e9e5dd] bg-white text-[#24211c] hover:bg-[#f6f3eb] hover:border-[#d0c6ae]'
                  }`}
                >
                  {active && <Check className="w-3.5 h-3.5 text-[#1c1b1b]" />}
                  <span>{sk}</span>
                </button>
              );
            })}
            {customSkillsOnly.map((sk) => (
              <span
                key={sk}
                className="quack-chip inline-flex items-center gap-1.5 rounded-lg border border-[#e5be35] bg-[#ffd84d] px-3 py-1.5 text-sm font-semibold text-[#1c1b1b] shadow-2xs"
              >
                <Check className="w-3.5 h-3.5 text-[#1c1b1b]" />
                <span>{sk}</span>
                <button
                  type="button"
                  onClick={() => toggleSkill(sk)}
                  aria-label={`Remove ${sk}`}
                  className="text-[#1c1b1b]/70 hover:text-[#1c1b1b] cursor-pointer ml-0.5"
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
              className="flex-1 rounded-xl border border-[#e9e5dd] bg-[#faf8f2] px-3.5 py-2 text-sm text-[#1c1b1b] focus:outline-none focus:ring-1 focus:ring-[#ffd84d] focus:border-[#d0c6ae] focus:bg-white transition-colors duration-150"
            />
            <button
              type="button"
              onClick={handleAddCustomSkill}
              disabled={!customSkillInput.trim()}
              className="inline-flex items-center gap-1 rounded-xl border border-[#e9e5dd] bg-white px-3.5 py-2 text-sm font-semibold text-[#24211c] hover:bg-[#f6f3eb] disabled:opacity-40 transition-colors duration-150 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* C. Preferred Technical Role */}
        <div>
          <label className="block text-sm font-semibold text-[#1c1b1b]">
            Preferred Technical Role
          </label>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {roleOptions.map((role) => {
              const active = preferredRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={`quack-chip inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm font-medium cursor-pointer ${
                    active
                      ? 'border-[#e5be35] bg-[#ffd84d] text-[#1c1b1b] font-semibold shadow-2xs'
                      : 'border-[#e9e5dd] bg-white text-[#24211c] hover:bg-[#f6f3eb] hover:border-[#d0c6ae]'
                  }`}
                >
                  {active && <Check className="w-3.5 h-3.5 text-[#1c1b1b]" />}
                  <span>{role}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Collapsible Projects, Bio & Links */}
      <div className="bg-white border border-[#e9e5dd] rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMoreDetails((v) => !v)}
          aria-expanded={showMoreDetails}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-[#faf8f2] transition-colors duration-150 cursor-pointer"
        >
          <div>
            <div className="text-sm font-semibold text-[#1c1b1b]">
              Projects &amp; Links (Optional)
            </div>
            <div className="text-xs text-[#746e65] mt-0.5">
              Headline, short bio, GitHub featured projects (up to 3), and portfolio links
            </div>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-[#746e65] shrink-0 transition-transform duration-150 ${
              showMoreDetails ? 'rotate-180 text-[#1c1b1b]' : ''
            }`}
          />
        </button>

        {showMoreDetails && (
          <div className="px-6 pb-6 pt-3 border-t border-[#f1ede6] space-y-6">
            {/* Headline & Bio */}
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#1c1b1b]">
                  Headline
                </label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="e.g. Full-stack & ML student building fast prototypes"
                  maxLength={120}
                  className="mt-1.5 w-full rounded-xl border border-[#e9e5dd] bg-[#faf8f2] px-3.5 py-2 text-sm text-[#1c1b1b] focus:outline-none focus:ring-1 focus:ring-[#ffd84d] focus:border-[#d0c6ae] focus:bg-white"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-[#1c1b1b]">
                    About Me
                  </label>
                  <span className="text-xs text-[#746e65] font-mono tabular-nums">
                    {about.length} / 160
                  </span>
                </div>
                <textarea
                  maxLength={160}
                  rows={3}
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  placeholder="What do you like building during hackathons?"
                  className="mt-1.5 w-full rounded-xl border border-[#e9e5dd] bg-[#faf8f2] px-3.5 py-2 text-sm text-[#1c1b1b] focus:outline-none focus:ring-1 focus:ring-[#ffd84d] focus:border-[#d0c6ae] focus:bg-white"
                />
              </div>
            </div>

            {/* GitHub & Featured Projects (max 3) */}
            <div className="pt-4 border-t border-[#f1ede6] space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[#1c1b1b] flex items-center gap-2">
                  <Github className="w-4 h-4 text-[#746e65]" />
                  <span>Featured Projects (Up to {MAX_FEATURED_PROJECTS})</span>
                </h3>
                <p className="text-xs text-[#746e65] mt-0.5">
                  Link GitHub to pick up to {MAX_FEATURED_PROJECTS} public repositories, or add a project manually.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={githubUsername}
                  onChange={(e) => setGithubUsername(e.target.value)}
                  placeholder="GitHub username (optional)"
                  className="flex-1 min-w-[200px] rounded-xl border border-[#e9e5dd] bg-[#faf8f2] px-3.5 py-2 text-sm text-[#1c1b1b] focus:outline-none focus:ring-1 focus:ring-[#ffd84d] focus:border-[#d0c6ae] focus:bg-white"
                />
                <button
                  type="button"
                  onClick={handleFetchGithubRepos}
                  disabled={githubLoading || !githubUsername.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#e9e5dd] bg-white px-3.5 py-2 text-sm font-medium text-[#24211c] hover:bg-[#f6f3eb] disabled:opacity-40 transition-colors duration-150 cursor-pointer"
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
                <div className="rounded-xl border border-[#e9e5dd] bg-[#faf8f2] p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#4d4634] tabular-nums">
                      Select up to {MAX_FEATURED_PROJECTS} ({featuredProjects.length}/{MAX_FEATURED_PROJECTS} selected)
                    </span>
                    <input
                      type="text"
                      value={repoSearch}
                      onChange={(e) => setRepoSearch(e.target.value)}
                      placeholder="Filter repos..."
                      className="rounded-lg border border-[#e9e5dd] bg-white px-2.5 py-1 text-xs text-[#1c1b1b]"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-[#f1ede6] rounded-lg border border-[#e9e5dd] bg-white">
                    {filteredGithubRepos.slice(0, 20).map((repo) => {
                      const selected = isRepoFeatured(repo);
                      return (
                        <div
                          key={repo.name}
                          className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-[#1c1b1b] truncate">
                              {repo.name}
                            </div>
                            {repo.description && (
                              <div className="text-xs text-[#746e65] truncate">
                                {repo.description}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleRepoFeatured(repo)}
                            className={`quack-chip shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer ${
                              selected
                                ? 'border-[#e5be35] bg-[#ffd84d] text-[#1c1b1b] font-semibold'
                                : 'border-[#e9e5dd] bg-white text-[#24211c] hover:bg-[#f6f3eb]'
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
                      className="flex items-start justify-between gap-3 rounded-xl border border-[#e9e5dd] bg-[#faf8f2] px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#1c1b1b]">
                            {proj.title}
                          </span>
                          {proj.sourceUrl && (
                            <a
                              href={proj.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[#725c00] hover:underline inline-flex items-center gap-0.5"
                            >
                              <span>Link</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        {proj.description && (
                          <p className="text-xs text-[#746e65] mt-0.5">
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
                        className="text-[#746e65] hover:text-rose-600 p-1 cursor-pointer transition-colors duration-150"
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
                    className="rounded-xl border border-[#e9e5dd] bg-[#faf8f2] px-3 py-2 text-sm text-[#1c1b1b] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                  />
                  <input
                    type="text"
                    value={newProjDesc}
                    onChange={(e) => setNewProjDesc(e.target.value)}
                    placeholder="Short description"
                    className="rounded-xl border border-[#e9e5dd] bg-[#faf8f2] px-3 py-2 text-sm text-[#1c1b1b] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                  />
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={newProjUrl}
                      onChange={(e) => setNewProjUrl(e.target.value)}
                      placeholder="URL (optional)"
                      className="flex-1 min-w-0 rounded-xl border border-[#e9e5dd] bg-[#faf8f2] px-3 py-2 text-sm text-[#1c1b1b] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                    />
                    <button
                      type="button"
                      onClick={handleAddManualProject}
                      disabled={!newProjTitle.trim()}
                      className="rounded-xl border border-[#e9e5dd] bg-white px-3 py-2 text-sm font-medium text-[#24211c] hover:bg-[#f6f3eb] disabled:opacity-40 cursor-pointer shrink-0 transition-colors duration-150"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Portfolio Links */}
            <div className="pt-4 border-t border-[#f1ede6] space-y-3">
              <label className="block text-sm font-semibold text-[#1c1b1b]">
                Portfolio Links
              </label>
              {portfolioLinks.length > 0 && (
                <div className="space-y-1.5">
                  {portfolioLinks.map((link, idx) => (
                    <div
                      key={`${link.url}-${idx}`}
                      className="flex items-center justify-between gap-2 text-sm text-[#4d4634]"
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#725c00] hover:underline truncate"
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
                        aria-label={`Remove ${link.label}`}
                        className="text-[#746e65] hover:text-rose-600 cursor-pointer transition-colors duration-150"
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
                  className="w-44 rounded-xl border border-[#e9e5dd] bg-[#faf8f2] px-3 py-2 text-sm text-[#1c1b1b] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                />
                <input
                  type="url"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 min-w-[180px] rounded-xl border border-[#e9e5dd] bg-[#faf8f2] px-3 py-2 text-sm text-[#1c1b1b] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ffd84d]"
                />
                <button
                  type="button"
                  onClick={handleAddPortfolioLink}
                  disabled={!newLinkUrl.trim()}
                  className="rounded-xl border border-[#e9e5dd] bg-white px-3.5 py-2 text-sm font-medium text-[#24211c] hover:bg-[#f6f3eb] disabled:opacity-40 cursor-pointer transition-colors duration-150"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Primary Action */}
      <div className="flex items-center justify-end gap-3">
        {!isInline && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#e9e5dd] bg-white px-4 py-2.5 text-sm font-medium text-[#4d4634] hover:bg-[#f6f3eb] transition-colors duration-150 cursor-pointer"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe06b] active:scale-[0.98] border border-[#e5be35] text-[#1c1b1b] text-sm font-bold px-6 py-2.5 shadow-xs transition-all duration-150 cursor-pointer"
        >
          <Check className="w-4 h-4 text-[#1c1b1b]" />
          <span>Save Changes</span>
        </button>
      </div>
    </div>
  );

  if (isInline) {
    return <div className="max-w-3xl mx-auto">{formContent}</div>;
  }

  return (
    <Modal onClose={onClose} title="Profile">
      {formContent}
    </Modal>
  );
};
