import React from 'react';
import { MenuIcon } from './Icons';
import ThreeDLogo from './ThreeDLogo';

interface MobileHeaderProps {
    onMenuClick: () => void;
}

const MobileHeader: React.FC<MobileHeaderProps> = ({ onMenuClick }) => {
    return (
        <header className="min-[900px]:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 h-16 glass-surface border-b border-[var(--glass-border)]">
            <ThreeDLogo collapsed={false} style={{ width: 'auto', paddingLeft: '8px' }} />
            <button
                onClick={onMenuClick}
                aria-label="Open navigation menu"
                className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-all duration-300 active:scale-95"
            >
                <MenuIcon className="w-5 h-5" />
            </button>
        </header>
    );
};

export default MobileHeader;