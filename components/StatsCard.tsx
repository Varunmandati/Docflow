import React from 'react';

interface StatsCardProps {
    title: string;
    value: string | number;
    icon: React.ReactNode;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon }) => {
    return (
        <div className={`relative p-5 rounded-2xl transition-all duration-300 bg-[var(--background-card)] dark:bg-[var(--background-card)]/40 backdrop-blur-md`}>
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-[var(--text-secondary)]">{title}</p>
                    <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">{value}</p>
                </div>
                <div className="w-10 h-10 flex items-center justify-center">
                    {icon}
                </div>
            </div>
            <div className="absolute bottom-4 left-5 right-5 h-px bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent"></div>
        </div>
    );
};

export default StatsCard;