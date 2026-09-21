import React from 'react';
import { LockClosedIcon, TrashIcon, ZapIcon, CheckBadgeIcon } from './Icons';

interface TrustBadge {
  icon: React.ReactNode;
  label: string;
  tooltip?: string;
}

interface TrustBadgesProps {
  variant?: 'inline' | 'card'; // inline: horizontal badges, card: vertical in box
  showTooltips?: boolean;
}

const defaultBadges: TrustBadge[] = [
  {
    icon: <LockClosedIcon className="w-3.5 h-3.5" />,
    label: 'Encrypted',
    tooltip: 'All uploads use industry-standard SSL/TLS encryption in transit',
  },
  {
    icon: <TrashIcon className="w-3.5 h-3.5" />,
    label: 'Auto-deleted',
    tooltip: 'Files are automatically deleted after 24 hours',
  },
  {
    icon: <ZapIcon className="w-3.5 h-3.5" />,
    label: 'Private',
    tooltip: 'No data collection, no analytics on your uploads',
  },
  {
    icon: <CheckBadgeIcon className="w-3.5 h-3.5" />,
    label: 'GDPR Compliant',
    tooltip: 'Compliant with GDPR, CCPA, and other privacy regulations',
  },
];

export const TrustBadges: React.FC<TrustBadgesProps> = ({
  variant = 'inline',
  showTooltips = true,
}) => {
  if (variant === 'card') {
    return (
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--background-card)] p-4 space-y-2 elevation-1">
        <h4 className="caption-mono" style={{ color: 'var(--text-tertiary)' }}>
          Privacy & Security
        </h4>
        <div className="space-y-2">
          {defaultBadges.map((badge) => (
            <div key={badge.label} className="flex items-center gap-2.5 group relative">
              <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--background-secondary)] text-[var(--primary-color)]">
                {badge.icon}
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {badge.label}
              </span>
              
              {showTooltips && badge.tooltip && (
                <div className="hidden group-hover:block absolute left-0 top-full mt-1 p-2 bg-[var(--surface-raised)] text-[var(--text-primary)] text-xs rounded-lg shadow-xl border border-[var(--border-color)] whitespace-nowrap z-10">
                  {badge.tooltip}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Default inline variant
  return (
    <div className="flex flex-wrap gap-2 py-3">
      {defaultBadges.map((badge) => (
        <div
          key={badge.label}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--background-secondary)] border border-[var(--border-color)] group cursor-help transition-all hover:border-[var(--primary-color)] hover:bg-[var(--primary-highlight)]"
          title={showTooltips ? badge.tooltip : undefined}
        >
          <span className="text-[var(--primary-color)] flex items-center">{badge.icon}</span>
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            {badge.label}
          </span>
        </div>
      ))}
    </div>
  );
};

/**
 * Trust message component to add below the upload zone
 * Shows trust messaging in microcopy format
 */
export const TrustMessage: React.FC = () => {
  return (
    <div className="mt-4 p-4 rounded-xl bg-[var(--background-secondary)] border border-[var(--border-color)]">
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        <span className="font-medium text-[var(--text-primary)]">Your privacy matters:</span> Files are encrypted in transit, 
        automatically deleted after 24 hours, and never tracked or analyzed. 
        <a href="/privacy" className="ml-1 text-[var(--primary-color)] hover:underline">Learn more</a>
      </p>
    </div>
  );
};

/**
 * Trust footer component for bottom of page
 * Shows security links and certifications
 */
export const TrustFooter: React.FC = () => {
  return (
    <div className="border-t border-[var(--border-color)] mt-8 pt-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center text-xs text-[var(--text-tertiary)]">
        <a href="/privacy" className="hover:text-[var(--primary-color)] transition-colors">
          Privacy Policy
        </a>
        <a href="/security" className="hover:text-[var(--primary-color)] transition-colors">
          Security
        </a>
        <a href="/terms" className="hover:text-[var(--primary-color)] transition-colors">
          Terms of Service
        </a>
      </div>
      
      <div className="mt-4 p-3 rounded-lg bg-[var(--background-secondary)] text-xs text-[var(--text-tertiary)] text-center border border-[var(--border-color)]">
        <span>ISO 27001 Certified</span>
        {' • '}
        <span>GDPR Compliant</span>
        {' • '}
        <span>SOC 2 Type II</span>
      </div>
    </div>
  );
};

export default TrustBadges;
