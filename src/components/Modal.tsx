import React, { useEffect } from 'react';
import { X, Edit3 } from 'lucide-react';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  hasUnsavedChanges?: boolean;
  maxWidthClass?: string;
  children: React.ReactNode;
}

/**
 * Standardized Centered Polished Modal Wrapper (Stitch Canary Minimal Design)
 * - Frosted backdrop (bg-black/40 backdrop-blur-md)
 * - Bounded max-height with internal smooth scrolling
 * - Top-right close button
 * - Escape key support
 * - Unsaved changes confirmation guard
 */
export const Modal: React.FC<ModalProps> = ({
  title,
  subtitle,
  onClose,
  hasUnsavedChanges = false,
  maxWidthClass = 'max-w-[760px]',
  children,
}) => {
  const [showDiscardConfirm, setShowDiscardConfirm] = React.useState(false);

  const attemptClose = () => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasUnsavedChanges, showDiscardConfirm, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-md transition-opacity duration-200 overflow-y-auto"
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
        className={`modal-enter relative w-full ${maxWidthClass} max-h-[88vh] flex flex-col bg-white rounded-2xl shadow-[0_24px_64px_-12px_rgba(0,0,0,0.22)] border border-[#e5e5e5] overflow-hidden my-auto`}
      >
        {/* FIXED MODAL HEADER */}
        <header className="px-6 py-4 border-b border-[#e5e5e5] flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#ffd84d]/60 flex items-center justify-center text-[#725c00]">
              <Edit3 className="w-4 h-4 text-[#725c00]" />
            </div>
            <div>
              <h2
                id="modal-title"
                className="text-base font-bold text-[#1c1b1b]"
              >
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs text-[#746e65] mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={attemptClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#7e7662] hover:text-[#1c1b1b] hover:bg-[#f0eded] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
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
                className="px-3 py-1.5 font-semibold bg-white border border-[#e9e5dd] rounded-lg text-[#1c1b1b] hover:bg-[#f6f3f2] cursor-pointer"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 font-semibold bg-[#ba1a1a] hover:bg-rose-700 text-white rounded-lg cursor-pointer shadow-xs"
              >
                Discard &amp; Close
              </button>
            </div>
          </div>
        )}

        {/* SCROLLABLE MODAL CONTENT */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 text-[#1c1b1b]">
          {children}
        </div>
      </div>
    </div>
  );
};
