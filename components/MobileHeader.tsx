import React from 'react';
import { MenuIcon } from './Icons';
import ThreeDLogo from './ThreeDLogo';

interface MobileHeaderProps {
    onMenuClick: () => void;
}

const MobileHeader: React.FC<MobileHeaderProps> = ({ onMenuClick }) => {
    return (
        <header className="min-[900px]:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 h-16 bg-[var(--background-card)]/90 backdrop-blur-md border-b border-[var(--border-color)]">
            <ThreeDLogo collapsed={false} style={{ width: 'auto', paddingLeft: '8px' }} />
            <button onClick={onMenuClick} className="p-2 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-all">
                <MenuIcon className="w-5 h-5" />
            </button>
        </header>
    );
};

export default MobileHeader;