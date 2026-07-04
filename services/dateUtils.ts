/**
 * Format date as relative time (e.g., "3 weeks ago")
 * Returns full date in title attribute for tooltip
 */
export function formatRelativeTime(dateString: string): { text: string; fullDate: string } {
    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        const diffWeeks = Math.floor(diffDays / 7);
        const diffMonths = Math.floor(diffDays / 30);
        const diffYears = Math.floor(diffDays / 365);

        let text = '';
        if (diffSecs < 60) text = 'just now';
        else if (diffMins < 60) text = `${diffMins}m ago`;
        else if (diffHours < 24) text = `${diffHours}h ago`;
        else if (diffDays < 7) text = `${diffDays}d ago`;
        else if (diffWeeks < 4) text = `${diffWeeks}w ago`;
        else if (diffMonths < 12) text = `${diffMonths}mo ago`;
        else text = `${diffYears}y ago`;

        const fullDate = date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        return { text, fullDate };
    } catch {
        return { text: dateString, fullDate: dateString };
    }
}
