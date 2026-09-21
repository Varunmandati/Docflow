import React, { useState } from 'react';
import StatsCard from './StatsCard';
import StatsCardWithTrend from './StatsCardWithTrend';
import RecentActivity from './RecentActivity';
import FileDropzone from './FileDropzone';
import { UploadIcon, CheckCircleIcon, ExclamationCircleIcon, CheckBadgeIcon, SunIcon, MoonIcon, CompressIcon, FileTextIcon, TrendingUpIcon, ZapIcon, FolderZipIcon, ProfileIcon } from './Icons';
import { Stats, Language, Theme } from '../App';
import { DashboardTranslation } from '../translations';
import { ConversionSettings, UserProfile } from '../types';
import ThemeToggleButton from './ThemeToggleButton';
import CharacterAvatar from './CharacterAvatar';

interface DashboardViewProps {
    onQuickConvert: (files: File[]) => void;
    onQuickCompress: (files: File[]) => void;
    stats: Stats;
    t: DashboardTranslation;
    settings: ConversionSettings;
    setSettings: (settings: ConversionSettings) => void;
    isAuthenticated: boolean;
    currentUserName: string;
    userProfile?: UserProfile;
    onAuthClick: () => void;
    onProfileClick?: () => void;
    onNavigateToHistory?: (filter?: 'failed' | 'success' | 'all') => void;
}

type DashboardTab = 'convert' | 'compress';

