import React from 'react';

// Replicating Framer SunIcon
const SunIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <svg 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
    >
        <circle cx="12" cy="12" r="5" fill={color} />
        <path 
            d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" 
            stroke={color} 
            strokeWidth="2" 
            strokeLinecap="round" 
        />
    </svg>
);

// Replicating Framer MoonIcon
const MoonIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <svg 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
    >
        <path 
            d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" 
            fill={color} 
        />
    </svg>
);

interface ThemeToggleButtonProps {
    theme: 'light' | 'dark' | 'system';
    onChange: () => void;
}

const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({ theme, onChange }) => {
    const isLightMode = theme === 'light' || (theme === 'system' && typeof window !== 'undefined' && !window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    // Switch styling parameters matching the Framer component
    const size = 30; // base size
    const switchWidth = size * 1.8; // 54px
    const switchHeight = size * 1; // 30px
    const knobSize = switchHeight * 0.8; // 24px
    const padding = (switchHeight - knobSize) / 2; // 3px
    const knobIconSize = knobSize * 0.6; // ~14px
    
    // Colors — token-driven with warm sun accent
    const switchTrackColor = 'var(--background-secondary)';
    const switchActiveColor = 'var(--background-secondary)';
    const sunIconColor = '#F59E0B';
    const moonIconColor = 'var(--text-tertiary)';
    const borderColor = 'var(--border-color)';
    
    return (
        <button
            type="button"
            aria-pressed={isLightMode}
            onClick={onChange}
            className="no-glassy relative border-0 p-0 cursor-pointer outline-none transition-all duration-200"
            style={{
                width: `${switchWidth}px`,
                height: `${switchHeight}px`,
                backgroundColor: isLightMode ? switchActiveColor : switchTrackColor,
                border: `1px solid ${borderColor}`,
                borderRadius: `${switchHeight / 2}px`,
                boxShadow: isLightMode ? '0 1px 3px rgba(0,0,0,0.05)' : '0 2px 8px rgba(0,0,0,0.12)',
            }}
        >
            <span
                className="absolute flex items-center justify-center bg-white rounded-full transition-all duration-200"
                style={{
                    top: `${padding}px`,
                    left: isLightMode 
                        ? `${switchWidth - knobSize - padding}px` 
                        : `${padding}px`,
                    width: `${knobSize}px`,
                    height: `${knobSize}px`,
                    borderRadius: '50%',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                    transition: 'left 0.2s cubic-bezier(.4,1.2,.6,1)',
                    zIndex: 10,
                }}
            >
                {isLightMode ? (
                    <SunIcon size={knobIconSize} color={sunIconColor} />
                ) : (
                    <MoonIcon size={knobIconSize} color={moonIconColor} />
                )}
            </span>
        </button>
    );
};

export default ThemeToggleButton;
export { ThemeToggleButton };
