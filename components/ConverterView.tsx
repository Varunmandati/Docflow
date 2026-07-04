import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { renderAsync } from 'docx-preview';
import { AppFile, DownloadableFile, HistoryEntry, PageSize, Orientation, ColorMode, OutputFormat, SecurityOptions, PageInfo } from '../types';
import FileDropzone from './FileDropzone';
import FileList from './FileList';
import ProgressBar from './ProgressBar';
import ToggleSwitch from './ToggleSwitch';
import DownloadList from './DownloadList';
import PageManagerModal from './PageManagerModal';
import ImageOrderManager from './ImageOrderManager';
import ConversionOptions, { CompressionLevel } from './ConversionOptions';
import { CheckIcon, UploadIcon, ResetIcon, SpinnerIcon, PlusIcon } from './Icons';
import { ConverterTranslation } from '../translations';
import { useToast } from '../hooks/useToast';
import UploadProgressIndicator from './UploadProgressIndicator';
import ConversionProgressWithStages from './ConversionProgressWithStages';
import ErrorState from './ErrorState';

declare const jspdf: any;
declare const Tiff: any;
declare const pdfjsLib: any;
declare const JSZip: any;

interface ConverterViewProps {
    initialFiles: File[];
    onConversionComplete: (result: 'success' | 'fail') => void;
    onAddToHistory: (entry: Omit<HistoryEntry, 'id' | 'date'>) => void;
    defaultCompression: CompressionLevel;
    autoDelete: boolean;
    t: ConverterTranslation;
}