const DashboardView: React.FC<DashboardViewProps> = ({
    onQuickConvert,
    onQuickCompress,
    stats,
    t,
    settings,
    setSettings,
    isAuthenticated,
    currentUserName,
    userProfile,
    onAuthClick,
    onProfileClick,
    onNavigateToHistory
}) => {
    const [activeTab, setActiveTab] = useState<DashboardTab>('convert');
    
    const successRate = stats.total > 0 ? ((stats.successful / stats.total) * 100).toFixed(0) + '%' : "0%";

    const isDefaultAvatar = !userProfile?.avatarUrl || 
                            userProfile.avatarUrl.includes('pravatar.cc') || 
                            userProfile.avatarUrl.includes('avatar') || 
                            userProfile.avatarUrl.includes('gravatar') ||
                            userProfile.avatarUrl.includes('placeholder') ||
                            userProfile.avatarUrl.includes('googleusercontent.com') ||
                            userProfile.avatarUrl === '';

    const handleLanguageChange = (lang: Language) => {
        setSettings({ ...settings, language: lang });
    };

    const handleThemeChange = () => {
        const newTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        setSettings({ ...settings, theme: newTheme });
    };

    return (
        <div className="p-4 sm:p-8 w-full max-w-6xl mx-auto text-[var(--text-primary)]">
            {/* Header */}
            <header className="view-header flex justify-between items-start gap-4">
                <div>
                    <div className="view-eyebrow">
                        <span className="eyebrow-dot" />
                        {isAuthenticated ? 'Signed in' : 'Guest session'}
                    </div>
                    <h1 className="display-md">{t.title}</h1>
                    <p className="body-sm mt-1">Overview of your recent conversions and stats</p>
                </div>
                <div className="flex items-center gap-2">
                    {/* Language Dropdown */}
                    <select 
                        value={settings.language} 
                        onChange={(e) => handleLanguageChange(e.target.value as Language)}
                        className="vercel-input"
                        style={{
                            fontSize: '12px',
                            fontWeight: 500,
                            height: '32px',
                            padding: '0 28px 0 10px',
                            cursor: 'pointer',
                        }}
                    >
                        <option value="en">EN</option>
                        <option value="hi">हि</option>
                        <option value="bn">বাং</option>
                        <option value="te">తె</option>
                    </select>
                    
                    {/* Theme Toggle Switch */}
                    <ThemeToggleButton theme={settings.theme} onChange={handleThemeChange} />
                    
                    {/* User Avatar */}
                    {!isDefaultAvatar ? (
                        <button
                            onClick={isAuthenticated ? (onProfileClick || onAuthClick) : (onAuthClick || onProfileClick)}
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold border-2 border-[var(--border-color)] hover:border-[var(--primary-color)] transition-all"
                            style={{
                                backgroundImage: `url(${userProfile.avatarUrl})`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                            }}
                            title={isAuthenticated ? (userProfile?.name || currentUserName) : 'Login or Sign up'}
                        />
                    ) : (
                        <button 
                            onClick={isAuthenticated ? (onProfileClick || onAuthClick) : (onAuthClick || onProfileClick)} 
                            title={isAuthenticated ? (userProfile?.name || currentUserName) : 'Login or Sign up'}
                            className="p-0 bg-transparent border-0 outline-none flex items-center justify-center cursor-pointer no-glassy"
                            style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                            }}
                        >
                            <CharacterAvatar name={isAuthenticated ? (userProfile?.name || currentUserName) : 'Guest'} size={36} />
                        </button>
                    )}
                </div>
            </header>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatsCardWithTrend 
                    title={t.stats.total} 
                    value={stats.total} 
                    icon={<UploadIcon className="w-5 h-5 text-[var(--primary-color)]" />}
                />
                <StatsCardWithTrend 
                    title={t.stats.successful} 
                    value={stats.successful} 
                    icon={<CheckCircleIcon className="w-5 h-5 text-[var(--success-color)]" />}
                />
                <StatsCardWithTrend 
                    title={t.stats.failed} 
                    value={stats.failed} 
                    icon={<ExclamationCircleIcon className="w-5 h-5 text-[var(--danger-color)]" />}
                    onClick={() => onNavigateToHistory?.('failed')}
                />
                <StatsCardWithTrend 
                    title="Success Rate" 
                    value={successRate} 
                    icon={<TrendingUpIcon className="w-5 h-5 text-[var(--brand-accent)]" />}
                />
            </div>

            {/* Quick Actions */}
            <div className="double-bezel">
                <div className="bezel-core">
                    <div className="p-6 sm:p-8">
                        <div className="segmented-control w-fit mb-6">
                            <button onClick={() => setActiveTab('convert')} className={`flex items-center gap-2 ${activeTab === 'convert' ? 'active' : ''}`}>
                                <FileTextIcon className="w-4 h-4" /> {t.quickConvert.title}
                            </button>
                            <button onClick={() => setActiveTab('compress')} className={`flex items-center gap-2 ${activeTab === 'compress' ? 'active' : ''}`}>
                                <FolderZipIcon className="w-4 h-4" /> {t.quickCompress.title}
                            </button>
                        </div>

                        {activeTab === 'convert' && (
                             <FileDropzone onFilesAdded={onQuickConvert} isQuickConvert={true} t={t.quickConvert} />
                        )}
                        {activeTab === 'compress' && (
                             <FileDropzone onFilesAdded={onQuickCompress} isQuickConvert={true} t={t.quickCompress} accept="*" />
                        )}
                    </div>
                </div>
            </div>

            <hr className="border-t border-[var(--border-color)] my-8" />

            {/* Recent Activity */}
            <div className="mt-6">
                {stats.recent && stats.recent.length > 0 ? (
                    <RecentActivity recent={stats.recent} onNavigateToHistory={() => onNavigateToHistory?.('all')} />
                ) : (
                    <div className="panel-card elevation-2">
                        <div className="empty-state">
                            <div className="empty-state-icon">
                                <CheckBadgeIcon className="w-7 h-7" />
                            </div>
                            <h3 className="display-sm text-[var(--text-primary)]">No activity yet</h3>
                            <p className="body-sm text-[var(--text-secondary)] max-w-md">Convert or compress a file and it will show up here.</p>
                        </div>
                    </div>
                )}
            </div>

            <hr className="border-t border-[var(--border-color)] my-8" />

            {/* Features — asymmetric grid: two tinted feature tiles + one mono status panel */}
            <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="feature-card feature-card-amber p-6 flex flex-col">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 well">
                        <FileTextIcon className="w-6 h-6 text-[var(--primary-color)]" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2 text-[var(--text-primary)]">Convert Documents</h3>
                    <p className="body-sm text-[var(--text-secondary)] flex-1">PDF, images, Office files to any format in seconds</p>
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border-color)]">
                        <span className="meta-chip">PDF · DOCX · JPG</span>
                        <span className="text-[var(--primary-color)]" style={{ transform: 'translateX(0)', transition: 'transform 0.3s var(--ease-out-quart)' }}>→</span>
                    </div>
                </div>
                <div className="feature-card feature-card-warm p-6 flex flex-col">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 well">
                        <CompressIcon className="w-6 h-6 text-[var(--primary-color)]" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2 text-[var(--text-primary)]">Compress Files</h3>
                    <p className="body-sm text-[var(--text-secondary)] flex-1">Hit an exact target size with quality-aware compression</p>
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border-color)]">
                        <span className="meta-chip">Image · PDF · Office</span>
                        <span className="text-[var(--primary-color)]" style={{ transform: 'translateX(0)', transition: 'transform 0.3s var(--ease-out-quart)' }}>→</span>
                    </div>
                </div>
                <div className="panel-card elevation-2 p-6 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center well">
                            <ZapIcon className="w-6 h-6 text-[var(--brand-accent)]" />
                        </div>
                        <span className="status-pill brand">Local</span>
                    </div>
                    <h3 className="text-lg font-semibold mb-2 text-[var(--text-primary)]">Runs entirely in your browser</h3>
                    <p className="body-sm text-[var(--text-secondary)] flex-1">No upload queue, no server round-trips for conversion and compression. Files stay on this device.</p>
                    <dl className="mt-4 pt-4 border-t border-[var(--border-color)] space-y-2">
                        <div className="flex items-center justify-between">
                            <dt className="caption-mono" style={{ color: 'var(--text-tertiary)' }}>Engine</dt>
                            <dd className="caption-mono" style={{ color: 'var(--text-secondary)' }}>PDF.js · canvas · JSZip</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="caption-mono" style={{ color: 'var(--text-tertiary)' }}>Mode</dt>
                            <dd className="caption-mono" style={{ color: 'var(--text-secondary)' }}>{settings.theme === 'system' ? 'system' : settings.theme}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="caption-mono" style={{ color: 'var(--text-tertiary)' }}>Language</dt>
                            <dd className="caption-mono" style={{ color: 'var(--text-secondary)' }}>{settings.language}</dd>
                        </div>
                    </dl>
                </div>
            </div>

        </div>
    );
};

export default DashboardView;
