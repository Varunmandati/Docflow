import React from 'react';

interface StatsCardWithTrendProps {
    title: string;
    value: string | number;
    icon: React.ReactNode;
    trend?: number; // percentage change, positive or negative
    onClick?: () => void;
    variant?: 'danger' | 'success' | 'warning' | 'default';
    progressValue?: number;
    progressColor?: string;
}
const StatsCardWithTrend: React.FC<StatsCardWithTrendProps> = ({ 
    title,
    value,
    icon,
    trend,
    onClick,
    variant = 'default',
    progressValue,
    progressColor
}) => {
    const getTrendArrow = () => {
        if (trend === undefined || trend === 0) return '—';
        return trend > 0 ? '↑' : '↓';
    };

    const getTrendColor = () => {
        if (trend === undefined || trend === 0) return 'text-[var(--text-tertiary)]';
        return trend > 0 ? 'text-[var(--success-color)]' : 'text-[var(--danger-color)]';
    };

    const getBgColor = () => {
        switch (variant) {
            case 'danger': return 'bg-red-500/10 dark:bg-red-500/5 border-red-500/20';
            case 'success': return 'bg-emerald-500/10 dark:bg-emerald-500/5 border-emerald-500/20';
            case 'warning': return 'bg-amber-500/10 dark:bg-amber-500/5 border-amber-500/20';
            default: return 'bg-[var(--background-card)] dark:bg-[var(--background-card)]/40 border-[var(--border-color)]';
        }
    };

    return (
        <div 
            onClick={onClick}
            className={`relative p-5 rounded-2xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] border elevation-2 ${getBgColor()} ${
                onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:elevation-3' : ''
            }`}
            style={{ paddingBottom: progressValue !== undefined ? '28px' : '20px' }}
        >
            <div className="flex items-center justify-between relative z-10">
                <div>
                    <p className="caption-text font-medium" style={{ color: 'var(--text-tertiary)' }}>{title}</p>
                    <div className="flex items-baseline gap-2 mt-1.5">
                        <p className="display-lg text-[var(--text-primary)] mono-stat">{value}</p>
                        {trend !== undefined && (
                            <div className="flex items-center gap-1.5">
                                <span className={`meta-chip ${trend > 0 ? '' : ''}`} style={{ color: trend > 0 ? 'var(--success-color)' : 'var(--danger-color)', borderColor: 'color-mix(in srgb, currentColor 24%, transparent)' }}>
                                    {getTrendArrow()} {Math.abs(trend)}%
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-[var(--well)] border border-[var(--border-color)] flex items-center justify-center">
                    {icon}
                </div>
            </div>
            
            {progressValue !== undefined && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--background-secondary)] rounded-b-2xl overflow-hidden">
                    <div 
                        className="h-full rounded-b-2xl transition-all duration-700 ease-out" 
                        style={{ 
                            width: `${Math.min(100, Math.max(0, progressValue))}%`, 
                            backgroundColor: progressColor || 'var(--primary-color)' 
                        }} 
                    />
                </div>
            )}
        </div>
    );
};

export default StatsCardWithTrend;
