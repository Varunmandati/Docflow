import React, { useState, useEffect } from 'react';
import { SettingsTranslation } from '../translations';
import { ConversionSettings, FontFamily, FontSize } from '../types';
import { Language, Theme } from '../App';
import { CompressionLevel } from './ConversionOptions';

interface SettingsViewProps {
    settings: ConversionSettings;
    onSave: (newSettings: ConversionSettings) => void;
    t: SettingsTranslation;
}

const SettingsToggle: React.FC<{ label: string; description: string; enabled: boolean; onChange: (enabled: boolean) => void; disabled?: boolean }> = ({ label, description, enabled, onChange, disabled = false }) => (
    <div className={`flex justify-between items-center ${disabled ? 'opacity-50' : ''}`}>
        <div>
            <h4 className="body-sm font-medium text-[var(--text-primary)]">{label}</h4>
            <p className="caption-text" style={{ color: 'var(--text-secondary)' }}>{description}</p>
        </div>
        <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(!enabled)}
            className={`${enabled ? 'bg-[var(--primary-color)]' : 'bg-black/20 dark:bg-white/20'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] focus:ring-offset-2 focus:ring-offset-[var(--background-body)] ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            role="switch"
            aria-checked={enabled}
        >
            <span
                aria-hidden="true"
                className={`${enabled ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
            />
        </button>
    </div>
);


const SettingsView: React.FC<SettingsViewProps> = ({ settings, onSave, t }) => {
    const [localSettings, setLocalSettings] = useState<ConversionSettings>(settings);
    const isGlassEffect = settings.backgroundAnimation && (settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
    const panelClasses = `relative rounded-xl border border-[var(--border-color)] p-6 bg-[var(--background-card)] elevation-3`;

    useEffect(() => {
        setLocalSettings(settings);
    }, [settings]);
    
    const handleSave = () => {
        onSave(localSettings);
        // Maybe show a toast notification here in the future
    };

    const handleFieldChange = <K extends keyof ConversionSettings>(field: K, value: ConversionSettings[K]) => {
        setLocalSettings(prev => ({...prev, [field]: value}));
    };

    const languageOptions: { value: Language, label: string }[] = [
        { value: 'en', label: 'English' },
        { value: 'hi', label: 'हिन्दी' },
        { value: 'bn', label: 'বাংলা' },
        { value: 'te', label: 'తెలుగు' },
    ];

    const themeOptions: { value: Theme, label: string }[] = [
        { value: 'light', label: t.sections.general.themeOptions.light },
        { value: 'dark', label: t.sections.general.themeOptions.dark },
        { value: 'system', label: t.sections.general.themeOptions.system },
    ];

    const compressionOptions: { value: CompressionLevel, label: string }[] = [
         { value: 'Low', label: t.sections.conversion.compressionOptions.low },
         { value: 'Medium', label: t.sections.conversion.compressionOptions.medium },
         { value: 'High', label: t.sections.conversion.compressionOptions.high },
    ];

    return (
        <div className="p-4 sm:p-8 w-full">
            <header className="mb-8">
                <div className="flex items-center gap-3">
                    <h1 className="display-md" style={{ color: 'var(--text-primary)' }}>{t.title}</h1>
                </div>
                <p className="body-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Manage your application preferences</p>
            </header>

            <div className="max-w-4xl mx-auto space-y-8">
                {/* General Settings */}
                <div className={panelClasses}>
                    <h3 className="display-sm mb-4 text-[var(--text-primary)]">{t.sections.general.title}</h3>
                    <div className="space-y-6">
                         <div>
                            <label className="block caption-text font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{t.sections.general.language}</label>
                            <select 
                                value={localSettings.language}
                                onChange={(e) => handleFieldChange('language', e.target.value as Language)}
                                className="w-full vercel-input"
                            >
                                {languageOptions.map(opt => <option key={opt.value} value={opt.value} className="bg-[var(--background-card)] text-[var(--text-primary)]">{opt.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block caption-text font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{t.sections.general.theme}</label>
                             <div className="segmented-control">
                                {themeOptions.map(opt => (
                                     <button 
                                        key={opt.value}
                                        onClick={() => handleFieldChange('theme', opt.value)}
                                        className={`capitalize ${
                                            localSettings.theme === opt.value ? 'active' : ''
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div style={{opacity: localSettings.theme === 'light' ? 0.5 : 1, pointerEvents: localSettings.theme === 'light' ? 'none' : 'auto'}}>
                            <SettingsToggle 
                                label={t.sections.general.backgroundAnimation}
                                description={localSettings.theme === 'light' ? 'Only available in dark mode' : t.sections.general.backgroundAnimationDescription}
                                enabled={localSettings.theme !== 'light' ? localSettings.backgroundAnimation : false}
                                onChange={(val) => localSettings.theme !== 'light' && handleFieldChange('backgroundAnimation', val)}
                                disabled={localSettings.theme === 'light'}
                            />
                        </div>

                        {/* Appearance Section - Removed Font Settings */}
                    </div>
                </div>


                
                <div className="flex justify-end">
                    <button onClick={handleSave} className="glowing-btn pill-btn font-medium py-2.5 px-8 text-sm">
                        {t.saveButton}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsView;