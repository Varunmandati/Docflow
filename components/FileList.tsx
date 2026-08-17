import React, { useRef, useState, useCallback } from 'react';
import { AppFile, OutputFormat } from '../types';
import { FileIcon, TrashIcon, CloseIcon, SpinnerIcon } from './Icons';

interface FileListProps {
    files: AppFile[];
    onClear: () => void;
    onRemove: (fileId: string) => void;
    onManage: (fileId: string) => void;
    onUpdateFormat?: (fileId: string, format: OutputFormat) => void;
    onReorder?: (files: AppFile[]) => void;
    disabled?: boolean;
    t: any;
}

const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const FileList: React.FC<FileListProps> = ({ files, onClear, onRemove, onManage, onUpdateFormat, onReorder, disabled = false, t }) => {
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const dragNodeRef = useRef<HTMLDivElement | null>(null);

    const canReorder = !disabled && files.length > 1 && !!onReorder;

    const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
        if (!canReorder) return;
        setDraggedIndex(index);
        dragNodeRef.current = e.currentTarget as HTMLDivElement;
        e.dataTransfer.effectAllowed = 'move';
        // Make the drag image slightly transparent
        if (dragNodeRef.current) {
            dragNodeRef.current.style.opacity = '0.5';
        }
    }, [canReorder]);

    const handleDragEnd = useCallback(() => {
        if (dragNodeRef.current) {
            dragNodeRef.current.style.opacity = '1';
        }
        setDraggedIndex(null);
        setDragOverIndex(null);
        dragNodeRef.current = null;
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedIndex === null || draggedIndex === index) return;
        setDragOverIndex(index);
    }, [draggedIndex]);

    const handleDragLeave = useCallback(() => {
        setDragOverIndex(null);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === dropIndex || !onReorder) return;

        const reordered = [...files];
        const [movedItem] = reordered.splice(draggedIndex, 1);
        reordered.splice(dropIndex, 0, movedItem);
        onReorder(reordered);

        setDraggedIndex(null);
        setDragOverIndex(null);
        dragNodeRef.current = null;
    }, [draggedIndex, files, onReorder]);

    const handleMoveUp = useCallback((index: number) => {
        if (index === 0 || !onReorder) return;
        const reordered = [...files];
        [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
        onReorder(reordered);
    }, [files, onReorder]);

    const handleMoveDown = useCallback((index: number) => {
        if (index === files.length - 1 || !onReorder) return;
        const reordered = [...files];
        [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
        onReorder(reordered);
    }, [files, onReorder]);

    return (
        <div className="w-full max-w-3xl bg-black/5 dark:bg-white/5 rounded-xl p-6 border border-[var(--border-color)]">
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                    <h3 className="text-xl font-semibold text-[var(--text-primary)]">Selected Files ({files.length})</h3>
                    {canReorder && (
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--primary-color)]/10 text-[var(--primary-color)] select-none flex items-center gap-1.5" title="Drag files or use arrows to reorder">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l0 20"/><path d="M5 9l7-7 7 7"/><path d="M5 15l7 7 7 7"/></svg>
                            Reorderable
                        </span>
                    )}
                </div>
                {files.length > 0 && (
                    <button
                        onClick={onClear}
                        disabled={disabled}
                        className="flex items-center gap-2 text-sm text-[var(--text-tertiary)] hover:text-[var(--danger-color)] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-[var(--text-tertiary)]"
                    >
                        <TrashIcon className="w-4 h-4" />
                        Clear All
                    </button>
                )}
            </div>
            <div className="max-h-80 overflow-y-auto pr-2 space-y-3">
                {files.map((appFile, index) => (
                    <div 
                        key={appFile.id}
                        draggable={canReorder}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, index)}
                        className={`file-row bg-[var(--background-card)] p-4 rounded-lg flex items-center justify-between gap-4 animate-in-item border transition-all duration-300 hover:bg-[var(--background-card)]/80 group ${
                            appFile.status === 'loading' ? 'opacity-60 animate-pulse' : 'opacity-100'
                        } ${
                            draggedIndex === index
                                ? 'border-[var(--primary-color)] shadow-lg shadow-[var(--primary-color)]/20 scale-[1.02] z-20 relative'
                                : dragOverIndex === index
                                    ? 'border-dashed border-2 border-[var(--primary-color)]/60 bg-[var(--primary-color)]/5'
                                    : 'border-[var(--border-color)] hover:border-[var(--primary-color)]'
                        } ${canReorder ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    >
                        {/* Sequence Number Badge + Drag Handle */}
                        {canReorder && (
                            <div className="flex flex-col items-center gap-1 flex-shrink-0 select-none">
                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[var(--primary-color)] to-[var(--primary-color)]/70 text-white font-bold flex items-center justify-center text-xs shadow-sm">
                                    {index + 1}
                                </div>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[var(--text-tertiary)] opacity-50 group-hover:opacity-100 transition-opacity">
                                    <circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/>
                                    <circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/>
                                    <circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/>
                                </svg>
                            </div>
                        )}

                        {/* Left Column: Thumbnail + Filename */}
                        <div className="flex items-center gap-4 overflow-hidden flex-1 min-w-0">
                            {appFile.status === 'loading' ? (
                                 <div className="w-12 h-12 bg-black/5 dark:bg-white/5 rounded-lg flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                                    <div className="w-full h-1 bg-black/10 dark:bg-white/10 absolute bottom-0 left-0 overflow-hidden">
                                        <div className="h-full bg-[var(--primary-color)] w-1/2 animate-[slide_1s_ease-in-out_infinite_alternate]" style={{ animation: 'indeterminate-progress 1.5s infinite ease-in-out' }} />
                                    </div>
                                    <FileIcon className="w-5 h-5 text-[var(--primary-color)] opacity-50 relative z-10"/>
                                </div>
                            ) : appFile.pages[0]?.thumbnailUrl ? (
                                <img src={appFile.pages[0].thumbnailUrl} alt="Preview" className="w-12 h-12 object-cover rounded-lg bg-black/5 dark:bg-white/5 flex-shrink-0" />
                            ) : (
                                <div className="w-12 h-12 bg-black/5 dark:bg-white/5 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <FileIcon className="w-6 h-6 text-[var(--primary-color)]"/>
                                </div>
                            )}
                            <div className="flex-1 overflow-hidden min-w-0">
                                <p className={`text-[var(--text-primary)] font-medium truncate block ${appFile.status === 'loading' ? 'italic' : ''}`} title={appFile.file.name}>
                                    {appFile.status === 'loading' ? `Ingesting ${appFile.file.name}...` : appFile.file.name}
                                </p>
                                <p className="text-xs text-[var(--text-tertiary)] truncate">
                                    {appFile.status === 'loading' ? 'Analyzing...' : (appFile.pageCount > 0 ? `${appFile.pageCount} ${appFile.pageCount > 1 ? 'pages' : 'page'}` : '...')}
                                </p>
                            </div>
                        </div>

                        {/* Center Column: Size + Format */}
                        <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                            <div className="text-right">
                                <p className="text-xs text-[var(--text-tertiary)] whitespace-nowrap">{formatBytes(appFile.file.size)}</p>
                                <select
                                    disabled={disabled || appFile.status === 'loading'}
                                    value={appFile.outputFormat}
                                    onChange={(e) => onUpdateFormat?.(appFile.id, e.target.value as OutputFormat)}
                                    className="text-[10px] font-bold uppercase bg-black/5 dark:bg-white/10 text-[var(--text-secondary)] rounded px-2 py-1 outline-none cursor-pointer hover:bg-[var(--primary-color)] hover:text-[var(--primary-text)] transition-all duration-200 disabled:cursor-not-allowed"
                                >
                                    <option value="pdf">PDF</option>
                                    <option value="jpg">JPG</option>
                                    <option value="png">PNG</option>
                                    <option value="webp">WEBP</option>
                                    <option value="docx">DOCX</option>
                                </select>
                            </div>
                        </div>

                        {/* Right Column: Reorder Arrows + Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                            {/* Up/Down reorder arrows */}
                            {canReorder && (
                                <div className="flex flex-col gap-0.5 mr-1">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleMoveUp(index); }}
                                        disabled={index === 0}
                                        className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--primary-color)] hover:bg-[var(--primary-color)]/10 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-tertiary)] transition-all duration-200"
                                        title="Move up"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleMoveDown(index); }}
                                        disabled={index === files.length - 1}
                                        className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--primary-color)] hover:bg-[var(--primary-color)]/10 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-tertiary)] transition-all duration-200"
                                        title="Move down"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                                    </button>
                                </div>
                            )}
                            {appFile.pageCount > 1 && appFile.status !== 'loading' && (
                                <button
                                    onClick={() => onManage(appFile.id)}
                                    disabled={disabled}
                                    className="text-xs font-semibold text-[var(--primary-color)] hover:underline transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 rounded hover:bg-[var(--primary-color)]/10"
                                >
                                    Edit
                                </button>
                            )}
                            <button 
                                onClick={() => onRemove(appFile.id)} 
                                disabled={disabled}
                                className="text-[var(--text-tertiary)] hover:text-[var(--danger-color)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-[var(--text-tertiary)] p-2 rounded hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
                                title="Remove file"
                            >
                                <CloseIcon className="w-5 h-5"/>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            <style>{`
                @keyframes shimmer {
                    0% { transform: translateX(-100%) skewX(-20deg); }
                    100% { transform: translateX(100%) skewX(-20deg); }
                }
                @keyframes indeterminate-progress { 
                    0% { transform: translateX(-100%); } 
                    100% { transform: translateX(200%); } 
                }
            `}</style>
        </div>
    );
};

export default FileList;
