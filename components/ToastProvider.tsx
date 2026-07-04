import React, { useState, useCallback, createContext, ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { CheckCircleIcon, ExclamationCircleIcon, CloseIcon } from './Icons';

type ToastType = 'success' | 'error';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    addToast: (message: string, type: ToastType) => void;
}

export const ToastContext = createContext<ToastContextType | undefined>(undefined);

const Toast: React.FC<{ toast: Toast, onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
    React.useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss(toast.id);
        }, 5000);

        return () => {
            clearTimeout(timer);
        };
    }, [toast.id, onDismiss]);

    const icons = {
        success: <CheckCircleIcon className="w-6 h-6 text-[var(--success-color)]" />,
        error: <ExclamationCircleIcon className="w-6 h-6 text-[var(--danger-color)]" />,
    };

    return (
        <div 
            className="flex items-start p-4 mb-4 w-full max-w-sm rounded-lg shadow-2xl animate-in slide-in-from-right-8 fade-in duration-300 bg-[var(--background-card)] border border-[var(--border-color)] overflow-hidden"
            role="alert"
        >
            <div className="flex-shrink-0">{icons[toast.type]}</div>
            <div className="ml-3 w-0 flex-1 pt-0.5">
                <p className="text-sm font-medium text-[var(--text-primary)]">{toast.message}</p>
            </div>
            <div className="ml-4 flex-shrink-0 flex">
                <button
                    onClick={() => onDismiss(toast.id)}
                    className="inline-flex rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--primary-color)]"
                >
                    <span className="sr-only">Close</span>
                    <CloseIcon className="h-5 w-5" />
                </button>
            </div>
        </div>
    );
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastRoot = document.getElementById('toast-root');

    const addToast = useCallback((message: string, type: ToastType) => {
        setToasts(prevToasts => {
            const newToasts = [...prevToasts, { id: Date.now(), message, type }];
            return newToasts.slice(-3);
        });
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
    }, []);

    if (!toastRoot) return <>{children}</>;

    const toastMarkup = (
        <div className="fixed bottom-0 right-0 z-50 p-4 sm:p-6 w-full sm:max-w-md">
            {toasts.map(toast => (
                <Toast key={toast.id} toast={toast} onDismiss={removeToast} />
            ))}
        </div>
    );

    return (
        <ToastContext.Provider value={{ addToast }}>
            {children}
            {ReactDOM.createPortal(toastMarkup, toastRoot)}
        </ToastContext.Provider>
    );
};
