import React, { useEffect, useRef } from 'react';
import { X, Edit3 } from 'lucide-react';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  hasUnsavedChanges?: boolean;
  maxWidthClass?: string;
  headerIcon?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Standardized Centered Polished Modal Wrapper (Canary Minimal Design)
 * - Frosted backdrop (bg-black/40 backdrop-blur-md) with smooth fade
 * - Bounded max-height with internal smooth scrolling
 * - Top-right close button
 * - Escape key support + keyboard focus trap + focus restoration on close
 * - Unsaved changes confirmation guard
 */
export const Modal: React.FC<ModalProps> = ({
  title,
  subtitle,
  onClose,
  hasUnsavedChanges = false,
  maxWidthClass = 'max-w-[760px]',
  headerIcon,
  footer,
  children,
}) => {
  const [showDiscardConfirm, setShowDiscardConfirm] = React.useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const attemptClose = React.useCallback(() => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [hasUnsavedChanges, onClose]);

  // Restore focus on close and focus dialog container / close button on mount
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const container = dialogRef.current;
    if (container) {
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        container.focus();
      }
    }
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, []);

  // Escape key & Tab focus trapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (showDiscardConfirm) {
          setShowDiscardConfirm(false);
        } else if (hasUnsavedChanges) {
          setShowDiscardConfirm(true);
        } else {
          onClose();
        }
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasUnsavedChanges, showDiscardConfirm, onClose]);

  return (
    <div
      className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          attemptClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`modal-enter relative w-full ${maxWidthClass} max-h-[88vh] flex flex-col bg-white rounded-2xl shadow-[0_24px_64px_-12px_rgba(0,0,0,0.22)] border border-[#e9e5dd] overflow-hidden my-auto focus:outline-none`}
      >
        {/* FIXED MODAL HEADER */}
        <header className="px-6 py-4 border-b border-[#e9e5dd] flex items-center justify-between gap-3 bg-white shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#fff3c9] border border-[#f2dc8c] flex items-center justify-center text-[#725c00] shrink-0">
              {headerIcon ?? <Edit3 className="w-4 h-4 text-[#725c00]" />}
            </div>
            <div className="min-w-0">
              <h2
                id="modal-title"
                className="text-base font-bold text-[#1c1b1b] truncate"
              >
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs text-[#746e65] mt-0.5 truncate">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={attemptClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#746e65] hover:text-[#1c1b1b] hover:bg-[#f6f3eb] transition-colors duration-150 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Unsaved Changes Confirmation Banner */}
        {showDiscardConfirm && (
          <div className="p-3.5 bg-[#fff3c9] border-b border-[#ffd84d] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shrink-0">
            <div className="text-[#725c00]">
              <span className="font-bold block">Discard unsaved changes?</span>
              You have modified fields that have not been saved yet.
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3 py-1.5 font-semibold bg-white border border-[#e9e5dd] rounded-lg text-[#1c1b1b] hover:bg-[#f6f3eb] cursor-pointer transition-colors duration-150"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 font-semibold bg-[#ba1a1a] hover:bg-rose-700 text-white rounded-lg cursor-pointer shadow-xs transition-colors duration-150"
              >
                Discard &amp; Close
              </button>
            </div>
          </div>
        )}

        {/* SCROLLABLE MODAL CONTENT */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5 text-[#1c1b1b]">
          {children}
        </div>

        {/* OPTIONAL FIXED MODAL FOOTER */}
        {footer && (
          <footer className="px-6 py-3.5 border-t border-[#e9e5dd] bg-[#faf8f2] flex items-center justify-end gap-2.5 shrink-0">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
};
