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
  | 'panda';

const ANIMAL_VARIANTS: readonly AnimalVariant[] = [
  'duck',
  'fox',
  'owl',
  'bear',
  'cat',
  'penguin',
  'rabbit',
  'panda',
] as const;

const SIZE_CLASSES: Record<NonNullable<StudentAvatarProps['size']>, string> = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8',
  md: 'w-11 h-11',
  lg: 'w-14 h-14',
};

const BG_CLASSES: Record<AnimalVariant, string> = {
  duck: 'bg-amber-100 border-amber-200/80',
  fox: 'bg-orange-100 border-orange-200/80',
  owl: 'bg-indigo-100 border-indigo-200/80',
  bear: 'bg-stone-200 border-stone-300/80',
  cat: 'bg-rose-100 border-rose-200/80',
  penguin: 'bg-sky-100 border-sky-200/80',
  rabbit: 'bg-emerald-100 border-emerald-200/80',
  panda: 'bg-slate-200 border-slate-300/80',
};

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function getAnimalVariantForStudent(
  uid?: string | null,
  name?: string | null
): AnimalVariant {
  const seed = (uid || name || 'quackathon-student').trim().toLowerCase();
  return ANIMAL_VARIANTS[hashSeed(seed) % ANIMAL_VARIANTS.length];
}

function renderAnimalSvg(variant: AnimalVariant): React.ReactNode {
  switch (variant) {
    case 'duck':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <circle cx="20" cy="21" r="12" fill="#FACC15" stroke="#1E293B" strokeWidth="1.8" />
          <path d="M29 19 C34 18, 36 21, 34 23 C31 24, 29 23, 28 22 Z" fill="#EA580C" stroke="#1E293B" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="24" cy="18" r="2" fill="#1E293B" />
          <circle cx="24.6" cy="17.4" r="0.6" fill="#FFFFFF" />
          <path d="M14 24 C17 26, 21 26, 23 24" fill="none" stroke="#CA8A04" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'fox':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <polygon points="10,18 13,8 19,14" fill="#EA580C" stroke="#1E293B" strokeWidth="1.6" strokeLinejoin="round" />
          <polygon points="30,18 27,8 21,14" fill="#EA580C" stroke="#1E293B" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="20" cy="22" r="11" fill="#F97316" stroke="#1E293B" strokeWidth="1.8" />
          <path d="M12 24 C15 20, 25 20, 28 24 C26 30, 14 30, 12 24 Z" fill="#FFF7ED" />
          <circle cx="16" cy="20" r="1.6" fill="#1E293B" />
          <circle cx="24" cy="20" r="1.6" fill="#1E293B" />
          <polygon points="18.2,24 21.8,24 20,26.2" fill="#1E293B" />
        </svg>
      );
    case 'owl':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <path d="M11 14 L14 9 L18 13 M29 14 L26 9 L22 13" fill="#6366F1" stroke="#1E293B" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="20" cy="22" r="11.5" fill="#6366F1" stroke="#1E293B" strokeWidth="1.8" />
          <circle cx="15.5" cy="20" r="4.2" fill="#EEF2FF" stroke="#1E293B" strokeWidth="1.4" />
          <circle cx="24.5" cy="20" r="4.2" fill="#EEF2FF" stroke="#1E293B" strokeWidth="1.4" />
          <circle cx="15.5" cy="20" r="1.7" fill="#1E293B" />
          <circle cx="24.5" cy="20" r="1.7" fill="#1E293B" />
          <polygon points="18.4,23.5 21.6,23.5 20,26.8" fill="#F59E0B" stroke="#1E293B" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case 'bear':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <circle cx="12" cy="13" r="4.5" fill="#92400E" stroke="#1E293B" strokeWidth="1.6" />
          <circle cx="28" cy="13" r="4.5" fill="#92400E" stroke="#1E293B" strokeWidth="1.6" />
          <circle cx="20" cy="22" r="11.2" fill="#B45309" stroke="#1E293B" strokeWidth="1.8" />
          <ellipse cx="20" cy="25" rx="5.5" ry="4.2" fill="#FDE68A" />
          <circle cx="16" cy="20" r="1.6" fill="#1E293B" />
          <circle cx="24" cy="20" r="1.6" fill="#1E293B" />
          <ellipse cx="20" cy="23.5" rx="2.2" ry="1.5" fill="#1E293B" />
        </svg>
      );
    case 'cat':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <polygon points="10,19 12,9 18,14" fill="#FB7185" stroke="#1E293B" strokeWidth="1.6" strokeLinejoin="round" />
          <polygon points="30,19 28,9 22,14" fill="#FB7185" stroke="#1E293B" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="20" cy="22" r="11" fill="#FDA4AF" stroke="#1E293B" strokeWidth="1.8" />
          <circle cx="16" cy="20.5" r="1.6" fill="#1E293B" />
          <circle cx="24" cy="20.5" r="1.6" fill="#1E293B" />
          <polygon points="18.6,23.5 21.4,23.5 20,25.2" fill="#BE123C" />
          <path d="M11 23 H15 M25 23 H29 M11.5 26 H15 M25 26 H28.5" stroke="#1E293B" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'penguin':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <circle cx="20" cy="21" r="11.5" fill="#1E293B" stroke="#0F172A" strokeWidth="1.6" />
          <path d="M13 23 C13 17, 17 16, 20 19 C23 16, 27 17, 27 23 C27 29, 24 31, 20 31 C16 31, 13 29, 13 23 Z" fill="#F8FAFC" />
          <circle cx="16.2" cy="20.5" r="1.5" fill="#0F172A" />
          <circle cx="23.8" cy="20.5" r="1.5" fill="#0F172A" />
          <polygon points="17.8,23 22.2,23 20,26.2" fill="#F97316" stroke="#0F172A" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      );
    case 'rabbit':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <ellipse cx="15" cy="11.5" rx="3" ry="6.5" fill="#F8FAFC" stroke="#1E293B" strokeWidth="1.6" />
          <ellipse cx="25" cy="11.5" rx="3" ry="6.5" fill="#F8FAFC" stroke="#1E293B" strokeWidth="1.6" />
          <ellipse cx="15" cy="12" rx="1.4" ry="4" fill="#FBCFE8" />
          <ellipse cx="25" cy="12" rx="1.4" ry="4" fill="#FBCFE8" />
          <circle cx="20" cy="23" r="10.5" fill="#FFFFFF" stroke="#1E293B" strokeWidth="1.8" />
          <circle cx="16.2" cy="21.5" r="1.5" fill="#1E293B" />
          <circle cx="23.8" cy="21.5" r="1.5" fill="#1E293B" />
          <ellipse cx="20" cy="24.5" rx="2" ry="1.3" fill="#F43F5E" />
        </svg>
      );
    case 'panda':
      return (
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <circle cx="12" cy="13" r="4.2" fill="#1E293B" />
          <circle cx="28" cy="13" r="4.2" fill="#1E293B" />
          <circle cx="20" cy="22" r="11" fill="#FFFFFF" stroke="#1E293B" strokeWidth="1.8" />
          <ellipse cx="15.5" cy="21" rx="3.2" ry="2.6" transform="rotate(-18 15.5 21)" fill="#1E293B" />
          <ellipse cx="24.5" cy="21" rx="3.2" ry="2.6" transform="rotate(18 24.5 21)" fill="#1E293B" />
          <circle cx="15.8" cy="20.6" r="1" fill="#FFFFFF" />
          <circle cx="24.2" cy="20.6" r="1" fill="#FFFFFF" />
          <ellipse cx="20" cy="24.5" rx="2.1" ry="1.4" fill="#1E293B" />
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
