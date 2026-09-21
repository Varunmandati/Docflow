import React, { useState, useCallback, useRef } from 'react';
import { EyeIcon, ChevronUpIcon, ChevronDownIcon, CloseIcon, CheckCircleIcon, TrashIcon } from './Icons';

interface ImageOrderItem {
    file: File;
    id: string;
    preview: string;
}

interface ImageOrderManagerProps {
    files: File[];
    onOrderedFilesChange: (orderedFiles: File[]) => void;
    t: any; // Translation object
    isDragging?: boolean;
}

const ImageOrderManager: React.FC<ImageOrderManagerProps> = ({
    files,
    onOrderedFilesChange,
    t,
    isDragging: externalDragging,
}) => {
    const [items, setItems] = useState<ImageOrderItem[]>(
        files.map((file, index) => ({
            file,
            id: `${file.name}-${index}`,
            preview: URL.createObjectURL(file),
        }))
    );

    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [selectedPreview, setSelectedPreview] = useState<string | null>(null);
    const dragStartY = useRef<number>(0);

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>, index: number) => {
        setDraggedIndex(index);
        dragStartY.current = e.clientY;
    }, []);

    const handleMouseMove = useCallback(
        (e: React.MouseEvent<HTMLDivElement>, index: number) => {
            if (draggedIndex === null) return;

            const deltaY = e.clientY - dragStartY.current;
            const moveThreshold = 30;

            if (Math.abs(deltaY) > moveThreshold) {
                if (deltaY < 0 && index > 0 && draggedIndex === index) {
                    // Moving up
                    const newItems = [...items];
                    [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
                    setItems(newItems);
                    setDraggedIndex(index - 1);
                    dragStartY.current = e.clientY;
                } else if (deltaY > 0 && index < items.length - 1 && draggedIndex === index) {
                    // Moving down
                    const newItems = [...items];
                    [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
                    setItems(newItems);
                    setDraggedIndex(index + 1);
                    dragStartY.current = e.clientY;
                }
            }
        },
        [draggedIndex, items]
    );

    const handleMouseUp = useCallback(() => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    }, []);

    const handleMoveUp = (index: number) => {
        if (index === 0) return;
        const newItems = [...items];
        [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
        setItems(newItems);
    };

    const handleMoveDown = (index: number) => {
        if (index === items.length - 1) return;
        const newItems = [...items];
        [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
        setItems(newItems);
    };

    const handleRemove = (index: number) => {
        const newItems = items.filter((_, i) => i !== index);
        setItems(newItems);
    };

    const handleConfirm = () => {
        const orderedFiles = items.map((item) => item.file);
        onOrderedFilesChange(orderedFiles);
        // Don't clear previews - they're managed by React
    };

    return (
        <div className="w-full max-w-4xl mx-auto">
            {/* Title Section */}
            <div className="mb-6">
                <h3 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
                    📋 Arrange Image Order
                </h3>
                <p className="text-[var(--text-secondary)] text-sm">
                    Drag images up/down to reorder. Images will be combined in this order.
                </p>
            </div>

            {/* Grid Layout: Left side - Images, Right side - Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column - Image List */}
                <div className="lg:col-span-2 space-y-3 max-h-[600px] overflow-y-auto pr-2">
                    {items.length === 0 ? (
                        <div className="text-center py-8 text-[var(--text-secondary)]">
                            No images to arrange
                        </div>
                    ) : (
                        items.map((item, index) => (
                            <div
                                key={item.id}
                                onMouseDown={(e) => handleMouseDown(e, index)}
                                onMouseMove={(e) => handleMouseMove(e, index)}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                                className={`
                                    flex items-center gap-3 p-4 rounded-xl border transition-all cursor-grab active:cursor-grabbing bg-[var(--background-card)]
                                    ${
                                        draggedIndex === index
                                            ? 'border-[var(--primary-color)] bg-[var(--primary-highlight)] shadow-lg scale-105'
                                            : 'border-[var(--border-color)] hover:border-[var(--border-hover)]'
                                    }
                                `}
                            >
                                {/* Page Number Badge */}
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--primary-color)] text-[var(--primary-text)] font-bold flex items-center justify-center text-sm">
                                    {index + 1}
                                </div>

                                {/* File Info */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                                        {item.file.name}
                                    </p>
                                    <p className="text-xs text-[var(--text-secondary)]">
                                        {(item.file.size / 1024 / 1024).toFixed(2)} MB
                                    </p>
                                </div>

                                {/* Preview Button */}
                                <button
                                    onClick={() => setSelectedPreview(item.preview)}
                                    className="flex-shrink-0 px-3 py-1 text-xs font-medium bg-[var(--background-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)] rounded-lg hover:text-[var(--primary-color)] hover:border-[var(--primary-color)] transition-colors inline-flex items-center gap-1.5"
                                >
                                    <EyeIcon className="w-3.5 h-3.5" /> Preview
                                </button>

                                {/* Up/Down Controls */}
                                <div className="flex-shrink-0 flex gap-1">
                                    <button
                                        onClick={() => handleMoveUp(index)}
                                        disabled={index === 0}
                                        className="p-2 text-sm font-medium bg-[var(--background-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)] rounded-lg hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        title="Move up"
                                    >
                                        <ChevronUpIcon className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleMoveDown(index)}
                                        disabled={index === items.length - 1}
                                        className="p-2 text-sm font-medium bg-[var(--background-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)] rounded-lg hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        title="Move down"
                                    >
                                        <ChevronDownIcon className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Delete Button */}
                                <button
                                    onClick={() => handleRemove(index)}
                                    className="flex-shrink-0 p-2 text-sm font-medium bg-[var(--error-bg)] text-[var(--danger-color)] rounded-lg hover:opacity-80 transition-opacity"
                                    title="Remove image"
                                >
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {/* Right Column - Image Preview */}
                <div className="lg:col-span-1">
                    <div className="sticky top-4 rounded-xl border border-[var(--border-color)] bg-[var(--background-card)] p-4 elevation-1">
                        <p className="text-sm font-medium text-[var(--text-primary)] mb-3">Preview</p>
                        {selectedPreview ? (
                            <div className="space-y-3">
                                <img
                                    src={selectedPreview}
                                    alt="Preview"
                                    className="w-full h-auto rounded-lg border border-[var(--border-color)] object-cover"
                                />
                                <button
                                    onClick={() => setSelectedPreview(null)}
                                    className="w-full px-3 py-2 text-xs font-medium bg-[var(--background-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)] rounded-lg hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] transition-colors inline-flex items-center justify-center gap-1.5"
                                >
                                    <CloseIcon className="w-3.5 h-3.5" /> Close Preview
                                </button>
                            </div>
                        ) : (
                            <div className="aspect-square flex items-center justify-center bg-[var(--background-secondary)] rounded-lg border border-dashed border-[var(--border-color)]">
                                <p className="text-xs text-[var(--text-secondary)] text-center">
                                    Click "Preview" on any image to see it here
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-[var(--border-color)]">
                <div className="text-sm text-[var(--text-secondary)]">
                    {items.length} image{items.length !== 1 ? 's' : ''}
                </div>
                <button
                    onClick={handleConfirm}
                    disabled={items.length === 0}
                    className="primary-btn px-6 py-2.5 font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                    <CheckCircleIcon className="w-4 h-4" /> Confirm & Combine to PDF
                </button>
            </div>
        </div>
    );
};

export default ImageOrderManager;
