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
    <div className="rounded-2xl border border-[var(--border-color)] p-6 bg-[var(--background-card)] elevation-2">
      <div className="flex justify-between items-center mb-4">
          <h3 className="body-sm font-semibold text-[var(--text-primary)]">Recent Activity</h3>
          {onNavigateToHistory && (
              <button 
                  onClick={onNavigateToHistory}
                  className="caption-text text-[var(--primary-color)] hover:underline font-medium"
              >
                  View All History
              </button>
          )}
      </div>
      
      <div className="space-y-2">
        {recentList.map((item, idx) => (
          <div
            key={`${item.id}-${idx}`}
            onClick={onNavigateToHistory}
            className="flex items-center justify-between p-3 bg-[var(--background-card)] rounded-xl border border-[var(--border-color)] transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[var(--well)] hover:-translate-y-px cursor-pointer"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${item.status === 'Success' ? 'bg-[var(--success-color)]' : 'bg-[var(--danger-color)]'}`} style={{ boxShadow: `0 0 0 3px color-mix(in srgb, ${item.status === 'Success' ? 'var(--success-color)' : 'var(--danger-color)'} 16%, transparent)` }} />
              <div className="flex-1 min-w-0">
                  <p className="body-sm font-medium text-[var(--text-primary)] truncate" title={item.fileName || 'Document'}>{item.fileName || 'Document'}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 flex-shrink-0 pl-2">
                <span className="caption-text mono-stat text-[var(--text-tertiary)] hidden sm:block">
                    {formatTimeAgo(item.timestamp)}
                </span>
                <span className={`status-pill ${item.status === 'Success' ? 'success' : 'failure'}`}>
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
