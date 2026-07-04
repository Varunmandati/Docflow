import React from 'react';

interface TrustBadge {
  icon: string;
  label: string;
  tooltip?: string;
}

interface TrustBadgesProps {
  variant?: 'inline' | 'card'; // inline: horizontal badges, card: vertical in box
  showTooltips?: boolean;
}

const defaultBadges: TrustBadge[] = [
  {
    icon: '🔒',
    label: 'Encrypted',
    tooltip: 'All uploads use industry-standard SSL/TLS encryption in transit',
  },
  {
    icon: '🗑',
    label: 'Auto-deleted',
    tooltip: 'Files are automatically deleted after 24 hours',
  },
  {
    icon: '⚡',
    label: 'Private',
    tooltip: 'No data collection, no analytics on your uploads',
  },
  {
    icon: '✓',
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
      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 space-y-2">
        <h4 className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">
          Privacy & Security
        </h4>
        <div className="space-y-2">
          {defaultBadges.map((badge) => (
            <div key={badge.label} className="flex items-center gap-2 group relative">
              <span className="text-sm">{badge.icon}</span>
              <span className="text-sm text-green-700 dark:text-green-400">
                {badge.label}
              </span>
              
              {showTooltips && badge.tooltip && (
                <div className="hidden group-hover:block absolute left-0 top-full mt-1 p-2 bg-black dark:bg-white text-white dark:text-black text-xs rounded shadow-lg whitespace-nowrap z-10">
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 group cursor-help transition-all hover:border-green-500/40 hover:bg-green-500/15"
          title={showTooltips ? badge.tooltip : undefined}
        >
          <span className="text-sm">{badge.icon}</span>
          <span className="text-xs font-medium text-green-700 dark:text-green-400">
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
    <div className="mt-4 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        <span className="font-medium text-[var(--text-primary)]">🔒 Your privacy matters:</span> Files are encrypted in transit, 
        automatically deleted after 24 hours, and never tracked or analyzed. 
        <a href="/privacy" className="ml-1 text-blue-500 hover:text-blue-600 underline">Learn more</a>
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
          🔐 Privacy Policy
        </a>
        <a href="/security" className="hover:text-[var(--primary-color)] transition-colors">
          🛡️ Security
        </a>
        <a href="/terms" className="hover:text-[var(--primary-color)] transition-colors">
          📋 Terms of Service
        </a>
      </div>
      
      <div className="mt-4 p-3 rounded-lg bg-black/5 dark:bg-white/5 text-xs text-[var(--text-tertiary)] text-center">
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
