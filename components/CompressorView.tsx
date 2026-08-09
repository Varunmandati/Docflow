import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useToast } from '../hooks/useToast';
import { CompressFile } from '../types';
import FileDropzone from './FileDropzone';
import ProgressBar from './ProgressBar';
import { CompressorTranslation } from '../translations';
import { CheckIcon, CloseIcon, CompressIcon, DownloadIcon, FileIcon, FolderZipIcon, PlusIcon, SpinnerIcon, TrashIcon, UploadIcon } from './Icons';
import { TrustBadges, TrustMessage } from './TrustBadges';
import { authFetch } from '../services/authFetch';

declare const JSZip: any;

interface CompressorViewProps {
    initialFiles: File[];
    t: CompressorTranslation;
}

interface CompressionBreakdown {
    images: number;
    text: number;
    vector: number;
    metadata: number;
    other: number;
}

interface CompressionInsight {
    fileName: string;
    detectedType: string;
    originalSize: number;
    compressedSize: number;
    savingsPercent: number;
    breakdownBytes?: CompressionBreakdown;
    suggestions: string[];
    recommendedPreset?: string;
    appliedPreset?: string;
    qualityUsed?: number;
}

interface CompressionRunResult {
    zipUrl?: string;
    files?: { name: string; url: string; size: number }[];
    originalSize: number;
    compressedSize: number;
    analyses?: CompressionInsight[];
}

const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const formatPresetLabel = (preset?: string) => {
    if (!preset) return 'Optimize';
    return preset.charAt(0).toUpperCase() + preset.slice(1);
};

const formatDetectedType = (detectedType: string) => {
    if (!detectedType) return 'Other';
    return detectedType.charAt(0).toUpperCase() + detectedType.slice(1);
};

// A debounced function to avoid excessive re-renders and calculations
const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<F>): Promise<Awaited<ReturnType<F>>> =>
        new Promise(resolve => {
            if (timeout) {
                clearTimeout(timeout);
            }
            timeout = setTimeout(() => resolve(func(...args)), waitFor);
        });
};

