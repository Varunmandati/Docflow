import React, { useState } from 'react';
import StatsCard from './StatsCard';
import StatsCardWithTrend from './StatsCardWithTrend';
import RecentActivity from './RecentActivity';
import FileDropzone from './FileDropzone';
import { UploadIcon, CheckCircleIcon, ExclamationCircleIcon, CheckBadgeIcon, SunIcon, MoonIcon, CompressIcon, FileTextIcon, TrendingUpIcon, ZapIcon, FolderZipIcon, ProfileIcon } from './Icons';
import { Stats, Language, Theme } from '../App';
import { DashboardTranslation } from '../translations';
import { ConversionSettings, UserProfile } from '../types';
import { TrustBadges } from './TrustBadges';
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
    const isGlassEffect = settings.backgroundAnimation && (settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));

    const isDefaultAvatar = !userProfile?.avatarUrl || 
                            userProfile.avatarUrl.includes('pravatar.cc') || 
                            userProfile.avatarUrl.includes('avatar') || 
                            userProfile.avatarUrl.includes('gravatar') ||
                            userProfile.avatarUrl.includes('placeholder') ||
                            userProfile.avatarUrl.includes('googleusercontent.com') ||
                            userProfile.avatarUrl === '';

    // Calculate trend (week-over-week comparison - simulated for demo)
    // In production, this would compare current week vs previous week
    const trends = {
        total: 12,      // 12% increase
        successful: 8,  // 8% increase
        failed: -5,     // 5% decrease
        successRate: 3  // 3% increase
    };

    const handleLanguageChange = (lang: Language) => {
        setSettings({ ...settings, language: lang });
    };

    const handleThemeChange = () => {
        const newTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        setSettings({ ...settings, theme: newTheme });
    };

    const langButtons: { lang: Language, label: string }[] = [
        { lang: 'en', label: 'En' },
        { lang: 'hi', label: 'हिं' },
        { lang: 'bn', label: 'বাং' },
        { lang: 'te', label: 'తె' }
    ];

    return (
        <div className="p-4 sm:p-8 text-[var(--text-primary)]">
            {/* Header */}
            <header className="flex justify-between items-start mb-8">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="display-md" style={{ color: 'var(--text-primary)' }}>{t.title}</h1>
                    </div>
                    <p className="body-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Overview of your recent conversions and stats</p>
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
                            onClick={onProfileClick || onAuthClick}
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
                            onClick={onProfileClick || onAuthClick} 
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
                    icon={<UploadIcon className="w-5 h-5 text-blue-500" />}
                    trend={stats.total === 0 ? undefined : trends.total}
                />
                <StatsCardWithTrend 
                    title={t.stats.successful} 
                    value={stats.successful} 
                    icon={<CheckCircleIcon className="w-5 h-5 text-emerald-500" />}
                    trend={stats.successful === 0 ? undefined : trends.successful}
                />
                <StatsCardWithTrend 
                    title={t.stats.failed} 
                    value={stats.failed} 
                    icon={<ExclamationCircleIcon className="w-5 h-5 text-red-500" />}
                    trend={stats.failed === 0 ? undefined : trends.failed}
                    onClick={() => onNavigateToHistory?.('failed')}
                />
                <StatsCardWithTrend 
                    title="Success Rate" 
                    value={successRate} 
                    icon={<TrendingUpIcon className="w-5 h-5 text-violet-500" />}
                    trend={stats.total === 0 ? undefined : trends.successRate}
                />
            </div>

            {/* Quick Actions */}
            <div className="rounded-xl bg-[var(--background-card)] border border-[var(--border-color)] elevation-3">
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

            <hr className="border-t border-[var(--border-color)] my-8" />

            {/* Recent Activity */}
            {stats.recent && stats.recent.length > 0 && (
                <div className="mt-6">
                    <RecentActivity recent={stats.recent} onNavigateToHistory={() => onNavigateToHistory?.('all')} />
                </div>
            )}



            {/* Features Section */}
            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="feature-card-pink relative overflow-hidden transition-all duration-300 hover:scale-[1.02] cursor-default">
                    <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mb-4 shadow-sm">
                        <FileTextIcon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="font-semibold text-white mb-2" style={{ fontSize: '18px', letterSpacing: '-0.3px' }}>Convert Documents</h3>
                    <p className="body-sm text-white/90">PDF, images, Office files to any format in seconds</p>
                </div>
                <div className="feature-card-teal relative overflow-hidden transition-all duration-300 hover:scale-[1.02] cursor-default">
                    <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-4 shadow-sm">
                        <CompressIcon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="font-semibold text-white mb-2" style={{ fontSize: '18px', letterSpacing: '-0.3px' }}>Compress Files</h3>
                    <p className="body-sm text-white/90">Reduce file size dramatically without losing any pixel quality</p>
                </div>
                <div className="feature-card-lavender relative overflow-hidden transition-all duration-300 hover:scale-[1.02] cursor-default">
                    <div className="w-12 h-12 rounded-xl bg-black/10 flex items-center justify-center mb-4 shadow-sm">
                        <ZapIcon className="w-6 h-6 text-[#0a0a0a]" />
                    </div>
                    <h3 className="font-semibold text-[#0a0a0a] mb-2" style={{ fontSize: '18px', letterSpacing: '-0.3px' }}>Fast & Reliable</h3>
                    <p className="body-sm text-[#0a0a0a]/80">Secure batch processing with real-time conversion progress</p>
                </div>
            </div>

        </div>
    );
};

export default DashboardView;
