import React from 'react';

export interface StudentAvatarProps {
  uid?: string | null;
  name?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

type AnimalVariant =
  | 'duck'
  | 'fox'
  | 'owl'
  | 'bear'
  | 'cat'
  | 'penguin'
  | 'rabbit'
  | 'otter';

const ANIMAL_VARIANTS: readonly AnimalVariant[] = [
  'duck',
  'fox',
  'owl',
  'bear',
  'cat',
  'penguin',
  'rabbit',
  'otter',
] as const;

const SIZE_CLASSES: Record<NonNullable<StudentAvatarProps['size']>, string> = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8',
  md: 'w-11 h-11',
  lg: 'w-14 h-14',
};

const BG_CLASSES: Record<AnimalVariant, string> = {
  duck: 'bg-[#fff3c9] border-[#f0d98c]',
  fox: 'bg-[#ffedd5] border-[#fed7aa]',
  owl: 'bg-[#fef3c7] border-[#fde68a]',
  bear: 'bg-[#f5efe6] border-[#e5d8c5]',
  cat: 'bg-[#ffe4e6] border-[#fecdd3]',
  penguin: 'bg-[#f1ede6] border-[#dfd8cc]',
  rabbit: 'bg-[#ecfdf5] border-[#d1fae5]',
  otter: 'bg-[#fef3c7] border-[#f3d89c]',
};

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * Deterministic avatar assignment seeded strictly by stable `uid` when available
 * (falling back to `name` only when `uid` is absent) so a student's avatar stays
 * consistent across every page, re-render, and login session.
 */
export function getAnimalVariantForStudent(
  uid?: string | null,
  name?: string | null
): AnimalVariant {
  const normalizedUid = typeof uid === 'string' ? uid.trim().toLowerCase() : '';
  const normalizedName = typeof name === 'string' ? name.trim().toLowerCase() : '';
  const seed = normalizedUid || normalizedName || 'quackathon-student';
  return ANIMAL_VARIANTS[hashSeed(seed) % ANIMAL_VARIANTS.length];
}

