import React, { useState, useMemo } from 'react';
import { DownloadIcon, FileIcon } from './Icons';
import { HistoryTranslation } from '../translations';
import { HistoryEntry } from '../types';

interface HistoryViewProps {
    history: HistoryEntry[];
    t: HistoryTranslation;
    initialFilter?: 'failed' | 'success' | 'all';
}

type StatusFilter = 'all' | 'success' | 'failed';

const ITEMS_PER_PAGE = 10;

const HistoryView: React.FC<HistoryViewProps> = ({ history, t, initialFilter = 'all' }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialFilter === 'failed' ? 'failed' : initialFilter === 'success' ? 'success' : 'all');
    const [currentPage, setCurrentPage] = useState(1);
    const isGlassEffect = document.documentElement.classList.contains('dark');

    const filteredHistory = useMemo(() => {
        let result = history;

        if (statusFilter === 'success') {
            result = result.filter(item => item.status === 'Success');
        } else if (statusFilter === 'failed') {
            result = result.filter(item => item.status === 'Failed');
        }

        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            result = result.filter(item => item.name.toLowerCase().includes(term));
        }

        return result;
    }, [history, searchTerm, statusFilter]);

    const totalPages = Math.ceil(filteredHistory.length / ITEMS_PER_PAGE);
    const paginatedHistory = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredHistory.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredHistory, currentPage]);

    const isExpired = (dateString: string) => {
        // Simple heuristic: if date looks like "5/20/2026", parse and check if > 7 days
        // Or if timestamp is not available in item, we guess.
        // Assuming we have to parse dateString. If it's "just now" or "Today", it's not expired.
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return false; // if format is weird, assume not expired
        const diffMs = Date.now() - d.getTime();
        return diffMs > 7 * 24 * 60 * 60 * 1000;
    };

    return (
        <div className="p-4 sm:p-8 w-full">
             <header className="mb-8">
                <div className="flex items-center gap-3">
                    <h1 className="display-md" style={{ color: 'var(--text-primary)' }}>{t.title}</h1>
                </div>
                <p className="body-sm mt-1" style={{ color: 'var(--text-secondary)' }}>View your past conversion and compression jobs</p>
            </header>

            {/* Search and Filter Section */}
            <div className="mb-6 flex flex-col sm:flex-row gap-4 justify-between items-center">
                <div className="segmented-control">
                    {(['all', 'success', 'failed'] as const).map((filter) => (
                        <button
                            key={filter}
                            onClick={() => { setStatusFilter(filter); setCurrentPage(1); }}
                            className={`capitalize ${statusFilter === filter ? 'active' : ''}`}
                        >
                            {filter}
                        </button>
                    ))}
                </div>

                <input
                    type="text"
                    placeholder="Search history..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    className="w-full sm:w-64 vercel-input"
                />
            </div>

            <div className="relative rounded-xl border border-[var(--border-color)] p-6 bg-[var(--background-card)] elevation-3">
                
                {filteredHistory.length > 0 ? (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="border-b border-[var(--border-color)]">
                                    <tr>
                                        <th className="py-3 px-4 caption-mono text-[var(--text-secondary)]">{t.tableHeaders.fileName}</th>
                                        <th className="py-3 px-4 caption-mono text-[var(--text-secondary)]">TYPE</th>
                                        <th className="py-3 px-4 caption-mono text-[var(--text-secondary)]">{t.tableHeaders.date}</th>
                                        <th className="py-3 px-4 caption-mono text-[var(--text-secondary)]">{t.tableHeaders.status}</th>
                                        <th className="py-3 px-4 caption-mono text-[var(--text-secondary)] text-right">{t.tableHeaders.action}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedHistory.map(item => {
                                        const expired = isExpired(item.date);
                                        return (
                                            <tr 
                                                key={item.id} 
                                                className={`border-b border-[var(--border-color)] last:border-b-0 transition-colors duration-150 hover:bg-[var(--hover)] cursor-pointer ${expired ? 'opacity-60' : ''}`}
                                            >
                                                <td className="py-3 px-4 body-sm font-medium text-[var(--text-primary)] max-w-[200px] truncate">{item.name}</td>
                                                <td className="py-3 px-4">
                                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider bg-[var(--background-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)]">
                                                        {item.type || 'Unknown'}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 body-sm text-[var(--text-secondary)] whitespace-nowrap">
                                                    {item.date} {expired && <span className="text-[10px] ml-1 text-[var(--danger-color)]">(Expired)</span>}
                                                </td>
                                                <td className="py-3 px-4">
                                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${item.status === 'Success' ? 'bg-[var(--success-color)]/10 text-[var(--success-color)]' : 'bg-[var(--danger-color)]/10 text-[var(--danger-color)]'}`}>
                                                        {item.status}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-right">
                                                    {item.status === 'Success' && item.url && !expired ? (
                                                        <a 
                                                        href={item.url}
                                                        download={item.name}
                                                        className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-[var(--border-color)] bg-[var(--background-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--primary-color)] transition-all duration-200"
                                                        aria-label={`Download ${item.name}`}
                                                        title={`Download ${item.name}`}
                                                        >
                                                            <DownloadIcon className="w-4 h-4" />
                                                        </a>
                                                    ) : (
                                                        <button
                                                        disabled
                                                        title={expired ? "File expired" : "File no longer available"}
                                                        className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-[var(--border-color)] bg-[var(--background-secondary)] text-[var(--text-tertiary)] cursor-not-allowed relative"
                                                        >
                                                            <DownloadIcon className="w-4 h-4" />
                                                            {expired && <div className="absolute inset-0 m-auto w-5 h-[2px] bg-[var(--danger-color)] rotate-45 rounded-full shadow-sm" />}
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                        
                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--border-color)]">
                                <p className="body-sm text-[var(--text-secondary)]">
                                    Showing <span className="font-medium text-[var(--text-primary)]">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to <span className="font-medium text-[var(--text-primary)]">{Math.min(currentPage * ITEMS_PER_PAGE, filteredHistory.length)}</span> of <span className="font-medium text-[var(--text-primary)]">{filteredHistory.length}</span> results
                                </p>
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="secondary-btn px-3 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Previous
                                    </button>
                                    <div className="flex gap-1">
                                        {Array.from({ length: totalPages }).map((_, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setCurrentPage(i + 1)}
                                                className={`w-8 h-8 flex items-center justify-center text-sm font-medium rounded-md transition-colors ${currentPage === i + 1 ? 'bg-[var(--text-primary)] text-[var(--background-card)]' : 'text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--text-primary)]'}`}
                                            >
                                                {i + 1}
                                            </button>
                                        ))}
                                    </div>
                                    <button 
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        className="secondary-btn px-3 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-16 h-16 bg-[var(--background-secondary)] rounded-full flex items-center justify-center mb-4">
                            <FileIcon className="w-8 h-8 text-[var(--text-tertiary)]" />
                        </div>
                        <h3 className="display-sm text-[var(--text-primary)] mb-2">No History Found</h3>
                        <p className="body-sm text-[var(--text-secondary)] max-w-md">
                            {searchTerm 
                                ? `No results found for "${searchTerm}". Try a different search term.` 
                                : statusFilter !== 'all' 
                                    ? `No ${statusFilter} items found in your history.`
                                    : "You haven't converted or compressed any files yet."}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HistoryView;