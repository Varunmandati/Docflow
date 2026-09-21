import React, { useMemo } from 'react';
import { SpinnerIcon, CheckCircleIcon, ExclamationCircleIcon } from './Icons';

export interface ConversionStage {
  id: string;
  name: string;
  estimatedDuration?: number; // seconds
  status: 'pending' | 'in_progress' | 'complete' | 'failed';
  progress: number; // 0-100
  message?: string;
}

interface ConversionProgressWithStagesProps {
  stages: ConversionStage[];
  totalProgress: number; // 0-100
  estimatedTotalTime?: number; // seconds
  elapsedTime?: number; // seconds
  jobId: string;
  onCancel?: () => void;
  queuePosition?: number;
  queueSize?: number;
  fileName?: string;
}

export const ConversionProgressWithStages: React.FC<ConversionProgressWithStagesProps> = ({
  stages,
  totalProgress,
  estimatedTotalTime = 0,
  elapsedTime = 0,
  jobId,
  onCancel,
  queuePosition,
  queueSize,
  fileName = 'Your file',
}) => {
  const remainingTime = useMemo(() => {
    return Math.max(0, estimatedTotalTime - elapsedTime);
  }, [estimatedTotalTime, elapsedTime]);

  const isComplete = stages.every((s) => s.status === 'complete');
  const hasFailed = stages.some((s) => s.status === 'failed');

  return (
    <div className="rounded-lg border border-[var(--border-color)] p-6 bg-[var(--background-card)] space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {isComplete ? '✓ Conversion complete!' : hasFailed ? '✗ Conversion failed' : 'Converting your file...'}
          </h3>
          {!isComplete && !hasFailed && queuePosition !== undefined && (
            <p className="text-sm text-[var(--text-tertiary)] mt-1">
              Position {queuePosition} of {queueSize} in queue
            </p>
          )}
          {fileName && (
            <p className="text-sm text-[var(--text-secondary)] mt-1">{fileName}</p>
          )}
        </div>
        {onCancel && !isComplete && !hasFailed && (
          <button
            onClick={onCancel}
            className="text-sm px-3 py-1.5 rounded-lg hover:bg-[var(--well)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title="Cancel conversion"
          >
            ⊘ Cancel
          </button>
        )}
      </div>

      {/* Overall Progress */}
      {!isComplete && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              Overall Progress
            </span>
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {totalProgress}%{remainingTime > 0 && ` • ~${remainingTime}s`}
            </span>
          </div>
          <div className="w-full h-2.5 bg-[var(--well-strong)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                hasFailed
                  ? 'bg-gradient-to-r from-red-500 to-red-500/80'
                  : 'bg-gradient-to-r from-[var(--primary-color)] via-[var(--primary-color)] to-[var(--primary-color)]/80'
              }`}
              style={{ width: `${Math.min(totalProgress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Stage Breakdown */}
      <div className="space-y-2 bg-[var(--background-secondary)] rounded-lg p-4">
        {stages.map((stage, index) => {
          const isActive = stage.status === 'in_progress';
          const isComplete = stage.status === 'complete';
          const isFailed = stage.status === 'failed';

          const getStatusIcon = () => {
            if (isComplete) return '✓';
            if (isActive) return '⟳';
            if (isFailed) return '✕';
            return '○';
          };

          const getStatusColor = () => {
            if (isComplete) return 'text-[var(--success-color)]';
            if (isActive) return 'text-[var(--primary-color)]';
            if (isFailed) return 'text-[var(--danger-color)]';
            return 'text-[var(--text-tertiary)]';
          };

          const getProgressBarColor = () => {
            if (isFailed) return 'bg-[var(--danger-color)]';
            if (isActive) return 'bg-[var(--primary-color)]';
            if (isComplete) return 'bg-[var(--success-color)]';
            return 'bg-[var(--border-color)]';
          };

          return (
            <div key={stage.id} className="space-y-1.5">
              {/* Stage Header */}
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${getStatusColor()}`}>
                  {getStatusIcon()}
                </span>
                <span className={`text-sm font-medium ${isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                  {stage.name}
                </span>

                {stage.message && (
                  <span className="text-xs text-[var(--text-tertiary)]">
                    • {stage.message}
                  </span>
                )}

                {isActive && stage.estimatedDuration && (
                  <span className="text-xs text-[var(--text-tertiary)] ml-auto">
                    ~{stage.estimatedDuration}s
                  </span>
                )}
              </div>

              {/* Progress Bar */}
              {(isActive || stage.progress > 0 || isComplete) && (
                <div className="ml-5 h-1.5 bg-[var(--well-strong)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${getProgressBarColor()}`}
                    style={{ width: `${Math.min(stage.progress, 100)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Helpful Tips During Long Waits */}
      {remainingTime > 30 && !isComplete && !hasFailed && (
        <div className="text-xs text-[var(--text-secondary)] p-3 bg-blue-500/10 dark:bg-blue-500/5 rounded-lg border border-blue-500/20">
          💡 <span className="font-medium">While you wait:</span> You can start another conversion or batch process multiple files
        </div>
      )}

      {/* Success Message */}
      {isComplete && (
        <div className="text-xs text-[var(--success-color)] p-3 bg-[var(--success-color)]/10 rounded-lg border border-[var(--success-color)]/20">
          ✓ <span className="font-medium">Conversion complete!</span> Your file is ready to download
        </div>
      )}

      {/* Error Message */}
      {hasFailed && (
        <div className="text-xs text-[var(--danger-color)] p-3 bg-[var(--danger-color)]/10 rounded-lg border border-[var(--danger-color)]/20">
          ✕ <span className="font-medium">Conversion failed.</span> Please try again or contact support if the problem persists
        </div>
      )}
    </div>
  );
};

export default ConversionProgressWithStages;