function renderAnimalSvg(variant: AnimalVariant): React.ReactNode {
  switch (variant) {
    case 'duck':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <circle cx="20" cy="21" r="12" fill="#FFD84D" stroke="#24211C" strokeWidth="1.7" />
          <path d="M29 19 C34 18, 36 21, 34 23 C31 24, 29 23, 28 22 Z" fill="#EB7B2D" stroke="#24211C" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="24" cy="18" r="2" fill="#24211C" />
          <circle cx="24.6" cy="17.4" r="0.6" fill="#FFFFFF" />
          <path d="M14 24 C17 26, 21 26, 23 24" fill="none" stroke="#B68A00" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'fox':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <polygon points="10,18 13,8 19,14" fill="#EA580C" stroke="#24211C" strokeWidth="1.6" strokeLinejoin="round" />
          <polygon points="30,18 27,8 21,14" fill="#EA580C" stroke="#24211C" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="20" cy="22" r="11" fill="#F97316" stroke="#24211C" strokeWidth="1.7" />
          <path d="M12 24 C15 20, 25 20, 28 24 C26 30, 14 30, 12 24 Z" fill="#FFF7ED" />
          <circle cx="16" cy="20" r="1.6" fill="#24211C" />
          <circle cx="24" cy="20" r="1.6" fill="#24211C" />
          <polygon points="18.2,24 21.8,24 20,26.2" fill="#24211C" />
        </svg>
      );
    case 'owl':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <path d="M11 14 L14 9 L18 13 M29 14 L26 9 L22 13" fill="#B47B2B" stroke="#24211C" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="20" cy="22" r="11.5" fill="#C98F3B" stroke="#24211C" strokeWidth="1.7" />
          <circle cx="15.5" cy="20" r="4.2" fill="#FFF8E7" stroke="#24211C" strokeWidth="1.4" />
          <circle cx="24.5" cy="20" r="4.2" fill="#FFF8E7" stroke="#24211C" strokeWidth="1.4" />
          <circle cx="15.5" cy="20" r="1.7" fill="#24211C" />
          <circle cx="24.5" cy="20" r="1.7" fill="#24211C" />
          <polygon points="18.4,23.5 21.6,23.5 20,26.8" fill="#FFD84D" stroke="#24211C" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case 'bear':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <circle cx="12" cy="13" r="4.5" fill="#92400E" stroke="#24211C" strokeWidth="1.6" />
          <circle cx="28" cy="13" r="4.5" fill="#92400E" stroke="#24211C" strokeWidth="1.6" />
          <circle cx="20" cy="22" r="11.2" fill="#B45309" stroke="#24211C" strokeWidth="1.7" />
          <ellipse cx="20" cy="25" rx="5.5" ry="4.2" fill="#FDE68A" />
          <circle cx="16" cy="20" r="1.6" fill="#24211C" />
          <circle cx="24" cy="20" r="1.6" fill="#24211C" />
          <ellipse cx="20" cy="23.5" rx="2.2" ry="1.5" fill="#24211C" />
        </svg>
      );
    case 'cat':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <polygon points="10,19 12,9 18,14" fill="#FB7185" stroke="#24211C" strokeWidth="1.6" strokeLinejoin="round" />
          <polygon points="30,19 28,9 22,14" fill="#FB7185" stroke="#24211C" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="20" cy="22" r="11" fill="#FDA4AF" stroke="#24211C" strokeWidth="1.7" />
          <circle cx="16" cy="20.5" r="1.6" fill="#24211C" />
          <circle cx="24" cy="20.5" r="1.6" fill="#24211C" />
          <polygon points="18.6,23.5 21.4,23.5 20,25.2" fill="#BE123C" />
          <path d="M11 23 H15 M25 23 H29 M11.5 26 H15 M25 26 H28.5" stroke="#24211C" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'penguin':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <circle cx="20" cy="21" r="11.5" fill="#3B3630" stroke="#24211C" strokeWidth="1.6" />
          <path d="M13 23 C13 17, 17 16, 20 19 C23 16, 27 17, 27 23 C27 29, 24 31, 20 31 C16 31, 13 29, 13 23 Z" fill="#FAF8F2" />
          <circle cx="16.2" cy="20.5" r="1.5" fill="#24211C" />
          <circle cx="23.8" cy="20.5" r="1.5" fill="#24211C" />
          <polygon points="17.8,23 22.2,23 20,26.2" fill="#F59E0B" stroke="#24211C" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      );
    case 'rabbit':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <ellipse cx="15" cy="11.5" rx="3" ry="6.5" fill="#FAF8F2" stroke="#24211C" strokeWidth="1.6" />
          <ellipse cx="25" cy="11.5" rx="3" ry="6.5" fill="#FAF8F2" stroke="#24211C" strokeWidth="1.6" />
          <ellipse cx="15" cy="12" rx="1.4" ry="4" fill="#FBCFE8" />
          <ellipse cx="25" cy="12" rx="1.4" ry="4" fill="#FBCFE8" />
          <circle cx="20" cy="23" r="10.5" fill="#FFFFFF" stroke="#24211C" strokeWidth="1.7" />
          <circle cx="16.2" cy="21.5" r="1.5" fill="#24211C" />
          <circle cx="23.8" cy="21.5" r="1.5" fill="#24211C" />
          <ellipse cx="20" cy="24.5" rx="2" ry="1.3" fill="#F43F5E" />
        </svg>
      );
    case 'otter':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <circle cx="12.5" cy="15" r="3.6" fill="#A16207" stroke="#24211C" strokeWidth="1.5" />
          <circle cx="27.5" cy="15" r="3.6" fill="#A16207" stroke="#24211C" strokeWidth="1.5" />
          <circle cx="20" cy="22" r="11" fill="#C2883A" stroke="#24211C" strokeWidth="1.7" />
          <ellipse cx="20" cy="24.5" rx="6.2" ry="4.8" fill="#FFF3C9" />
          <circle cx="15.8" cy="19.8" r="1.6" fill="#24211C" />
          <circle cx="24.2" cy="19.8" r="1.6" fill="#24211C" />
          <ellipse cx="20" cy="23.2" rx="2.3" ry="1.5" fill="#24211C" />
          <path d="M17.5 26.2 Q20 27.8 22.5 26.2" fill="none" stroke="#24211C" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
  }
}

export const StudentAvatar: React.FC<StudentAvatarProps> = ({
  uid,
  name,
  size = 'sm',
  className = '',
}) => {
  const variant = getAnimalVariantForStudent(uid, name);
  const label = name ? `${name} avatar` : 'Student avatar';

  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-full border overflow-hidden shrink-0 select-none ${SIZE_CLASSES[size]} ${BG_CLASSES[variant]} ${className}`}
    >
      {renderAnimalSvg(variant)}
    </span>
  );
};
