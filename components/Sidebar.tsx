import React from 'react';
import { Page } from '../App';
import { LogoIcon, ChevronLeftIcon, DashboardIcon, UploadIcon, HistoryIcon, SettingsIcon, ProfileIcon, CompressIcon, ZapIcon, StreamIcon, ImageIcon } from './Icons';
import { SidebarTranslation } from '../translations';
import ThreeDLogo from './ThreeDLogo';


interface SidebarProps {
    activePage: Page;
    setActivePage: (page: Page) => void;
    isCollapsed: boolean;
    onToggle: () => void;
    t: SidebarTranslation;
    isMobileOpen: boolean;
    setMobileOpen: (isOpen: boolean) => void;
    isGlassEffect: boolean;
}

const NavItem: React.FC<{
    icon: React.ElementType;
    label: string;
    isActive: boolean;
    isCollapsed: boolean;
    onClick: () => void;
}> = ({ icon: Icon, label, isActive, isCollapsed, onClick }) => (
    <button
        onClick={onClick}
        title={isCollapsed ? label : undefined}
        className={`w-full flex items-center text-left rounded-xl transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isActive 
                ? 'nav-item-active' 
                : 'text-[var(--text-secondary)] hover:bg-[var(--well)] hover:text-[var(--text-primary)]'
        }`}
        style={{
            padding: isCollapsed ? '10px 10px' : '11px 12px',
            position: 'relative',
            gap: '12px',
        }}
    >
        {isActive && !isCollapsed && (
            <span
                className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full"
                style={{ background: 'var(--primary-color)', height: '20px' }}
            />
        )}
        <Icon className={`w-[18px] h-[18px] flex-shrink-0 nav-icon transition-transform duration-300 ${isActive ? 'scale-110' : ''}`} />
        <span 
            className={`whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isCollapsed ? 'max-w-0 opacity-0 ml-0' : 'max-w-full opacity-100'}`}
            style={{ fontSize: '14px', fontWeight: isActive ? 600 : 400, letterSpacing: '-0.28px' }}
        >
            {label}
        </span>
    </button>
);

const Sidebar: React.FC<SidebarProps> = ({ activePage, setActivePage, isCollapsed, onToggle, t, isMobileOpen, setMobileOpen, isGlassEffect }) => {
    
    const renderSidebarContent = (collapsed: boolean) => (
         <div className="flex flex-col h-full">
            {/* BRAND HEADER */}
            <ThreeDLogo collapsed={collapsed} />
            <hr className={`border-t border-[var(--border-color)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] mb-3 ${collapsed ? 'w-10 mx-auto' : 'w-full'}`} />
            
            <nav className="flex-1 space-y-4 mt-1 px-2">
                 <div>
                     {!collapsed && <div className="caption-mono px-2 mb-2" style={{ color: 'var(--text-tertiary)' }}>Tools</div>}
                     <div className="space-y-0.5">
                         <NavItem icon={DashboardIcon} label={t.dashboard} isActive={activePage === 'dashboard'} isCollapsed={collapsed} onClick={() => setActivePage('dashboard')} />
                         <NavItem icon={CompressIcon} label={t.compress} isActive={activePage === 'compress'} isCollapsed={collapsed} onClick={() => setActivePage('compress')} />
                         <NavItem icon={ZapIcon} label={t.converter} isActive={activePage === 'upload'} isCollapsed={collapsed} onClick={() => setActivePage('upload')} />
                         <NavItem icon={StreamIcon} label="Upload" isActive={activePage === 'upload'} isCollapsed={collapsed} onClick={() => setActivePage('upload')} />
                         <NavItem icon={ImageIcon} label="Image Extractor" isActive={activePage === 'extract'} isCollapsed={collapsed} onClick={() => setActivePage('extract')} />
                     </div>
                 </div>

                 <hr className={`border-t border-[var(--border-color)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${collapsed ? 'w-8 mx-auto' : 'w-full'}`} />

                 <div>
                     {!collapsed && <div className="caption-mono px-2 mb-2" style={{ color: 'var(--text-tertiary)' }}>Account</div>}
                     <div className="space-y-0.5">
                         <NavItem icon={HistoryIcon} label={t.history} isActive={activePage === 'history'} isCollapsed={collapsed} onClick={() => setActivePage('history')} />
                         <NavItem icon={SettingsIcon} label={t.settings} isActive={activePage === 'settings'} isCollapsed={collapsed} onClick={() => setActivePage('settings')} />
                     </div>
                 </div>
            </nav>

            <div className="mt-auto px-2 pt-3 border-t border-[var(--border-color)]">
                 <NavItem icon={ProfileIcon} label={t.profile} isActive={activePage === 'profile'} isCollapsed={collapsed} onClick={() => setActivePage('profile')} />
            </div>
        </div>
    );

    const sidebarClasses = `relative flex-col p-3 border-r border-[var(--border-color)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isGlassEffect ? 'glass-surface' : 'bg-[var(--background-card)]'}`;

    return (
        <>
            {/* Desktop Sidebar */}
            <aside className={`sticky top-0 h-screen z-40 hidden min-[900px]:flex flex-shrink-0 self-start ${sidebarClasses} ${isCollapsed ? 'w-[72px]' : 'w-60'}`}>
                  <button 
                    onClick={onToggle}
                    className="absolute -right-3 top-20 p-1 rounded-full text-[var(--text-tertiary)] bg-[var(--background-card)] border border-[var(--border-color)] hover:text-[var(--text-primary)] transition-all duration-200 z-50 elevation-2"
                    aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    <ChevronLeftIcon className={`w-3.5 h-3.5 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : 'rotate-0'}`} />
                </button>
                 {renderSidebarContent(isCollapsed)}
            </aside>

             {/* Mobile Sidebar */}
            <div
                className={`fixed inset-0 z-40 min-[900px]:hidden transition-all duration-300 ${isMobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
                <div
                    className="absolute inset-0 bg-black/50"
                    onClick={() => setMobileOpen(false)}
                ></div>
                <aside className={`relative z-50 h-full w-60 flex transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} ${sidebarClasses}`}>
                    {renderSidebarContent(false)}
                </aside>
            </div>
        </>
    );
};

export default Sidebar;
