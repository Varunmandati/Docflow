
import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import DashboardView from './components/DashboardView';
import ConverterView from './components/ConverterView';
import CompressorView from './components/CompressorView';
import UploadConverterView from './components/UploadConverterView';
import ImageExtractorView from './components/ImageExtractorView';
import HistoryView from './components/HistoryView';
import SettingsView from './components/SettingsView';
import ProfileView from './components/ProfileView';
import AuthView from './components/AuthView';
import MobileHeader from './components/MobileHeader';
import AnimatedBackground from './components/AnimatedBackground';
import { ToastProvider } from './components/ToastProvider';
import { translations } from './translations';
import { HistoryEntry, ConversionSettings, UserProfile } from './types';

export type Page = 'dashboard' | 'upload' | 'compress' | 'upload' | 'extract' | 'history' | 'settings' | 'profile';
export type Theme = 'light' | 'dark' | 'system';
export type Language = 'en' | 'hi' | 'bn' | 'te';

export interface Stats {
    total: number;
    successful: number;
    failed: number;
    recent?: Array<{
        id: string;
        status: 'Success' | 'Failed';
        timestamp: number;
        error?: string;
        fileName?: string;
    }>;
}

interface AuthSuccessPayload {
    name: string;
    email: string;
    avatarUrl?: string;
    provider: 'otp' | 'google';
}

const defaultUserProfile: UserProfile = {
    name: 'Alex Doe',
    email: 'alex.doe@example.com',
    avatarUrl: 'https://i.pravatar.cc/150?u=alex.doe@example.com',
};

