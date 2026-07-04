import React from 'react';
import { CloseIcon, ExclamationCircleIcon } from './Icons';

interface ErrorStateProps {
  title: string;
  message: string;
  suggestion?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  type?: 'error' | 'warning' | 'info';
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title,
  message,
  suggestion,
  actionLabel,
  onAction,
  onDismiss,
  type = 'error',
}) => {
  const colorMap = {
    error: { icon: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    warning: { icon: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    info: { icon: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  };

  const colors = colorMap[type];

  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} p-4`}>
      <div className="flex gap-3 items-start">
        <ExclamationCircleIcon className={`w-6 h-6 ${colors.icon} flex-shrink-0 mt-0.5`} />
        <div className="flex-1">
          <h3 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-2">{message}</p>
          {suggestion && (
            <p className="text-xs text-[var(--text-tertiary)] mb-3 italic">💡 {suggestion}</p>
          )}
          {(actionLabel || onDismiss) && (
            <div className="flex gap-2 flex-wrap">
              {actionLabel && onAction && (
                <button
                  onClick={onAction}
                  className="text-sm font-medium px-3 py-1.5 rounded bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 transition-colors"
                >
                  {actionLabel}
                </button>
              )}
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="text-sm font-medium px-3 py-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ErrorState;
