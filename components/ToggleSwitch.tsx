import React from 'react';

interface ToggleSwitchProps {
    label: string;
    enabled: boolean;
    onChange: (enabled: boolean) => void;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ label, enabled, onChange }) => {
    return (
        <div className="flex items-center justify-center gap-3">
            <label htmlFor="merge-toggle" className="text-[var(--text-primary)] font-medium cursor-pointer">{label}</label>
            <button
                type="button"
                id="merge-toggle"
                onClick={() => onChange(!enabled)}
                className={`${enabled ? 'bg-[var(--primary-color)]' : 'bg-[var(--well-strong)]'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] focus:ring-offset-2 focus:ring-offset-[var(--background-card)]`}
                role="switch"
                aria-checked={enabled}
            >
                <span
                    aria-hidden="true"
                    className={`${enabled ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--text-primary)] shadow ring-0 transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]`}
                />
            </button>
        </div>
    );
};

export default ToggleSwitch;