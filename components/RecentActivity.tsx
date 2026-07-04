import React, { useMemo } from 'react';
import { CheckCircleIcon, ExclamationCircleIcon } from './Icons';

interface RecentConversion {
  id: string;
  status: 'Success' | 'Failed';
  timestamp: number; // milliseconds
  error?: string;
  fileName?: string;
}

interface RecentActivityProps {
  recent: RecentConversion[];
  onRetry?: () => void;
  onNavigateToHistory?: () => void;
}

const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${Math.floor(diffHour / 24)}d ago`;
};

export const RecentActivity: React.FC<RecentActivityProps> = ({ recent, onRetry, onNavigateToHistory }) => {
  if (recent.length === 0) {
    return null;
  }

  const recentList = recent.slice(0, 5);

  return (
    <div className="rounded-xl border border-[var(--border-color)] p-6 bg-[var(--background-card)] elevation-2">
      <div className="flex justify-between items-center mb-4">
          <h3 className="body-sm font-medium text-[var(--text-primary)]">Recent Activity</h3>
          {onNavigateToHistory && (
              <button 
                  onClick={onNavigateToHistory}
                  className="caption-text text-[var(--primary-color)] hover:underline font-medium"
              >
                  View All History
              </button>
          )}
      </div>
      
      <div className="space-y-1.5">
        {recentList.map((item, idx) => (
          <div
            key={`${item.id}-${idx}`}
            onClick={onNavigateToHistory}
            className="flex items-center justify-between p-3 bg-[var(--background-secondary)] rounded-lg border border-[var(--border-color)] transition-all hover:bg-[var(--hover)] cursor-pointer"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.status === 'Success' ? 'bg-[var(--success-color)]' : 'bg-[var(--danger-color)]'}`} />
              <div className="flex-1 min-w-0">
                  <p className="body-sm font-medium text-[var(--text-primary)] truncate" title={item.fileName || 'Document'}>{item.fileName || 'Document'}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 flex-shrink-0 pl-2">
                <span className="caption-text text-[var(--text-tertiary)] w-16 text-right hidden sm:block">
                    {formatTimeAgo(item.timestamp)}
                </span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${item.status === 'Success' ? 'bg-[var(--success-color)]/10 text-[var(--success-color)]' : 'bg-[var(--danger-color)]/10 text-[var(--danger-color)]'}`}>
                    {item.status}
                </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RecentActivity;
