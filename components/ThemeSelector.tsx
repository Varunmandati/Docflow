import React, { useEffect, useState } from 'react';

type ThemeName = 'theme-ember' | 'theme-indigo' | 'theme-teal' | 'theme-violet' | 'theme-navy';

interface ThemeConfig {
    name: ThemeName;
    label: string;
    colors: { accent: string; accentHover: string; accentText: string };
}

const THEMES: ThemeConfig[] = [
    {
        name: 'theme-ember',
        label: 'Ember',
        colors: { accent: '#E07B39', accentHover: '#C8692A', accentText: '#fff' }
    },
    {
        name: 'theme-indigo',
        label: 'Indigo',
        colors: { accent: '#6366F1', accentHover: '#4F46E5', accentText: '#fff' }
    },
    {
        name: 'theme-teal',
        label: 'Teal',
        colors: { accent: '#14B8A6', accentHover: '#0D9488', accentText: '#fff' }
    },
    {
        name: 'theme-violet',
        label: 'Violet',
        colors: { accent: '#A78BFA', accentHover: '#8B5CF6', accentText: '#fff' }
    },
    {
        name: 'theme-navy',
        label: 'Navy',
        colors: { accent: '#3B82F6', accentHover: '#2563EB', accentText: '#fff' }
    }
];

const ThemeSelector: React.FC = () => {
    const [activeTheme, setActiveTheme] = useState<ThemeName>('theme-ember');

    useEffect(() => {
        // Load saved theme from localStorage
        const savedTheme = (localStorage.getItem('appTheme') || 'theme-ember') as ThemeName;
        setActiveTheme(savedTheme);
        applyTheme(savedTheme);
    }, []);

    const applyTheme = (theme: ThemeName) => {
        const html = document.documentElement;
        const config = THEMES.find(t => t.name === theme);
        
        if (config) {
            // Remove all theme classes
            THEMES.forEach(t => html.classList.remove(t.name));
            // Add new theme class
            html.classList.add(theme);

            // Set CSS variables
            html.style.setProperty('--brand-accent', config.colors.accent);
            html.style.setProperty('--brand-accent-hover', config.colors.accentHover);
            html.style.setProperty('--brand-accent-text', config.colors.accentText);

            // Save to localStorage
            localStorage.setItem('appTheme', theme);
        }
    };

    const handleThemeChange = (theme: ThemeName) => {
        setActiveTheme(theme);
        // Add transition class to prevent flash
        const html = document.documentElement;
        html.classList.add('theme-transitioning');
        
        applyTheme(theme);
        
        setTimeout(() => {
            html.classList.remove('theme-transitioning');
        }, 250);
    };

    return (
        <div className="flex gap-3">
            {THEMES.map(theme => (
                <button
                    key={theme.name}
                    onClick={() => handleThemeChange(theme.name)}
                    title={theme.label}
                    style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: theme.colors.accent,
                        border: activeTheme === theme.name ? '3px solid currentColor' : '2px solid transparent',
                        cursor: 'pointer',
                        transition: 'all 150ms ease-out'
                    }}
                    className={activeTheme === theme.name ? 'ring-2 ring-offset-2 ring-offset-[var(--background-body)]' : ''}
                />
            ))}
        </div>
    );
};

export { ThemeSelector, THEMES, type ThemeName };
