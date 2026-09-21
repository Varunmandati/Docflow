import React, { useState, useCallback, useRef } from 'react';
import { UploadIcon } from './Icons';
import { QuickConvertTranslation, DropzoneTranslation } from '../translations';

interface FileDropzoneProps {
    onFilesAdded: (files: File[]) => void;
    isQuickConvert?: boolean;
    t?: QuickConvertTranslation | DropzoneTranslation;
    accept?: string;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({ onFilesAdded, isQuickConvert = false, t, accept }) => {
    // Default translations
    const defaultQuickConvert: QuickConvertTranslation = {
        title: 'Quick Convert',
        dropText: 'Drop your files here',
        supportText: 'Supports PDF, TIFF, PNG, JPEG/JPG, and more'
    };
    const defaultDropzone: DropzoneTranslation = {
        title: 'Convert & Merge Files Instantly',
        subtitle: 'Secure, fast, and entirely in-browser.',
        dragText: 'Drag & drop files here',
        browseText: 'click to browse',
        supportText: 'Supports PDF, TIFF, JPEG/JPG, PNG, and BMP files'
    };
    const finalT = t || (isQuickConvert ? defaultQuickConvert : defaultDropzone);
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    
    const defaultAccept = ".pdf,application/pdf,.tif,.tiff,image/tiff,.jpg,.jpeg,image/jpeg,.png,image/png,.bmp,image/bmp,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.odp,.ods,.rtf,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.ms-powerpoint,application/vnd.ms-excel,text/plain";

    const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files && files.length > 0) {
            onFilesAdded(files);
        }
    }, [onFilesAdded]);
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
         if (files && files.length > 0) {
            onFilesAdded(files);
        }
    };
    
    const onButtonClick = () => {
        inputRef.current?.click();
    };

    if (isQuickConvert) {
        const quickConvertT = finalT as QuickConvertTranslation;
        return (
            <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={onButtonClick}
                className={`relative w-full p-8 sm:p-10 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 ease-out ${
                    isDragging 
                    ? 'border-[var(--primary-color)] bg-[var(--primary-highlight)] scale-[1.02]' 
                    : 'border-[var(--border-color)] bg-[var(--background-card)] hover:border-[var(--primary-color)] hover:bg-[var(--hover)]'
                }`}
            >
                <input ref={inputRef} type="file" multiple accept={accept || defaultAccept} onChange={handleFileChange} className="hidden" />
                <div className={`flex flex-col items-center justify-center gap-2 text-center transition-transform duration-200 ${isDragging ? 'scale-105' : 'scale-100'}`}>
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 transition-colors duration-200 ${isDragging ? 'bg-[var(--primary-color)]/20' : 'bg-[var(--background-secondary)]'}`}>
                        <UploadIcon className={`w-6 h-6 transition-colors duration-200 ${isDragging ? 'text-[var(--primary-color)]' : 'text-[var(--text-tertiary)]'}`}/>
                    </div>
                    <p className={`body-lg font-medium transition-colors duration-200 ${isDragging ? 'text-[var(--primary-color)]' : 'text-[var(--text-primary)]'}`}>
                        {isDragging ? 'Drop to start' : quickConvertT.dropText}
                    </p>
                    <p className="caption-text" style={{ color: 'var(--text-tertiary)' }}>{quickConvertT.supportText}</p>
                </div>
            </div>
        );
    }

    const dropzoneT = finalT as DropzoneTranslation;
    return (
        <div className="flex flex-col items-center justify-center text-center w-full">
            <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={onButtonClick}
                className={`relative w-full max-w-2xl min-h-[200px] flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden group ${
                    isDragging 
                    ? 'border-[var(--primary-color)] bg-[var(--primary-highlight)] scale-[1.02]' 
                    : 'border-[var(--border-color)] hover:border-[var(--primary-color)] bg-[var(--background-card)] hover:bg-[var(--hover)]'
                }`}
            >
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept={accept || defaultAccept}
                    onChange={handleFileChange}
                    className="hidden"
                />
                <div className={`flex flex-col items-center justify-center gap-3 transition-transform duration-300 relative z-10 ${isDragging ? 'scale-105' : 'scale-100'}`}>
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ${isDragging ? 'bg-[var(--primary-color)]/20 text-[var(--primary-color)]' : 'bg-[var(--well)] text-[var(--text-secondary)] group-hover:text-[var(--primary-color)]'}`}>
                        <UploadIcon className="w-6 h-6"/>
                    </div>
                    <p className={`display-sm transition-colors duration-200 ${isDragging ? 'text-[var(--primary-color)]' : 'text-[var(--text-primary)]'}`}>
                        {isDragging ? 'Drop them here' : dropzoneT.dragText}
                    </p>
                    <p className="caption-text" style={{ color: 'var(--text-tertiary)' }}>
                        {dropzoneT.subtitle}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                        {['PDF', 'PNG', 'JPG', 'DOCX'].map(ext => (
                            <span key={ext} className="meta-chip">
                                {ext}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
            
            {/* Trust Indicators */}
            <div className="w-full max-w-2xl mt-8" style={{fontSize: '12px', color: 'var(--text-ghost)', textAlign: 'center'}}>
                Files are processed in-browser and deleted automatically.
            </div>
        </div>
    );
};

export default FileDropzone;