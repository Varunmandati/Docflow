import React, { useState, useEffect } from 'react';
import { AppFile, PageInfo } from '../types';
import { CloseIcon, RotateCwIcon, TrashIcon, CheckIcon } from './Icons';

interface PageManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    file: AppFile | null;
    onSave: (fileId: string, updatedPages: PageInfo[]) => void;
    t: any;
}

const PageManagerModal: React.FC<PageManagerModalProps> = ({ isOpen, onClose, file, onSave, t }) => {
    const [pages, setPages] = useState<PageInfo[]>([]);
    const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (file) {
            setPages(file.pages);
            setSelectedPages(new Set()); // Reset selection when file changes or modal opens
        } else {
            setPages([]);
        }
    }, [file]);

    if (!isOpen || !file) return null;

    const handleRotate = (pageId: string) => {
        setPages(currentPages =>
            currentPages.map(p => {
                if (p.id === pageId) {
                    const newRotation = (p.rotation + 90) % 360;
                    return { ...p, rotation: newRotation as PageInfo['rotation'] };
                }
                return p;
            })
        );
    };

    const handleDelete = (pageId: string) => {
        if (pages.length <= 1) return;
        setPages(currentPages => currentPages.filter(p => p.id !== pageId));
    };

    const handleSelectPage = (pageId: string) => {
        setSelectedPages(prev => {
            const newSelection = new Set(prev);
            if (newSelection.has(pageId)) {
                newSelection.delete(pageId);
            } else {
                newSelection.add(pageId);
            }
            return newSelection;
        });
    };

    const handleSelectAll = () => {
        if (selectedPages.size === pages.length) {
            setSelectedPages(new Set());
        } else {
            setSelectedPages(new Set(pages.map(p => p.id)));
        }
    };

    const handleRotateSelected = () => {
        setPages(currentPages =>
            currentPages.map(p => {
                if (selectedPages.has(p.id)) {
                    const newRotation = (p.rotation + 90) % 360;
                    return { ...p, rotation: newRotation as PageInfo['rotation'] };
                }
                return p;
            })
        );
    };

    const handleDeleteSelected = () => {
        if (pages.length - selectedPages.size < 1) return;
        setPages(currentPages => currentPages.filter(p => !selectedPages.has(p.id)));
        setSelectedPages(new Set());
    };
    
    const handleSave = () => {
        onSave(file.id, pages);
        onClose();
    };

    const isPageSelected = (pageId: string) => selectedPages.has(pageId);
    const hasSelection = selectedPages.size > 0;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in-item" style={{ animationDuration: '0.3s' }}>
            <div className="bg-[var(--background-card)] rounded-2xl shadow-2xl w-full max-w-4xl h-full max-h-[90vh] flex flex-col">
                <header className="flex justify-between items-center p-4 border-b border-[var(--border-color)] flex-shrink-0">
                    <div>
                         <h2 className="text-xl font-bold text-[var(--text-primary)]">{t.title}</h2>
                         <p className="text-sm text-[var(--text-secondary)] truncate max-w-md" title={file.file.name}>
                            {file.file.name} ({pages.length} {t.pages})
                         </p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                        <CloseIcon className="w-6 h-6 text-[var(--text-secondary)]"/>
                    </button>
                </header>
                <main className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {pages.map((page, index) => (
                            <div 
                                key={page.id} 
                                className={`relative group aspect-w-1 aspect-h-1 rounded-lg overflow-hidden cursor-pointer transition-all duration-200 ${isPageSelected(page.id) ? 'ring-2 ring-offset-2 ring-offset-[var(--background-card)] ring-[var(--primary-color)]' : 'ring-2 ring-transparent hover:ring-[var(--primary-color)]/50'}`}
                                onClick={() => handleSelectPage(page.id)}
                            >
                                <img 
                                    src={page.thumbnailUrl} 
                                    alt={`Page ${index + 1}`} 
                                    className="w-full h-full object-contain transition-transform duration-300"
                                    style={{ transform: `rotate(${page.rotation}deg)` }}
                                />
                                 {isPageSelected(page.id) && (
                                     <div className="absolute inset-0 bg-black/20 dark:bg-black/40"></div>
                                 )}

                                {isPageSelected(page.id) && (
                                    <div className="absolute top-1.5 left-1.5 w-5 h-5 bg-[var(--primary-color)] rounded-full flex items-center justify-center text-[var(--primary-text)] ring-2 ring-white/50">
                                        <CheckIcon className="w-3 h-3" strokeWidth={3} />
                                    </div>
                                )}
                                
                                {/* Individual actions only show when NO pages are selected */}
                                {!hasSelection && (
                                    <div 
                                        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <span className="text-white font-bold text-lg mb-2">Page {index + 1}</span>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleRotate(page.id)} title="Rotate Page" className="p-2 bg-white/20 rounded-full text-white hover:bg-white/30 transition">
                                                <RotateCwIcon className="w-5 h-5"/>
                                            </button>
                                            <button onClick={() => handleDelete(page.id)} title="Delete Page" className="p-2 bg-white/20 rounded-full text-white hover:bg-red-500/80 transition disabled:opacity-50" disabled={pages.length <= 1}>
                                                <TrashIcon className="w-5 h-5"/>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </main>
                <footer className="flex-shrink-0 p-4 border-t border-[var(--border-color)] flex justify-between items-center gap-4">
                     <div className="flex-1">
                         <button
                            onClick={handleSelectAll}
                            className="text-sm font-semibold text-[var(--primary-color)] hover:underline disabled:opacity-50"
                            disabled={pages.length === 0}
                         >
                            {selectedPages.size === pages.length && pages.length > 0 ? 'Deselect All' : 'Select All'}
                         </button>
                    </div>

                    <div className={`flex items-center gap-3 transition-all duration-300 ${hasSelection ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
                        <span className="text-sm font-medium text-[var(--text-primary)] bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md">{selectedPages.size} selected</span>
                        <button onClick={handleRotateSelected} title="Rotate Selected" className="p-2 rounded-full text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--text-primary)] transition">
                            <RotateCwIcon className="w-5 h-5"/>
                        </button>
                        <button onClick={handleDeleteSelected} title="Delete Selected" className="p-2 rounded-full text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--danger-color)] transition disabled:opacity-50" disabled={pages.length - selectedPages.size < 1}>
                            <TrashIcon className="w-5 h-5"/>
                        </button>
                    </div>
                    
                     <div className="flex-1 flex justify-end">
                        <button onClick={handleSave} className="glowing-btn font-bold py-2 px-6 rounded-lg transition-all duration-300">
                            {t.save}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default PageManagerModal;
