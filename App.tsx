
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
import { signOut } from 'firebase/auth';
import { firebaseAuth } from './firebase';
import { translations } from './translations';
import { HistoryEntry, ConversionSettings, UserProfile, FontFamily } from './types';
import { authFetch } from './services/authFetch';

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
            fontFamily: 'Space Grotesk',
        };
    });

    const [stats, setStats] = useState<Stats>(() => {
        const saved = localStorage.getItem('conversionStats');
        const parsed = saved ? JSON.parse(saved) : { total: 0, successful: 0, failed: 0 };
        return { ...parsed, recent: parsed.recent || [] };
    });

    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
        try {
            return localStorage.getItem('authSession') === 'true';
        } catch (error) {
            return false;
        }
    });

    const [history, setHistory] = useState<HistoryEntry[]>([]);

    // Fetch history from backend API when authenticated
    useEffect(() => {
        if (!isAuthenticated) {
            // Clear history when logged out
            setHistory([]);
            return;
        }

        let cancelled = false;
        const fetchHistory = async () => {
            try {
                const response = await authFetch('/v1/jobs?limit=50');
                if (!response.ok) return;
                const data = await response.json();
                if (cancelled || !data?.success || !data?.data) return;

                // Transform backend Job format to frontend HistoryEntry
                const entries: HistoryEntry[] = data.data.map((job: any) => ({
                    id: parseInt(job.id.replace(/-/g, '').slice(0, 8), 16) || Date.now(),
                    name: job.input_filename || 'Unknown file',
                    date: job.completed_at || job.queued_at || new Date().toISOString(),
                    status: job.status === 'completed' ? 'Success' as const : 'Failed' as const,
                    url: job.status === 'completed' && job.download_token
                        ? `/v1/files/download?token=${job.download_token}`
                        : undefined,
                    type: job.job_type === 'compression' ? 'Compress' as const : 'Convert' as const,
                }));

                setHistory(entries);
            } catch (error) {
                console.error('Failed to fetch history:', error);
            }
        };

        fetchHistory();
        return () => { cancelled = true; };
    }, [isAuthenticated]);
    
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
        return localStorage.getItem('sidebarCollapsed') === 'true';
    });

    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

    const t = translations[settings.language];

    useEffect(() => {
        const applyTheme = (theme: Theme) => {
            const root = window.document.documentElement;
            const isDark =
                theme === 'dark' ||
                (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
            
            // Use requestAnimationFrame to ensure smooth transition
            requestAnimationFrame(() => {
                // Add transition class first, then force a reflow so the browser
                // registers the transition duration BEFORE the theme colors change
                root.classList.add('theme-transitioning');
                void root.offsetHeight;
                
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
        const allowedFonts: FontFamily[] = ['Space Grotesk', 'Inter', 'Lato', 'Roboto', 'Merriweather'];
        const fam = allowedFonts.includes(settings.fontFamily) ? settings.fontFamily : 'Space Grotesk';
        root.style.setProperty('--font-size-base', sizeMap[settings.fontSize]);
        root.style.setProperty('--font-family-sans', `'${fam}', 'Inter', sans-serif`);
    }, [settings.fontSize, settings.fontFamily]);
    
    useEffect(() => {
        localStorage.setItem('conversionSettings', JSON.stringify(settings));
    }, [settings]);

    useEffect(() => {
        localStorage.setItem('conversionStats', JSON.stringify(stats));
    }, [stats]);

    // History is now fetched from backend API - no localStorage persistence needed

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

    const handleLogout = () => {
        // Clear persisted auth so protected /v1/* calls stop carrying a token.
        localStorage.removeItem('authToken');
        localStorage.removeItem('customToken');
        localStorage.removeItem('authSession');
        localStorage.removeItem('authProvider');
        localStorage.removeItem('userProfile');
        setIsAuthenticated(false);
        setUserProfile(defaultUserProfile);
        setActivePage('dashboard');

        // Sign out of Firebase (Google auth) so the next login prompts again.
        if (firebaseAuth) {
            signOut(firebaseAuth).catch(() => {});
        }

        // Immediately show the login/signup modal so the user is asked to
        // authenticate instead of being left on a mock profile.
        setIsAuthModalOpen(true);
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

    // Sync the local profile with the authoritative email/name stored in the
    // backend. Without this, a stale localStorage email breaks flows that must
    // match the account email exactly (e.g. change-email "oldEmail" check).
    useEffect(() => {
        if (!isAuthenticated) return;

        let cancelled = false;
        const syncProfile = async () => {
            try {
                const response = await authFetch('/v1/profile');
                if (!response.ok) return;
                const data = await response.json();
                if (cancelled || !data?.success || !data.profile) return;
                const p = data.profile;
                if (p.email) {
                    setUserProfile(prev => ({
                        name: p.name || prev.name,
                        email: p.email,
                        avatarUrl: p.avatarUrl || prev.avatarUrl,
                    }));
                }
            } catch {
                // Ignore transient failures; the local profile remains usable.
            }
        };
        syncProfile();
        return () => { cancelled = true; };
    }, [isAuthenticated]);
    
    const isGlassEffect = settings.backgroundAnimation && (settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));

    return (
        <ToastProvider>
            <div className={`min-h-screen w-full font-sans transition-colors duration-300 bg-transparent`}>
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
                                <div className="page-fade-in" style={{ display: activePage === 'dashboard' ? 'block' : 'none' }}>
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
                                 <div className="page-fade-in" style={{ display: activePage === 'compress' ? 'block' : 'none' }}>
                                    <CompressorView 
                                        initialFiles={initialCompressFiles}
                                        t={t.compressor}
                                        isAuthenticated={isAuthenticated}
                                    />
                                </div>
                                <div className="page-fade-in" style={{ display: activePage === 'upload' ? 'block' : 'none' }}>
                                    <ConverterView 
                                        initialFiles={initialFiles} 
                                        onConversionComplete={handleUpdateStats} 
                                        onAddToHistory={handleAddToHistory} 
                                        defaultCompression={settings.defaultCompression} 
                                        autoDelete={settings.autoDelete}
                                        t={t.converter}
                                        isAuthenticated={isAuthenticated}
                                        onAuthClick={() => setIsAuthModalOpen(true)}
                                    />
                                </div>
                                <div className="page-fade-in" style={{ display: activePage === 'upload' ? 'block' : 'none' }}>
                                    <UploadConverterView />
                                </div>
                                <div className="page-fade-in" style={{ display: activePage === 'extract' ? 'block' : 'none' }}>
                                    <ImageExtractorView />
                                </div>
                                <div className="page-fade-in" style={{ display: activePage === 'history' ? 'block' : 'none' }}>
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
                                <div className="page-fade-in" style={{ display: activePage === 'settings' ? 'block' : 'none' }}>
                                    <SettingsView settings={settings} onSave={handleSaveSettings} t={t.settings}/>
                                </div>
                                <div className="page-fade-in" style={{ display: activePage === 'profile' ? 'block' : 'none' }}>
                                    <ProfileView userProfile={userProfile} onSave={handleSaveProfile} onLogout={handleLogout} onAuthClick={() => setIsAuthModalOpen(true)} isAuthenticated={isAuthenticated} t={t.profile}/>
                                </div>
                            </div>
                        </main>
                        <footer className="mt-10 p-4 sm:p-6 border-t border-[var(--border-color)]">
                            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <span className="meta-chip">v2.0</span>
                                    <p className="caption-text" style={{ color: 'var(--text-tertiary)' }}>Files are processed in-browser. Nothing leaves your device unless you choose to.</p>
                                </div>
                                <div className="flex items-center gap-5">
                                    <a href="#" className="caption-text no-hover-effect" style={{ color: 'var(--text-tertiary)' }} onClick={(e) => e.preventDefault()}>Privacy</a>
                                    <a href="#" className="caption-text no-hover-effect" style={{ color: 'var(--text-tertiary)' }} onClick={(e) => e.preventDefault()}>Terms</a>
                                </div>
                            </div>
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
