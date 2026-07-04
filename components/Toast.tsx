import React, { useEffect, useState } from 'react';

export interface ToastMessage {
    id: string;
    type: 'success' | 'error' | 'info' | 'warning';
    message: string;
    duration?: number;
}

interface ToastProps {
    toast: ToastMessage;
    onDismiss: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
    const [isHovering, setIsHovering] = useState(false);
    const [progress, setProgress] = useState(100);

    useEffect(() => {
        const duration = toast.duration || 4000;
        if (isHovering) return;

        const startTime = Date.now();
        let animationFrameId: number;

        const updateProgress = () => {
            const elapsed = Date.now() - startTime;
            const newProgress = Math.max(0, 100 - (elapsed / duration) * 100);
            setProgress(newProgress);

            if (newProgress > 0) {
                animationFrameId = requestAnimationFrame(updateProgress);
            } else {
                onDismiss(toast.id);
            }
        };

        animationFrameId = requestAnimationFrame(updateProgress);
        return () => cancelAnimationFrame(animationFrameId);
    }, [toast, onDismiss, isHovering]);

    const iconColor = {
        success: 'text-[var(--success-color)]',
        error: 'text-[var(--danger-color)]',
        info: 'text-blue-500',
        warning: 'text-[var(--warning-color)]'
    }[toast.type];

    return (
        <div
            style={{
                animation: 'toast-slide-in 220ms ease-out',
                marginBottom: '12px'
            }}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            className={`bg-[var(--background-card)] text-[var(--text-primary)] border border-[var(--border-color)] elevation-5 px-4 py-3 rounded-xl relative overflow-hidden flex items-center`}
        >
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{toast.message}</p>
                <button
                    onClick={() => onDismiss(toast.id)}
                    className="text-xs opacity-70 hover:opacity-100 transition-opacity"
                >
                    ✕
                </button>
            </div>
            <div
                style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    height: '3px',
                    backgroundColor: 'currentColor',
                    opacity: 0.5,
                    width: `${progress}%`,
                    transition: isHovering ? 'none' : 'width 100ms linear'
                }}
            />
        </div>
    );
};

export default Toast;
