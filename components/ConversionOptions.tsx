import React, { useState } from 'react';
import { SettingsIcon, ChevronDownIcon, LockClosedIcon, CheckBadgeIcon } from './Icons';
import { PageSize, Orientation, ColorMode, OutputFormat, SecurityOptions } from '../types';

export type CompressionLevel = 'Low' | 'Medium' | 'High';

interface ConversionOptionsProps {
    watermark: string;
    setWatermark: (text: string) => void;
    pageSize: PageSize;
    setPageSize: (size: PageSize) => void;
    orientation: Orientation;
    setOrientation: (orientation: Orientation) => void;
    colorMode: ColorMode;
    setColorMode: (mode: ColorMode) => void;
    outputFormat: OutputFormat;
    setOutputFormat: (format: OutputFormat) => void;
    onApplyFormatToAll: () => void;
    securityOptions: SecurityOptions;
    setSecurityOptions: (options: SecurityOptions) => void;
    pageNumbers: boolean;
    setPageNumbers: (enabled: boolean) => void;
    t: any; // Using 'any' for simplicity, could be typed better
}

const OptionButton: React.FC<{ onClick: () => void; isActive: boolean; children: React.ReactNode }> = ({ onClick, isActive, children }) => (
    <button
        type="button"
        onClick={onClick}
        className={`w-full py-2 text-sm font-semibold rounded-md transition-colors duration-200 ${isActive ? 'bg-[var(--primary-color)] text-[var(--primary-text)] shadow' : 'text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5'}`}
    >
        {children}
    </button>
);

const ConversionOptions: React.FC<ConversionOptionsProps> = ({ 
    watermark, setWatermark,
    pageSize, setPageSize,
    orientation, setOrientation,
    colorMode, setColorMode,
    outputFormat, setOutputFormat,
    onApplyFormatToAll,
    securityOptions, setSecurityOptions,
    pageNumbers, setPageNumbers,
    t
}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="w-full max-w-3xl mx-auto bg-black/5 dark:bg-white/5 rounded-xl shadow-lg transition-all duration-300">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex justify-between items-center p-4 text-left"
            >
                <div className="flex items-center gap-3">
                    <SettingsIcon className="w-5 h-5 text-[var(--text-secondary)]" />
                    <h3 className="font-semibold text-[var(--text-primary)]">Advanced Options</h3>
                </div>
                <ChevronDownIcon className={`w-5 h-5 text-[var(--text-secondary)] transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[56rem]' : 'max-h-0'}`}>
                <div className="border-t border-[var(--border-color)] p-6 space-y-6">
                    
                    {/* Output Format */}
                    <div>
                        <h4 className="block text-sm font-medium text-[var(--text-secondary)] mb-2">{t.outputFormat}</h4>
                        <div className="flex items-center gap-2">
                            <div className="flex-grow grid grid-cols-2 sm:grid-cols-4 gap-2 bg-black/5 dark:bg-white/10 rounded-lg p-1">
                                {(['pdf', 'jpg', 'png', 'webp', 'docx'] as OutputFormat[]).map(format => (
                                    <OptionButton key={format} onClick={() => setOutputFormat(format)} isActive={outputFormat === format}>{format.toUpperCase()}</OptionButton>
                                ))}
                            </div>
                            <button 
                                onClick={onApplyFormatToAll}
                                title="Apply format to all files"
                                className="flex-shrink-0 p-2.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-[var(--primary-color)]/20 text-[var(--text-secondary)] hover:text-[var(--primary-color)] transition-colors"
                            >
                                <CheckBadgeIcon className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                    
                    {/* Page Layout */}
                    <div>
                        <h4 className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Page Layout</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <span className="block text-xs font-semibold text-[var(--text-tertiary)] mb-1 ml-1">Page Size</span>
                                <div className="flex bg-black/5 dark:bg-white/10 rounded-lg p-1">
                                    <OptionButton onClick={() => setPageSize('a4')} isActive={pageSize === 'a4'}>A4</OptionButton>
                                    <OptionButton onClick={() => setPageSize('letter')} isActive={pageSize === 'letter'}>Letter</OptionButton>
                                </div>
                            </div>
                            <div>
                                <span className="block text-xs font-semibold text-[var(--text-tertiary)] mb-1 ml-1">Orientation</span>
                                <div className="flex bg-black/5 dark:bg-white/10 rounded-lg p-1">
                                    <OptionButton onClick={() => setOrientation('p')} isActive={orientation === 'p'}>Portrait</OptionButton>
                                    <OptionButton onClick={() => setOrientation('l')} isActive={orientation === 'l'}>Landscape</OptionButton>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Image Settings */}
                    <div>
                        <h4 className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Image Settings</h4>
                        <div>
                            <span className="block text-xs font-semibold text-[var(--text-tertiary)] mb-1 ml-1">Color Mode</span>
                            <div className="flex bg-black/5 dark:bg-white/10 rounded-lg p-1">
                                <OptionButton onClick={() => setColorMode('color')} isActive={colorMode === 'color'}>Color</OptionButton>
                                <OptionButton onClick={() => setColorMode('grayscale')} isActive={colorMode === 'grayscale'}>Grayscale</OptionButton>
                                <OptionButton onClick={() => setColorMode('bw')} isActive={colorMode === 'bw'}>B&W</OptionButton>
                            </div>
                        </div>
                    </div>

                    {/* Watermark Options */}
                    <div>
                        <label htmlFor="watermark" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Watermark Text</label>
                        <input
                            type="text"
                            id="watermark"
                            value={watermark}
                            onChange={(e) => setWatermark(e.target.value)}
                            placeholder="e.g., Confidential"
                            className="w-full bg-black/5 dark:bg-white/10 border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg px-3 py-2 focus:ring-2 focus:ring-[var(--primary-color)] focus:border-[var(--primary-color)] transition"
                        />
                    </div>

                    {/* PDF Specific Options */}
                    {outputFormat === 'pdf' && (
                        <div className="pt-6 border-t border-[var(--border-color)] mt-6 space-y-6">
                            <div className="flex justify-between items-center gap-4">
                                <div>
                                    <h4 className="font-medium text-[var(--text-primary)]">{t.pageNumbers}</h4>
                                    <p className="text-sm text-[var(--text-secondary)]">{t.pageNumbersDescription}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPageNumbers(!pageNumbers)}
                                    className={`${pageNumbers ? 'bg-[var(--primary-color)]' : 'bg-black/20 dark:bg-white/20'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] focus:ring-offset-2 focus:ring-offset-[var(--background-card)]`}
                                    role="switch"
                                    aria-checked={pageNumbers}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={`${pageNumbers ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                                    />
                                </button>
                            </div>
                            <div>
                                <label htmlFor="pdf-password" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">{t.security}</label>
                                <div className="relative">
                                    <LockClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-tertiary)]"/>
                                    <input
                                        type="password"
                                        id="pdf-password"
                                        value={securityOptions.password || ''}
                                        onChange={(e) => setSecurityOptions({ ...securityOptions, password: e.target.value })}
                                        placeholder={t.password}
                                        className="w-full pl-10 bg-black/5 dark:bg-white/10 border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg px-3 py-2 focus:ring-2 focus:ring-[var(--primary-color)] focus:border-[var(--primary-color)] transition"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ConversionOptions;