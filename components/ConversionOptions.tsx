import React, { useState } from 'react';
import { SettingsIcon, ChevronDownIcon, LockClosedIcon } from './Icons';
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
        className={`w-full py-2 text-sm font-semibold rounded-md transition-colors duration-200 ${isActive ? 'bg-[var(--primary-color)] text-[var(--primary-text)]' : 'text-[var(--text-primary)] hover:bg-[var(--well-hover)]'}`}
    >
        {children}
    </button>
);

const ConversionOptions: React.FC<ConversionOptionsProps> = ({ 
    watermark, setWatermark,
    pageSize, setPageSize,
    orientation, setOrientation,
    colorMode, setColorMode,
    outputFormat,
    securityOptions, setSecurityOptions,
    pageNumbers, setPageNumbers,
    t
}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="w-full max-w-3xl mx-auto well transition-all duration-300">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex justify-between items-center p-4 text-left"
            >
                <div className="flex items-center gap-3">
                    <SettingsIcon className="w-5 h-5 text-[var(--text-secondary)]" />
                    <h3 className="font-semibold text-[var(--text-primary)]">Advanced Options</h3>
                </div>
                <ChevronDownIcon className={`w-5 h-5 text-[var(--text-secondary)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            
            <div className={`overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isOpen ? 'max-h-[56rem]' : 'max-h-0'}`}>
                <div className="border-t border-[var(--border-color)] p-6 space-y-6">
                    
                    {/* Page Layout */}
                    <div>
                        <h4 className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Page Layout</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <span className="block text-xs font-semibold text-[var(--text-tertiary)] mb-1 ml-1">Page Size</span>
                                <div className="flex bg-[var(--well)] rounded-lg p-1">
                                    <OptionButton onClick={() => setPageSize('a4')} isActive={pageSize === 'a4'}>A4</OptionButton>
                                    <OptionButton onClick={() => setPageSize('letter')} isActive={pageSize === 'letter'}>Letter</OptionButton>
                                </div>
                            </div>
                            <div>
                                <span className="block text-xs font-semibold text-[var(--text-tertiary)] mb-1 ml-1">Orientation</span>
                                <div className="flex bg-[var(--well)] rounded-lg p-1">
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
                            <div className="flex bg-[var(--well)] rounded-lg p-1">
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
                            className="vercel-input w-full"
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
                                    className={`${pageNumbers ? 'bg-[var(--primary-color)]' : 'bg-[var(--well-strong)]'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] focus:ring-offset-2 focus:ring-offset-[var(--background-card)]`}
                                    role="switch"
                                    aria-checked={pageNumbers}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={`${pageNumbers ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--text-primary)] shadow ring-0 transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]`}
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
                                        className="vercel-input w-full pl-10"
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