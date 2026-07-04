import React, { useState, useCallback, useRef } from 'react';

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
                                    flex items-center gap-3 p-4 rounded-lg border-2 transition-all cursor-grab active:cursor-grabbing
                                    ${
                                        draggedIndex === index
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-lg scale-105'
                                            : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 bg-white dark:bg-gray-800/50'
                                    }
                                `}
                            >
                                {/* Page Number Badge */}
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white font-bold flex items-center justify-center text-sm">
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
                                    className="flex-shrink-0 px-3 py-1 text-xs font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900 transition-colors"
                                >
                                    👁️ Preview
                                </button>

                                {/* Up/Down Controls */}
                                <div className="flex-shrink-0 flex gap-1">
                                    <button
                                        onClick={() => handleMoveUp(index)}
                                        disabled={index === 0}
                                        className="p-2 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        title="Move up"
                                    >
                                        ⬆️
                                    </button>
                                    <button
                                        onClick={() => handleMoveDown(index)}
                                        disabled={index === items.length - 1}
                                        className="p-2 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        title="Move down"
                                    >
                                        ⬇️
                                    </button>
                                </div>

                                {/* Delete Button */}
                                <button
                                    onClick={() => handleRemove(index)}
                                    className="flex-shrink-0 p-2 text-sm font-medium bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900 transition-colors"
                                    title="Remove image"
                                >
                                    ✕
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {/* Right Column - Image Preview */}
                <div className="lg:col-span-1">
                    <div className="sticky top-4 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800/50 p-4">
                        <p className="text-sm font-medium text-[var(--text-primary)] mb-3">Preview</p>
                        {selectedPreview ? (
                            <div className="space-y-3">
                                <img
                                    src={selectedPreview}
                                    alt="Preview"
                                    className="w-full h-auto rounded-lg border border-gray-300 dark:border-gray-600 object-cover"
                                />
                                <button
                                    onClick={() => setSelectedPreview(null)}
                                    className="w-full px-3 py-2 text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                                >
                                    Close Preview
                                </button>
                            </div>
                        ) : (
                            <div className="aspect-square flex items-center justify-center bg-gray-100 dark:bg-gray-900/50 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                                <p className="text-xs text-[var(--text-secondary)] text-center">
                                    Click "Preview" on any image to see it here
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-gray-300 dark:border-gray-600">
                <div className="text-sm text-[var(--text-secondary)]">
                    {items.length} image{items.length !== 1 ? 's' : ''}
                </div>
                <button
                    onClick={handleConfirm}
                    disabled={items.length === 0}
                    className="px-6 py-2 font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all"
                >
                    ✓ Confirm & Combine to PDF
                </button>
            </div>
        </div>
    );
};

export default ImageOrderManager;
