import React from 'react';

interface ProgressBarProps {
    progress: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
    return (
        <div className="w-full bg-[var(--well-strong)] rounded-full h-4 overflow-hidden ring-1 ring-inset ring-[var(--border-color)]">
            <div
                className="h-4 rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-[var(--primary-color-hover)] to-[var(--primary-color)]"
                style={{ 
                    width: `${progress}%`,
                    backgroundSize: '200% 100%',
                    animation: 'bg-pan 3s linear infinite',
                }}
            ></div>
        </div>
    );
};

export default ProgressBar;