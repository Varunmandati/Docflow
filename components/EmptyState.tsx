import React from 'react';

interface EmptyStateProps {
    icon: React.ReactNode;
    heading: string;
    body: string;
    ctaLabel?: string;
    ctaHref?: string;
    onCtaClick?: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({
    icon,
    heading,
    body,
    ctaLabel,
    ctaHref,
    onCtaClick
}) => {
    return (
        <div className="flex flex-col items-center justify-center min-h-[220px] py-12 px-4">
            <div className="mb-4 text-[#9CA3AF]">
                {icon}
            </div>
            <h3 className="text-15 font-medium text-[var(--text-primary)] mb-2 text-center">
                {heading}
            </h3>
            <p className="text-13 text-[#9CA3AF] text-center mb-6 max-w-md">
                {body}
            </p>
            {(ctaLabel && ctaHref) || onCtaClick ? (
                ctaHref ? (
                    <a 
                        href={ctaHref}
                        className="text-sm font-semibold text-white bg-[#E07B39] hover:bg-[#C8692A] px-4 py-2 rounded-lg transition-colors"
                    >
                        {ctaLabel} →
                    </a>
                ) : (
                    <button
                        onClick={onCtaClick}
                        className="text-sm font-semibold text-white bg-[#E07B39] hover:bg-[#C8692A] px-4 py-2 rounded-lg transition-colors"
                    >
                        {ctaLabel} →
                    </button>
                )
            ) : null}
        </div>
    );
};

export default EmptyState;
