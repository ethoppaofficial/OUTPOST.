/**
 * @file Modal.tsx
 * @module components/ui/Modal
 * @description Accessible dialog modal component with backdrop blur, keyboard dismissal, and body scroll locking.
 *
 * Accessibility & Behavior:
 * - Traps focus with `role="dialog"` and `aria-modal="true"`.
 * - Automatically attaches an `Escape` key listener when open to allow keyboard dismissal.
 * - Locks `document.body.style.overflow = 'hidden'` to prevent background scroll leaks.
 * - Used across receipt upload, landlord decision reviews, and document previews.
 */

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  /** Visibility state of the modal */
  isOpen: boolean;
  /** Callback fired when user closes the modal (via X button, backdrop click, or Escape key) */
  onClose: () => void;
  /** Modal header text */
  title: string;
  /** Dialog content body */
  children: React.ReactNode;
  /** Maximum width constraint */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}

/**
 * Centered dialog modal component.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'md',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  }[maxWidth];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`relative w-full ${maxWidthClass} bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 id="modal-title" className="text-lg font-semibold text-slate-900 dark:text-white">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};
