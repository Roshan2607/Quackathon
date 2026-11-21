import React, { useState } from 'react';
import { ArrowRight, Check, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { Profile, User } from '../types/domain';
import { normalizeHumanDisplayName } from '../lib/displayName';
import { StudentAvatar } from './StudentAvatar';

export const QUICK_INTEREST_OPTIONS = [
  'AI/ML',
  'Web Development',
  'Cybersecurity',
  'Robotics',
  'Data Science',
  'Design',
  'Mobile Apps',
  'Cloud/Systems',
] as const;

export const QUICK_SKILL_OPTIONS = [
  'Python',
  'JavaScript',
  'React',
  'SQL',
  'C++',
  'Figma',
  'TypeScript',
  'Node.js',
  'PyTorch',
  'Docker',
] as const;

export const QUICK_ROLE_OPTIONS = [
  'Frontend',
  'Backend',
  'ML/Data',
  'Design',
  'Hardware',
  'Flexible',
] as const;

interface QuickOnboardingViewProps {
  currentUser: User;
  existingProfile: Profile;
  onComplete: (payload: {
    displayName?: string;
    profile: Profile;
    privacyPreferences: User['privacyPreferences'];
    skipped?: boolean;
  }) => Promise<void> | void;
}

export const QuickOnboardingView: React.FC<QuickOnboardingViewProps> = ({
  currentUser,
  existingProfile,
  onComplete,
}) => {
  const needsName = Boolean(currentUser.needsDisplayNameSetup);
  const [displayNameInput, setDisplayNameInput] = useState(
    needsName ? '' : currentUser.displayName
  );
  const [nameError, setNameError] = useState<string | null>(null);

  const [selectedInterests, setSelectedInterests] = useState<string[]>(
    existingProfile.interestTags.slice(0, 3)
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    existingProfile.skillTags
  );
  const [customSkillInput, setCustomSkillInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>(
    existingProfile.preferredRoles[0] ?? ''
  );
  const [submitting, setSubmitting] = useState(false);

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) => {
      if (prev.includes(interest)) {
        return prev.filter((item) => item !== interest);
      }
      if (prev.length >= 3) {
        return prev;
      }
      return [...prev, interest];
    });
  };

  const toggleSkill = (skill: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skill)
        ? prev.filter((item) => item !== skill)
        : [...prev, skill]
    );
  };

  const handleAddCustomSkill = () => {
    const trimmed = customSkillInput.trim();
    if (!trimmed) return;
    const exists = selectedSkills.some(
      (s) => s.toLowerCase() === trimmed.toLowerCase()
    );
    if (!exists) {
      setSelectedSkills((prev) => [...prev, trimmed]);
    }
    setCustomSkillInput('');
  };

  const handleSubmit = async (skipped: boolean) => {
    setNameError(null);
    let validatedName: string | undefined;

    if (needsName && displayNameInput.trim()) {
      const normalized = normalizeHumanDisplayName(displayNameInput);
      if (!normalized) {
        setNameError(
          'Please enter your real name (not an SRN/PRN or email address).'
        );
        return;
      }
      validatedName = normalized;
    }

    setSubmitting(true);
    try {
      const nextProfile: Profile = skipped
        ? {
            ...existingProfile,
            updatedAt: new Date().toISOString(),
          }
        : {
            ...existingProfile,
            interestTags: selectedInterests,
            projectDomains: selectedInterests,
            skillTags: selectedSkills,
            preferredRoles: selectedRole ? [selectedRole] : [],
            updatedAt: new Date().toISOString(),
          };

      const nextPrivacy: User['privacyPreferences'] = {
        ...currentUser.privacyPreferences,
        onboardingCompleted: true,
        ...(validatedName ? { customDisplayNameSet: true } : {}),
      };

      await onComplete({
        displayName: validatedName,
        profile: nextProfile,
        privacyPreferences: nextPrivacy,
        skipped,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const customSkillsOnly = selectedSkills.filter(
    (sk) =>
      !QUICK_SKILL_OPTIONS.some(
        (preset) => preset.toLowerCase() === sk.toLowerCase()
      )
  );

  return (
    <div className="min-h-screen bg-[#faf8f2] text-[#1c1b1b] py-10 px-4 sm:px-6 antialiased">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white border border-[#e9e5dd] rounded-2xl shadow-sm p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4 pb-6 border-b border-[#f1ede6]">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-7 h-7 rounded-lg bg-[#ffd84d] flex items-center justify-center">
                  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
                    <ellipse cx="24" cy="27" rx="15.5" ry="14.5" fill="#ffdc63" />
                    <path d="M13 17c2-10 18-12 22 0" fill="#ffdc63" />
                    <circle cx="19" cy="25" r="1.7" fill="#25221c" />
                    <circle cx="28.5" cy="25" r="1.7" fill="#25221c" />
                    <path d="M19 30h10c0 5-10 5-10 0z" fill="#eba64a" />
                  </svg>
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-[#725c00]">
                  Quick Setup
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-[#1c1b1b]">
                {needsName
                  ? 'Welcome to Quackathon'
                  : `Welcome, ${currentUser.displayName.split(' ')[0]}`}
              </h1>
              <p className="mt-1 text-sm text-[#746e65]">
                Pick a few interests, skills, and a preferred role so we can suggest compatible teammates right away.
              </p>
            </div>
            <StudentAvatar
              uid={currentUser.uid}
              name={currentUser.displayName}
              size="lg"
              className="hidden sm:inline-flex"
            />
          </div>

          <div className="mt-6 space-y-7">
            {/* Optional one-time Display Name if OAuth did not provide a human name */}
            {needsName && (
              <section>
                <label
                  htmlFor="quick-display-name"
                  className="block text-sm font-semibold text-[#1c1b1b]"
                >
                  Display Name
                </label>
                <p className="mt-0.5 text-xs text-[#746e65]">
                  PESU OAuth did not include your full name. Choose how teammates should see you.
                </p>
                <input
                  id="quick-display-name"
                  type="text"
                  value={displayNameInput}
                  onChange={(e) => {
                    setDisplayNameInput(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  placeholder="e.g. Aarav Sharma"
                  maxLength={60}
                  className="mt-2 w-full rounded-xl border border-[#e9e5dd] bg-[#f6f3f2] px-3.5 py-2.5 text-sm text-[#1c1b1b] placeholder:text-[#7e7662] focus:bg-white focus:border-[#725c00] focus:outline-none focus:ring-1 focus:ring-[#725c00]"
                />
                {nameError && (
                  <p className="mt-1.5 text-xs text-rose-600">{nameError}</p>
                )}
              </section>
            )}

            {/* A. Interests */}
            <section>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#1c1b1b]">
                  1. Interests
                </h2>
                <span className="text-xs text-[#746e65]">
                  Choose up to 3 ({selectedInterests.length}/3)
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK_INTEREST_OPTIONS.map((interest) => {
                  const active = selectedInterests.includes(interest);
                  const disabled = !active && selectedInterests.length >= 3;
                  return (
                    <button
                      key={interest}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleInterest(interest)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        active
                          ? 'border-[#ffd84d] bg-[#fff3c9] text-[#272015] font-bold shadow-xs'
                          : disabled
                          ? 'border-[#e9e5dd] bg-[#f6f3f2] text-[#746e65]/50 cursor-not-allowed'
                          : 'border-[#e9e5dd] bg-[#f6f3f2] text-[#514b43] hover:border-[#d0c6ae] hover:bg-white'
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5 text-[#725c00]" />}
                      <span>{interest}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* B. Skills */}
            <section>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#1c1b1b]">
                  2. Skills
                </h2>
                <span className="text-xs text-[#746e65]">
                  Select a few or add your own
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK_SKILL_OPTIONS.map((skill) => {
                  const active = selectedSkills.includes(skill);
                  return (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        active
                          ? 'border-[#ffd84d] bg-[#fff3c9] text-[#272015] font-bold shadow-xs'
                          : 'border-[#e9e5dd] bg-[#f6f3f2] text-[#514b43] hover:border-[#d0c6ae] hover:bg-white'
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5 text-[#725c00]" />}
                      <span>{skill}</span>
                    </button>
                  );
                })}
                {customSkillsOnly.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#ffd84d] bg-[#fff3c9] px-3.5 py-1.5 text-xs font-bold text-[#272015]"
                  >
                    <span>{skill}</span>
                    <button
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      aria-label={`Remove ${skill}`}
                      className="text-[#725c00] hover:text-red-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
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
                  placeholder="Add a custom skill (e.g. Rust, Flutter, Unity)"
                  className="flex-1 rounded-xl border border-[#e9e5dd] bg-[#f6f3f2] px-3.5 py-2 text-sm text-[#1c1b1b] placeholder:text-[#7e7662] focus:bg-white focus:border-[#725c00] focus:outline-none focus:ring-1 focus:ring-[#725c00]"
                />
                <button
                  type="button"
                  onClick={handleAddCustomSkill}
                  disabled={!customSkillInput.trim()}
                  className="inline-flex items-center gap-1 rounded-xl border border-[#e9e5dd] bg-white px-3.5 py-2 text-sm font-semibold text-[#1c1b1b] hover:bg-[#f6f3eb] disabled:opacity-40 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add</span>
                </button>
              </div>
            </section>

            {/* C. Preferred Role */}
            <section>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#1c1b1b]">
                  3. Preferred Role
                </h2>
                <span className="text-xs text-[#746e65]">Pick one</span>
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {QUICK_ROLE_OPTIONS.map((role) => {
                  const active = selectedRole === role;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() =>
                        setSelectedRole((prev) => (prev === role ? '' : role))
                      }
                      className={`rounded-xl border px-3.5 py-2.5 text-xs font-semibold text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-[#ffd84d] bg-[#fff3c9] text-[#272015] shadow-xs'
                          : 'border-[#e9e5dd] bg-[#f6f3f2] text-[#514b43] hover:border-[#d0c6ae] hover:bg-white'
                      }`}
                    >
                      {role}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Info Note */}
          <div className="mt-7 flex items-start gap-2.5 rounded-xl bg-[#fff3c9]/40 border border-[#ffd84d]/60 px-4 py-3 text-xs text-[#564500] leading-relaxed">
            <Sparkles className="w-4 h-4 text-[#875200] shrink-0 mt-0.5" />
            <p>
              GitHub, bio, and projects are completely optional. You can add them anytime under Profile → More Details to improve teammate recommendations.
            </p>
          </div>

          {/* Actions */}
          <div className="mt-7 pt-6 border-t border-[#f1ede6] flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleSubmit(true)}
              className="text-sm font-medium text-[#746e65] hover:text-[#1c1b1b] px-2 py-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              Skip for now
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => handleSubmit(false)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#ffd84d] hover:bg-[#ffe07e] text-[#1a1a1a] px-6 py-2.5 text-sm font-bold shadow-sm transition-all cursor-pointer disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>Continue</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