const getFileType = (file: File): 'image' | 'pdf' | 'docx' | 'pptx' | 'other' => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type === 'application/pdf') return 'pdf';
    if (file.name.toLowerCase().endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (file.name.toLowerCase().endsWith('.pptx') || file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
    return 'other';
};

const CompressorView: React.FC<CompressorViewProps> = ({ initialFiles, t }) => {
    const [files, setFiles] = useState<CompressFile[]>([]);
    const [isCompressing, setIsCompressing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState('');
    const [globalQuality, setGlobalQuality] = useState(75);
    const [result, setResult] = useState<CompressionRunResult | null>(null);
    const { addToast } = useToast();
    const addFilesInputRef = useRef<HTMLInputElement>(null);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const dragCounter = useRef(0);

    const [compressionMode, setCompressionMode] = useState<'quality' | 'percentage' | 'target'>('quality');
    const [targetPercentage, setTargetPercentage] = useState<number>(50);
    const [targetSizeValue, setTargetSizeValue] = useState<number>(1);
    const [targetSizeUnit, setTargetSizeUnit] = useState<'KB' | 'MB'>('MB');
    const [isCalculatingTarget, setIsCalculatingTarget] = useState(false);
    const [outputMode, setOutputMode] = useState<'zip' | 'individual'>('zip');
    const [mergePdfPages, setMergePdfPages] = useState<boolean>(true);

    const getConversionApiBase = (): string => {
        const raw = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080').trim();
        if (!raw) return 'http://localhost:8080';
        return raw.replace(/\/api\/?$/, '');
    };

    const buildApiUrl = (base: string, route: string): string => {
        if (route.startsWith('http://') || route.startsWith('https://')) return route;
        return `${base}${route.startsWith('/') ? route : `/${route}`}`;
    };

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const resolveTargetTotalBytes = useCallback((
        mode: 'quality' | 'percentage' | 'target',
        totalOriginalSize: number,
        percentage: number,
        sizeValue: number,
        sizeUnit: 'KB' | 'MB'
    ): number | null => {
        if (mode === 'quality') return null;
        if (mode === 'percentage') return totalOriginalSize * (1 - percentage / 100);

        const bytes = sizeValue * (sizeUnit === 'MB' ? 1024 * 1024 : 1024);
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return null;
        }
        return bytes;
    }, []);

    const shouldUseBackendCompression = (file: CompressFile) => {
        const lower = file.file.name.toLowerCase();
        return (
            file.type === 'docx' ||
            file.type === 'pptx' ||
            file.type === 'pdf' ||
            lower.endsWith('.zip') ||
            lower.endsWith('.rar')
        );
    };

    const backendCompressSingle = async (compressFile: CompressFile, targetTotalBytesForRun: number | null): Promise<{ name: string; url: string; size: number; originalSize: number; analysis?: CompressionInsight }> => {
        const apiBase = getConversionApiBase();

        const uploadForm = new FormData();
        uploadForm.append('file', compressFile.file, compressFile.file.name);

        const uploadResponse = await authFetch(buildApiUrl(apiBase, '/v1/files/upload'), {
            method: 'POST',
            body: uploadForm,
        });
        if (!uploadResponse.ok) {
            throw new Error(`Upload failed for ${compressFile.file.name}`);
        }

        const uploadPayload = await uploadResponse.json();
        const fileId = uploadPayload.fileId as string;
        if (!fileId) throw new Error('Backend upload did not return fileId');

        // Calculate target bytes for this file if in target/percentage mode
        let fileTargetBytes: number | undefined;
        if (
            (compressionMode === 'target' || compressionMode === 'percentage') &&
            targetTotalBytesForRun &&
            Number.isFinite(targetTotalBytesForRun) &&
            targetTotalBytesForRun > 0
        ) {
            fileTargetBytes = Math.max(1, Math.floor(targetTotalBytesForRun));
        }

        const compressResponse = await authFetch(buildApiUrl(apiBase, '/v1/compress'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fileId,
                options: {
                    quality: compressFile.quality,
                    targetBytes: fileTargetBytes,
                    preset:
                        compressionMode === 'quality'
                            ? 'optimize'
                            : compressionMode === 'percentage'
                                ? 'web'
                                : 'email',
                    lockQuality: compressionMode === 'quality',
                },
            }),
        });
        if (!compressResponse.ok) {
            throw new Error(`Compression request failed for ${compressFile.file.name}`);
        }

        const compressPayload = await compressResponse.json();
        const jobId = compressPayload.jobId as string;
        if (!jobId) throw new Error('Backend compress endpoint did not return jobId');

        let done = false;
        while (!done) {
            const statusResponse = await authFetch(buildApiUrl(apiBase, `/v1/jobs/${jobId}`));
            if (!statusResponse.ok) {
                throw new Error(`Status request failed for ${compressFile.file.name}`);
            }
            const statusPayload = await statusResponse.json();

            if (statusPayload.status === 'failed') {
                throw new Error(statusPayload.error || `Compression failed for ${compressFile.file.name}`);
            }

            if (statusPayload.message) {
                setStatusMessage(statusPayload.message);
            }

            if (statusPayload.status === 'completed') {
                done = true;
                break;
            }

            await sleep(1200);
        }

        const resultResponse = await authFetch(buildApiUrl(apiBase, `/v1/jobs/${jobId}/result`));
        if (!resultResponse.ok) {
            throw new Error(`Result request failed for ${compressFile.file.name}`);
        }
        const resultPayload = await resultResponse.json();
        const output = resultPayload?.outputs?.primary;
        const analysis = resultPayload?.analysis;
        if (!output?.downloadUrl) {
            throw new Error(`Compressed output missing for ${compressFile.file.name}`);
        }

        const response = await authFetch(buildApiUrl(apiBase, output.downloadUrl));
        if (!response.ok) {
            throw new Error(`Failed to fetch compressed output for ${compressFile.file.name}`);
        }
        const blob = await response.blob();
        const name = compressFile.file.name.replace(/\.[^/.]+$/, '') + '_compressed' + (compressFile.file.name.match(/\.[^/.]+$/)?.[0] || '');

        const insight: CompressionInsight | undefined = analysis
            ? {
                fileName: compressFile.file.name,
                detectedType: analysis.detectedType || 'other',
                originalSize: Number(analysis.originalSize ?? compressFile.originalSize),
                compressedSize: Number(analysis.compressedSize ?? blob.size),
                savingsPercent: Number(analysis.savingsPercent ?? 0),
                breakdownBytes: analysis.breakdownBytes
                    ? {
                        images: Number(analysis.breakdownBytes.images ?? 0),
                        text: Number(analysis.breakdownBytes.text ?? 0),
                        vector: Number(analysis.breakdownBytes.vector ?? 0),
                        metadata: Number(analysis.breakdownBytes.metadata ?? 0),
                        other: Number(analysis.breakdownBytes.other ?? 0),
                    }
                    : undefined,
                suggestions: Array.isArray(analysis.suggestions) ? analysis.suggestions : [],
                recommendedPreset: analysis.recommendedPreset,
                appliedPreset: analysis.appliedPreset,
                qualityUsed: analysis.qualityUsed,
            }
            : undefined;

        return {
            name,
            url: URL.createObjectURL(blob),
            size: blob.size,
            originalSize: compressFile.originalSize,
            analysis: insight,
        };
    };

    const compressOfficeDocument = async (file: File | Blob, quality: number): Promise<Blob> => {
        try {
            const zip = new JSZip();
            const loadedZip = await zip.loadAsync(file);
            const newZip = new JSZip();
            
            const promises: Promise<void>[] = [];
            
            loadedZip.forEach((relativePath: string, zipEntry: any) => {
                promises.push((async () => {
                    if (zipEntry.dir) return;
                    
                    const isImage = relativePath.match(/\.(jpeg|jpg|png)$/i);
                    // Only compress images in word/media or ppt/media
                    const isMedia = relativePath.startsWith('word/media/') || relativePath.startsWith('ppt/media/');
                    
                    if (isImage && isMedia) {
                        const imgData = await zipEntry.async('blob');
                        const compressedBlob = await new Promise<Blob | null>(resolve => {
                            const img = new Image();
                            img.onload = () => {
                                const canvas = document.createElement('canvas');
                                canvas.width = img.width;
                                canvas.height = img.height;
                                canvas.getContext('2d')?.drawImage(img, 0, 0);
                                canvas.toBlob(resolve, 'image/jpeg', quality / 100);
                            };
                            img.src = URL.createObjectURL(imgData);
                        });
                        
                        if (compressedBlob && compressedBlob.size < imgData.size) {
                            newZip.file(relativePath, compressedBlob);
                        } else {
                            newZip.file(relativePath, await zipEntry.async('arraybuffer'));
                        }
                    } else {
                        newZip.file(relativePath, await zipEntry.async('arraybuffer'));
                    }
                })());
            });
            
            await Promise.all(promises);
            return await newZip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        } catch (error) {
            console.error("Error compressing office document:", error);
            return file;
        }
    };

    const compressImageBlob = useCallback(async (
        file: File,
        quality: number,
        previewUrl?: string,
        scale = 1,
    ): Promise<{ blob: Blob | null; extension: string }> => {
        const lowerName = file.name.toLowerCase();
        const mime = (file.type || '').toLowerCase();

        let outputMime = 'image/jpeg';
        let outputExtension = 'jpg';
        let outputQuality: number | undefined = Math.max(0, Math.min(1, quality / 100));

        if (mime === 'image/png' || lowerName.endsWith('.png')) {
            outputMime = 'image/png';
            outputExtension = 'png';
            outputQuality = undefined;
        } else if (mime === 'image/webp' || lowerName.endsWith('.webp')) {
            outputMime = 'image/webp';
            outputExtension = 'webp';
        } else if (
            mime === 'image/jpeg' ||
            mime === 'image/jpg' ||
            lowerName.endsWith('.jpg') ||
            lowerName.endsWith('.jpeg')
        ) {
            outputMime = 'image/jpeg';
            outputExtension = 'jpg';
        }

        return new Promise((resolve) => {
            const img = new Image();
            const objectUrl = previewUrl || URL.createObjectURL(file);
            const shouldRevoke = !previewUrl;

            img.onload = () => {
                const canvas = document.createElement('canvas');
                const safeScale = Math.max(0.1, Math.min(1, scale));
                canvas.width = Math.max(1, Math.round(img.width * safeScale));
                canvas.height = Math.max(1, Math.round(img.height * safeScale));
                canvas.getContext('2d')?.drawImage(img, 0, 0);

                canvas.toBlob(
                    (blob) => {
                        if (shouldRevoke) {
                            URL.revokeObjectURL(objectUrl);
                        }
                        resolve({ blob, extension: outputExtension });
                    },
                    outputMime,
                    outputQuality
                );
            };

            img.onerror = () => {
                if (shouldRevoke) {
                    URL.revokeObjectURL(objectUrl);
                }
                resolve({ blob: null, extension: outputExtension });
            };

            img.src = objectUrl;
        });
    }, []);

    const compressImageToTarget = useCallback(async (
        file: File,
        targetBytes: number,
        previewUrl?: string,
    ): Promise<{ blob: Blob | null; extension: string; qualityUsed: number; scaleUsed: number; size: number }> => {
        const normalizedTarget = Math.max(1, Math.floor(targetBytes));
        let bestUnder: { blob: Blob | null; extension: string; qualityUsed: number; scaleUsed: number; size: number } | null = null;
        let smallestOver: { blob: Blob | null; extension: string; qualityUsed: number; scaleUsed: number; size: number } | null = null;

        const evaluateAtScale = async (scale: number) => {
            let low = 1;
            let high = 100;

            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const out = await compressImageBlob(file, mid, previewUrl, scale);
                const size = out.blob?.size || 0;
                const candidate = {
                    blob: out.blob,
                    extension: out.extension,
                    qualityUsed: mid,
                    scaleUsed: scale,
                    size,
                };

                if (size <= normalizedTarget && size > 0) {
                    if (
                        !bestUnder ||
                        candidate.qualityUsed > bestUnder.qualityUsed ||
                        (candidate.qualityUsed === bestUnder.qualityUsed && candidate.size > bestUnder.size)
                    ) {
                        bestUnder = candidate;
                    }
                    low = mid + 1;
                } else {
                    if (!smallestOver || (size > 0 && size < smallestOver.size)) {
                        smallestOver = candidate;
                    }
                    high = mid - 1;
                }
            }
        };

        let scale = 1;
        for (let i = 0; i < 8; i++) {
            await evaluateAtScale(scale);
            if (bestUnder) {
                break;
            }
            scale = Math.max(0.35, scale * 0.9);
        }

        const picked = bestUnder || smallestOver || { blob: null, extension: 'jpg', qualityUsed: 1, scaleUsed: 1, size: 0 };
        return picked;
    }, [compressImageBlob]);

    const estimateImageSize = useCallback(async (file: File, quality: number, previewUrl: string): Promise<number> => {
        const { blob } = await compressImageBlob(file, quality, previewUrl);
        return blob?.size || 0;
    }, [compressImageBlob]);

    const estimateFileSize = useCallback(async (file: CompressFile, quality: number): Promise<number> => {
        if (file.type === 'image' && file.previewUrl) {
            return await estimateImageSize(file.file, quality, file.previewUrl);
        } else if (file.type === 'docx' || file.type === 'pptx') {
            const compressedBlob = await compressOfficeDocument(file.file, quality);
            return compressedBlob.size;
        }
        return file.originalSize;
    }, [estimateImageSize]);

    const debouncedEstimate = useCallback(debounce(estimateFileSize, 300), [estimateFileSize]);

    const findOptimalQuality = async (file: CompressFile, targetSizeInBytes: number): Promise<number> => {
        let low = 1;
        let high = 100;
        let bestQuality = 75;
        let closestDiff = Infinity;

        for (let i = 0; i < 6; i++) {
            const mid = Math.floor((low + high) / 2);
            const size = await estimateFileSize(file, mid);
            
            const diff = Math.abs(size - targetSizeInBytes);
            if (diff < closestDiff) {
                closestDiff = diff;
                bestQuality = mid;
            }

            if (size > targetSizeInBytes) {
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        return bestQuality;
    };

    const applyTargetCompression = useCallback(async (overrides?: {
        mode?: 'quality' | 'percentage' | 'target';
        percentage?: number;
        sizeValue?: number;
        sizeUnit?: 'KB' | 'MB';
    }) => {
        const mode = overrides?.mode ?? compressionMode;
        const percentage = overrides?.percentage ?? targetPercentage;
        const sizeValue = overrides?.sizeValue ?? targetSizeValue;
        const sizeUnit = overrides?.sizeUnit ?? targetSizeUnit;

        if (mode === 'quality') {
            return;
        }

        setIsCalculatingTarget(true);

        try {
            const compressibleFiles = files.filter(f => f.type === 'image' || f.type === 'docx' || f.type === 'pptx');
            if (compressibleFiles.length === 0) {
                return;
            }

            const totalOriginalSize = compressibleFiles.reduce((acc, f) => acc + f.originalSize, 0);
            if (totalOriginalSize <= 0) {
                return;
            }

            const targetTotalBytes = resolveTargetTotalBytes(mode, totalOriginalSize, percentage, sizeValue, sizeUnit);

            if (!targetTotalBytes || !Number.isFinite(targetTotalBytes) || targetTotalBytes <= 0) {
                return;
            }

            setFiles(prev => prev.map(f => (
                f.type === 'image' || f.type === 'docx' || f.type === 'pptx'
                    ? { ...f, isProcessing: true }
                    : f
            )));

            const nextById = new Map<string, { quality: number; compressedSize: number }>();

            for (const file of compressibleFiles) {
                const proportion = file.originalSize / totalOriginalSize;
                const fileTarget = Math.max(1, Math.floor(targetTotalBytes * proportion));

                if (file.type === 'image') {
                    const targeted = await compressImageToTarget(file.file, fileTarget, file.previewUrl);
                    nextById.set(file.id, {
                        quality: targeted.qualityUsed,
                        compressedSize: targeted.size,
                    });
                } else {
                    const optimalQuality = await findOptimalQuality(file, fileTarget);
                    const newSize = await estimateFileSize(file, optimalQuality);
                    nextById.set(file.id, {
                        quality: optimalQuality,
                        compressedSize: newSize,
                    });
                }
            }

            setFiles(prev => prev.map(f => {
                const next = nextById.get(f.id);
                if (!next) return f;
                return {
                    ...f,
                    quality: next.quality,
                    compressedSize: next.compressedSize,
                    isProcessing: false,
                };
            }));
        } finally {
            setIsCalculatingTarget(false);
        }
    }, [compressionMode, targetPercentage, targetSizeValue, targetSizeUnit, files, resolveTargetTotalBytes, compressImageToTarget, findOptimalQuality, estimateFileSize]);

    const handleFileQualityChange = (id: string, quality: number) => {
        let fileToUpdate: CompressFile | undefined;
        setFiles(prev => {
            const newFiles = prev.map(f => {
                if (f.id === id) {
                    const updated = { ...f, quality, isProcessing: true };
                    fileToUpdate = updated;
                    return updated;
                }
                return f;
            });
            
            if (fileToUpdate && (fileToUpdate.type === 'image' || fileToUpdate.type === 'docx' || fileToUpdate.type === 'pptx')) {
                debouncedEstimate(fileToUpdate, quality).then(size => {
                    setFiles(currentFiles =>
                        currentFiles.map(cf =>
                            cf.id === id ? { ...cf, compressedSize: size, isProcessing: false } : cf
                        )
                    );
                });
            } else if (fileToUpdate) {
                // For other files, just turn off processing
                setFiles(currentFiles =>
                    currentFiles.map(cf =>
                        cf.id === id ? { ...cf, isProcessing: false } : cf
                    )
                );
            }
            return newFiles;
        });
    };

    const processAndAddFiles = useCallback(async (newFiles: File[]) => {
        const newCompressFiles: CompressFile[] = [];
        
        for (const file of newFiles) {
            const type = getFileType(file);
            const baseId = `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).substr(2, 9)}`;
            
            if (type === 'pdf') {
                // Keep the raw PDF as a single unit so shouldUseBackendCompression()
                // routes it to /v1/compress, where Ghostscript (installed in the
                // backend Docker image) downscales embedded images WITHOUT turning
                // pages into JPEGs and destroying the selectable text layer.
                newCompressFiles.push({
                    id: baseId,
                    file,
                    type: 'pdf',
                    quality: globalQuality,
                    isProcessing: false,
                    originalSize: file.size,
                    detectedType: 'PDF Document'
                });
            } else if (type === 'docx' || type === 'pptx') {
                try {
                    const zip = new JSZip();
                    const loadedZip = await zip.loadAsync(file);
                    let imageCount = 0;
                    
                    const imageEntries: any[] = [];
                    loadedZip.forEach((relativePath: string, zipEntry: any) => {
                        if (!zipEntry.dir && relativePath.match(/\.(jpeg|jpg|png)$/i) && (relativePath.startsWith('word/media/') || relativePath.startsWith('ppt/media/'))) {
                            imageEntries.push({ relativePath, zipEntry });
                        }
                    });
                    
                    if (imageEntries.length > 0) {
                        for (const { relativePath, zipEntry } of imageEntries) {
                            imageCount++;
                            const imgData = await zipEntry.async('blob');
                            const pageFile = new File([imgData], `${file.name.replace(/\.[^/.]+$/, "")}_asset_${imageCount}.jpg`, { type: imgData.type });
                            const previewUrl = URL.createObjectURL(imgData);
                            
                            newCompressFiles.push({
                                id: `${baseId}-asset-${imageCount}`,
                                file: pageFile,
                                type: 'image', // Treat as image for compression
                                quality: globalQuality,
                                isProcessing: true,
                                originalSize: imgData.size,
                                previewUrl,
                                isPdfPage: true, // Reuse this flag to indicate it's part of a document
                                originalPdfId: baseId,
                                originalPdfName: file.name,
                                pageNumber: imageCount,
                                originalFile: file,
                                relativePath: relativePath,
                                detectedType: 'Embedded Image'
                            });
                        }
                    } else {
                        // No images found, just add the file itself
                        newCompressFiles.push({
                            id: baseId,
                            file,
                            type,
                            quality: globalQuality,
                            isProcessing: false,
                            originalSize: file.size,
                            detectedType: 'Text Document'
                        });
                    }
                } catch (error) {
                    console.error(`Error processing ${type.toUpperCase()}:`, error);
                    addToast(`Failed to process ${type.toUpperCase()}: ${file.name}`, 'error');
                }
            } else {
                newCompressFiles.push({
                    id: baseId,
                    file,
                    type,
                    quality: globalQuality,
                    isProcessing: false,
                    originalSize: file.size,
                    detectedType: type === 'image' ? 'Image' : 'Other'
                });
            }
        }

        setFiles(prev => [...prev, ...newCompressFiles]);

        // Generate previews and initial estimates
        for (const cf of newCompressFiles) {
            if (cf.type === 'image' && !cf.isPdfPage) {
                const previewUrl = URL.createObjectURL(cf.file);
                setFiles(prev => prev.map(f => f.id === cf.id ? { ...f, previewUrl, isProcessing: true } : f));
                const estimatedSize = await estimateImageSize(cf.file, cf.quality, previewUrl);
                setFiles(prev => prev.map(f => f.id === cf.id ? { ...f, compressedSize: estimatedSize, isProcessing: false } : f));
            } else if (cf.isPdfPage && cf.previewUrl) {
                setFiles(prev => prev.map(f => f.id === cf.id ? { ...f, isProcessing: true } : f));
                const estimatedSize = await estimateImageSize(cf.file, cf.quality, cf.previewUrl);
                setFiles(prev => prev.map(f => f.id === cf.id ? { ...f, compressedSize: estimatedSize, isProcessing: false } : f));
            } else if (cf.type === 'docx' || cf.type === 'pptx') {
                setFiles(prev => prev.map(f => f.id === cf.id ? { ...f, isProcessing: true } : f));
                const compressedBlob = await compressOfficeDocument(cf.file, cf.quality);
                setFiles(prev => prev.map(f => f.id === cf.id ? { ...f, compressedSize: compressedBlob.size, isProcessing: false } : f));
            } else if (cf.type === 'other') {
                // For other files, we might not be able to compress them effectively client-side.
                // Just set compressed size to original size for now.
                setFiles(prev => prev.map(f => f.id === cf.id ? { ...f, compressedSize: cf.originalSize } : f));
            }
        }
    }, [globalQuality, estimateImageSize, addToast]);
    
    useEffect(() => {
        if (initialFiles.length > 0) processAndAddFiles(initialFiles);
    }, [initialFiles, processAndAddFiles]);
    
    const handleGlobalQualityChange = (quality: number) => {
        setGlobalQuality(quality);
        setFiles(prev => {
            const newFiles = prev.map(f => {
                if (f.type === 'image' || f.type === 'docx' || f.type === 'pptx') {
                    return { ...f, quality, isProcessing: true };
                }
                return f;
            });
            
            const filesToUpdate = newFiles.filter(f => f.type === 'image' || f.type === 'docx' || f.type === 'pptx');

            const promises = filesToUpdate.map(file => 
                debouncedEstimate(file, quality)
                    .then(size => ({ id: file.id, size }))
            );

            Promise.all(promises).then(results => {
                const sizeMap = new Map(results.map(r => [r.id, r.size]));
                setFiles(currentFiles =>
                    currentFiles.map(cf => {
                        if (sizeMap.has(cf.id)) {
                            return { ...cf, compressedSize: sizeMap.get(cf.id), isProcessing: false };
                        }
                        return cf;
                    })
                );
            });
            
            return newFiles;
        });
    };
    
    const handleCompress = async () => {
        setIsCompressing(true);
        setStatusMessage(t.status.starting);
        setProgress(0);

        const totalTargetEligibleOriginalSize = files
            .filter(f => f.type === 'image' || f.type === 'docx' || f.type === 'pptx')
            .reduce((acc, f) => acc + f.originalSize, 0);

        const targetTotalBytesForRun = resolveTargetTotalBytes(
            compressionMode,
            totalTargetEligibleOriginalSize,
            targetPercentage,
            targetSizeValue,
            targetSizeUnit,
        );

        const backendCandidates = files.filter(shouldUseBackendCompression);
        if (backendCandidates.length > 0) {
            try {
                const outputs: { name: string; url: string; size: number }[] = [];
                const analyses: CompressionInsight[] = [];
                let totalOriginalSize = 0;
                let totalCompressedSize = 0;

                for (let i = 0; i < files.length; i++) {
                    const compressFile = files[i];
                    setProgress(Math.round(((i + 1) / files.length) * 100));

                    if (shouldUseBackendCompression(compressFile)) {
                        const backendOut = await backendCompressSingle(compressFile, targetTotalBytesForRun);
                        outputs.push({ name: backendOut.name, url: backendOut.url, size: backendOut.size });
                        totalOriginalSize += backendOut.originalSize;
                        totalCompressedSize += backendOut.size;
                        if (backendOut.analysis) {
                            analyses.push(backendOut.analysis);
                        }
                    } else {
                        // Non-backend files (plain images) are still compressed
                        // locally and included in the same batch output.
                        try {
                            const compressedImage = await compressImageBlob(compressFile.file, compressFile.quality, compressFile.previewUrl);
                            if (compressedImage.blob) {
                                const name = `${compressFile.file.name.replace(/\.[^/.]+$/, '')}.${compressedImage.extension}`;
                                outputs.push({ name, url: URL.createObjectURL(compressedImage.blob), size: compressedImage.blob.size });
                                totalOriginalSize += compressFile.originalSize;
                                totalCompressedSize += compressedImage.blob.size;
                            }
                        } catch (imgErr) {
                            console.error('Local image compression failed in mixed batch:', imgErr);
                        }
                    }
                }

                if (outputs.length > 0) {
                    if (outputMode === 'zip') {
                        const zip = new JSZip();
                        for (const fileOut of outputs) {
                            const blob = await (await fetch(fileOut.url)).blob();
                            zip.file(fileOut.name, blob);
                        }
                        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
                        const zipUrl = URL.createObjectURL(zipBlob);
                        setResult({ zipUrl, originalSize: totalOriginalSize, compressedSize: zipBlob.size, analyses });
                    } else {
                        setResult({ files: outputs, originalSize: totalOriginalSize, compressedSize: totalCompressedSize, analyses });
                    }

                    setStatusMessage(t.status.zipping);
                    setIsCompressing(false);
                    return;
                }
            } catch (error) {
                console.error(error);
                addToast('Backend compression failed. Falling back to local compression.', 'error');
                setStatusMessage(t.status.error);
            }
        }
        
        const zip = new JSZip();
        let totalOriginalSize = 0;
        let totalCompressedSize = 0;
        const outputFiles: { name: string; url: string; size: number }[] = [];
        
        // Group files by originalPdfId if mergePdfPages is true
        const officeGroups: Record<string, { name: string, originalFile: File, assets: { file: CompressFile, blob: Blob }[] }> = {};
        const standaloneFiles: { file: CompressFile, blob: Blob, name: string }[] = [];

        for (let i = 0; i < files.length; i++) {
            const compressFile = files[i];
            setStatusMessage(`${t.status.compressing} "${compressFile.file.name}"...`);
            setProgress(Math.round(((i + 1) / files.length) * 100));
            totalOriginalSize += compressFile.originalSize;

            try {
                let finalBlob: Blob | null = null;
                let finalName = compressFile.file.name;

                if (compressFile.type === 'image' && compressFile.previewUrl) {
                    if (
                        targetTotalBytesForRun &&
                        Number.isFinite(targetTotalBytesForRun) &&
                        targetTotalBytesForRun > 0 &&
                        totalTargetEligibleOriginalSize > 0 &&
                        (compressionMode === 'target' || compressionMode === 'percentage')
                    ) {
                        const fileTargetBytes = Math.max(1, Math.floor(targetTotalBytesForRun * (compressFile.originalSize / totalTargetEligibleOriginalSize)));
                        const targeted = await compressImageToTarget(compressFile.file, fileTargetBytes, compressFile.previewUrl);
                        finalBlob = targeted.blob;
                        finalName = `${compressFile.file.name.replace(/\.[^/.]+$/, '')}.${targeted.extension}`;
                    } else {
                        const compressedImage = await compressImageBlob(compressFile.file, compressFile.quality, compressFile.previewUrl);
                        finalBlob = compressedImage.blob;
                        finalName = `${compressFile.file.name.replace(/\.[^/.]+$/, '')}.${compressedImage.extension}`;
                    }
                } else if (compressFile.type === 'docx' || compressFile.type === 'pptx') {
                    finalBlob = await compressOfficeDocument(compressFile.file, compressFile.quality);
                } else {
                    const buffer = await compressFile.file.arrayBuffer();
                    finalBlob = new Blob([buffer], { type: compressFile.file.type });
                }

                if (finalBlob) {
                    if (mergePdfPages && compressFile.isPdfPage && compressFile.originalPdfId && compressFile.originalPdfName) {
                        // Office document asset
                        if (!officeGroups[compressFile.originalPdfId]) {
                            officeGroups[compressFile.originalPdfId] = { name: compressFile.originalPdfName, originalFile: compressFile.originalFile, assets: [] };
                        }
                        officeGroups[compressFile.originalPdfId].assets.push({ file: compressFile, blob: finalBlob });
                    } else {
                        standaloneFiles.push({ file: compressFile, blob: finalBlob, name: finalName });
                    }
                }
            } catch (error) {
                 addToast(`${t.status.error} ${compressFile.file.name}`, 'error');
            }
        }
        
        // Process Office groups
        for (const docId in officeGroups) {
            const group = officeGroups[docId];
            setStatusMessage(`Repacking ${group.name}...`);
            try {
                const officeZip = new JSZip();
                const loadedZip = await officeZip.loadAsync(group.originalFile);
                const newZip = new JSZip();
                
                const assetMap = new Map();
                group.assets.forEach(asset => {
                    assetMap.set(asset.file.relativePath, asset.blob);
                });
                
                const promises: Promise<void>[] = [];
                loadedZip.forEach((relativePath: string, zipEntry: any) => {
                    promises.push((async () => {
                        if (zipEntry.dir) return;
                        if (assetMap.has(relativePath)) {
                            newZip.file(relativePath, assetMap.get(relativePath));
                        } else {
                            newZip.file(relativePath, await zipEntry.async('arraybuffer'));
                        }
                    })());
                });
                
                await Promise.all(promises);
                const docBlob = await newZip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
                
                if (outputMode === 'zip') {
                    zip.file(group.name, docBlob);
                } else {
                    outputFiles.push({
                        name: group.name,
                        url: URL.createObjectURL(docBlob),
                        size: docBlob.size
                    });
                }
                totalCompressedSize += docBlob.size;
            } catch (error) {
                console.error("Error repacking office document:", error);
                addToast(`Failed to repack ${group.name}`, 'error');
            }
        }

        // Process standalone files
        for (const item of standaloneFiles) {
            if (outputMode === 'zip') {
                zip.file(item.name, item.blob);
            } else {
                outputFiles.push({
                    name: item.name,
                    url: URL.createObjectURL(item.blob),
                    size: item.blob.size
                });
            }
            totalCompressedSize += item.blob.size;
        }
        
        if (outputMode === 'zip') {
            setStatusMessage(t.status.zipping);
            const zipBlob = await zip.generateAsync({ type: 'blob', compression: "DEFLATE", compressionOptions: { level: 9 } });
            totalCompressedSize = zipBlob.size; // Final size is the zip blob size
            const zipUrl = URL.createObjectURL(zipBlob);
            setResult({ zipUrl, originalSize: totalOriginalSize, compressedSize: totalCompressedSize });
        } else {
            setResult({ files: outputFiles, originalSize: totalOriginalSize, compressedSize: totalCompressedSize });
        }
        
        setIsCompressing(false);
    };

    const handleStartOver = () => {
        setFiles([]);
        setResult(null);
        setIsCompressing(false);
        setProgress(0);
        setStatusMessage('');
    };
    
    const handleRemoveFile = (fileId: string) => setFiles(prev => prev.filter(f => f.id !== fileId));
    const handleClearFiles = () => setFiles([]);
    const handleAddMoreClick = () => addFilesInputRef.current?.click();
    const handleAddMoreFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newFiles = Array.from(e.target.files || []);
        if (newFiles.length > 0) processAndAddFiles(newFiles);
        if (e.target) e.target.value = '';
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDraggingOver(true); };
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current === 0) setIsDraggingOver(false); };
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); };
    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); dragCounter.current = 0; const droppedFiles = Array.from(e.dataTransfer.files); if (droppedFiles && droppedFiles.length > 0) processAndAddFiles(droppedFiles); };

    const isGlassEffect = document.documentElement.classList.contains('dark');
    const panelClasses = `relative w-full rounded-2xl p-8 border border-[var(--border-color)] ${isGlassEffect ? 'bg-[var(--background-card)]/60 backdrop-blur-xl' : 'bg-[var(--background-card)]'}`;

    const renderFileItem = (item: CompressFile) => {
        const spaceSaved = item.compressedSize ? ((item.originalSize - item.compressedSize) / item.originalSize) * 100 : 0;
        
        let heatmapColor = 'bg-black/10 dark:bg-white/10';
        let heatmapText = 'text-[var(--text-tertiary)]';
        
        if (spaceSaved > 0) {
            if (spaceSaved < 30) {
                heatmapColor = 'bg-green-500/20';
                heatmapText = 'text-green-700 dark:text-green-400';
            } else if (spaceSaved < 60) {
                heatmapColor = 'bg-yellow-500/20';
                heatmapText = 'text-yellow-700 dark:text-yellow-400';
            } else {
                heatmapColor = 'bg-red-500/20';
                heatmapText = 'text-red-700 dark:text-red-400';
            }
        }

        return (
             <div key={item.id} className={`p-3 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4 animate-in-item border dark:border-[var(--border-color)] transition-colors duration-300 ${spaceSaved > 0 ? heatmapColor.replace('/20', '/5') : 'bg-[var(--background-card)]'}`}>
                <div className="flex items-center gap-3 overflow-hidden w-full sm:w-1/3">
                    {item.previewUrl ? <img src={item.previewUrl} alt="Preview" className="w-10 h-10 object-cover rounded-md bg-black/5 dark:bg-white/5 flex-shrink-0" /> : <div className="w-10 h-10 bg-black/5 dark:bg-white/5 rounded-md flex items-center justify-center flex-shrink-0"><FileIcon className="w-6 h-6 text-[var(--primary-color)]"/></div>}
                    <div className="flex-1 overflow-hidden">
                        <p className="text-[var(--text-primary)] font-medium truncate" title={item.file.name}>{item.file.name}</p>
                        <div className="flex items-center gap-2">
                            <p className="text-xs text-[var(--text-tertiary)]">{formatBytes(item.originalSize)}</p>
                            {item.detectedType && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary-color)]/20 text-[var(--primary-color)] font-medium">
                                    {item.detectedType}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-2/3">
                    <input type="range" min="0" max="100" value={item.quality} onChange={(e) => handleFileQualityChange(item.id, parseInt(e.target.value))} className="w-full h-2 bg-black/10 dark:bg-white/10 rounded-lg appearance-none cursor-pointer" style={{accentColor: 'var(--primary-color)'}}/>
                    <div className="flex items-center gap-2 w-36 text-sm">
                        {item.isProcessing ? (
                            <div className="w-full max-w-[80px] h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden relative">
                                <div className="absolute inset-y-0 left-0 bg-[var(--primary-color)] w-1/2 animate-[slide_1s_ease-in-out_infinite_alternate]" style={{ animation: 'indeterminate-progress 1.5s infinite ease-in-out' }} />
                                <style>{`@keyframes indeterminate-progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }`}</style>
                            </div>
                        ) : <span className="font-semibold text-[var(--text-primary)]">{formatBytes(item.compressedSize || item.originalSize)}</span>}
                        <span className={`font-semibold text-xs px-1.5 py-0.5 rounded-md ${heatmapColor} ${heatmapText}`}>
                            {spaceSaved > 0 ? `-${spaceSaved.toFixed(0)}%` : '...'}
                        </span>
                    </div>
                </div>
                <button onClick={() => handleRemoveFile(item.id)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors p-1"><CloseIcon className="w-5 h-5"/></button>
            </div>
        );
    }
    
    const renderContent = () => {
        if (result) {
            const sizeDelta = result.originalSize - result.compressedSize;
            const hasSavings = sizeDelta >= 0;
            const deltaBytes = Math.abs(sizeDelta);
            const deltaPercent = result.originalSize > 0 ? (deltaBytes / result.originalSize) * 100 : 0;
            const uniqueSuggestions = Array.from(new Set((result.analyses || []).flatMap((analysis) => analysis.suggestions))).slice(0, 5);
             return (
                <div className={`${panelClasses} text-center flex flex-col items-center slide-up-fade-in`}>
                    <div className="w-16 h-16 bg-[var(--success-color)]/10 rounded-full flex items-center justify-center mb-4 ring-8 ring-[var(--success-color)]/5"><CheckIcon className="w-8 h-8 text-[var(--success-color)]" /></div>
                    <h2 className="text-3xl font-bold mb-2 text-[var(--text-primary)]">{t.results.title}</h2>
                    <div className="flex items-baseline justify-center gap-4 my-4">
                        <div><p className="text-lg text-[var(--text-secondary)]">Original Size</p><p className="text-2xl font-semibold">{formatBytes(result.originalSize)}</p></div>
                        <div className="text-2xl font-bold text-[var(--primary-color)]">→</div>
                        <div><p className="text-lg text-[var(--text-secondary)]">Compressed Size</p><p className="text-2xl font-semibold">{formatBytes(result.compressedSize)}</p></div>
                    </div>
                    <p className={`text-xl font-bold px-4 py-2 rounded-lg ${hasSavings ? 'text-[var(--success-color)] bg-[var(--success-color)]/10' : 'text-[var(--warning-color)] bg-[var(--warning-color)]/10'}`}>
                        {hasSavings
                            ? `You saved ${formatBytes(deltaBytes)} (${deltaPercent.toFixed(1)}%)`
                            : `Size increased by ${formatBytes(deltaBytes)} (${deltaPercent.toFixed(1)}%)`}
                    </p>

                    {result.analyses && result.analyses.length > 0 && (
                        <div className="mt-8 w-full max-w-3xl text-left space-y-4">
                            <h3 className="text-lg font-semibold text-[var(--text-primary)] text-center">Smart Compression Insights</h3>
                            {result.analyses.map((analysis, index) => {
                                const breakdown = analysis.breakdownBytes;
                                const breakdownTotal = breakdown
                                    ? Math.max(1, breakdown.images + breakdown.text + breakdown.vector + breakdown.metadata + breakdown.other)
                                    : 1;

                                return (
                                    <div key={`${analysis.fileName}-${index}`} className="p-4 rounded-xl border border-[var(--border-color)] bg-black/5 dark:bg-white/5">
                                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                            <p className="font-semibold text-[var(--text-primary)] truncate" title={analysis.fileName}>{analysis.fileName}</p>
                                            <span className="text-xs px-2 py-1 rounded-full bg-[var(--primary-color)]/20 text-[var(--primary-color)] font-semibold">{formatDetectedType(analysis.detectedType)}</span>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
                                            <div className="p-2 rounded-lg bg-[var(--background-card)] border border-[var(--border-color)]">
                                                <p className="text-[var(--text-tertiary)]">Original</p>
                                                <p className="font-semibold text-[var(--text-primary)]">{formatBytes(analysis.originalSize)}</p>
                                            </div>
                                            <div className="p-2 rounded-lg bg-[var(--background-card)] border border-[var(--border-color)]">
                                                <p className="text-[var(--text-tertiary)]">Compressed</p>
                                                <p className="font-semibold text-[var(--text-primary)]">{formatBytes(analysis.compressedSize)}</p>
                                            </div>
                                            <div className="p-2 rounded-lg bg-[var(--background-card)] border border-[var(--border-color)]">
                                                <p className="text-[var(--text-tertiary)]">Preset</p>
                                                <p className="font-semibold text-[var(--text-primary)]">{formatPresetLabel(analysis.appliedPreset || analysis.recommendedPreset)}</p>
                                            </div>
                                            <div className="p-2 rounded-lg bg-[var(--background-card)] border border-[var(--border-color)]">
                                                <p className="text-[var(--text-tertiary)]">Savings</p>
                                                <p className="font-semibold text-[var(--success-color)]">{analysis.savingsPercent.toFixed(1)}%</p>
                                            </div>
                                        </div>

                                        {breakdown && (
                                            <div className="space-y-2">
                                                <p className="text-xs text-[var(--text-tertiary)]">Size Composition</p>
                                                {[
                                                    { label: 'Images', value: breakdown.images, bar: 'bg-blue-500/70' },
                                                    { label: 'Text', value: breakdown.text, bar: 'bg-emerald-500/70' },
                                                    { label: 'Vector', value: breakdown.vector, bar: 'bg-amber-500/70' },
                                                    { label: 'Metadata', value: breakdown.metadata, bar: 'bg-fuchsia-500/70' },
                                                    { label: 'Other', value: breakdown.other, bar: 'bg-slate-500/70' },
                                                ].map((item) => (
                                                    <div key={`${analysis.fileName}-${item.label}`} className="space-y-1">
                                                        <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                                                            <span>{item.label}</span>
                                                            <span>{formatBytes(item.value)} ({((item.value / breakdownTotal) * 100).toFixed(0)}%)</span>
                                                        </div>
                                                        <div className="w-full h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                                                            <div className={`h-full ${item.bar}`} style={{ width: `${Math.max(2, (item.value / breakdownTotal) * 100)}%` }} />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {analysis.suggestions.length > 0 && (
                                            <p className="mt-3 text-xs text-[var(--text-secondary)]">Tip: {analysis.suggestions[0]}</p>
                                        )}
                                    </div>
                                );
                            })}

                            {uniqueSuggestions.length > 0 && (
                                <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--primary-color)]/5">
                                    <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">Recommended Next Steps</p>
                                    <div className="space-y-1">
                                        {uniqueSuggestions.map((tip, tipIndex) => (
                                            <p key={tipIndex} className="text-xs text-[var(--text-secondary)]">- {tip}</p>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {result.zipUrl && (
                        <a href={result.zipUrl} download="compressed_files.zip" className="glowing-btn pill-btn mt-8 flex items-center justify-center gap-2 font-medium py-3 px-8 transition-all duration-300"><DownloadIcon className="w-5 h-5" />{t.results.downloadButton} (ZIP)</a>
                    )}

                    {result.files && result.files.length > 0 && (
                        <div className="mt-8 w-full max-w-md space-y-3 text-left">
                            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4 text-center">Download Individual Files</h3>
                            {result.files.map((f, i) => (
                                <div key={i} className="flex items-center justify-between p-3 bg-black/5 dark:bg-white/5 rounded-lg border border-[var(--border-color)]">
                                    <div className="flex flex-col overflow-hidden mr-4">
                                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{f.name}</span>
                                        <span className="text-xs text-[var(--text-tertiary)]">{formatBytes(f.size)}</span>
                                    </div>
                                    <a href={f.url} download={f.name} className="p-2 bg-[var(--primary-color)] text-[var(--text-primary)] rounded-md hover:opacity-90 transition-opacity flex-shrink-0"><DownloadIcon className="w-4 h-4" /></a>
                                </div>
                            ))}
                        </div>
                    )}

                    <button onClick={handleStartOver} className="secondary-btn pill-btn mt-8 flex items-center justify-center gap-2 py-3 px-6 font-medium transition-all duration-300">{t.results.startOverButton}</button>
                </div>
            );
        }

        if (files.length > 0) {
            const imageFilesCount = files.filter(f => f.type === 'image').length;
             return (
                <div onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop} className={`${panelClasses} slide-up-fade-in relative transition-all duration-300 border-2 ${isDraggingOver ? 'border-dashed border-[var(--primary-color)]' : 'border-[var(--border-color)]'}`}>
                    <input type="file" ref={addFilesInputRef} multiple onChange={handleAddMoreFiles} className="hidden"/>
                    {isDraggingOver && <div className="absolute inset-0 bg-[var(--background-card)]/90 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-2xl pointer-events-none"><UploadIcon className="w-16 h-16 text-[var(--primary-color)] mb-4 animate-bounce" /><p className="text-2xl font-bold text-[var(--text-primary)]">{t.dropMore}</p></div>}
                    {isCompressing && <div className="mb-6 animate-in-item space-y-2"><ProgressBar progress={progress} /><p className="text-sm text-[var(--text-tertiary)] text-center h-5 truncate">{statusMessage}</p></div>}
                    <div className="flex justify-between items-center mb-4"><h3 className="text-xl font-semibold">Files ({files.length})</h3><button onClick={handleClearFiles} className="flex items-center gap-2 text-sm text-[var(--text-tertiary)] hover:text-[var(--danger-color)] transition-colors"><TrashIcon className="w-4 h-4"/>Clear All</button></div>
                    <div className="max-h-[24rem] overflow-y-auto pr-2 space-y-3 mb-6">{files.map(renderFileItem)}</div>
                    {!isCompressing && (
                        <>
                            <div className="bg-black/5 dark:bg-white/5 p-4 rounded-lg mb-6">
                                <div className="flex flex-wrap gap-2 mb-4">
                                    <button onClick={() => { setCompressionMode('quality'); handleGlobalQualityChange(80); }} className="secondary-btn outline-btn flex-1 py-2 px-3 text-sm font-medium flex items-center justify-center gap-2">✨ Optimize for Me</button>
                                    <button onClick={() => { setCompressionMode('percentage'); setTargetPercentage(25); applyTargetCompression({ mode: 'percentage', percentage: 25 }); }} className="secondary-btn outline-btn flex-1 py-2 px-3 text-sm font-medium flex items-center justify-center gap-2">🌐 Optimize for Web</button>
                                    <button onClick={() => { setCompressionMode('target'); setTargetSizeValue(10); setTargetSizeUnit('MB'); applyTargetCompression({ mode: 'target', sizeValue: 10, sizeUnit: 'MB' }); }} className="secondary-btn outline-btn flex-1 py-2 px-3 text-sm font-medium flex items-center justify-center gap-2">📧 Optimize for Email</button>
                                    <button onClick={() => { setCompressionMode('target'); setTargetSizeValue(16); setTargetSizeUnit('MB'); applyTargetCompression({ mode: 'target', sizeValue: 16, sizeUnit: 'MB' }); }} className="secondary-btn outline-btn flex-1 py-2 px-3 text-sm font-medium flex items-center justify-center gap-2">💬 Optimize for WhatsApp</button>
                                    <button onClick={() => { setCompressionMode('quality'); handleGlobalQualityChange(95); }} className="secondary-btn outline-btn flex-1 py-2 px-3 text-sm font-medium flex items-center justify-center gap-2">🖨️ Optimize for Print</button>
                                </div>
                                <div className="segmented-control mb-6">
                                    <button onClick={() => setCompressionMode('quality')} className={compressionMode === 'quality' ? 'active' : ''}>Quality</button>
                                    <button onClick={() => setCompressionMode('percentage')} className={compressionMode === 'percentage' ? 'active' : ''}>Percentage</button>
                                    <button onClick={() => setCompressionMode('target')} className={compressionMode === 'target' ? 'active' : ''}>Target Size</button>
                                </div>

                                    {compressionMode === 'quality' && (
                                        <div>
                                            <div className="flex justify-between items-end mb-2">
                                                <label className="block text-sm font-medium text-[var(--text-secondary)]">Output Quality</label>
                                                <span className="text-sm font-bold text-[var(--primary-color)]">{globalQuality}%</span>
                                            </div>
                                            <div className="flex items-center gap-4 max-w-md mx-auto mb-4">
                                                <span className="text-xs font-mono text-[var(--text-tertiary)]">LOW</span>
                                                <input type="range" min="0" max="100" value={globalQuality} onChange={e => handleGlobalQualityChange(parseInt(e.target.value))} className="w-full h-2 bg-black/10 dark:bg-white/10 rounded-lg appearance-none cursor-pointer" style={{accentColor: 'var(--primary-color)'}}/>
                                                <span className="text-xs font-mono text-[var(--text-tertiary)]">HIGH</span>
                                            </div>
                                            <div className="flex justify-center gap-2">
                                                <button onClick={() => handleGlobalQualityChange(30)} className="px-3 py-1 text-xs font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded text-[var(--text-primary)]">Low</button>
                                                <button onClick={() => handleGlobalQualityChange(60)} className="px-3 py-1 text-xs font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded text-[var(--text-primary)]">Medium</button>
                                                <button onClick={() => handleGlobalQualityChange(85)} className="px-3 py-1 text-xs font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded text-[var(--text-primary)]">High</button>
                                            </div>
                                        </div>
                                    )}

                                    {compressionMode === 'percentage' && (
                                        <div className="flex flex-col items-center gap-4">
                                            <label className="block text-sm font-medium text-[var(--text-secondary)]">Reduce file size by</label>
                                            <div className="flex flex-wrap justify-center gap-2">
                                                {[10, 25, 50, 75].map(pct => (
                                                    <button key={pct} onClick={() => setTargetPercentage(pct)} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${targetPercentage === pct ? 'bg-[var(--primary-color)] text-[var(--primary-text)]' : 'bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-[var(--text-primary)]'}`}>{pct}%</button>
                                                ))}
                                            </div>
                                            <button onClick={() => applyTargetCompression()} disabled={isCalculatingTarget} className="glowing-btn pill-btn mt-2 px-6 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                                                {isCalculatingTarget ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : null}
                                                Apply Reduction
                                            </button>
                                        </div>
                                    )}

                                    {compressionMode === 'target' && (
                                        <div className="flex flex-col items-center gap-4">
                                            <label className="block text-sm font-medium text-[var(--text-secondary)]">Target Total Size</label>
                                            <div className="flex items-center gap-2">
                                                <input type="number" min="0.1" step="0.1" value={targetSizeValue} onChange={e => setTargetSizeValue(parseFloat(e.target.value) || 0)} className="w-24 px-3 py-2 bg-[var(--background-card)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] text-center outline-none focus:border-[var(--primary-color)]" />
                                                <select value={targetSizeUnit} onChange={e => setTargetSizeUnit(e.target.value as 'KB' | 'MB')} className="px-3 pr-8 py-2 bg-[var(--background-card)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] outline-none focus:border-[var(--primary-color)]">
                                                    <option value="KB">KB</option>
                                                    <option value="MB">MB</option>
                                                </select>
                                            </div>
                                            <button onClick={() => applyTargetCompression()} disabled={isCalculatingTarget} className="glowing-btn pill-btn mt-2 px-6 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                                                {isCalculatingTarget ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : null}
                                                Apply Target Size
                                            </button>
                                        </div>
                                    )}

                                    <div className="mt-6 pt-4 border-t border-[var(--border-color)] text-center text-sm text-[var(--text-secondary)]">
                                        Estimated Total Size: <span className="font-bold text-[var(--text-primary)]">{formatBytes(files.reduce((acc, f) => acc + (f.compressedSize || f.originalSize), 0))}</span>
                                        {' '}
                                        <span className="text-[var(--success-color)] font-medium">
                                            (-{Math.max(0, ((files.reduce((acc, f) => acc + f.originalSize, 0) - files.reduce((acc, f) => acc + (f.compressedSize || f.originalSize), 0)) / files.reduce((acc, f) => acc + f.originalSize, 0)) * 100).toFixed(1)}%)
                                        </span>
                                    </div>
                                </div>
                            
                            <div className="bg-black/5 dark:bg-white/5 p-4 rounded-lg mb-6 flex flex-col items-center gap-3">
                                <label className="text-sm font-medium text-[var(--text-secondary)]">Output Format</label>
                                <div className="segmented-control">
                                    <button onClick={() => setOutputMode('zip')} className={outputMode === 'zip' ? 'active' : ''}>ZIP Archive</button>
                                    <button onClick={() => setOutputMode('individual')} className={outputMode === 'individual' ? 'active' : ''}>Individual Files</button>
                                </div>
                                {files.some(f => f.isPdfPage) && (
                                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            checked={mergePdfPages} 
                                            onChange={(e) => setMergePdfPages(e.target.checked)} 
                                            className="w-4 h-4 text-[var(--primary-color)] rounded border-[var(--border-color)] focus:ring-[var(--primary-color)]"
                                        />
                                        <span className="text-sm text-[var(--text-primary)]">Merge pages/assets back into original document</span>
                                    </label>
                                )}
                            </div>

                            <div className="mt-8 flex flex-col sm:flex-row-reverse items-center justify-center gap-4">
                                <button onClick={handleCompress} className="glowing-btn pill-btn w-full sm:w-auto flex items-center justify-center gap-2 font-medium py-3 px-8 min-w-[200px]"><CompressIcon className="w-5 h-5" />{t.compressButton} {files.length} {files.length > 1 ? t.files : t.file}</button>
                                <button onClick={handleAddMoreClick} className="secondary-btn pill-btn w-full sm:w-auto flex items-center justify-center gap-2 py-3 px-8 font-medium"><PlusIcon className="w-5 h-5"/>{t.addMoreButton}</button>
                            </div>
                        </>
                    )}
                </div>
            );
        }

        return (
            <div className="space-y-4">
                <div className={panelClasses}><div className="card-sheen"></div><FileDropzone onFilesAdded={processAndAddFiles} isQuickConvert={false} t={t.dropzone} accept="*" /></div>
            </div>
        );
    };

    return (
        <div className="p-4 sm:p-8 w-full">
            <header className="mb-8">
                <div className="flex items-center gap-3">
                    <h1 className="display-md" style={{ color: 'var(--text-primary)' }}>{t.title}</h1>
                </div>
                <p className="body-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{t.subtitle}</p>
            </header>
            <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center">{renderContent()}</div>
        </div>
    );
};

export default CompressorView;
