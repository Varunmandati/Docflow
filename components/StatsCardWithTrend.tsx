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
            className={`relative p-5 rounded-xl transition-all duration-200 border elevation-2 ${getBgColor()} ${
                onClick ? 'cursor-pointer hover:elevation-3' : ''
            }`}
            style={{ paddingBottom: progressValue !== undefined ? '28px' : '20px' }}
        >
            <div className="flex items-center justify-between relative z-10">
                <div>
                    <p className="caption-text font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</p>
                    <div className="flex items-baseline gap-2 mt-1.5">
                        <p className="display-lg text-[var(--text-primary)] number-font">{value}</p>
                        {trend !== undefined && (
                            <div className="flex flex-col">
                                <span className={`text-xs font-semibold ${getTrendColor()} number-font`}>
                                    {getTrendArrow()} {Math.abs(trend)}%
                                </span>
                                <span className="text-[10px] text-[var(--text-tertiary)] leading-none">vs last 7d</span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="w-9 h-9 rounded-lg bg-[var(--background-secondary)] flex items-center justify-center">
                    {icon}
                </div>
            </div>
            
            {progressValue !== undefined && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--background-secondary)] rounded-b-xl overflow-hidden">
                    <div 
                        className="h-full rounded-b-xl transition-all duration-700 ease-out" 
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