const App: React.FC = () => {
    const [activePage, setActivePage] = useState<Page>('dashboard');
    const [initialFiles, setInitialFiles] = useState<File[]>([]);
    const [initialCompressFiles, setInitialCompressFiles] = useState<File[]>([]);
    
    const [userProfile, setUserProfile] = useState<UserProfile>(() => {
        try {
            const saved = localStorage.getItem('userProfile');
            return saved ? JSON.parse(saved) : defaultUserProfile;
        } catch (error) {
            return defaultUserProfile;
        }
    });
    
    const [settings, setSettings] = useState<ConversionSettings>(() => {
        const saved = localStorage.getItem('conversionSettings');
        return saved ? JSON.parse(saved) : {
            language: 'en',
            theme: 'dark',
            defaultCompression: 'Medium',
            autoDelete: false,
            backgroundAnimation: true,
            fontSize: 'md',
            fontFamily: 'Inter',
        };
    });

    const [stats, setStats] = useState<Stats>(() => {
        const saved = localStorage.getItem('conversionStats');
        const parsed = saved ? JSON.parse(saved) : { total: 0, successful: 0, failed: 0 };
        return { ...parsed, recent: parsed.recent || [] };
    });

    const [history, setHistory] = useState<HistoryEntry[]>(() => {
        const saved = localStorage.getItem('conversionHistory');
        return saved ? JSON.parse(saved) : [];
    });
    
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
        return localStorage.getItem('sidebarCollapsed') === 'true';
    });

    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
        try {
            return localStorage.getItem('authSession') === 'true';
        } catch (error) {
            return false;
        }
    });

    const t = translations[settings.language];

    useEffect(() => {
        const applyTheme = (theme: Theme) => {
            const root = window.document.documentElement;
            const isDark =
                theme === 'dark' ||
                (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
            
            // Use requestAnimationFrame to ensure smooth transition
            requestAnimationFrame(() => {
                // Add transition class
                root.classList.add('theme-transitioning');
                
                // Apply theme immediately
                root.classList.toggle('dark', isDark);
                root.classList.toggle('light', !isDark);
                
                // Remove transition class after animation completes
                setTimeout(() => {
                    root.classList.remove('theme-transitioning');
                }, 350);
            });
        };

        applyTheme(settings.theme);

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = () => applyTheme(settings.theme);
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);

    }, [settings.theme]);

    // Initialize and apply brand theme system
    useEffect(() => {
        const savedTheme = (localStorage.getItem('appTheme') || 'theme-ember') as string;
        const root = window.document.documentElement;
        
        // Map theme names to colors
        const themes: Record<string, { accent: string; hover: string }> = {
            'theme-ember': { accent: '#E07B39', hover: '#C8692A' },
            'theme-indigo': { accent: '#6366F1', hover: '#4F46E5' },
            'theme-teal': { accent: '#14B8A6', hover: '#0D9488' },
            'theme-violet': { accent: '#A78BFA', hover: '#8B5CF6' },
            'theme-navy': { accent: '#3B82F6', hover: '#2563EB' }
        };

        // Remove all theme classes and apply saved one
        Object.keys(themes).forEach(t => root.classList.remove(t));
        root.classList.add(savedTheme);

        const config = themes[savedTheme] || themes['theme-ember'];
        root.style.setProperty('--brand-accent', config.accent);
        root.style.setProperty('--brand-accent-hover', config.hover);
        root.style.setProperty('--brand-accent-text', '#fff');
    }, []);

    useEffect(() => {
        const root = window.document.documentElement;
        const sizeMap = { sm: '14px', md: '16px', lg: '18px' };
        root.style.setProperty('--font-size-base', sizeMap[settings.fontSize]);
        root.style.setProperty('--font-family-sans', `'${settings.fontFamily}', sans-serif`);
    }, [settings.fontSize, settings.fontFamily]);
    
    useEffect(() => {
        localStorage.setItem('conversionSettings', JSON.stringify(settings));
    }, [settings]);

    useEffect(() => {
        localStorage.setItem('conversionStats', JSON.stringify(stats));
    }, [stats]);

    useEffect(() => {
        localStorage.setItem('conversionHistory', JSON.stringify(history));
    }, [history]);

    useEffect(() => {
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
    }, [userProfile]);
    
    useEffect(() => {
        localStorage.setItem('sidebarCollapsed', String(isSidebarCollapsed));
    }, [isSidebarCollapsed]);

    const handleAddToHistory = useCallback((entry: Omit<HistoryEntry, 'id' | 'date'>) => {
        setHistory(prevHistory => {
            const newEntry: HistoryEntry = {
                ...entry,
                id: Date.now(),
                date: new Date().toISOString().split('T')[0]
            };
            return [newEntry, ...prevHistory].slice(0, 50); // Keep last 50 entries
        });
    }, []);

    const handleUpdateStats = useCallback((result: 'success' | 'fail') => {
        setStats(prevStats => {
            const status: 'Success' | 'Failed' = result === 'success' ? 'Success' : 'Failed';
            const newStats: Stats = { 
                ...prevStats, 
                total: prevStats.total + 1,
                recent: [
                    {
                        id: String(Date.now()),
                        status: status,
                        timestamp: Date.now(),
                        error: result === 'fail' ? 'Conversion failed' : undefined,
                    },
                    ...(prevStats.recent || []).slice(0, 4) // Keep last 5
                ]
            };
            if (result === 'success') {
                newStats.successful += 1;
            } else {
                newStats.failed += 1;
            }
            return newStats;
        });
    }, []);

    const handleNavigate = (page: Page) => {
        setActivePage(page);
        setIsMobileSidebarOpen(false);
    };

    const handleQuickConvertToUpload = (files: File[]) => {
        setInitialFiles(files);
        setActivePage('upload');
    };
    
    const handleQuickCompressToUpload = (files: File[]) => {
        setInitialCompressFiles(files);
        setActivePage('compress');
    };

    const handleNavigateToHistory = (filter?: 'failed' | 'success' | 'all') => {
        setActivePage('history');
        // Store the filter preference in state if needed for HistoryView to use
        if (filter) {
            localStorage.setItem('historyFilterPreference', filter);
        }
    };

    const handleSaveSettings = (newSettings: ConversionSettings) => {
        setSettings(newSettings);
    };

    const handleSaveProfile = (newProfile: UserProfile) => {
        setUserProfile(newProfile);
    };
    
    const handleToggleSidebar = () => {
        setIsSidebarCollapsed(prev => !prev);
    };

    const handleAuthSuccess = (payload: AuthSuccessPayload) => {
        setUserProfile({
            name: payload.name,
            email: payload.email,
            avatarUrl: payload.avatarUrl || `https://i.pravatar.cc/150?u=${encodeURIComponent(payload.email)}`,
        });
        setIsAuthenticated(true);
        setIsAuthModalOpen(false);
        localStorage.setItem('authSession', 'true');
        localStorage.setItem('authProvider', payload.provider);
    };
    
    const isGlassEffect = settings.backgroundAnimation && (settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));

    return (
        <ToastProvider>
            <div className={`min-h-screen w-full font-sans transition-colors duration-300 bg-[var(--background-main)]`}>
                <AnimatedBackground enabled={isGlassEffect} />
                
                <div className="md:flex min-h-screen">
                    <Sidebar 
                        activePage={activePage} 
                        setActivePage={handleNavigate} 
                        isCollapsed={isSidebarCollapsed}
                        onToggle={handleToggleSidebar}
                        t={t.sidebar}
                        isMobileOpen={isMobileSidebarOpen}
                        setMobileOpen={setIsMobileSidebarOpen}
                        isGlassEffect={isGlassEffect}
                    />
                    <div className="flex-1 w-full">
                        <MobileHeader onMenuClick={() => setIsMobileSidebarOpen(true)} />
                        <main>
                            <div className="w-full md:pt-0 pt-16">
                                <div style={{ display: activePage === 'dashboard' ? 'block' : 'none' }}>
                                    <DashboardView
                                        onQuickConvert={handleQuickConvertToUpload}
                                        onQuickCompress={handleQuickCompressToUpload}
                                        stats={stats}
                                        t={t.dashboard}
                                        settings={settings}
                                        setSettings={setSettings}
                                        isAuthenticated={isAuthenticated}
                                        currentUserName={userProfile.name}
                                        userProfile={userProfile}
                                        onAuthClick={() => setIsAuthModalOpen(true)}
                                        onProfileClick={() => setActivePage('profile')}
                                        onNavigateToHistory={handleNavigateToHistory}
                                    />
                                </div>
                                 <div style={{ display: activePage === 'compress' ? 'block' : 'none' }}>
                                    <CompressorView 
                                        initialFiles={initialCompressFiles}
                                        t={t.compressor}
                                    />
                                </div>
                                <div style={{ display: activePage === 'upload' ? 'block' : 'none' }}>
                                    <ConverterView 
                                        initialFiles={initialFiles} 
                                        onConversionComplete={handleUpdateStats} 
                                        onAddToHistory={handleAddToHistory} 
                                        defaultCompression={settings.defaultCompression} 
                                        autoDelete={settings.autoDelete}
                                        t={t.converter}
                                    />
                                </div>
                                <div style={{ display: activePage === 'upload' ? 'block' : 'none' }}>
                                    <UploadConverterView />
                                </div>
                                <div style={{ display: activePage === 'extract' ? 'block' : 'none' }}>
                                    <ImageExtractorView />
                                </div>
                                <div style={{ display: activePage === 'history' ? 'block' : 'none' }}>
                                    <HistoryView 
                                        history={history} 
                                        t={t.history}
                                        initialFilter={(() => {
                                            const pref = localStorage.getItem('historyFilterPreference');
                                            localStorage.removeItem('historyFilterPreference');
                                            return pref as 'failed' | 'success' | 'all' | undefined;
                                        })()}
                                    />
                                </div>
                                <div style={{ display: activePage === 'settings' ? 'block' : 'none' }}>
                                    <SettingsView settings={settings} onSave={handleSaveSettings} t={t.settings}/>
                                </div>
                                <div style={{ display: activePage === 'profile' ? 'block' : 'none' }}>
                                    <ProfileView userProfile={userProfile} onSave={handleSaveProfile} t={t.profile}/>
                                </div>
                            </div>
                        </main>
                        <footer className="mt-8 p-4 sm:p-8 border-t border-[var(--border-color)]">
                        </footer>
                    </div>
                </div>
            </div>
            <AuthView
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
                onAuthSuccess={handleAuthSuccess}
            />
        </ToastProvider>
    );
};

export default App;
