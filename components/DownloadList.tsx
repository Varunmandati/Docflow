import React from 'react';
import { DownloadableFile } from '../types';
import { DownloadIcon, FileIcon, FolderZipIcon, SparklesIcon, SpinnerIcon } from './Icons';
import { authFetch } from '../services/authFetch';

declare const JSZip: any;

interface DownloadListProps {
    files: DownloadableFile[];
    aiSuggestedName: string;
    isSuggestingName: boolean;
    finalFileName: string;
    onFinalFileNameChange: (newName: string) => void;
    t: any;
}

const isBlobUrl = (url: string): boolean => url.startsWith('blob:' );

const DownloadList: React.FC<DownloadListProps> = ({ files, aiSuggestedName, isSuggestingName, finalFileName, onFinalFileNameChange, t }) => {

    // Backend artifact URLs are auth-protected, so fetch them with the Bearer
    // header; blob: URLs (locally generated) can be fetched directly.
    const toDownloadableBlob = async (file: DownloadableFile): Promise<Blob> => {
        const response = isBlobUrl(file.url) ? await fetch(file.url) : await authFetch(file.url);
        if (!response.ok) {
            throw new Error(`Failed to download ${file.name}`);
        }
        return response.blob();
    };

    const triggerDownload = (blob: Blob, fileName: string) => {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
    };

    const handleDownloadSingle = async (file: DownloadableFile) => {
        try {
            const blob = await toDownloadableBlob(file);
            triggerDownload(blob, `${file.name}.${file.format}`);
        } catch (error) {
            console.error(`Failed to download ${file.name}:`, error);
        }
    };

    const handleDownloadZip = async () => {
        if (!files || files.length === 0) return;
        
        const zip = new JSZip();
        
        for (const file of files) {
            try {
                const blob = await toDownloadableBlob(file);
                zip.file(`${file.name}.${file.format}`, blob);
            } catch (error) {
                console.error(`Failed to fetch ${file.name} for zipping:`, error);
            }
        }
        
        zip.generateAsync({ type: 'blob' }).then(content => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = 'converted_files.zip';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        });
    };

    const singleFile = files.length === 1 ? files[0] : null;

    return (
        <div className="w-full max-w-2xl bg-black/5 dark:bg-white/5 rounded-xl p-6 shadow-lg space-y-4 border border-[var(--border-color)]">
            <div className="flex justify-between items-center">
                 <h3 className="text-xl font-semibold text-[var(--text-primary)]">Your Files are Ready</h3>
                 {files.length > 1 && (
                     <button
                        onClick={handleDownloadZip}
                        className="flex items-center justify-center gap-2 bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 text-[var(--text-primary)] font-semibold py-2 px-4 rounded-lg transition-all duration-300"
                    >
                        <FolderZipIcon className="w-5 h-5" />
                        <span>{t.downloadZipButton}</span>
                    </button>
                 )}
            </div>

            {singleFile && (
                <div className="space-y-4">
                    {/* AI Suggestion Area */}
                    {(isSuggestingName || aiSuggestedName) && (
                        <div className="bg-black/5 dark:bg-white/10 p-3 rounded-lg text-left border border-[var(--border-color)]">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                                        <SparklesIcon className="w-4 h-4 text-[var(--primary-color)]" />
                                        {t.aiSuggestion}
                                    </p>
                                    {isSuggestingName ? (
                                        <div className="flex items-center gap-2 mt-1">
                                            <SpinnerIcon className="w-4 h-4 text-[var(--primary-color)]"/>
                                            <span className="text-sm text-[var(--text-tertiary)]">{t.status.suggestingName}</span>
                                        </div>
                                    ) : aiSuggestedName ? (
                                        <p className="font-semibold text-[var(--text-primary)] mt-1 truncate" title={aiSuggestedName}>
                                            {aiSuggestedName}
                                        </p>
                                    ) : null}
                                </div>
                                {!isSuggestingName && aiSuggestedName && (
                                    <button
                                        onClick={() => onFinalFileNameChange(aiSuggestedName)}
                                        className="text-sm font-semibold text-[var(--primary-text)] bg-[var(--primary-color)] hover:bg-[var(--primary-color-hover)] px-3 py-1.5 rounded-md transition-all whitespace-nowrap"
                                    >
                                        {t.useSuggestionButton}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* File Name Input */}
                    <div>
                        <label className="block text-left text-sm font-medium text-[var(--text-secondary)] mb-1">
                            {t.fileNameLabel}
                        </label>
                        <input
                            type="text"
                            value={finalFileName}
                            onChange={(e) => onFinalFileNameChange(e.target.value)}
                            className="w-full bg-[var(--background-card)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg px-3 py-2 focus:ring-2 focus:ring-[var(--primary-color)] focus:border-[var(--primary-color)] transition"
                        />
                    </div>
                </div>
            )}
            
            <div className="max-h-60 overflow-y-auto pr-2 space-y-3">
                {files.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="bg-[var(--background-card)] p-3 rounded-lg flex items-center justify-between gap-4 animate-in-item border border-[var(--border-color)]">
                        <div className="flex items-center gap-3 overflow-hidden">
                            <FileIcon className="w-6 h-6 text-[var(--primary-color)] flex-shrink-0"/>
                            <span className="text-[var(--text-primary)] font-medium truncate" title={`${file.name}.${file.format}`}>
                                {file.name}.{file.format}
                            </span>
                        </div>
                        <a 
                            href={file.url} 
                            onClick={(e) => { e.preventDefault(); handleDownloadSingle(file); }}
                            className="flex items-center justify-center gap-1.5 bg-[var(--primary-color)] hover:bg-[var(--primary-color-hover)] text-[var(--primary-text)] font-semibold py-1.5 px-3 rounded-md shadow-lg shadow-orange-500/10 dark:shadow-black/40 transition-all duration-200 text-sm transform hover:scale-105"
                        >
                            <DownloadIcon className="w-4 h-4" />
                            <span>{t.downloadButton}</span>
                        </a>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DownloadList;