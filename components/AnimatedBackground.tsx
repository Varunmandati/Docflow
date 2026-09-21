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
            className="fixed top-0 left-0 w-full h-full -z-10 bg-gradient-to-tr from-[var(--background-body)] via-[var(--background-secondary)] to-[var(--background-body)]"
            style={{
                backgroundSize: '400% 400%',
                animation: 'bg-pan 25s var(--ease-emphasized) infinite',
            }}
        />
    );
};

export default AnimatedBackground;