const ConverterView: React.FC<ConverterViewProps> = ({ initialFiles, onConversionComplete, onAddToHistory, defaultCompression, autoDelete, t }) => {
    const [files, setFiles] = useState<AppFile[]>([]);
    const [isConverting, setIsConverting] = useState<boolean>(false);
    const [progress, setProgress] = useState<{ current: number, total: number, percentage: number }>({ current: 0, total: 0, percentage: 0 });
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [downloadableFiles, setDownloadableFiles] = useState<DownloadableFile[]>([]);
    
    // New upload progress tracking
    const [uploadProgress, setUploadProgress] = useState<{ fileName: string; uploadedBytes: number; totalBytes: number; status: 'idle' | 'validating' | 'uploading' | 'complete' | 'failed'; error?: string; attemptNumber: number; }>({ fileName: '', uploadedBytes: 0, totalBytes: 0, status: 'idle', attemptNumber: 0 });
    const [conversionStages, setConversionStages] = useState<Array<{ id: string; name: string; status: 'pending' | 'in_progress' | 'complete' | 'failed'; progress: number; message?: string; estimatedDuration?: number; }>>([]);
    const [uploadError, setUploadError] = useState<{ title: string; message: string; suggestion?: string } | null>(null);
    
    const [mergeFiles, setMergeFiles] = useState<boolean>(true);
    const [compression, setCompression] = useState<CompressionLevel>(defaultCompression);
    const [watermark, setWatermark] = useState<string>('');
    const [pageSize, setPageSize] = useState<PageSize>('a4');
    const [orientation, setOrientation] = useState<Orientation>('p');
    const [colorMode, setColorMode] = useState<ColorMode>('color');
    const [globalOutputFormat, setGlobalOutputFormat] = useState<OutputFormat>('pdf');
    const [securityOptions, setSecurityOptions] = useState<SecurityOptions>({});
    const [addPageNumbers, setAddPageNumbers] = useState<boolean>(false);
    
    const [isPageManagerOpen, setIsPageManagerOpen] = useState(false);
    const [managingFileId, setManagingFileId] = useState<string | null>(null);
    const [aiSuggestedName, setAiSuggestedName] = useState('');
    const [finalFileName, setFinalFileName] = useState('');
    const [isSuggestingName, setIsSuggestingName] = useState(false);
    
    const [isImageOrderManagerOpen, setIsImageOrderManagerOpen] = useState(false);
    const [pendingImageFiles, setPendingImageFiles] = useState<File[]>([]);

    const { addToast } = useToast();
    const addFilesInputRef = useRef<HTMLInputElement>(null);

    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const dragCounter = useRef(0);

    useEffect(() => {
        setCompression(defaultCompression);
    }, [defaultCompression]);

    const OFFICE_EXTENSIONS = ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.txt'];
    const INPUT_ACCEPT = '.pdf,application/pdf,.tif,.tiff,image/tiff,.jpg,.jpeg,image/jpeg,.png,image/png,.bmp,image/bmp,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.odp,.ods,.rtf,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.ms-powerpoint,application/vnd.ms-excel,text/plain';

    const isOfficeDocument = (file: File): boolean => {
        const lower = file.name.toLowerCase();
        return OFFICE_EXTENSIONS.some(ext => lower.endsWith(ext));
    };

    const isSupportedImageFile = (file: File): boolean => {
        const lower = file.name.toLowerCase();
        return ['.jpg', '.jpeg', '.png'].some(ext => lower.endsWith(ext)) ||
               ['image/jpeg', 'image/png'].includes(file.type);
    };

    const allFilesAreImages = (filesToCheck: File[]): boolean => {
        return filesToCheck.length > 0 && filesToCheck.every(f => isSupportedImageFile(f));
    };

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

    const getBackendStageMessage = (stage?: string, message?: string): string => {
        if (message && message.trim().length > 0) return message;
        const stageMap: Record<string, string> = {
            queued: t.status.initializing,
            validating: t.status.initializing,
            converting_to_pdf: `${t.status.processing} (PDF render)`,
            splitting_pdf: `${t.status.processing} (page split)`,
            converting_pdf_to_images: `${t.status.processing} (image export)`,
            generating_html_preview: `${t.status.processing} (preview generation)`,
            finalizing: t.status.generating,
            completed: t.status.complete,
            failed: t.status.error,
        };
        return stageMap[stage || ''] || t.status.processing;
    };

    const zipDownloadables = async (items: DownloadableFile[], zipName: string): Promise<DownloadableFile> => {
        const zip = new JSZip();
        for (const item of items) {
            const response = await fetch(item.url);
            if (!response.ok) {
                throw new Error(`Failed to fetch converted artifact: ${item.name}`);
            }
            const blob = await response.blob();
            zip.file(`${item.name}.${item.format}`, blob);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        return {
            name: zipName,
            url: URL.createObjectURL(zipBlob),
            format: 'zip',
        };
    };

    const runOfficeConversionViaBackend = async (
        appFile: AppFile,
        outputFormat: OutputFormat,
        fileIndex: number,
        totalFiles: number,
    ): Promise<DownloadableFile[]> => {
        const apiBase = getConversionApiBase();

        const uploadForm = new FormData();
        uploadForm.append('file', appFile.file, appFile.file.name);

        const uploadResponse = await fetch(buildApiUrl(apiBase, '/v1/files/upload'), {
            method: 'POST',
            body: uploadForm,
        });

        if (!uploadResponse.ok) {
            const details = await uploadResponse.text();
            throw new Error(`Upload failed for ${appFile.file.name}: ${details}`);
        }

        const uploadPayload = await uploadResponse.json();
        const fileId = uploadPayload.fileId as string;
        if (!fileId) {
            throw new Error('Backend upload did not return fileId.');
        }

        const outputs: Record<string, unknown> = {};
        if (outputFormat === 'jpg' || outputFormat === 'png') {
            outputs.images = true;
            outputs.imageFormat = outputFormat;
            outputs.dpi = 200;
        }

        const convertResponse = await fetch(buildApiUrl(apiBase, '/v1/convert'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ fileId, outputs }),
        });

        if (!convertResponse.ok) {
            const details = await convertResponse.text();
            throw new Error(`Conversion request failed for ${appFile.file.name}: ${details}`);
        }

        const convertPayload = await convertResponse.json();
        const jobId = convertPayload.jobId as string;
        if (!jobId) {
            throw new Error('Backend convert endpoint did not return jobId.');
        }

        let done = false;
        while (!done) {
            const statusResponse = await fetch(buildApiUrl(apiBase, `/v1/jobs/${jobId}`));
            if (!statusResponse.ok) {
                const details = await statusResponse.text();
                throw new Error(`Status check failed for ${appFile.file.name}: ${details}`);
            }

            const statusPayload = await statusResponse.json();
            const backendProgress = typeof statusPayload.progress === 'number' ? statusPayload.progress : 0;
            const globalProgress = Math.round(((fileIndex + backendProgress / 100) / totalFiles) * 100);
            setProgress({ current: fileIndex + 1, total: totalFiles, percentage: globalProgress });
            setStatusMessage(getBackendStageMessage(statusPayload.stage, statusPayload.message));

            if (statusPayload.status === 'failed') {
                throw new Error(statusPayload.error || `Backend conversion failed for ${appFile.file.name}`);
            }

            if (statusPayload.status === 'completed') {
                done = true;
                break;
            }

            await sleep(1200);
        }

        const resultResponse = await fetch(buildApiUrl(apiBase, `/v1/jobs/${jobId}/result`));
        if (!resultResponse.ok) {
            const details = await resultResponse.text();
            throw new Error(`Result fetch failed for ${appFile.file.name}: ${details}`);
        }

        const resultPayload = await resultResponse.json();
        const baseName = appFile.file.name.split('.').slice(0, -1).join('.') || appFile.file.name;

        if (outputFormat === 'pdf') {
            const pdfRef = resultPayload?.outputs?.pdf;
            if (!pdfRef?.downloadUrl) {
                throw new Error(`PDF output missing for ${appFile.file.name}`);
            }
            return [{
                name: baseName,
                url: buildApiUrl(apiBase, pdfRef.downloadUrl),
                format: 'pdf',
            }];
        }

        const images = resultPayload?.outputs?.images;
        if (!Array.isArray(images) || images.length === 0) {
            throw new Error(`Image output missing for ${appFile.file.name}`);
        }

        return images.map((imageRef: any, idx: number) => ({
            name: `${baseName}_page_${idx + 1}`,
            url: buildApiUrl(apiBase, imageRef.downloadUrl),
            format: outputFormat,
        }));
    };

    const runBatchImageConversionViaBackend = async (
        imageFileIds: string[],
        imageFiles: File[]
    ): Promise<DownloadableFile> => {
        const apiBase = getConversionApiBase();

        if (imageFileIds.length === 0) {
            throw new Error('No image files to combine');
        }

        setStatusMessage('Sending batch image conversion request to backend...');
        setProgress({ current: 1, total: imageFileIds.length + 5, percentage: 20 });

        const combinePdfResponse = await fetch(buildApiUrl(apiBase, '/v1/images/combine-to-pdf'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                imageFileIds,
                outputFileName: `combined-images-${Date.now()}.pdf`,
            }),
        });

        if (!combinePdfResponse.ok) {
            const details = await combinePdfResponse.text();
            throw new Error(`Batch image conversion request failed: ${details}`);
        }

        const combinePdfPayload = await combinePdfResponse.json();
        const jobId = combinePdfPayload.jobId as string;
        if (!jobId) {
            throw new Error('Backend batch image conversion did not return jobId');
        }

        setStatusMessage('Processing batch image conversion on backend...');

        let done = false;
        let pollCount = 0;
        while (!done) {
            const statusResponse = await fetch(buildApiUrl(apiBase, `/v1/jobs/${jobId}`));
            if (!statusResponse.ok) {
                const details = await statusResponse.text();
                throw new Error(`Status check failed: ${details}`);
            }

            const statusPayload = await statusResponse.json();
            const backendProgress = typeof statusPayload.progress === 'number' ? statusPayload.progress : 0;
            setProgress({
                current: Math.min(imageFileIds.length + 3, imageFileIds.length + 3 + Math.floor((backendProgress / 100) * 2)),
                total: imageFileIds.length + 5,
                percentage: Math.round((backendProgress / 100) * 80 + 20),
            });
            setStatusMessage(`${statusPayload.message || 'Processing images...'}`) ;

            if (statusPayload.status === 'failed') {
                throw new Error(statusPayload.error || 'Backend batch image conversion failed');
            }

            if (statusPayload.status === 'completed') {
                done = true;
                break;
            }

            await sleep(1500);
            pollCount++;
            if (pollCount > 120) {
                throw new Error('Batch image conversion timeout');
            }
        }

        const resultResponse = await fetch(buildApiUrl(apiBase, `/v1/jobs/${jobId}/result`));
        if (!resultResponse.ok) {
            const details = await resultResponse.text();
            throw new Error(`Result fetch failed: ${details}`);
        }

        const resultPayload = await resultResponse.json();
        const pdfRef = resultPayload?.outputs?.pdf;
        if (!pdfRef?.downloadUrl) {
            throw new Error('PDF output missing from batch conversion');
        }

        const combinedFileName = `${imageFiles[0]?.name?.split('.')[0] || 'combined'}-all-pages`;

        setProgress({ current: imageFileIds.length + 5, total: imageFileIds.length + 5, percentage: 100 });

        return {
            name: combinedFileName,
            url: buildApiUrl(apiBase, pdfRef.downloadUrl),
            format: 'pdf',
        };
    };

    const processAndAddFiles = useCallback(async (newFiles: File[]) => {
        const allowedTypes = [
            'image/tiff',
            'image/jpeg',
            'image/png',
            'image/bmp',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/msword',
            'application/vnd.ms-powerpoint',
            'application/vnd.ms-excel',
            'application/vnd.oasis.opendocument.text',
            'application/vnd.oasis.opendocument.presentation',
            'application/vnd.oasis.opendocument.spreadsheet',
            'text/rtf',
            'application/rtf',
            'text/plain',
        ];
        const validFiles = newFiles.filter(file =>
            allowedTypes.includes(file.type) ||
            file.name.toLowerCase().endsWith('.tif') ||
            file.name.toLowerCase().endsWith('.tiff') ||
            file.name.toLowerCase().endsWith('.pdf') ||
            file.name.toLowerCase().endsWith('.jpg') ||
            file.name.toLowerCase().endsWith('.jpeg') ||
            file.name.toLowerCase().endsWith('.png') ||
            file.name.toLowerCase().endsWith('.bmp') ||
            isOfficeDocument(file)
        );

        const newAppFiles: AppFile[] = validFiles.map(file => ({
            id: `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).substr(2, 9)}`,
            file,
            pages: [],
            pageCount: 0,
            status: 'loading',
            outputFormat: globalOutputFormat, // Default to current global selection
        }));

        setFiles(prev => {
            const existingIds = new Set(prev.map(f => f.id));
            return [...prev, ...newAppFiles.filter(f => !existingIds.has(f.id))];
        });

        for (const appFile of newAppFiles) {
            const pages: PageInfo[] = [];
            let pageCount = 0;

            try {
                if (appFile.file.type === 'application/pdf' || appFile.file.name.toLowerCase().endsWith('.pdf')) {
                    const buffer = await appFile.file.arrayBuffer();
                    const loadingTask = pdfjsLib.getDocument({ data: buffer });
                    const pdf = await loadingTask.promise;
                    pageCount = pdf.numPages;
                    
                    for (let i = 1; i <= pageCount; i++) {
                        const page = await pdf.getPage(i);
                        const viewport = page.getViewport({ scale: 2.0 }); // 2.0 for high resolution rendering
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d')!;
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        
                        await page.render({ canvasContext: context, viewport }).promise;
                        
                        pages.push({
                            id: `${appFile.id}-page-${i-1}`,
                            thumbnailUrl: canvas.toDataURL('image/png'),
                            rotation: 0,
                            originalCanvas: canvas,
                        });
                    }
                } else if (appFile.file.type === 'image/tiff' || appFile.file.name.toLowerCase().endsWith('.tif') || appFile.file.name.toLowerCase().endsWith('.tiff')) {
                    const buffer = await appFile.file.arrayBuffer();
                    const tiff = new Tiff({ buffer });
                    pageCount = tiff.countDirectory();
                    for (let i = 0; i < pageCount; i++) {
                        tiff.setDirectory(i);
                        const canvas = tiff.toCanvas();
                        pages.push({
                            id: `${appFile.id}-page-${i}`,
                            thumbnailUrl: canvas.toDataURL('image/png'),
                            rotation: 0,
                            originalCanvas: canvas,
                        });
                    }
                } else if (appFile.file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || appFile.file.name.toLowerCase().endsWith('.docx')) {
                    const html2canvas = (await import('html2canvas')).default;

                    const splitCanvasIntoPages = (source: HTMLCanvasElement, pageHeight: number): HTMLCanvasElement[] => {
                        if (source.height <= pageHeight * 1.08) {
                            return [source];
                        }

                        const slices: HTMLCanvasElement[] = [];
                        let y = 0;
                        while (y < source.height) {
                            const sliceHeight = Math.min(pageHeight, source.height - y);
                            const slice = document.createElement('canvas');
                            slice.width = source.width;
                            slice.height = sliceHeight;
                            const sliceCtx = slice.getContext('2d');
                            if (sliceCtx) {
                                sliceCtx.drawImage(source, 0, y, source.width, sliceHeight, 0, 0, source.width, sliceHeight);
                                if (slice.height > 40) {
                                    slices.push(slice);
                                }
                            }
                            y += pageHeight;
                        }
                        return slices.length > 0 ? slices : [source];
                    };

                    const cssLengthToPx = (lengthValue: string, scope: HTMLElement): number => {
                        if (!lengthValue) {
                            return NaN;
                        }
                        if (lengthValue.endsWith('px')) {
                            return parseFloat(lengthValue);
                        }

                        const probe = document.createElement('div');
                        probe.style.position = 'absolute';
                        probe.style.visibility = 'hidden';
                        probe.style.height = lengthValue;
                        probe.style.padding = '0';
                        probe.style.border = '0';
                        scope.appendChild(probe);
                        const px = probe.getBoundingClientRect().height;
                        scope.removeChild(probe);
                        return px;
                    };

                    const getExpectedDocPageHeight = (rendered: HTMLCanvasElement, section: HTMLElement): number => {
                        const sectionBounds = section.getBoundingClientRect();
                        const sectionWidth = Math.max(sectionBounds.width, 1);
                        const renderedScale = rendered.width / sectionWidth;

                        const inlineMinHeight = section.style.minHeight || window.getComputedStyle(section).minHeight;
                        const minHeightPx = cssLengthToPx(inlineMinHeight, section);
                        if (Number.isFinite(minHeightPx) && minHeightPx > 0) {
                            return Math.max(500, Math.round(minHeightPx * renderedScale));
                        }

                        const sectionRatio = sectionBounds.height / sectionWidth;

                        // DOCX pages are usually portrait and close to sqrt(2) aspect ratio.
                        const defaultRatio = Math.SQRT2;
                        const ratioToUse = sectionRatio >= 1.2 && sectionRatio <= 1.8 ? sectionRatio : defaultRatio;
                        return Math.max(500, Math.round(rendered.width * ratioToUse));
                    };
                    
                    const container = document.createElement('div');
                    container.style.position = 'absolute';
                    container.style.left = '-9999px';
                    container.style.top = '0';
                    container.style.backgroundColor = 'white';
                    document.body.appendChild(container);

                    try {
                        const buffer = await appFile.file.arrayBuffer();
                        await renderAsync(buffer, container, container, {
                            inWrapper: true,
                            ignoreWidth: false,
                            ignoreHeight: false,
                            ignoreFonts: false,
                            breakPages: true,
                            ignoreLastRenderedPageBreak: false,
                            experimental: true,
                            trimXmlDeclaration: true,
                            useBase64URL: true,
                            debug: false,
                        });

                        // Wait a bit for images/fonts to settle before snapshotting pages.
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        const sections = Array.from(
                            container.querySelectorAll('.docx-wrapper > section.docx, .docx-wrapper > section')
                        ) as HTMLElement[];

                        let pageIndex = 0;
                        if (sections.length > 0) {
                            for (const section of sections) {
                                section.style.boxShadow = 'none';
                                section.style.margin = '0';

                                const rendered = await html2canvas(section, {
                                    scale: 2,
                                    useCORS: true,
                                    backgroundColor: '#ffffff',
                                    logging: false,
                                });

                                const expectedPageHeight = getExpectedDocPageHeight(rendered, section);

                                const splitPages = splitCanvasIntoPages(rendered, expectedPageHeight);
                                for (const splitPage of splitPages) {
                                    pages.push({
                                        id: `${appFile.id}-page-${pageIndex++}`,
                                        thumbnailUrl: splitPage.toDataURL('image/png'),
                                        rotation: 0,
                                        originalCanvas: splitPage,
                                    });
                                }
                            }
                        } else {
                            const canvas = await html2canvas(container, {
                                scale: 2,
                                useCORS: true,
                                backgroundColor: '#ffffff',
                                logging: false,
                            });
                            const fallbackPages = splitCanvasIntoPages(canvas, Math.max(400, Math.round(canvas.width * Math.SQRT2)));
                            for (const fallbackPage of fallbackPages) {
                                pages.push({
                                    id: `${appFile.id}-page-${pageIndex++}`,
                                    thumbnailUrl: fallbackPage.toDataURL('image/png'),
                                    rotation: 0,
                                    originalCanvas: fallbackPage,
                                });
                            }
                        }

                        pageCount = pages.length;
                    } finally {
                        document.body.removeChild(container);
                    }
                } else if (isOfficeDocument(appFile.file)) {
                    // Non-DOCX office files are converted by backend workers; keep a placeholder entry in UI.
                    pageCount = 1;
                } else {
                    pageCount = 1;
                    const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
                        const img = new Image();
                        const url = URL.createObjectURL(appFile.file);
                        img.onload = () => {
                            const c = document.createElement('canvas');
                            c.width = img.width;
                            c.height = img.height;
                            c.getContext('2d')?.drawImage(img, 0, 0);
                            resolve(c);
                            URL.revokeObjectURL(url);
                        };
                        img.onerror = reject;
                        img.src = url;
                    });
                    pages.push({
                        id: `${appFile.id}-page-0`,
                        thumbnailUrl: canvas.toDataURL('image/png'),
                        rotation: 0,
                        originalCanvas: canvas,
                    });
                }
                
                setFiles(prev => prev.map(f => f.id === appFile.id ? { ...f, pages, pageCount, status: 'ready' } : f));
            } catch (err) {
                console.error(`Error processing file ${appFile.file.name}:`, err);
                setFiles(prev => prev.filter(f => f.id !== appFile.id));
                addToast(`Error processing ${appFile.file.name}. The file might be corrupted or unsupported.`, "error");
            }
        }
    }, [addToast, globalOutputFormat]);
    
    const handleCombineImagesToPdf = useCallback(async () => {
        if (files.length === 0) {
            addToast('Please select image files first', 'error');
            return;
        }

        const selectedFiles = files.map(f => f.file);
        if (!allFilesAreImages(selectedFiles)) {
            addToast('All selected files must be JPG or PNG images', 'error');
            return;
        }

        setPendingImageFiles(selectedFiles);
        setIsImageOrderManagerOpen(true);
    }, [files, addToast]);

    const handleImageOrderConfirmed = useCallback(async (orderedFiles: File[]) => {
        if (orderedFiles.length === 0) {
            addToast('No images to process', 'error');
            return;
        }

        setIsConverting(true);
        setStatusMessage('Uploading images to backend...');
        setProgress({ current: 0, total: orderedFiles.length + 5, percentage: 0 });

        try {
            // Upload all images and get their IDs
            const uploadedIds: string[] = [];
            for (let i = 0; i < orderedFiles.length; i++) {
                const file = orderedFiles[i];
                const apiBase = getConversionApiBase();
                
                const uploadForm = new FormData();
                uploadForm.append('file', file, file.name);

                const uploadResponse = await fetch(buildApiUrl(apiBase, '/v1/files/upload'), {
                    method: 'POST',
                    body: uploadForm,
                });

                if (!uploadResponse.ok) {
                    throw new Error(`Failed to upload image ${i + 1}: ${file.name}`);
                }

                const uploadPayload = await uploadResponse.json();
                const fileId = uploadPayload.fileId as string;
                if (!fileId) {
                    throw new Error(`Upload did not return fileId for ${file.name}`);
                }

                uploadedIds.push(fileId);
                setProgress({
                    current: i + 1,
                    total: orderedFiles.length + 5,
                    percentage: Math.round(((i + 1) / (orderedFiles.length + 3)) * 20),
                });
                setStatusMessage(`Uploaded image ${i + 1} of ${orderedFiles.length}`);
            }

            // Now process the batch conversion
            setProgress({ current: orderedFiles.length + 1, total: orderedFiles.length + 5, percentage: 20 });
            const combinedPdf = await runBatchImageConversionViaBackend(uploadedIds, orderedFiles);

            setDownloadableFiles([combinedPdf]);
            setStatusMessage('✓ Images successfully combined into PDF');
            setProgress({ current: orderedFiles.length + 5, total: orderedFiles.length + 5, percentage: 100 });

            // Close the image order manager
            setIsImageOrderManagerOpen(false);

            onConversionComplete('success');
            onAddToHistory({
                name: `${combinedPdf.name}.pdf`,
                status: 'Success',
                url: combinedPdf.url,
            });

            if (autoDelete) {
                setFiles([]);
            }
        } catch (error) {
            console.error(error);
            onConversionComplete('fail');
            setStatusMessage('✗ Batch image conversion failed');
            addToast(error instanceof Error ? error.message : 'Failed to combine images', 'error');
        } finally {
            setIsConverting(false);
        }
    }, [addToast, autoDelete, onConversionComplete, onAddToHistory, getConversionApiBase, buildApiUrl]);
    
    const handleFilesAdded = useCallback((acceptedFiles: File[]) => {
        processAndAddFiles(acceptedFiles);
        setDownloadableFiles([]);
    }, [processAndAddFiles]);

    const handleAddMoreClick = () => addFilesInputRef.current?.click();

    const handleAddMoreFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newFiles = Array.from(e.target.files || []);
        if (newFiles.length > 0) handleFilesAdded(newFiles);
        if (e.target) e.target.value = '';
    };

    useEffect(() => {
        if (initialFiles.length > 0) handleFilesAdded(initialFiles);
    }, [initialFiles, handleFilesAdded]);
    
    useEffect(() => {
        if (downloadableFiles.length === 1 && finalFileName && finalFileName !== downloadableFiles[0].name) {
            setDownloadableFiles(prev => [{ ...prev[0], name: finalFileName }]);
        }
    }, [finalFileName, downloadableFiles]);
    
    const handleRemoveFile = (fileId: string) => setFiles(prev => prev.filter(f => f.id !== fileId));

    const handleReorderFiles = useCallback((reorderedFiles: AppFile[]) => {
        setFiles(reorderedFiles);
    }, []);
    
    const handleClearFiles = () => setFiles([]);
    
    const handleUpdateFileFormat = (fileId: string, format: OutputFormat) => {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, outputFormat: format } : f));
    };

    const handleApplyFormatToAll = () => {
        setFiles(prev => prev.map(f => ({ ...f, outputFormat: globalOutputFormat })));
        addToast(`All files set to output as ${globalOutputFormat.toUpperCase()}`, "success");
    };

    const handleStartOver = () => {
        setFiles([]);
        setIsConverting(false);
        setProgress({ current: 0, total: 0, percentage: 0 });
        setStatusMessage('');
        setDownloadableFiles([]);
        setAiSuggestedName('');
        setFinalFileName('');
    };
    
    const handleManageFile = (fileId: string) => {
        setManagingFileId(fileId);
        setIsPageManagerOpen(true);
    };

    const handleUpdateFilePages = (fileId: string, updatedPages: PageInfo[]) => {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, pages: updatedPages, pageCount: updatedPages.length } : f));
    };

    const suggestFileName = async (firstPageCanvas: HTMLCanvasElement): Promise<string> => {
        setIsSuggestingName(true);
        setStatusMessage(t.status.suggestingName);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            
            const quality = 0.7;
            const base64Data = firstPageCanvas.toDataURL('image/jpeg', quality).split(',')[1];

            const imagePart = { inlineData: { mimeType: 'image/jpeg', data: base64Data } };
            const textPart = { text: "Suggest a concise, snake_case filename for this document. Examples: 'invoice_acme_corp_may_2024', 'quarterly_report_q2'. Do not include the file extension or markdown formatting." };
            
            const response = await ai.models.generateContent({
                model: 'gemini-flash-latest',
                contents: { parts: [imagePart, textPart] }
            });

            const cleanName = response.text.trim().replace(/`/g, '').replace(/\.pdf$/, '');
            return cleanName;

        } catch (error) {
            console.error("AI filename suggestion failed:", error);
            return '';
        } finally {
            setIsSuggestingName(false);
        }
    };
    
    const getProcessedCanvas = (canvas: HTMLCanvasElement, rotation: number, colorMode: ColorMode): HTMLCanvasElement => {
        const rotatedCanvas = document.createElement('canvas');
        const ctx = rotatedCanvas.getContext('2d')!;
        
        if (rotation === 90 || rotation === 270) {
            rotatedCanvas.width = canvas.height;
            rotatedCanvas.height = canvas.width;
        } else {
            rotatedCanvas.width = canvas.width;
            rotatedCanvas.height = canvas.height;
        }

        ctx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
        
        if (colorMode !== 'color') {
            const imageData = ctx.getImageData(0, 0, rotatedCanvas.width, rotatedCanvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i+1], b = data[i+2];
                if (colorMode === 'grayscale') {
                    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                    data[i] = data[i+1] = data[i+2] = lum;
                } else { // bw
                    const avg = (r + g + b) / 3;
                    const val = avg > 128 ? 255 : 0;
                    data[i] = data[i+1] = data[i+2] = val;
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        return rotatedCanvas;
    };
    
    const handleConvert = async () => {
        if (files.length === 0) return;
        setIsConverting(true);
        setStatusMessage(t.status.initializing);

        const officeFiles = files.filter(f => isOfficeDocument(f.file));
        if (officeFiles.length > 0) {
            const outputTargets = files.map(f => mergeFiles ? globalOutputFormat : f.outputFormat);
            const unsupportedFormat = outputTargets.find(fmt => !['pdf', 'jpg', 'png'].includes(fmt));
            if (unsupportedFormat) {
                addToast('Backend office conversion supports PDF, JPG, and PNG output formats only.', 'error');
                setStatusMessage(t.status.error);
                setIsConverting(false);
                return;
            }

            if (officeFiles.length !== files.length) {
                addToast('For rendering fidelity, process office documents separately from image/PDF batches.', 'error');
                setStatusMessage(t.status.error);
                setIsConverting(false);
                return;
            }

            try {
                const backendFiles: DownloadableFile[] = [];
                for (let idx = 0; idx < files.length; idx += 1) {
                    const appFile = files[idx];
                    const targetFormat = mergeFiles ? globalOutputFormat : appFile.outputFormat;
                    const converted = await runOfficeConversionViaBackend(appFile, targetFormat, idx, files.length);
                    backendFiles.push(...converted);
                    onConversionComplete('success');
                    onAddToHistory({
                        name: `${appFile.file.name} -> .${targetFormat}`,
                        status: 'Success',
                        url: converted[0]?.url,
                    });
                }

                const finalOfficeFiles =
                    mergeFiles && backendFiles.length > 1
                        ? [await zipDownloadables(backendFiles, `${files[0].file.name.split('.')[0] || 'converted_files'}_bundle`)]
                        : backendFiles;

                if (finalOfficeFiles.length === 1) {
                    setFinalFileName(finalOfficeFiles[0].name);
                }

                setDownloadableFiles(finalOfficeFiles);
                setStatusMessage(t.status.complete);
                setProgress({ current: files.length, total: files.length, percentage: 100 });
                setIsConverting(false);

                if (autoDelete && finalOfficeFiles.length > 0) {
                    setFiles([]);
                }
                return;
            } catch (error) {
                console.error(error);
                onConversionComplete('fail');
                setStatusMessage(t.status.error);
                addToast(error instanceof Error ? error.message : 'Office conversion failed.', 'error');
                setIsConverting(false);
                return;
            }
        }
        
        const allPages = files.flatMap(f => f.pages);
        setProgress({ current: 0, total: allPages.length, percentage: 0 });
        
        const { jsPDF } = jspdf;
        const qualityMap = { 'Low': 0.5, 'Medium': 0.75, 'High': 0.95 };
        const quality = qualityMap[compression];

        const generatedFiles: DownloadableFile[] = [];
        
        const getEncryptionOptions = () => {
             if (securityOptions.password && securityOptions.password.length > 0) {
                return {
                    userPassword: securityOptions.password,
                    ownerPassword: securityOptions.password,
                    userPermissions: ['print', 'copy'],
                };
            }
            return undefined;
        };
        
        const encryption = getEncryptionOptions();
        
        const jsPDFConfig: any = {
            orientation,
            unit: 'mm',
            format: pageSize,
            ...(encryption ? { encryption } : {})
        };

        const addPageNumbersToPdf = (pdf: any) => {
            const totalPages = pdf.internal.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                pdf.setPage(i);
                pdf.setFontSize(10);
                pdf.setTextColor(150, 150, 150);
                const text = `Page ${i} / ${totalPages}`;
                const textWidth = pdf.getStringUnitWidth(text) * pdf.internal.getFontSize() / pdf.internal.scaleFactor;
                const textX = (pdf.internal.pageSize.getWidth() - textWidth) / 2;
                const textY = pdf.internal.pageSize.getHeight() - 10;
                pdf.text(text, textX, textY);
            }
        };
        
        if (mergeFiles) {
            const totalPages = files.reduce((acc, f) => acc + f.pageCount, 0);

            if (globalOutputFormat === 'pdf') {
                const pdf = new jsPDF(jsPDFConfig);
                let pageCounter = 0;
                for (const file of files) {
                    for (const page of file.pages) {
                        pageCounter++;
                        setStatusMessage(`${t.status.processing} ${pageCounter}/${totalPages}`);
                        setProgress(p => ({...p, current: pageCounter, percentage: Math.round((pageCounter / totalPages) * 100)}));

                        try {
                            const processedCanvas = getProcessedCanvas(page.originalCanvas, page.rotation, colorMode);
                            if (pageCounter > 1) pdf.addPage();
                            const imgData = processedCanvas.toDataURL('image/jpeg', quality);

                            const pdfWidth = pdf.internal.pageSize.getWidth();
                            const pdfHeight = pdf.internal.pageSize.getHeight();
                            const ratio = Math.min(pdfWidth / processedCanvas.width, pdfHeight / processedCanvas.height);
                            pdf.addImage(imgData, 'JPEG', (pdfWidth - processedCanvas.width * ratio) / 2, (pdfHeight - processedCanvas.height * ratio) / 2, processedCanvas.width * ratio, processedCanvas.height * ratio);

                            if (watermark) {
                                pdf.setFontSize(48);
                                pdf.setTextColor(150, 150, 150);
                                pdf.text(watermark, pdfWidth / 2, pdfHeight / 2, { align: 'center', angle: -45 });
                            }
                        } catch (e) { console.error(e); }
                    }
                }
                if (addPageNumbers) addPageNumbersToPdf(pdf);
                
                setStatusMessage(t.status.generating);
                const buffer = pdf.output('arraybuffer');
                const pdfBlob = new Blob([buffer], { type: 'application/pdf' });
                const filename = files[0].file.name.split('.')[0] || 'merged_document';
                
                const url = URL.createObjectURL(pdfBlob);
                generatedFiles.push({ name: filename, url, format: 'pdf' });
                onConversionComplete('success');
                onAddToHistory({ name: `${filename}.pdf`, status: 'Success', url });
                setFinalFileName(filename);
                const aiName = await suggestFileName(files[0].pages[0].originalCanvas);
                setAiSuggestedName(aiName);

            } else { // Merging to ZIP for image formats
                setStatusMessage(t.status.creatingZip);
                const zip = new JSZip();
                let pageCounter = 0;

                for (const appFile of files) {
                    for (let i = 0; i < appFile.pages.length; i++) {
                        const page = appFile.pages[i];
                        pageCounter++;
                        setProgress({ current: pageCounter, total: totalPages, percentage: Math.round((pageCounter / totalPages) * 100) });
                        setStatusMessage(`${t.status.processing} ${pageCounter}/${totalPages}`);
                        
                        const processedCanvas = getProcessedCanvas(page.originalCanvas, page.rotation, colorMode);
                        const mimeType = `image/${globalOutputFormat}`;
                        const blob = await new Promise<Blob | null>(resolve => processedCanvas.toBlob(resolve, mimeType, quality));

                        if (blob) {
                            const originalFileName = appFile.file.name.split('.').slice(0, -1).join('.');
                            const filename = `${originalFileName}_page_${i + 1}.${globalOutputFormat}`;
                            zip.file(filename, blob);
                        }
                    }
                }
                
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const zipName = files[0].file.name.split('.')[0] || 'converted_files';
                const url = URL.createObjectURL(zipBlob);
                generatedFiles.push({ name: zipName, url, format: 'zip' });
                onConversionComplete('success');
                onAddToHistory({ name: `${zipName}.zip`, status: 'Success', url });
            }

        } else {
            // Processing INDIVIDUAL files
            for (const appFile of files) {
                setStatusMessage(`${t.status.processing} ${appFile.file.name}`);
                const fileFormat = appFile.outputFormat;
                
                try {
                    const filename = `${appFile.file.name.split('.')[0]}_processed`;
                    
                    if (fileFormat === 'pdf') {
                        const pdf = new jsPDF(jsPDFConfig);
                        for (let i = 0; i < appFile.pages.length; i++) {
                            const page = appFile.pages[i];
                            const processedCanvas = getProcessedCanvas(page.originalCanvas, page.rotation, colorMode);
                            if (i > 0) pdf.addPage();
                            const imgData = processedCanvas.toDataURL('image/jpeg', quality);
                            const pdfWidth = pdf.internal.pageSize.getWidth();
                            const pdfHeight = pdf.internal.pageSize.getHeight();
                            const ratio = Math.min(pdfWidth / processedCanvas.width, pdfHeight / processedCanvas.height);
                            pdf.addImage(imgData, 'JPEG', (pdfWidth - processedCanvas.width * ratio) / 2, (pdfHeight - processedCanvas.height * ratio) / 2, processedCanvas.width * ratio, processedCanvas.height * ratio);
                            if (watermark) {
                                pdf.setFontSize(48);
                                pdf.setTextColor(150, 150, 150);
                                pdf.text(watermark, pdfWidth / 2, pdfHeight / 2, { align: 'center', angle: -45 });
                            }
                        }
                        if (addPageNumbers) addPageNumbersToPdf(pdf);
                        const buffer = pdf.output('arraybuffer');
                        const resultBlob = new Blob([buffer], { type: 'application/pdf' });
                        const url = URL.createObjectURL(resultBlob);
                        generatedFiles.push({ name: filename, url, format: fileFormat });
                    } else { // Individual image formats
                        for (let i = 0; i < appFile.pages.length; i++) {
                            const page = appFile.pages[i];
                            const processedCanvas = getProcessedCanvas(page.originalCanvas, page.rotation, colorMode);
                            const pageName = appFile.pages.length > 1 ? `${filename}_page_${i+1}` : filename;
                            const mimeType = `image/${fileFormat}`;
                            const blob = await new Promise<Blob | null>(resolve => processedCanvas.toBlob(resolve, mimeType, quality));
                            if (blob) {
                                const url = URL.createObjectURL(blob);
                                generatedFiles.push({ name: pageName, url, format: fileFormat });
                            }
                        }
                    }

                    onConversionComplete('success');
                    onAddToHistory({ name: `${appFile.file.name} -> .${fileFormat}`, status: 'Success' });
                } catch(e) {
                    console.error(e);
                    onConversionComplete('fail');
                    onAddToHistory({ name: appFile.file.name, status: 'Failed' });
                }
            }

            if (generatedFiles.length === 1) {
                setFinalFileName(generatedFiles[0].name);
                const firstCanvas = files[0].pages[0].originalCanvas;
                const aiName = await suggestFileName(firstCanvas);
                setAiSuggestedName(aiName);
            }
        }
        
        setDownloadableFiles(generatedFiles);
        setStatusMessage(t.status.complete);
        setIsConverting(false);

        if (autoDelete && generatedFiles.length > 0) {
            setFiles([]);
        }
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current++;
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsDraggingOver(true);
        }
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current--;
        if (dragCounter.current === 0) {
            setIsDraggingOver(false);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
        dragCounter.current = 0;
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles && droppedFiles.length > 0) {
            handleFilesAdded(droppedFiles);
        }
    };
    
    const isGlassEffect = document.documentElement.classList.contains('dark');
    const panelClasses = `relative w-full rounded-xl p-8 border border-[var(--border-color)] bg-[var(--background-card)] elevation-3`;
    const managingFile = files.find(f => f.id === managingFileId);
    
    const mergeLabel = globalOutputFormat === 'pdf' 
        ? t.options.merge.pdf
        : t.options.merge.zip;
    const showMergeToggle = files.length > 1 || (files.length === 1 && files[0].pageCount > 1);

    const renderContent = () => {
        // Show image order manager if user clicked "Combine Images"
        if (isImageOrderManagerOpen && pendingImageFiles.length > 0) {
            return (
                <div className={`${panelClasses} slide-up-fade-in`}>
                    <div className="card-sheen"></div>
                    <div className="p-8">
                        <ImageOrderManager
                            files={pendingImageFiles}
                            onOrderedFilesChange={handleImageOrderConfirmed}
                            t={t}
                        />
                    </div>
                </div>
            );
        }

        if (downloadableFiles.length > 0) {
            return (
                <div className={`${panelClasses} text-center flex flex-col items-center slide-up-fade-in`}>
                    <div className="card-sheen"></div>
                    <div className="w-16 h-16 bg-[var(--success-color)]/10 rounded-full flex items-center justify-center mb-4 ring-8 ring-[var(--success-color)]/5">
                         <CheckIcon className="w-8 h-8 text-[var(--success-color)]" />
                    </div>
                    <h2 className="display-lg mb-2 text-[var(--text-primary)]">{t.success.title}</h2>
                    <p className="body-md text-[var(--text-secondary)] mb-8">{t.success.subtitle}</p>
                    
                    <DownloadList 
                        files={downloadableFiles} 
                        aiSuggestedName={aiSuggestedName}
                        isSuggestingName={isSuggestingName}
                        finalFileName={finalFileName}
                        onFinalFileNameChange={setFinalFileName}
                        t={t.success}
                    />

                    <button
                        onClick={handleStartOver}
                        className="secondary-btn pill-btn mt-8 flex items-center justify-center gap-2 py-3 px-6 font-medium"
                    >
                        <ResetIcon className="w-5 h-5" />
                        {t.success.startOverButton}
                    </button>
                </div>
            );
        }

        if (files.length > 0) {
            return (
                <div
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    className={`${panelClasses} slide-up-fade-in relative transition-all duration-300 border-2 ${isDraggingOver ? 'border-dashed border-[var(--primary-color)]' : 'border-[var(--border-color)]'}`}
                >
                    <input type="file" ref={addFilesInputRef} multiple accept={INPUT_ACCEPT} onChange={handleAddMoreFiles} className="hidden"/>
                    <div className="card-sheen"></div>
                    
                    {isDraggingOver && (
                        <div className="absolute inset-0 bg-[var(--background-card)]/90 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-2xl pointer-events-none">
                            <UploadIcon className="w-16 h-16 text-[var(--primary-color)] mb-4 animate-bounce" />
                            <p className="text-2xl font-bold text-[var(--text-primary)]">Drop to add more files</p>
                        </div>
                    )}

                    {isConverting && (
                        <div className="mb-6 animate-in-item space-y-4">
                            {/* Show multi-stage progress if converting office files or PDFs */}
                            {conversionStages.length > 0 ? (
                                <ConversionProgressWithStages
                                    stages={conversionStages}
                                    totalProgress={progress.percentage}
                                    fileName={files[0]?.file.name}
                                />
                            ) : (
                                <>
                                    <div className="flex justify-between items-center font-semibold">
                                        <span className="text-[var(--text-primary)]">Overall Progress</span>
                                        <span className="text-[var(--text-secondary)]">{progress.percentage}%</span>
                                    </div>
                                    <ProgressBar progress={progress.percentage} />
                                    <p className="text-sm text-[var(--text-tertiary)] text-center h-5 truncate" title={statusMessage}>{statusMessage}</p>
                                </>
                            )}
                        </div>
                    )}
                    
                    {/* Error State Display */}
                    {uploadError && (
                        <div className="mb-6 animate-in-item">
                            <ErrorState
                                title={uploadError.title}
                                message={uploadError.message}
                                suggestion={uploadError.suggestion}
                                onDismiss={() => setUploadError(null)}
                            />
                        </div>
                    )}
                    
                    <FileList 
                        files={files} 
                        onClear={handleClearFiles} 
                        onRemove={handleRemoveFile} 
                        onManage={handleManageFile} 
                        onUpdateFormat={handleUpdateFileFormat}
                        onReorder={handleReorderFiles}
                        disabled={isConverting} 
                        t={t.options} 
                    />
                    {!isConverting && (
                        <div className="animate-in-item">
                            <div className="mt-6 space-y-6">
                                {showMergeToggle && <ToggleSwitch label={mergeLabel} enabled={mergeFiles} onChange={setMergeFiles} />}
                                
                                <ConversionOptions
                                    watermark={watermark} setWatermark={setWatermark}
                                    pageSize={pageSize} setPageSize={setPageSize}
                                    orientation={orientation} setOrientation={setOrientation}
                                    colorMode={colorMode} setColorMode={setColorMode}
                                    outputFormat={globalOutputFormat} setOutputFormat={setGlobalOutputFormat}
                                    onApplyFormatToAll={handleApplyFormatToAll}
                                    securityOptions={securityOptions} setSecurityOptions={setSecurityOptions}
                                    pageNumbers={addPageNumbers}
                                    // Fix: Pass the correct state setter for page numbers.
                                    setPageNumbers={setAddPageNumbers}
                                    t={t.options}
                                />
                            </div>
                            <div className="mt-8 flex flex-col sm:flex-row-reverse items-center justify-center gap-4">
                                {allFilesAreImages(files.map(f => f.file)) && files.length > 1 ? (
                                    <>
                                        <button
                                            onClick={handleCombineImagesToPdf} disabled={isConverting || files.some(f => f.status === 'loading')}
                                            className="glowing-btn pill-btn w-full sm:w-auto font-medium py-3 px-8 disabled:opacity-50 disabled:cursor-not-allowed min-w-[240px] flex items-center justify-center bg-[var(--success-color)] text-white hover:opacity-90"
                                        >
                                           {isConverting ? (
                                               <span className="flex items-center gap-2"><SpinnerIcon /> Combining images...</span>
                                           ) : (
                                               `📄 Combine ${files.length} Images to PDF`
                                           )}
                                        </button>
                                        <button onClick={handleAddMoreClick} className="secondary-btn pill-btn w-full sm:w-auto flex items-center justify-center gap-2 py-3 px-8 font-medium">
                                            <PlusIcon className="w-5 h-5" />{t.options.addMoreButton}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={handleConvert} disabled={isConverting || files.some(f => f.status === 'loading')}
                                            className="glowing-btn pill-btn w-full sm:w-auto font-medium py-3 px-8 disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px] flex items-center justify-center"
                                        >
                                           {isConverting ? (
                                               <span className="flex items-center gap-2"><SpinnerIcon />{t.options.convertButtonLoading}</span>
                                           ) : (
                                               `${t.options.convertButton} ${files.length} ${files.length > 1 ? t.options.files : t.options.file}`
                                           )}
                                        </button>
                                        <button onClick={handleAddMoreClick} className="secondary-btn pill-btn w-full sm:w-auto flex items-center justify-center gap-2 py-3 px-8 font-medium">
                                            <PlusIcon className="w-5 h-5" />{t.options.addMoreButton}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        return (
             <div className={panelClasses}>
                <div className="card-sheen"></div>
                
                {/* Format Selector */}
                <div className="mb-6 pb-6 border-b border-[var(--border-color)]">
                    <p className="caption-text font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Select Output Format:</p>
                    <div className="segmented-control">
                        {(['pdf', 'jpg', 'png', 'docx'] as OutputFormat[]).map((format) => (
                            <button
                                key={format}
                                onClick={() => setGlobalOutputFormat(format)}
                                className={`uppercase ${globalOutputFormat === format ? 'active' : ''}`}
                            >
                                {format}
                            </button>
                        ))}
                    </div>
                </div>

                <FileDropzone onFilesAdded={handleFilesAdded} isQuickConvert={false} accept={INPUT_ACCEPT} t={{
                    title: t.dropzone.title, subtitle: t.dropzone.subtitle,
                    dragText: t.dropzone.dragText, browseText: t.dropzone.browseText, supportText: t.dropzone.supportText,
                }} />
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
            <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center">
                {renderContent()}
            </div>
            <PageManagerModal
                isOpen={isPageManagerOpen}
                onClose={() => setIsPageManagerOpen(false)}
                file={managingFile || null}
                onSave={handleUpdateFilePages}
                t={t.pageManager}
            />
        </div>
    );
};

export default ConverterView;