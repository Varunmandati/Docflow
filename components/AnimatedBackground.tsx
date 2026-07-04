import React from 'react';

interface AnimatedBackgroundProps {
    enabled: boolean;
}

const AnimatedBackground: React.FC<AnimatedBackgroundProps> = ({ enabled }) => {
    if (!enabled) {
        return null;
    }

    return (
        <div 
            className="fixed top-0 left-0 w-full h-full -z-10 bg-gradient-to-tr from-neutral-50 via-neutral-100/50 to-neutral-50 dark:from-[#0a0a0a] dark:via-[#0f0f12] dark:to-[#0a0a0a]"
            style={{
                backgroundSize: '400% 400%',
                animation: 'bg-pan 25s ease infinite',
            }}
        />
    );
};

export default AnimatedBackground;