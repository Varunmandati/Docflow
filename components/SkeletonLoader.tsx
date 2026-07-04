import React from 'react';

interface SkeletonLoaderProps {
  width?: string;
  height?: string;
  count?: number;
  circle?: boolean;
  className?: string;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  width = 'w-full',
  height = 'h-4',
  count = 1,
  circle = false,
  className = '',
}) => {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`${width} ${height} ${
            circle ? 'rounded-full' : 'rounded-lg'
          } bg-gradient-to-r from-[var(--background-card)] via-black/5 dark:via-white/10 to-[var(--background-card)] animate-pulse`}
        />
      ))}
    </div>
  );
};

export const SkeletonCard: React.FC = () => {
  return (
    <div className="rounded-xl border border-[var(--border-color)] p-4 space-y-4">
      <SkeletonLoader width="w-1/3" height="h-6" className="mb-4" />
      <SkeletonLoader height="h-4" count={3} />
      <SkeletonLoader width="w-2/3" height="h-4" />
    </div>
  );
};

export const SkeletonStats: React.FC = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-xl border border-[var(--border-color)] p-4">
          <SkeletonLoader width="w-2/3" height="h-4" className="mb-4" />
          <SkeletonLoader width="w-1/2" height="h-8" />
        </div>
      ))}
    </div>
  );
};

export default SkeletonLoader;
