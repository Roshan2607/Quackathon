import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  hasUnsavedChanges?: boolean;
  maxWidthClass?: string;
  children: React.ReactNode;
}

/**
 * Standardized Popup/Modal Wrapper (Requirement #6)
 * - Consistent top-right X icon button (no duplicate bottom Close text buttons)
 * - Escape key support
 * - Unsaved changes confirmation guard before discarding edits
 * - Accessible focus and responsive scroll container
 */
export const Modal: React.FC<ModalProps> = ({
  title,
  subtitle,
  onClose,
  hasUnsavedChanges = false,
  maxWidthClass = 'max-w-2xl',
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
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto"
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
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl ${maxWidthClass} w-full p-6 space-y-5 my-8 max-h-[90vh] overflow-y-auto shadow-xl relative`}
      >
        {/* Standardized Modal Header with Top-Right X Icon */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2
              id="modal-title"
              className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={attemptClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Unsaved Changes Warning Banner */}
        {showDiscardConfirm && (
          <div className="p-3.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="text-amber-900 dark:text-amber-200">
              <span className="font-bold block">Discard unsaved changes?</span>
              You have modified fields in this window that have not been saved yet.
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3 py-1.5 font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md cursor-pointer"
              >
                Discard & Close
              </button>
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  );
};
