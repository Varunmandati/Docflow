import React, { useMemo } from 'react';
import { SpinnerIcon, CheckCircleIcon, ExclamationCircleIcon } from './Icons';

interface UploadProgressIndicatorProps {
  fileName: string;
  uploadedBytes: number;
  totalBytes: number;
  uploadSpeed?: number; // MB/s
  status: 'idle' | 'validating' | 'uploading' | 'complete' | 'failed';
  errorMessage?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  attemptNumber?: number;
  maxAttempts?: number;
}

export const UploadProgressIndicator: React.FC<UploadProgressIndicatorProps> = ({
  fileName,
  uploadedBytes,
  totalBytes,
  uploadSpeed = 0,
  status,
  errorMessage,
  onRetry,
  onCancel,
  attemptNumber = 1,
  maxAttempts = 3,
}) => {
  const percentage = useMemo(() => {
    if (totalBytes === 0) return 0;
    return Math.min((uploadedBytes / totalBytes) * 100, 100);
  }, [uploadedBytes, totalBytes]);

  const estimatedTimeRemaining = useMemo(() => {
    if (uploadSpeed <= 0 || status !== 'uploading') return null;
    const remainingBytes = totalBytes - uploadedBytes;
    const remainingSeconds = remainingBytes / (uploadSpeed * 1024 * 1024);
    return Math.ceil(remainingSeconds);
  }, [uploadSpeed, uploadedBytes, totalBytes, status]);

  const uploadedMB = (uploadedBytes / 1024 / 1024).toFixed(1);
  const totalMB = (totalBytes / 1024 / 1024).toFixed(1);

  const getStatusMessage = () => {
    switch (status) {
      case 'validating':
        return `Validating ${fileName}...`;
      case 'uploading':
        return `Uploading ${fileName}`;
      case 'complete':
        return `✓ ${fileName} uploaded successfully`;
      case 'failed':
        return `✗ Upload failed`;
      default:
        return `Ready to upload ${fileName}`;
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'complete':
        return 'text-green-500';
      case 'failed':
        return 'text-red-500';
      case 'uploading':
      case 'validating':
        return 'text-[var(--primary-color)]';
      default:
        return 'text-[var(--text-secondary)]';
    }
  };

  const getProgressBarColor = () => {
    if (status === 'failed') return 'from-red-500 to-red-500/80';
    if (status === 'complete') return 'from-green-500 to-green-500/80';
    return 'from-[var(--primary-color)] to-[var(--primary-color)]/80';
  };

  return (
    <div className="rounded-lg border border-[var(--border-color)] p-4 space-y-3 bg-[var(--background-card)] elevation-1">
      {/* Header */}
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {status === 'validating' || status === 'uploading' ? (
              <SpinnerIcon className="w-4 h-4 text-[var(--primary-color)] animate-spin" />
            ) : status === 'complete' ? (
              <CheckCircleIcon className="w-4 h-4 text-green-500" />
            ) : status === 'failed' ? (
              <ExclamationCircleIcon className="w-4 h-4 text-red-500" />
            ) : (
              <div className="w-4 h-4" />
            )}
            <p className={`text-sm font-medium ${getStatusColor()}`}>
              {getStatusMessage()}
            </p>
          </div>

          {/* Size & Time Info */}
          <p className="text-xs text-[var(--text-tertiary)] mt-1 ml-6">
            {uploadedMB} MB / {totalMB} MB
            {estimatedTimeRemaining && ` • ~${estimatedTimeRemaining}s remaining`}
          </p>

          {/* Error Message */}
          {status === 'failed' && errorMessage && (
            <p className="text-xs text-red-500 mt-1 ml-6">{errorMessage}</p>
          )}
        </div>

        {/* Cancel Button */}
        {status === 'uploading' && onCancel && (
          <button
            onClick={onCancel}
            className="text-xs px-2 py-1 rounded hover:bg-[var(--well)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title="Cancel upload"
          >
            ⊘ Cancel
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="w-full h-2 bg-[var(--well-strong)] rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${getProgressBarColor()} rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Retry / Actions */}
      {status === 'failed' && (
        <div className="flex gap-2 pt-2">
          {attemptNumber < maxAttempts && onRetry && (
            <button
              onClick={onRetry}
              className="text-xs px-3 py-2 rounded-lg bg-[var(--primary-color)]/10 text-[var(--primary-color)] hover:bg-[var(--primary-color)]/20 transition-colors font-medium"
            >
              Retry ({attemptNumber} of {maxAttempts})
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-xs px-3 py-2 rounded-lg hover:bg-[var(--well)] text-[var(--text-secondary)] transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Upload Speed Display (on hover - optional) */}
      {uploadSpeed > 0 && status === 'uploading' && (
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Upload speed: {uploadSpeed.toFixed(1)} MB/s
        </p>
      )}
    </div>
  );
};

export default UploadProgressIndicator;
