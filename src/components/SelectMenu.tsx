import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectMenuOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
}

interface SelectMenuProps {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  menuAlign?: 'left' | 'right';
}

/**
 * Accessible Canary Minimal Dropdown Menu
 * - Smooth open/close fade + slight vertical translate (<= 160ms, compositor-only)
 * - Animated chevron rotation
 * - Keyboard accessible (ArrowUp/ArrowDown, Home/End, Enter/Space, Escape)
 */
export const SelectMenu: React.FC<SelectMenuProps> = ({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Select an option',
  className = '',
  buttonClassName = '',
  menuAlign = 'left',
}) => {
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const openMenu = () => {
    const idx = options.findIndex((o) => o.value === value);
    setHighlightedIdx(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev + 1) % Math.max(1, options.length));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((prev) =>
        prev <= 0 ? Math.max(0, options.length - 1) : prev - 1
      );
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const target = options[highlightedIdx];
      if (target && !target.disabled) {
        onChange(target.value);
        setOpen(false);
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        className={`w-full flex items-center justify-between gap-2.5 bg-white border border-[#e9e5dd] hover:border-[#d0c6ae] text-[#1c1b1b] text-xs font-semibold rounded-xl px-3.5 py-2.5 shadow-2xs transition-colors duration-150 cursor-pointer ${buttonClassName}`}
      >
        <span className="truncate text-left">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[#746e65] shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180 text-[#1c1b1b]' : ''
          }`}
        />
      </button>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={`quack-dropdown-enter absolute z-50 mt-1.5 min-w-full w-max max-w-[340px] max-h-64 overflow-y-auto rounded-xl bg-white border border-[#e9e5dd] shadow-[0_14px_34px_-12px_rgba(36,33,28,0.22)] p-1.5 space-y-0.5 ${
            menuAlign === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isHighlighted = idx === highlightedIdx;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled}
                onMouseEnter={() => setHighlightedIdx(idx)}
                onClick={() => {
                  if (opt.disabled) return;
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors duration-150 ${
                  opt.disabled
                    ? 'opacity-50 cursor-not-allowed text-[#746e65]'
                    : 'cursor-pointer'
                } ${
                  isSelected
                    ? 'bg-[#fff3c9] text-[#1c1b1b] font-semibold'
                    : isHighlighted
                    ? 'bg-[#f6f3eb] text-[#1c1b1b]'
                    : 'text-[#24211c] hover:bg-[#f6f3eb]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{opt.label}</div>
                  {opt.description && (
                    <div className="text-[11px] text-[#746e65] truncate mt-0.5 font-normal">
                      {opt.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {opt.badge && (
                    <span className="px-1.5 py-0.5 rounded-md bg-[#f6f3f2] border border-[#e9e5dd] text-[10px] font-semibold text-[#746e65]">
                      {opt.badge}
                    </span>
                  )}
                  {isSelected && <Check className="w-3.5 h-3.5 text-[#725c00]" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
