import React, { useState, useCallback, useEffect, useRef } from 'react';
import { renderAsync } from 'docx-preview';
import { Document, Packer, ImageRun, Paragraph, PageBreak, AlignmentType, TextRun, ExternalHyperlink, HeadingLevel, Table, TableRow, TableCell, WidthType, VerticalAlign, BorderStyle, Column, ColumnBreak, SectionType, LineRuleType } from 'docx';
import { AppFile, DownloadableFile, HistoryEntry, PageSize, Orientation, ColorMode, OutputFormat, SecurityOptions, PageInfo, DocxBlock, DocxRun, DocxSegment, PageGeometry } from '../types';
import FileDropzone from './FileDropzone';
import FileList from './FileList';
import ProgressBar from './ProgressBar';
import ToggleSwitch from './ToggleSwitch';
import DownloadList from './DownloadList';
import PageManagerModal from './PageManagerModal';
import ImageOrderManager from './ImageOrderManager';
import ConversionOptions, { CompressionLevel } from './ConversionOptions';
import { CheckIcon, UploadIcon, ResetIcon, SpinnerIcon, PlusIcon, FileTextIcon, ArrowUpRightIcon } from './Icons';
import { ConverterTranslation } from '../translations';
import { useToast } from '../hooks/useToast';
import UploadProgressIndicator from './UploadProgressIndicator';
import ConversionProgressWithStages from './ConversionProgressWithStages';
import ErrorState from './ErrorState';
import { authFetch } from '../services/authFetch';
import { uploadWithPresignFallback } from '../services/upload';
import { convertPdfToDocxViaAdobe } from '../services/pdfDocx';

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
    isAuthenticated?: boolean;
    onAuthClick?: () => void;
}

const ConverterView: React.FC<ConverterViewProps> = ({ initialFiles, onConversionComplete, onAddToHistory, defaultCompression, autoDelete, t, isAuthenticated, onAuthClick }) => {
    const [files, setFiles] = useState<AppFile[]>([]);
    const filesRef = useRef<AppFile[]>([]);
    const [isConverting, setIsConverting] = useState<boolean>(false);
    const [progress, setProgress] = useState<{ current: number, total: number, percentage: number }>({ current: 0, total: 0, percentage: 0 });
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [downloadableFiles, setDownloadableFiles] = useState<DownloadableFile[]>([]);
    
    // New upload progress tracking
    const [uploadProgress, setUploadProgress] = useState<{ fileName: string; uploadedBytes: number; totalBytes: number; status: 'idle' | 'validating' | 'uploading' | 'complete' | 'failed'; error?: string; attemptNumber: number; }>({ fileName: '', uploadedBytes: 0, totalBytes: 0, status: 'idle', attemptNumber: 0 });
    const [conversionStages, setConversionStages] = useState<Array<{ id: string; name: string; status: 'pending' | 'in_progress' | 'complete' | 'failed'; progress: number; message?: string; estimatedDuration?: number; }>>([]);
    const lastInitialFilesRef = useRef<File[] | null>(null);

    // Backend conversion stages in order — used to drive the multi-stage UI.
    const BACKEND_STAGE_SEQUENCE = ['queued', 'validating', 'converting', 'post-processing', 'finalizing', 'completed'] as const;
    const BACKEND_STAGE_NAMES: Record<string, string> = {
        queued: 'Queued',
        validating: 'Validating',
        converting: 'Converting',
        'post-processing': 'Post-processing',
        finalizing: 'Finalizing',
        completed: 'Complete',
    };

    // Client-side PDF->DOCX stages — the structure-preserving builder runs in
    // the browser, so it drives its own staged progress UI (the backend job
    // tracker does not apply).
    const CLIENT_DOCX_STAGES = ['reading', 'structure', 'generating'] as const;
    const CLIENT_DOCX_STAGE_NAMES: Record<string, string> = {
        reading: 'Reading PDF text & layout',
        structure: 'Rebuilding document structure',
        generating: 'Generating .docx file',
    };
    const setClientDocxStages = (phase: 'reading' | 'structure' | 'generating' | 'done') => {
        const index = phase === 'done' ? 3 : CLIENT_DOCX_STAGES.indexOf(phase);
        setConversionStages(CLIENT_DOCX_STAGES.map((id, i) => ({
            id,
            name: CLIENT_DOCX_STAGE_NAMES[id],
            status: i < index ? 'complete' : i === index ? 'in_progress' : 'pending',
            progress: i < index ? 100 : i === index ? (phase === 'reading' ? 20 : phase === 'structure' ? 55 : phase === 'generating' ? 85 : 100) : 0,
        })));
    };

    const stagesFromBackendStatus = (
        stage: string,
        status: 'queued' | 'in_progress' | 'completed' | 'failed',
        backendProgress: number,
        message?: string,
    ): Array<{ id: string; name: string; status: 'pending' | 'in_progress' | 'complete' | 'failed'; progress: number; message?: string }> => {
        const sequence = BACKEND_STAGE_SEQUENCE as readonly string[];
        let currentIndex = sequence.indexOf(stage);
        if (currentIndex < 0) currentIndex = stage === 'failed' ? 3 : 0;

        return sequence.map((id, index) => {
            const name = BACKEND_STAGE_NAMES[id] || id;
            if (status === 'completed') {
                return { id, name, status: 'complete' as const, progress: 100 };
            }
            if (status === 'failed' && index === currentIndex) {
                return { id, name, status: 'failed' as const, progress: backendProgress, message };
            }
            if (index < currentIndex) {
                return { id, name, status: 'complete' as const, progress: 100 };
            }
            if (index === currentIndex) {
                return { id, name, status: 'in_progress' as const, progress: status === 'queued' ? 0 : backendProgress, message };
            }
            return { id, name, status: 'pending' as const, progress: 0 };
        });
    };
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
    const INPUT_ACCEPT = '.pdf,application/pdf,.tif,.tiff,image/tiff,.jpg,.jpeg,image/jpeg,.png,image/png,.bmp,image/bmp,.webp,image/webp,.gif,image/gif,.svg,image/svg+xml,.heic,image/heic,.avif,image/avif,image/*,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.odp,.ods,.rtf,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.ms-powerpoint,application/vnd.ms-excel,text/plain';

    const isOfficeDocument = (file: File): boolean => {
        const lower = file.name.toLowerCase();
        return OFFICE_EXTENSIONS.some(ext => lower.endsWith(ext));
    };

    const isSupportedImageFile = (file: File): boolean => {
        const lower = file.name.toLowerCase();
        const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.svg', '.heic', '.heif', '.avif', '.ico'];
        return imgExts.some(ext => lower.endsWith(ext)) || file.type.startsWith('image/');
    };

    const allFilesAreImages = (filesToCheck: File[]): boolean => {
        return filesToCheck.length > 0 && filesToCheck.every(f => isSupportedImageFile(f));
    };

    const getConversionApiBase = (): string => {
        const raw = (import.meta.env.VITE_API_BASE_URL || '').trim();
        // Empty base: use relative /v1/... URLs, which the Vite dev proxy
        // forwards to the backend (http://127.0.0.1:8090 locally).
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
            const response = await authFetch(item.url);
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

        const uploadResponse = await uploadWithPresignFallback(
            appFile.file,
            buildApiUrl(apiBase, '/v1/files/presign'),
            buildApiUrl(apiBase, '/v1/files/upload'),
        );

        if (uploadResponse.status === 401) {
            addToast(t.status.signInRequired || 'Sign in is required to convert office documents.', 'error');
            if (onAuthClick) onAuthClick();
            throw new Error('Sign in is required to convert office documents.');
        }

        if (!uploadResponse.ok) {
            const details = await uploadResponse.text();
            throw new Error(`Upload failed for ${appFile.file.name}: ${details}`);
        }

        const uploadPayload = await uploadResponse.json();
        const fileId = uploadPayload.fileId as string;
        if (!fileId) {
            throw new Error('Backend upload did not return fileId.');
        }

        const sourceFormat = (appFile.file.name.split('.').pop() || '').toLowerCase().replace(/^\./, '');
        const options: Record<string, unknown> = {};
        if (outputFormat === 'jpg' || outputFormat === 'png') {
            options.images = true;
            options.imageFormat = outputFormat;
            options.dpi = 200;
        }
        if (watermark) {
            options.watermark = { text: watermark };
        }
        if (securityOptions.password) {
            options.password = securityOptions.password;
        }
        if (addPageNumbers) {
            options.pageNumbers = true;
        }

        const convertResponse = await authFetch(buildApiUrl(apiBase, '/v1/convert'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fileId,
                sourceFormat,
                targetFormat: outputFormat,
                options,
            }),
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
            const statusResponse = await authFetch(buildApiUrl(apiBase, `/v1/jobs/${jobId}`));
            if (!statusResponse.ok) {
                const details = await statusResponse.text();
                throw new Error(`Status check failed for ${appFile.file.name}: ${details}`);
            }

            const statusPayload = await statusResponse.json();
            const backendProgress = typeof statusPayload.progress === 'number' ? statusPayload.progress : 0;
            const globalProgress = Math.round(((fileIndex + backendProgress / 100) / totalFiles) * 100);
            setProgress({ current: fileIndex + 1, total: totalFiles, percentage: globalProgress });
            setStatusMessage(getBackendStageMessage(statusPayload.stage, statusPayload.message));
            setConversionStages(stagesFromBackendStatus(
                statusPayload.stage || 'queued',
                statusPayload.status,
                backendProgress,
                statusPayload.message,
            ));

            if (statusPayload.status === 'failed') {
                throw new Error(statusPayload.error || `Backend conversion failed for ${appFile.file.name}`);
            }

            if (statusPayload.status === 'completed') {
                setConversionStages(stagesFromBackendStatus('completed', 'completed', 100));
                done = true;
                break;
            }

            await sleep(800);
        }

        const resultResponse = await authFetch(buildApiUrl(apiBase, `/v1/jobs/${jobId}/result`));
        if (!resultResponse.ok) {
            const details = await resultResponse.text();
            throw new Error(`Result fetch failed for ${appFile.file.name}: ${details}`);
        }

        const resultPayload = await resultResponse.json();
        const baseName = appFile.file.name.split('.').slice(0, -1).join('.') || appFile.file.name;

        if (outputFormat === 'pdf') {
            const pdfRef = resultPayload?.outputs?.pdf ?? resultPayload?.outputs?.primary;
            if (!pdfRef?.downloadUrl) {
                throw new Error(`PDF output missing for ${appFile.file.name}`);
            }
            return [{
                name: baseName,
                url: buildApiUrl(apiBase, pdfRef.downloadUrl),
                format: 'pdf',
            }];
        }

        // Handle DOCX output from backend (PDF -> DOCX via LibreOffice)
        if (outputFormat === 'docx') {
            const docxRef = resultPayload?.outputs?.primary;
            if (!docxRef?.downloadUrl) {
                throw new Error(`DOCX output missing for ${appFile.file.name}`);
            }
            return [{
                name: baseName,
                url: buildApiUrl(apiBase, docxRef.downloadUrl),
                format: 'docx',
            }];
        }

        const images = resultPayload?.outputs?.images;
        const imageList = Array.isArray(images) && images.length > 0
            ? images
            : (resultPayload?.outputs?.primary ? [resultPayload.outputs.primary] : []);
        if (imageList.length === 0) {
            throw new Error(`Image output missing for ${appFile.file.name}`);
        }

        return imageList.map((imageRef: any, idx: number) => ({
            name: `${baseName}_page_${idx + 1}`,
            url: buildApiUrl(apiBase, imageRef.downloadUrl),
            format: outputFormat,
        }));
    };

    const mergeImagesToPdfClientSide = async (orderedFiles: File[]): Promise<DownloadableFile> => {
        const { jsPDF } = jspdf;
        const baseName = orderedFiles[0]?.name?.split('.')[0] || 'combined';

        const canvases: HTMLCanvasElement[] = [];
        for (const file of orderedFiles) {
            const appFile = files.find(f => f.file === file);
            const existingCanvas = appFile?.pages?.[0]?.originalCanvas;
            if (existingCanvas) {
                canvases.push(existingCanvas);
                continue;
            }
            const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
                const img = new Image();
                const url = URL.createObjectURL(file);
                img.onload = () => {
                    const c = document.createElement('canvas');
                    c.width = img.width;
                    c.height = img.height;
                    c.getContext('2d')?.drawImage(img, 0, 0);
                    URL.revokeObjectURL(url);
                    resolve(c);
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error(`Could not read image: ${file.name}`));
                };
                img.src = url;
            });
            canvases.push(canvas);
        }

        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const availableWidth = pageWidth - margin * 2;
        const availableHeight = pageHeight - margin * 2;

        canvases.forEach((canvas, index) => {
            if (index > 0) pdf.addPage('a4', 'portrait');
            const ratio = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
            const width = canvas.width * ratio;
            const height = canvas.height * ratio;
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
        });

        const blob = pdf.output('blob');
        return {
            name: `${baseName}-all-pages`,
            url: URL.createObjectURL(blob),
            format: 'pdf',
        };
    };

    const processAndAddFiles = useCallback(async (newFiles: File[]) => {
        const allowedTypes = [
            'image/tiff',
            'image/jpeg',
            'image/png',
            'image/bmp',
            'image/webp',
            'image/gif',
            'image/svg+xml',
            'image/heic',
            'image/heif',
            'image/avif',
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
            file.type.startsWith('image/') ||
            isSupportedImageFile(file) ||
            file.name.toLowerCase().endsWith('.tif') ||
            file.name.toLowerCase().endsWith('.tiff') ||
            file.name.toLowerCase().endsWith('.pdf') ||
            file.name.toLowerCase().endsWith('.jpg') ||
            file.name.toLowerCase().endsWith('.jpeg') ||
            file.name.toLowerCase().endsWith('.png') ||
            file.name.toLowerCase().endsWith('.bmp') ||
            file.name.toLowerCase().endsWith('.webp') ||
            isOfficeDocument(file)
        );

        const newAppFiles: AppFile[] = validFiles.map(file => ({
            id: `${file.name}-${file.lastModified}-${file.size}`,
            file,
            pages: [],
            pageCount: 0,
            status: 'loading',
            outputFormat: globalOutputFormat, // Default to current global selection
        }));

        // Dedupe against the live list (ref) so we don't re-process files that
        // are already present — setState updaters may run after this loop.
        const existingIds = new Set(filesRef.current.map(f => f.id));
        const filesToProcess = newAppFiles.filter(f => !existingIds.has(f.id));
        if (filesToProcess.length > 0) {
            filesRef.current = [...filesRef.current, ...filesToProcess];
            setFiles(prev => {
                const ids = new Set(prev.map(f => f.id));
                return [...prev, ...filesToProcess.filter(f => !ids.has(f.id))];
            });
        }

        for (const appFile of filesToProcess) {
            const pages: PageInfo[] = [];
            let pageCount = 0;

            try {
                if (appFile.file.type === 'application/pdf' || appFile.file.name.toLowerCase().endsWith('.pdf')) {
                    const buffer = await appFile.file.arrayBuffer();
                    const loadingTask = pdfjsLib.getDocument({ data: buffer });
                    const pdf = await loadingTask.promise;
                    pageCount = pdf.numPages;
                    // Images are collected per page and attached AFTER all pages
                    // are read, so running headers/footers (the same image on
                    // many pages) can be detected by geometry and left out of the
                    // body flow — they would otherwise push every page's content
                    // down and inflate the page count.
                    const perPageImages: PdfPageImage[][] = [];
                    const perPageSegments: DocxSegment[][] = [];
                    
                    for (let i = 1; i <= pageCount; i++) {
                        const page = await pdf.getPage(i);
                        const viewport = page.getViewport({ scale: 2.0 }); // 2.0 for high resolution rendering
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d')!;
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        
                        await page.render({ canvasContext: context, viewport }).promise;

                        const [textContent, annotations] = await Promise.all([
                            page.getTextContent(),
                            page.getAnnotations().catch(() => []),
                        ]);

                        // Get actual PDF page dimensions (in points, 72 dpi)
                        const pdfPage = await page.getViewport({ scale: 1.0 });
                        const pdfWidth = pdfPage.width;
                        const pdfHeight = pdfPage.height;

                        const { blocks: docxBlocks, columnBlocks: docxColumnBlocks, columnCount, segments: docxSegments, geometry } = extractPdfDocxBlocks(textContent, annotations, pdfWidth, pdfHeight, await resolvePdfFontFamilies(page, textContent));
                        // Carry embedded raster figures into the DOCX (best-effort).
                        try {
                            const pageImages = await extractPdfPageImages(page, pdfWidth, pdfHeight);
                            perPageImages.push(pageImages);
                        } catch { perPageImages.push([]); }
                        perPageSegments.push(docxSegments);
                        const text = blocksToPlainParagraphs(docxBlocks);

                        pages.push({
                            id: `${appFile.id}-page-${i-1}`,
                            thumbnailUrl: canvas.toDataURL('image/png'),
                            rotation: 0,
                            originalCanvas: canvas,
                            text,
                            docxBlocks,
                            docxColumnBlocks,
                            docxSegments,
                            columnCount,
                            pageGeometry: geometry,
                        });
                    }

                    // Attach figures, skipping images that repeat across pages —
                    // those are running headers/footers. Placing them in the body
                    // flow pushes each page's content down and adds pages.
                    if (perPageImages.length > 0) {
                        const sig = (im: PdfPageImage) => `${Math.round(im.x)}:${Math.round(im.yPdf)}:${Math.round(im.w)}:${Math.round(im.h)}`;
                        const counts = new Map<string, number>();
                        for (const list of perPageImages) for (const im of list) {
                            const s = sig(im);
                            counts.set(s, (counts.get(s) || 0) + 1);
                        }
                        const repeatedThreshold = Math.max(2, Math.floor(perPageImages.length * 0.6));
                        const repeated = new Set<string>();
                        counts.forEach((c, s) => { if (c >= repeatedThreshold) repeated.add(s); });
                        for (let pi = 0; pi < perPageImages.length; pi++) {
                            const imgs = perPageImages[pi].filter(im => !repeated.has(sig(im)));
                            if (imgs.length) attachPdfImagesToSegments(perPageSegments[pi], imgs);
                        }
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
            addToast('All selected files must be image files', 'error');
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
        setStatusMessage('Combining images into PDF...');
        setProgress({ current: 0, total: 3, percentage: 10 });

        try {
            const combinedPdf = await mergeImagesToPdfClientSide(orderedFiles);

            setDownloadableFiles([combinedPdf]);
            setStatusMessage('✓ Images successfully combined into PDF');
            setProgress({ current: 3, total: 3, percentage: 100 });

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
    }, [addToast, autoDelete, onConversionComplete, onAddToHistory, files]);
    
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
        // Only apply each initialFiles batch once. handleFilesAdded identity
        // changes with globalOutputFormat and would otherwise re-add the same
        // File objects as duplicates (IDs are random, so id-set filtering fails).
        if (initialFiles.length === 0) return;
        if (lastInitialFilesRef.current === initialFiles) return;
        lastInitialFilesRef.current = initialFiles;
        handleFilesAdded(initialFiles);
    }, [initialFiles, handleFilesAdded]);

    useEffect(() => {
        filesRef.current = files;
    }, [files]);
    
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
        setConversionStages([]);
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
            const quality = 0.7;
            const base64Data = firstPageCanvas.toDataURL('image/jpeg', quality).split(',')[1];

            const prompt = "Suggest a concise, snake_case filename for this document. Examples: 'invoice_acme_corp_may_2024', 'quarterly_report_q2'. Do not include the file extension or markdown formatting.";

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            try {
                const apiBase = getConversionApiBase();
                const response = await authFetch(buildApiUrl(apiBase, '/v1/ai/suggest-filename'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageBase64: base64Data, mimeType: 'image/jpeg', prompt }),
                    signal: controller.signal,
                });

                if (!response.ok) {
                    return '';
                }

                const result = await response.json();
                const text = result?.suggestion || '';
                const cleanName = text.trim().replace(/`/g, '').replace(/\.pdf$/, '');
                return cleanName;
            } finally {
                clearTimeout(timeoutId);
            }
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

    // Font size that carries the most characters — the true body size. A plain
    // median-by-count is skewed by bursts of short same-size runs (an author grid
    // at 9pt out-counts body lines at 10pt but holds far less text), which would
    // make ordinary 10pt body lines look like headings.
    const dominantTextSize = (runs: { size: number; text?: string }[]): number => {
    const weights = new Map<number, number>();
    for (const r of runs) weights.set(r.size, (weights.get(r.size) || 0) + (r.text?.length || 0));
    let best = 0, bestSize = 0;
    for (const [size, w] of weights) if (w > best) { best = w; bestSize = size; }
    if (bestSize) return bestSize;
    const asc = runs.map(r => r.size).sort((a, b) => a - b);
    return asc.length ? asc[Math.floor(asc.length / 2)] : 12;
    };

    const normalizePdfFontName = (fontName: string): string => {
        let name = fontName
            .replace(/^[A-Z]{6}\+/, '')       // Remove PDF subset prefix like ABCDEF+
            .replace(/,.*$/, '')                // Remove comma suffixes
            .trim();
        const lower = name.toLowerCase();
        if (!lower) return 'Times New Roman';
        const compact = lower.replace(/[^a-z0-9]/g, '');
        // Map common PDF font names to standard Word fonts
        const fontMap: Record<string, string> = {
            'arialmt': 'Arial',
            'arial': 'Arial',
            'helvetica': 'Arial',
            'timesnewromanpsmt': 'Times New Roman',
            'timesnewroman': 'Times New Roman',
            'times-roman': 'Times New Roman',
            'times': 'Times New Roman',
            'courier': 'Courier New',
            'couriernew': 'Courier New',
            'couriernewpsmt': 'Courier New',
            'georgia': 'Georgia',
            'verdana': 'Verdana',
            'tahoma': 'Tahoma',
            'trebuchet': 'Trebuchet MS',
            'calibri': 'Calibri',
            'cambria': 'Cambria',
            'garamond': 'Garamond',
            'bookman': 'Bookman Old Style',
            'palatino': 'Palatino Linotype',
            'lucida console': 'Lucida Console',
            'symbol': 'Symbol',
            'wingdings': 'Wingdings',
            // Generic families pdf.js reports for base-14 fonts with no embed
            'serif': 'Times New Roman',
            'sans-serif': 'Arial',
            'sansserif': 'Arial',
            'monospace': 'Courier New',
        };
        if (fontMap[lower]) return fontMap[lower];
        if (fontMap[compact]) return fontMap[compact];

        // Embedded LaTeX faces. pdf.js reports their real BaseFont name (e.g.
        // "CMBX12", "LM Roman 10") but no reader has them installed, so route
        // each family to the closest standard Word font instead of letting the
        // generic "sans-serif" fallback turn the whole document into Arial.
        if (/cmss|lmsans|latinmodernsans|texgyreheros|texgyreadventor|texgyrechorus|sfrm/.test(compact)) return 'Arial';
        if (/cmtt|lmtt|latinmoderntypewriter|texgyrecursor/.test(compact)) return 'Courier New';
        if (/cmsy|cmex|cmmi|lmri|lmmi|lmsy|lmex|stix|xits|cambriamath|mathjax|asanamath/.test(compact)) return 'Cambria Math';
        if (/cmr|cmb|cmti|latinmodern|lmroman|lmodern|lmr|nimbusrom|texgyretermes|texgyrepagella|texgyrebonom|texgyreschola|computermodern/.test(compact)) return 'Times New Roman';

        // Generic family keywords: base-14 substitutions, webfonts and the
        // metric-compatible clones pdf.js may report by their real name.
        if (/mono|fixed|courier|consol|typewriter|menlo|inconsolata|\bcode\b|terminal/.test(lower)) return 'Courier New';
        if (/sans|helvetica|arial|grotesk|roboto|lato|\binter\b|montserrat|poppins|nunito|raleway|source\s?sans|fira\s?sans|noto\s?sans|dejavu\s?sans|liberation\s?sans|segoe|calibri|verdana|tahoma|trebuchet|futura|avenir|candara|corbel|optima/.test(lower)) return 'Arial';
        if (/serif|times|georgia|garamond|bookman|book\s?antiqua|palatino|baskerv|didot|bodoni|caslon|charter|cambria|constantia|merriweather|playfair|libertine|computer\s?modern|roman/.test(lower)) return 'Times New Roman';

        // Return title-cased version
        return name.split(/[\s_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    };

    const detectAlignment = (runs: { x: number; w: number; str: string }[], pageWidth: number, marginX: number): 'left' | 'center' | 'right' | 'justify' => {
        if (runs.length === 0) return 'left';
        if (runs.length === 1) {
            const r = runs[0];
            // Centre only when the line is inset from BOTH region edges by
            // similar amounts. Left/justified text sits flush against the region
            // left edge (inset ~0), so a full-width line is never mistaken for
            // centred; centred lines (titles, bylines, captions) are inset on
            // both sides, symmetrically. marginX/2*scale keeps tiny noise out.
            // ... symmetrically. A line that fills a COLUMN (>=90% of its width)
            // is normal flowing text that merely ends near the right edge —
            // real centred lines (titles, bylines, labels) leave a clear gap.
            // Full-width bands (pageWidth >= 450pt) are exempt: a centred
            // title line legitimately spans almost the whole text area.
            const leftInset = r.x - marginX;
            const rightInset = (pageWidth - marginX) - (r.x + r.w);
            const fillsColumn = pageWidth < 450 && r.w >= (pageWidth - 2 * marginX) * 0.9;
            if (leftInset > 3 && rightInset > 3 && Math.abs(leftInset - rightInset) < (leftInset + rightInset) * 0.3 && !fillsColumn) return 'center';
            // Right-aligned text sits flush to the region's right edge with its
            // centre deep in the right portion of the region — an indented
            // continuation line (bullet wraps, first-line indents) also ends
            // flush right, but its centre stays near the middle.
            const lineCenter = r.x + r.w / 2;
            if (rightInset <= 6 && lineCenter > marginX + (pageWidth - 2 * marginX) * 0.7) return 'right';
            return 'left';
        }
        const firstX = runs[0].x;
        const lastRun = runs[runs.length - 1];
        const lastEnd = lastRun.x + lastRun.w;
        const centerX = pageWidth / 2;
        const avgRunCenter = runs.reduce((sum, r) => sum + r.x + r.w / 2, 0) / runs.length;
        const isCentered = Math.abs(avgRunCenter - centerX) < pageWidth * 0.06 && Math.abs(firstX - (pageWidth - lastEnd)) < marginX * 1.5;
        if (isCentered) return 'center';
        const rightAligned = firstX > pageWidth * 0.4 && lastEnd > pageWidth - marginX * 0.3;
        if (rightAligned && runs.length <= 3) return 'right';
        const gaps: number[] = [];
        for (let i = 1; i < runs.length; i++) {
            gaps.push(runs[i].x - (runs[i - 1].x + runs[i - 1].w));
        }
        const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
        const rightMarginGap = pageWidth - lastEnd;
        if (rightMarginGap < marginX * 0.3 && avgGap < marginX * 0.2) return 'justify';
        return 'left';
    };

    interface PdfPageImage {
        dataUrl: string;
        x: number;      // left edge in PDF points
        yPdf: number;   // bottom edge, PDF space (origin bottom-left)
        w: number;
        h: number;
    }

    // Walk the page operator list with a manual CTM so embedded raster
    // images (figures/diagrams) can be carried into the DOCX. Never throws —
    // image extraction is optional and must not break text conversion.
    const extractPdfPageImages = async (page: any, pageWidth: number, pageHeight: number): Promise<PdfPageImage[]> => {
        const images: PdfPageImage[] = [];
        try {
            const OPS = pdfjsLib.OPS;
            const ops = await page.getOperatorList();
            const mul = (m: number[], n: number[]): number[] => [
                m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
                m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
                m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
            ];
            const isMatrix = (a: any): a is number[] =>
                Array.isArray(a) && a.length === 6 && typeof a[0] === 'number';

            const objToDataUrl = (obj: any): string | null => {
                try {
                    if (!obj) return null;
                    if (typeof obj === 'string' && obj.startsWith('data:')) return obj;
                    const w = obj.bitmap?.width ?? obj.width;
                    const h = obj.bitmap?.height ?? obj.height;
                    if (!w || !h || w < 2 || h < 2 || w > 8000 || h > 8000) return null;
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return null;
                    const isCanvasLike = typeof obj.getContext === 'function';
                    const isBitmapLike = !!obj.bitmap;
                    if (!isCanvasLike && !isBitmapLike && obj.data) {
                        // Raw decoded pixels (pdf.js stores RGBA/RGB bitmaps in objs).
                        if (obj.data.length === w * h * 4) {
                            const px = obj.data instanceof Uint8ClampedArray ? obj.data : new Uint8ClampedArray(obj.data);
                            ctx.putImageData(new ImageData(px, w, h), 0, 0);
                        } else if (obj.data.length === w * h * 3) {
                            const rgba = new Uint8ClampedArray(w * h * 4);
                            for (let i = 0, j = 0; i < w * h; i++, j += 4) {
                                rgba[j] = obj.data[i * 3];
                                rgba[j + 1] = obj.data[i * 3 + 1];
                                rgba[j + 2] = obj.data[i * 3 + 2];
                                rgba[j + 3] = 255;
                            }
                            ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
                        } else {
                            return null; // 1-bit masks / exotic formats: skip safely
                        }
                    } else {
                        ctx.drawImage(obj.bitmap || obj, 0, 0, w, h);
                    }
                    return canvas.toDataURL('image/png');
                } catch {
                    return null;
                }
            };

            // pdf.js delivers image objects slightly AFTER the operator-list promise
            // resolves, so ids are collected first and awaited (with timeout)
            // before conversion. Bounded to 5s total regardless of count.
            interface PendingPaint { objId?: string; inlineObj?: any; x: number; yPdf: number; w: number; h: number }
            const pending: PendingPaint[] = [];
            const stack: number[][] = [];
            let ctm = [1, 0, 0, 1, 0, 0];
            for (let k = 0; k < ops.fnArray.length; k++) {
                const fn = ops.fnArray[k];
                const args = ops.argsArray[k];
                if (fn === OPS.save) {
                    stack.push(ctm.slice());
                } else if (fn === OPS.restore) {
                    const prev = stack.pop();
                    if (prev) ctm = prev;
                } else if (fn === OPS.transform) {
                    // pdf.js 3.x nests the matrix, 4+/5.x passes it flat.
                    const mat = isMatrix(args) ? args : (isMatrix(args?.[0]) ? args[0] : null);
                    if (mat) ctm = mul(ctm, mat);
                } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
                    const w = Math.hypot(ctm[0], ctm[1]);
                    const h = Math.hypot(ctm[2], ctm[3]);
                    if (w < 6 || h < 6 || w > pageWidth * 1.5 || h > pageHeight * 1.5) continue;
                    if (pending.length >= 40) continue;
                    if (fn === OPS.paintInlineImageXObject) {
                        pending.push({ inlineObj: args?.[0], x: ctm[4], yPdf: ctm[5], w, h });
                    } else {
                        pending.push({ objId: args?.[0], x: ctm[4], yPdf: ctm[5], w, h });
                    }
                }
            }

            const waitForObj = (id: string): Promise<any> => new Promise(resolve => {
                const t0 = Date.now();
                const tryGet = (): any | null => {
                    try { if (page.objs?.has?.(id)) return page.objs.get(id); } catch { /* not yet */ }
                    try { if (page.commonObjs?.has?.(id)) return page.commonObjs.get(id); } catch { /* not yet */ }
                    return null;
                };
                const check = () => {
                    const found = tryGet();
                    if (found) { resolve(found); return; }
                    if (Date.now() - t0 > 5000) { resolve(null); return; }
                    setTimeout(check, 25);
                };
                check();
            });

            const resolved = await Promise.all(pending.map(p =>
                p.inlineObj ? Promise.resolve(p.inlineObj) : waitForObj(p.objId!)
            ));
            for (let pi = 0; pi < pending.length; pi++) {
                const p = pending[pi];
                const dataUrl = resolved[pi] ? objToDataUrl(resolved[pi]) : null;
                if (!dataUrl) continue;
                images.push({ dataUrl, x: p.x, yPdf: p.yPdf, w: p.w, h: p.h });
            }
        } catch {
            // Encrypted/odd PDFs: fall back to text-only conversion.
        }
        return images;
    };

    // Place extracted images into the already-detected layout segments,
    // matched by vertical overlap (segment) and horizontal centre (column).
    const attachPdfImagesToSegments = (segments: DocxSegment[], images: PdfPageImage[]): void => {
        if (!segments?.length || !images?.length) return;
        for (const img of images) {
            const imgTop = img.yPdf + img.h;
            const centerY = img.yPdf + img.h / 2;
            const centerX = img.x + img.w / 2;
            const imageBlock: DocxBlock = {
                type: 'image',
                runs: [],
                image: { dataUrl: img.dataUrl, width: img.w, height: img.h },
                y: centerY,
                alignment: 'left',
                spacing: { before: 120, after: 120 },
            };
            const collectYs = (seg: DocxSegment): number[] => {
                const ys: number[] = [];
                const take = (b?: DocxBlock) => { if (b && typeof b.y === 'number') ys.push(b.y); };
                (seg.blocks || []).forEach(take);
                (seg.leadBlocks || []).forEach(take);
                (seg.columns || []).forEach(col => col.forEach(take));
                return ys;
            };
            // Two-pass segment selection: first prefer segments that tightly
            // contain the image (keeps a top-of-page figure out of a tiny
            // header band); only then relax with a 45pt slack.
            interface SegScore { seg: DocxSegment; overlap: number; blocks: number }
            const scores: SegScore[] = [];
            for (const seg of segments) {
                const ys = collectYs(seg);
                if (!ys.length) continue;
                scores.push({
                    seg,
                    overlap: Math.min(Math.max(...ys), imgTop) - Math.max(Math.min(...ys), img.yPdf),
                    blocks: ys.length,
                });
            }
            const pick = (s: SegScore[]) => s.sort((a, b) => (b.overlap - a.overlap) || (b.blocks - a.blocks))[0]?.seg;
            const tight = scores.filter(s => s.overlap > 0);
            const relaxed = scores.map(s => ({ ...s, overlap: s.overlap + 45 }));
            const bestSeg = pick(tight) ?? pick(relaxed) ?? segments[segments.length - 1];
            const seg = bestSeg;
            const insertOrdered = (arr: DocxBlock[]) => {
                let idx = arr.findIndex(b => typeof b.y === 'number' && b.y < centerY);
                if (idx < 0) idx = arr.length;
                arr.splice(idx, 0, imageBlock);
                // The following block's `before` spacing was derived from the
                // source vertical gap, which INCLUDED the figure. Now that the
                // image block itself occupies that height, reduce the next
                // block's before by the image height so the space isn't
                // double-counted (which overflowed columns onto extra pages).
                const next = arr[idx + 1];
                if (next && next.type !== 'image' && next.spacing) {
                    const imgTwips = Math.round(img.h * 20);
                    next.spacing.before = Math.max(0, (next.spacing.before || 0) - imgTwips);
                }
            };
            if (seg.kind === 'columns' && seg.columns?.length) {
                const ranges = seg.columnRanges;
                const firstRangeWidth = ranges?.length ? ranges[0].maxX - ranges[0].minX : 0;
                if (ranges && ranges.length > 1 && firstRangeWidth > 0 && img.w > firstRangeWidth * 1.1) {
                    // Full-width figure inside a column band: keep it above the
                    // column table so it never breaks the two-column flow.
                    if (!seg.leadBlocks) seg.leadBlocks = [];
                    insertOrdered(seg.leadBlocks);
                    continue;
                }
                let colIdx = 0;
                if (ranges?.length) {
                    let bestDist = Infinity;
                    for (let ci = 0; ci < ranges.length; ci++) {
                        const r = ranges[ci];
                        if (centerX >= r.minX && centerX <= r.maxX) { colIdx = ci; bestDist = -1; break; }
                        const dist = centerX < r.minX ? r.minX - centerX : centerX - r.maxX;
                        if (dist < bestDist) { bestDist = dist; colIdx = ci; }
                    }
                    const cr = ranges[colIdx];
                    const insetL = img.x - cr.minX;
                    const insetR = cr.maxX - (img.x + img.w);
                    if (insetL > 4 && insetR > 4 && Math.abs(insetL - insetR) <= Math.max(insetL, insetR) * 0.6) {
                        imageBlock.alignment = 'center';
                    }
                }
                const target = seg.columns[Math.min(colIdx, seg.columns.length - 1)];
                insertOrdered(target);
            } else if (seg.blocks) {
                insertOrdered(seg.blocks);
            } else if (seg.leadBlocks) {
                insertOrdered(seg.leadBlocks);
            }
        }
    };

    // Resolve the REAL font family behind each loaded font name. pdf.js's text
    // `styles` expose only a generic family (serif / sans-serif / monospace) —
    // often wrong, and always lossy for embedded faces (Computer Modern reports
    // as sans-serif). The true BaseFont name lives on the loaded font objects in
    // page.commonObjs; read it (bounded wait) so the DOCX references the correct
    // family instead of inventing "Arial"/"Monospace".
    const resolvePdfFontFamilies = async (page: any, textContent: any): Promise<Record<string, string>> => {
        const result: Record<string, string> = {};
        const ids: string[] = Object.keys(textContent?.styles || {});
        if (ids.length === 0) return result;
        const pending = ids.slice();
        const deadline = Date.now() + 3000;
        while (pending.length > 0 && Date.now() < deadline) {
            for (let i = pending.length - 1; i >= 0; i -= 1) {
                const id = pending[i];
                let font: any = null;
                try {
                    if (page?.commonObjs?.has?.(id)) font = page.commonObjs.get(id);
                } catch { font = null; }
                if (!font) continue;
                const rawName = String(font.name || '').replace(/^[A-Z]{6}\+/, '').trim();
                const css = String(font.systemFontInfo?.css || '');
                const cssFamily = css ? css.split(',')[0].replace(/["']/g, '').trim() : '';
                // pdf.js reports unembedded/Type3 faces as "Type3"/"TrueType" or
                // an internal g_dN_fM id — none is a real family, so prefer the
                // systemFontInfo CSS family and otherwise leave it unresolved.
                const isPlaceholder = !rawName || /^g_d\d+_f\d+$/i.test(rawName) || /^type\d$/i.test(rawName) || /^truetype$/i.test(rawName);
                const family = isPlaceholder ? cssFamily : rawName;
                if (family) result[id] = family;
                pending.splice(i, 1);
            }
            if (pending.length > 0) await new Promise(resolve => setTimeout(resolve, 25));
        }
        return result;
    };

    const extractPdfDocxBlocks = (textContent: any, annotations: any[], pageWidth?: number, pageHeight?: number, fontNames?: Record<string, string>): { blocks: DocxBlock[]; columnBlocks: DocxBlock[][]; columnCount: number; segments: DocxSegment[]; geometry: PageGeometry } => {
        interface RawRun {
            x: number; y: number; h: number; w: number;
            size: number; str: string;
            bold: boolean; italic: boolean; underline: boolean;
            fontFamily: string; color: string;
            hasEOL: boolean;
        }
        const styles: Record<string, any> = textContent?.styles || {};
        const pw = pageWidth || 612;
        const ph = pageHeight || 792;
        // Placeholder margins; overridden below from the page's measured ink
        // extents so the printable box matches the real content (see the
        // content-derived block after rawRuns is built).
        let marginLeft = pw * 0.1;
        let marginRight = pw * 0.1;
        let marginTop = ph * 0.08;
        let marginBottom = ph * 0.08;

        const rawRuns: RawRun[] = [];
        for (const it of (textContent?.items || [])) {
            const s = it?.str;
            if (typeof s !== 'string' || s.trim().length === 0) continue;
            const m = it.transform as number[] | undefined;
            if (!m || m.length < 6) continue;

            const st = it.fontName ? styles[it.fontName] : null;
            // Prefer the font's REAL family (resolved from page.commonObjs):
            // pdf.js's `styles` only carry a generic serif/sans-serif/monospace
            // fallback, so embedded faces lose their identity otherwise.
            const rawFontName = String((it.fontName && fontNames?.[it.fontName]) || st?.fontFamily || it.font?.name || it.fontName || '');
            const fontFamily = normalizePdfFontName(rawFontName);
            const fontSize = Math.abs(st?.fontSize || 0) || Math.abs(it.height ?? 0) || 10;
            const bold = /\bbold\b|\bblack\b|\bsemibold\b|\bheavy\b|\bcmsc\b|\bcmbx\d*\b|\bbx\d+\b/i.test(rawFontName);
            const italic = /\bitalic\b|\boblique\b|\bcmti\d*\b|\bcmmi\d*\b|\blmri\d*\b|\blmmi\d*\b/i.test(rawFontName);
            const underline = /\bunderlined?\b/i.test(rawFontName);
            let color = '';
            if (it.color && Array.isArray(it.color) && it.color.length >= 3) {
                const [r, g, b] = it.color;
                color = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
            }

            rawRuns.push({
                x: m[4],
                y: m[5],
                h: Math.abs(it.height ?? 0) || fontSize,
                w: Math.abs(it.width ?? 0) || (s.length * fontSize * 0.5),
                size: fontSize,
                str: s,
                bold,
                italic,
                underline,
                fontFamily,
                color,
                hasEOL: !!it.hasEOL,
            });
        }
        // Content-derived page margins (generic, not per-paper): the printable
        // box is the measured ink extents of the page's text. Hardcoded
        // percentage margins make content wider than the printable area, which
        // squeezes columns and overflows pages; deriving left/right from the
        // real extents lets column widths fit exactly.
        if (rawRuns.length > 0) {
            let cMinX = pw, cMaxX = 0, cTopY = 0, cBotY = ph;
            for (const r of rawRuns) {
                if (r.x < cMinX) cMinX = r.x;
                if (r.x + r.w > cMaxX) cMaxX = r.x + r.w;
                if (r.y + r.h > cTopY) cTopY = r.y + r.h;  // highest glyph top (PDF y-up)
                if (r.y - r.h < cBotY) cBotY = r.y - r.h; // lowest text bottom
            }
            const contentW = cMaxX - cMinX;
            const contentH = cTopY - cBotY;
            // Guard degenerate/near-empty pages (scanned, almost no text).
            if (contentW > pw * 0.3 && contentH > ph * 0.3) {
                marginLeft = Math.max(cMinX, 0);
                marginRight = Math.max(pw - cMaxX, 0);
                marginTop = Math.max(ph - cTopY, 0);
                marginBottom = Math.max(cBotY, 0);
            }
        }
        if (rawRuns.length === 0) return { blocks: [], columnBlocks: [], columnCount: 1, segments: [], geometry: { width: pw, height: ph, marginLeft, marginRight, marginTop, marginBottom } };

        const linkRects: { url: string; x1: number; y1: number; x2: number; y2: number }[] = [];
        for (const a of (annotations || [])) {
            if (a?.subtype === 'Link' && a?.url && Array.isArray(a?.rect) && a.rect.length === 4) {
                const [x1, y1, x2, y2] = a.rect;
                linkRects.push({ url: a.url, x1, y1, x2, y2 });
            }
        }
        const findUrl = (x: number, y: number, w: number, h: number): string | undefined => {
            const cx = x + w / 2;
            const cy = y + h / 2;
            for (const lr of linkRects) {
                if (cx >= lr.x1 && cx <= lr.x2 && cy >= lr.y1 && cy <= lr.y2) return lr.url;
            }
            return undefined;
        };

        // Page-wide body size — reference for heading classification so a band
        // that contains only large title text is still recognised as a heading
        // rather than "body" relative to itself.
        const globalBodySize = dominantTextSize(rawRuns);

        // Segment the page into horizontal layout bands, then detect columns
        // per band. IEEE pages stack a full-width title, a 3-column author grid
        // and a 2-column body; a single per-page detection lets the narrow
        // author columns poison the body's gutter and collapse everything to
        // one interleaved column. Per-band detection isolates each region.
        const bands = segmentIntoBands(rawRuns);

        const allBlocks: DocxBlock[] = [];
        const segments: DocxSegment[] = [];
        let primaryColumnBlocks: DocxBlock[][] = [];
        let primaryColumnCount = 1;

        for (const band of bands) {
            // Dominant body size for this whole band (all its columns together),
            // so one column's minority size can't inflate its own lines to headings.
            const bandBodySize = dominantTextSize(band);
            const columnRanges = detectColumns(band, pw);

            if (columnRanges.length >= 2) {
                const sortedRanges = [...columnRanges].sort((a, b) => a.minX - b.minX);
                const gaps: { left: number; right: number }[] = [];
                for (let gi = 0; gi < sortedRanges.length - 1; gi++) {
                    gaps.push({ left: sortedRanges[gi].maxX, right: sortedRanges[gi + 1].minX });
                }

                // A run is full-width when it overlaps two or more column ranges
                // (i.e. it bridges a gutter). Per-run only — never by clustering
                // same-baseline rows, which would fuse columns together.
                const overlapsColumn = (r: typeof band[number]) =>
                    columnRanges.filter(cr => r.x < cr.maxX && r.x + r.w > cr.minX).length;

                const fullWidthRuns = band.filter(r => overlapsColumn(r) >= 2);
                const columnOnlyRuns = band.filter(r => overlapsColumn(r) < 2);

                const leadBlocks: DocxBlock[] = [];
                if (fullWidthRuns.length > 0) {
                    const fb = processColumnRunsEnhanced(fullWidthRuns, findUrl, pw, pw, marginLeft, bandBodySize, globalBodySize);
                    for (const b of fb) b.fullWidth = true;
                    leadBlocks.push(...fb);
                }

                const columns: DocxBlock[][] = [];
                const keptRanges: { minX: number; maxX: number }[] = [];
                for (const colRange of sortedRanges) {
                    const colRuns = columnOnlyRuns.filter(r => {
                        const midX = r.x + r.w / 2;
                        return midX >= colRange.minX && midX <= colRange.maxX;
                    });
                    if (colRuns.length === 0) continue;
                    columns.push(processColumnRunsEnhanced(colRuns, findUrl, colRange.maxX - colRange.minX, pw, marginLeft, bandBodySize, globalBodySize));
                    keptRanges.push({ minX: colRange.minX, maxX: colRange.maxX });
                }

                if (columns.length >= 2) {
                    segments.push({ kind: 'columns', columns, leadBlocks, columnRanges: keptRanges });
                    allBlocks.push(...leadBlocks);
                    for (const col of columns) allBlocks.push(...col);
                    if (primaryColumnCount === 1) {
                        primaryColumnCount = columns.length;
                        primaryColumnBlocks = columns;
                    }
                    continue;
                }
                // Fewer than 2 usable columns — fall through to linear.
                const linearBlocks = [...leadBlocks];
                for (const col of columns) linearBlocks.push(...col);
                segments.push({ kind: 'linear', blocks: linearBlocks });
                allBlocks.push(...linearBlocks);
                continue;
            }

            // Single column band — process all its runs together.
            const singleColBlocks = processColumnRunsEnhanced(band, findUrl, pw, pw, marginLeft, bandBodySize, globalBodySize);
            segments.push({ kind: 'linear', blocks: singleColBlocks });
            allBlocks.push(...singleColBlocks);
            if (primaryColumnCount === 1) {
                primaryColumnBlocks = [singleColBlocks];
            }
        }

        return { blocks: allBlocks, columnBlocks: primaryColumnBlocks, columnCount: primaryColumnCount, segments, geometry: { width: pw, height: ph, marginLeft, marginRight, marginTop, marginBottom } };
    };

    const detectColumns = (
        rawRuns: { x: number; y: number; h: number; w: number; size: number; str: string; bold: boolean; italic: boolean }[],
        pageWidth: number
    ): { minX: number; maxX: number }[] => {
        if (rawRuns.length === 0) return [{ minX: 0, maxX: pageWidth }];

        let contentMin = pageWidth;
        let contentMax = 0;
        for (const r of rawRuns) {
            if (r.x < contentMin) contentMin = r.x;
            if (r.x + r.w > contentMax) contentMax = r.x + r.w;
        }
        const contentWidth = contentMax - contentMin;
        if (contentWidth <= 0) return [{ minX: 0, maxX: pageWidth }];

        // Full-width runs (IEEE title/author strips) span nearly the whole content
        // width and would smear ink into the column gutter — exclude only those.
        // pdf.js usually emits one item per visual line, so a column's justified
        // lines legitimately reach most of the column width; a 0.35 cut would
        // throw those away and leave the profile with almost no signal.
        const bodyRuns = rawRuns.filter(r => r.w < contentWidth * 0.75);
        if (bodyRuns.length < 6) return [{ minX: 0, maxX: pageWidth }];

        // Ink-density profile: every body run paints its height into every
        // x-slice it covers. Two justified columns produce two dense bands
        // separated by a nearly empty gutter.
const SLICES = 160;
    const coverage = new Array(SLICES).fill(0);
    for (const r of bodyRuns) {
        const b0 = Math.max(0, Math.min(SLICES - 1, Math.floor((r.x / pageWidth) * SLICES)));
        const b1 = Math.max(0, Math.min(SLICES - 1, Math.floor(((r.x + r.w) / pageWidth) * SLICES)));
        for (let b = b0; b <= b1; b++) coverage[b] += Math.max(r.h, 1);
    }
    const maxCoverage = Math.max(...coverage);
    // A gutter is "empty" when a slice carries only residue from a line-end
    // dipping a few points past its column — keep the bar low enough to catch
    // that while still recognizing real text columns (dense coverage).
    const emptyThreshold = Math.max(1, maxCoverage * 0.1);
        const spacer = (b: number) => coverage[b] < emptyThreshold;

        // Consecutive empty slices form candidate gutters.
        const bands: { start: number; end: number }[] = [];
        let bandStart = -1;
        for (let b = 0; b < SLICES; b++) {
            if (spacer(b)) {
                if (bandStart < 0) bandStart = b;
            } else if (bandStart >= 0) {
                bands.push({ start: (bandStart / SLICES) * pageWidth, end: (b / SLICES) * pageWidth });
                bandStart = -1;
            }
        }
        if (bandStart >= 0) bands.push({ start: (bandStart / SLICES) * pageWidth, end: pageWidth });
        bands.sort((a, b) => b.end - b.start - (a.end - a.start));

        // A band is a real gutter only when it sits inside the content area,
        // is wide enough to separate columns, and both resulting sides hold
        // enough glyphs to be distinct columns.
        const edgePad = pageWidth * 0.05;
        const separators: { start: number; end: number }[] = [];
        for (const band of bands) {
            if (band.end - band.start < pageWidth * 0.006) continue; // ~4pt minimum gutter
            const center = (band.start + band.end) / 2;
            if (center < contentMin + edgePad || center > contentMax - edgePad) continue;
            separators.push(band);
            if (separators.length >= 2) break;
        }
        separators.sort((a, b) => a.start - b.start);
        if (separators.length === 0) return [{ minX: 0, maxX: pageWidth }];

        const ranges: { minX: number; maxX: number }[] = [];
        let cursor = contentMin;
        for (const sep of separators) {
            ranges.push({ minX: cursor, maxX: sep.start });
            cursor = sep.end;
        }
        ranges.push({ minX: cursor, maxX: contentMax });

        const colMinWidth = pageWidth * 0.12;
        const minRunsPerCol = Math.max(4, Math.ceil(bodyRuns.length * 0.08));
        const viable = ranges
            .filter(range => range.maxX - range.minX >= colMinWidth)
            .map(range => ({
                ...range,
                runs: bodyRuns.filter(r => {
                    const mid = r.x + r.w / 2;
                    return mid >= range.minX && mid <= range.maxX;
                }).length,
            }))
            .filter(c => c.runs >= minRunsPerCol);

        if (viable.length >= 2) {
            return viable.map(({ minX, maxX }) => ({ minX, maxX }));
        }

        return [{ minX: 0, maxX: pageWidth }];
    };

    /**
     * Cluster the page's runs into horizontal layout bands (regions) by
     * grouping top-to-bottom and splitting whenever a vertical gap larger than
     * the band threshold appears. This isolates a full-width title from a
     * multi-column author grid from a two-column body, each of which needs its
     * own column detection.
     */
    const segmentIntoBands = <T extends { y: number; h: number }>(runs: T[]): T[][] => {
        if (runs.length === 0) return [];
        const sorted = [...runs].sort((a, b) => b.y - a.y);
        const heights = runs.map(r => r.h).sort((a, b) => a - b);
        const medianH = heights[Math.floor(heights.length / 2)] || 10;
        const bandGapThreshold = Math.max(medianH * 2.5, 24);

        const bands: T[][] = [];
        let current: T[] = [];
        let bandBottom = Infinity;
        for (const r of sorted) {
            const rBottom = r.y - r.h;
            if (current.length === 0) {
                current.push(r);
                bandBottom = rBottom;
            } else if (r.y >= bandBottom - bandGapThreshold) {
                current.push(r);
                if (rBottom < bandBottom) bandBottom = rBottom;
            } else {
                bands.push(current);
                current = [r];
                bandBottom = rBottom;
            }
        }
        if (current.length) bands.push(current);
        return bands;
    };

    const processColumnRunsEnhanced = (
        rawRuns: { x: number; y: number; h: number; w: number; size: number; str: string; bold: boolean; italic: boolean; underline: boolean; fontFamily: string; color: string; hasEOL: boolean }[],
        findUrl: (x: number, y: number, w: number, h: number) => string | undefined,
        colWidth: number,
        pageWidth: number,
        marginLeft: number,
        refBodySize?: number,
        refGlobalBodySize?: number
    ): DocxBlock[] => {
        // Sort top-to-bottom (PDF y grows upward), then left-to-right
        rawRuns.sort((a, b) => (b.y - a.y) || (a.x - b.x));

        // Group into visual lines by baseline proximity
        const lines: { y: number; h: number; runs: typeof rawRuns[number][] }[] = [];
        for (const r of rawRuns) {
            const last = lines[lines.length - 1];
            if (last && Math.abs(last.y - r.y) <= Math.max(last.h, r.h) * 0.4) {
                last.runs.push(r);
                last.h = Math.max(last.h, r.h);
            } else {
                lines.push({ y: r.y, h: r.h, runs: [r] });
            }
        }

        // Sort runs within each line left-to-right
        for (const line of lines) {
            line.runs.sort((a, b) => a.x - b.x);
        }

        // Body size for heading classification. The caller passes the char-weighted
        // dominant size of the whole band (a minority size inside one column
        // can't skew it) plus the page-wide reference. When the band is uniformly
        // much larger than the page body (a title band), fall back to the page
        // reference so its lines read as headings rather than "body relative to
        // itself"; otherwise compare within the band so a 10pt body line sitting
        // beside a 9pt abstract isn't mistaken for a heading.
        const bandBodySize = refBodySize || dominantTextSize(rawRuns);
        const bodySize = refGlobalBodySize && bandBodySize > refGlobalBodySize * 1.4 ? refGlobalBodySize : bandBodySize;
        const bodyFont = rawRuns.find(r => Math.abs(r.size - bandBodySize) < 1.5)?.fontFamily || rawRuns[0]?.fontFamily || 'Times New Roman';

        // Build text runs per line, adding spaces for horizontal gaps
        const lineTexts: {
            text: string;
            runs: DocxRun[];
            y: number;
            h: number;
            lineSize: number;
            lineFont: string;
            lineBold: boolean;
            lineItalic: boolean;
            xStart: number;
            xEnd: number;
            fullLineWidth: number;
        }[] = [];

        for (const line of lines) {
            const lineSize = Math.max(...line.runs.map(r => r.size));
            const lineFont = line.runs.reduce((prev, r) => {
                const count = line.runs.filter(rr => rr.fontFamily === prev).length;
                const thisCount = line.runs.filter(rr => rr.fontFamily === r.fontFamily).length;
                return thisCount > count ? r.fontFamily : prev;
            }, line.runs[0]?.fontFamily || bodyFont);
            const lineBold = line.runs.filter(r => r.bold).length > line.runs.length * 0.5;
            const lineItalic = line.runs.filter(r => r.italic).length > line.runs.length * 0.5;

            const merged: DocxRun[] = [];
            for (let ri = 0; ri < line.runs.length; ri++) {
                const r = line.runs[ri];
                const url = findUrl(r.x, r.y, r.w, r.h);

                // Smart spacing between runs based on horizontal gap
                if (ri > 0) {
                    const prev = line.runs[ri - 1];
                    const gap = r.x - (prev.x + prev.w);
                    const avgCharWidth = (prev.w / Math.max(prev.str.length, 1) + r.w / Math.max(r.str.length, 1)) / 2;
                    const prevEndsWithSpace = prev.str.endsWith(' ');
                    const nextStartsWithSpace = r.str.startsWith(' ');
                    if (!prevEndsWithSpace && !nextStartsWithSpace && gap > avgCharWidth * 0.1) {
                        const lastMerged = merged[merged.length - 1];
                        if (lastMerged) {
                            lastMerged.text += ' ';
                        }
                    }
                }

                const runColor = r.color && r.color !== '#000000' ? r.color : undefined;
                const last = merged[merged.length - 1];
                if (last && last.bold === (r.bold || lineBold) && last.italic === (r.italic || lineItalic) && last.url === url && last.fontFamily === lineFont && last.fontSize === Math.round(lineSize)) {
                    last.text += r.str;
                } else {
                    merged.push({
                        text: r.str,
                        bold: r.bold || lineBold,
                        italic: r.italic || lineItalic,
                        underline: r.underline,
                        url,
                        fontFamily: lineFont,
                        fontSize: Math.round(lineSize),
                        color: runColor,
                    });
                }
            }

            // A leading Type3 "bullet" glyph arrives from pdf.js as a lone C1
            // control char (e.g. U+0088). Restore it to a real bullet so the list
            // item keeps its marker instead of silently dropping it.
            const leadChar = merged[0]?.text?.[0];
            if (leadChar && leadChar >= '\u0080' && leadChar <= '\u009F') {
                merged[0].text = '\u2022' + merged[0].text.slice(1);
            }

            const fullText = merged.map(r => r.text).join('');
            const xStart = line.runs[0]?.x || 0;
            const xEnd = line.runs[line.runs.length - 1]?.x + (line.runs[line.runs.length - 1]?.w || 0) || 0;
            lineTexts.push({
                text: fullText,
                runs: merged,
                y: line.y,
                h: line.h,
                lineSize,
                lineFont,
                lineBold,
                lineItalic,
                xStart,
                xEnd,
                fullLineWidth: xEnd - xStart,
            });
        }

        // Join consecutive lines into paragraphs
        const blocks: DocxBlock[] = [];
        let currentRuns: DocxRun[] = [];
        let currentType: DocxBlock['type'] = 'body';
        let currentFontSize = bodySize;
        let currentFont = bodyFont;
        let prevLineY: number | null = null;
        let prevLineH = 0;
        let prevLineSize = bodySize;
        let currentLineStartX = 0;
        let currentLineEndX = 0;
        let currentLineY = 0;
        let paraLocalGaps: number[] = [];
        let paraLineCount = 0;

        // Content region for alignment: a narrow column is judged against its own
        // bounds (text centred inside a column must not be measured by the page
        // centre), full-width content against the page margins. detectAlignment
        // takes pageWidth/marginX, so pass values whose midpoint is the region
        // centre and whose margin is the region's left edge.
        let minRunX = Infinity;
        for (const rr of rawRuns) if (rr.x < minRunX) minRunX = rr.x;
        if (!isFinite(minRunX)) minRunX = marginLeft;
        const columnar = colWidth < pageWidth * 0.9;
        const regionLeft = columnar ? minRunX : marginLeft;
        const regionRight = columnar ? minRunX + colWidth : pageWidth - marginLeft;

        const flushParagraph = () => {
            if (currentRuns.length > 0) {
                const fullText = currentRuns.map(r => r.text).join('');
                if (fullText.trim().length > 0) {
                    // Alignment from the paragraph's first line REAL geometry —
                    // estimating width as chars*size*0.5 blows past the page for
                    // multi-line paragraphs and shifted centred titles off-centre.
                    const paraAlignment = detectAlignment(
                        [{ x: currentLineStartX, w: Math.max(currentLineEndX - currentLineStartX, 0), str: fullText }],
                        regionLeft + regionRight,
                        regionLeft
                    );
                    // Exact line height from the measured within-paragraph pitch.
                    // For body runs (maxFs ≈ bodySize) the measured pitch wins —
                    // forcing a font-metric floor here overrode it by ~1pt/line
                    // and overflowed columns onto extra pages. The floor only
                    // guards genuinely oversized (heading) runs against clipping.
                    // Within one paragraph the lines advance at the paragraph's OWN
                    // measured gaps (table rows / data tables advance far tighter
                    // than the column-wide pitch); using the column pitch there
                    // inflates dense pages past the source height. Clamp the local
                    // advance so text never clips (>= 1.05x the tallest run) and
                    // never exceeds the column pitch.
                    const maxFs = currentRuns.reduce((m, r) => Math.max(m, r.fontSize || currentFontSize), currentFontSize);
                    let linePt = lineHeight;
                    if (paraLocalGaps.length >= 1) {
                        const sorted = [...paraLocalGaps].sort((a, b) => a - b);
                        linePt = sorted[Math.floor(sorted.length / 2)];
                    }
                    linePt = Math.min(linePt, lineHeight);
                    linePt = Math.max(linePt, maxFs * 1.05);
                    const lineTwips = Math.round((maxFs > bodySize + 0.5 ? Math.max(linePt, maxFs * 1.15) : linePt) * 20);
                    blocks.push({
                        type: currentType,
                        runs: [...currentRuns],
                        fontSize: Math.round(currentFontSize),
                        fontFamily: currentFont,
                        alignment: paraAlignment !== 'left' ? paraAlignment : 'left',
                        spacing: { line: lineTwips, lineRule: 'exact', before: pendingBeforeTwips, after: 0 },
                        isBold: currentRuns.some(r => r.bold),
                        isItalic: currentRuns.some(r => r.italic),
                        y: currentLineY,
                        lineCount: paraLineCount,
                    });
                    pendingBeforeTwips = 0;
                }
                currentRuns = [];
                paraLocalGaps = [];
                paraLineCount = 0;
            }
        };

        // Tight within-paragraph line advance (leading). Compute it from gaps
        // that can only be wrapped-line advances: skip any gap that lands on a
        // heading or starts a list item (those are section/entry boundaries, not
        // leading), then take the median. A whole-column median is skewed — a
        // resume is mostly short entries and tightly packed lists, so its median
        // lands on a paragraph/list gap and either merges everything into one
        // blob or (at the tight list pitch) splits every plain paragraph line by
        // line. Skipping boundary gaps pins the estimate on the wrapped-line
        // advance whatever the mix of body, headings, and lists.
        const isHeadingSize = (s: number) => s > bodySize * 1.1;
        const listMarker = (t: string) => {
            const m = t.match(/\S/);
            const c = m ? m[0] : '';
            // Real bullets, plus the Type3 bullet glyph pdf.js exposes as a lone
            // C1 control char (e.g. U+0088) — that is how these resumes mark
            // list items, and it must still start a new paragraph.
            return /[•●◦▪‣·*]/.test(c) || (c >= '\u0080' && c <= '\u009F');
        };
        const leadGaps: number[] = [];
        for (let i = 1; i < lineTexts.length; i++) {
            const gap = lineTexts[i - 1].y - lineTexts[i].y;
            if (gap <= 0) continue;
            if (gap < bodySize * 0.7 || gap > bodySize * 2.5) continue;
            if (isHeadingSize(lineTexts[i].lineSize) || isHeadingSize(lineTexts[i - 1].lineSize)) continue;
            if (listMarker(lineTexts[i].text)) continue;
            leadGaps.push(gap);
        }
        leadGaps.sort((a, b) => a - b);
        let lineHeight = leadGaps.length ? leadGaps[Math.floor(leadGaps.length / 2)] : bodySize * 1.15;
        lineHeight = Math.min(Math.max(lineHeight, bodySize * 0.95), bodySize * 1.7);

        // A paragraph break is a gap meaningfully larger than one line advance.
        const paraBreakGap = Math.max(lineHeight * 1.12, lineHeight + 1.2, bodySize * 1.05);
        // Inter-paragraph gap (beyond one line advance) stashed for the block
        // that is about to start; applied as `spacing.before` when it flushes.
        let pendingBeforeTwips = 0;

        for (const lt of lineTexts) {
            const { text, runs, y, h, lineSize, lineFont, lineBold, lineItalic } = lt;

            let thisType: DocxBlock['type'] = 'body';
            if (lineSize > bodySize * 1.5) thisType = 'heading1';
            else if (lineSize > bodySize * 1.25) thisType = 'heading2';
            else if (lineSize > bodySize * 1.1) thisType = 'heading3';
            const startsList = listMarker(text);
            if (startsList) thisType = 'list';

            // Paragraph break conditions. A wrapped continuation line carries no
            // bullet, so it "changes type" from the list item it belongs to — but
            // it is set with a hanging indent (starts right of the column edge),
            // unlike a brand-new entry title which is flush left. Suppress the
            // type-change break for those indented continuations only; a flush-left
            // line after a list still starts a new entry.
            const gap = prevLineY === null ? 0 : prevLineY - y;
            const largeGap = gap > paraBreakGap;
            const differentType = thisType !== currentType;
            const isHeading = thisType === 'heading1' || thisType === 'heading2' || thisType === 'heading3';
            const prevWasHeading = currentType === 'heading1' || currentType === 'heading2' || currentType === 'heading3';
            const differentSize = Math.abs(lineSize - prevLineSize) > 1.5;
            const indented = (lt.xStart - regionLeft) > 3;
            const isContinuation = indented && gap <= paraBreakGap;

            // Check if text is centred — measured against the REGION (the column's
            // own bounds), not the page centre, and only when the line is inset
            // symmetrically from both region edges. Full-width body lines are
            // flush left (inset ~0) and never count as centred, so a centred
            // heading/label always breaks the paragraph before body text.
            const lineInsetL = lt.xStart - regionLeft;
            const lineInsetR = regionRight - lt.xEnd;
            const isCentered = lineInsetL > 3 && lineInsetR > 3 && Math.abs(lineInsetL - lineInsetR) <= (lineInsetL + lineInsetR) * 0.3;
            const paraInsetL = currentLineStartX - regionLeft;
            const paraInsetR = regionRight - currentLineEndX;
            const prevCentered = prevLineY !== null && paraInsetL > 3 && paraInsetR > 3 && Math.abs(paraInsetL - paraInsetR) <= (paraInsetL + paraInsetR) * 0.3;
            const alignmentChanged = isCentered !== prevCentered && prevLineY !== null;

            const broke = largeGap || isHeading || prevWasHeading || startsList || (differentType && !isContinuation) || differentSize || alignmentChanged || blocks.length === 0;
            if (broke) {
                flushParagraph();
                // Space before this new paragraph = the real vertical gap minus
                // one line advance (the line spacing already covers one advance).
                pendingBeforeTwips = prevLineY === null ? 0 : Math.max(0, Math.round(((prevLineY - y) - lineHeight) * 20));
                currentType = thisType;
                currentFontSize = lineSize;
                currentFont = lineFont;
                currentLineStartX = lt.xStart;
                currentLineEndX = lt.xEnd;
                currentLineY = lt.y;
            }

            // Append this line's runs to the paragraph. When the paragraph continues onto
            // a new visual line, ensure a separating space — PDF text items rarely
            // carry a trailing space at a line break, so joining blindly fuses
            // words ("and"+"Engineering" -> "andEngineering").
            if (currentRuns.length > 0) {
                const lastR = currentRuns[currentRuns.length - 1];
                const firstNext = runs[0]?.text || '';
                const hyphenJoin = /[A-Za-z]-$/.test(lastR.text) && /^[a-z]/.test(firstNext);
                if (lastR.text && !/\s$/.test(lastR.text) && !hyphenJoin) {
                    lastR.text += ' ';
                }
            }
            for (const run of runs) {
                currentRuns.push(run);
            }

            // This line continued an open paragraph (no flush on this pass): its
            // baseline delta is the paragraph's real internal advance, used to
            // size tight sub-paragraph strips (tables) precisely.
            if (!broke && prevLineY !== null && prevLineY - y >= 0.5 && prevLineY - y <= lineHeight * 1.6) {
                paraLocalGaps.push(prevLineY - y);
            }
            paraLineCount += 1;

            prevLineY = y;
            prevLineH = h;
            prevLineSize = lineSize;
        }

        flushParagraph();
        return blocks;
    };

    const blocksToPlainParagraphs = (blocks: DocxBlock[]): string[] =>
        blocks
            .filter(b => b.runs.length > 0)
            .map(b => b.runs.map(r => r.text).join(''));

    const buildDocxFromPages = async (pages: { canvas: HTMLCanvasElement; text?: string[]; blocks?: DocxBlock[]; columnBlocks?: DocxBlock[][]; segments?: DocxSegment[]; columnCount?: number; pageGeometry?: PageGeometry }[]): Promise<Blob> => {
        const isLandscape = orientation === 'l';
        // One docx SECTION per layout region (continuous breaks stack regions on
        // the same page; a next-page break starts each new PDF page). Column
        // regions use native Word section columns so text flows naturally with
        // no empty cells or crushed widths.
        const sectionsOut: { properties: any; children: (Paragraph | Table)[] }[] = [];

        // Strip characters that are illegal in XML (control chars, lone
        // surrogates). PDFs with a broken ToUnicode map yield garbage code
        // points; emitting them raw produced a DOCX every reader rejected.
        const sanitizeXmlText = (s: string): string => {
            let out = '';
            for (let i = 0; i < s.length; i++) {
                const c = s.charCodeAt(i);
                if (c === 0x9 || c === 0xA || c === 0xD) { out += s[i]; continue; }
                // Drop C0 controls, DEL/C1 controls (junk left behind by Type3
                // fonts whose glyphs have no ToUnicode map) and non-characters.
                if (c < 0x20 || (c >= 0x7F && c <= 0x9F) || c === 0xFFFE || c === 0xFFFF) continue;
                if (c >= 0xD800 && c <= 0xDFFF) {
                    const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
                    if (c <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) { out += s[i] + s[i + 1]; i++; }
                    continue;
                }
                out += s[i];
            }
            return out;
        };

        const runToDocx = (run: DocxRun): TextRun | ExternalHyperlink => {
            // Always emit an explicit font and colour. Word's built-in Heading
            // styles paint text blue in Calibri Light; leaving these unset lets
            // that theme leak over the PDF's own (black, serif) formatting.
            const opts: any = {
                text: sanitizeXmlText(run.text),
                bold: run.bold,
                italics: run.italic,
                underline: run.underline ? {} : undefined,
                font: run.fontFamily || 'Times New Roman',
                size: run.fontSize ? run.fontSize * 2 : undefined, // half-points
                color: run.url ? '0563C1' : (run.color && run.color !== '#000000' ? run.color.replace('#', '') : '000000'),
            };
            const textRun = new TextRun(opts);
            if (run.url) {
                return new ExternalHyperlink({ children: [textRun], link: run.url });
            }
            return textRun;
        };

        // PNG data URL -> Word image. PDF points -> px at 96dpi (Word sizes EMU from px).
        const imageBlockToParagraph = (block: DocxBlock, maxWidthPx: number): Paragraph => {
            const img = block.image;
            if (!img || !img.dataUrl) return new Paragraph({ children: [] });
            try {
                const base64 = img.dataUrl.substring(img.dataUrl.indexOf(',') + 1);
                const bin = atob(base64);
                const bytes = new Uint8Array(bin.length);
                for (let bi = 0; bi < bin.length; bi++) bytes[bi] = bin.charCodeAt(bi);
                let wPx = Math.max(8, Math.round(img.width * 96 / 72));
                let hPx = Math.max(8, Math.round(img.height * 96 / 72));
                if (wPx > maxWidthPx) {
                    hPx = Math.max(8, Math.round(hPx * maxWidthPx / wPx));
                    wPx = maxWidthPx;
                }
                const opts: any = {
                    children: [new ImageRun({
                        data: bytes,
                        transformation: { width: wPx, height: hPx },
                        type: 'png',
                    })],
                    spacing: {
                        before: block.spacing?.before ?? 120,
                        after: block.spacing?.after ?? 120,
                    },
                };
                if (block.alignment === 'center') opts.alignment = AlignmentType.CENTER;
                else if (block.alignment === 'right') opts.alignment = AlignmentType.RIGHT;
                return new Paragraph(opts);
            } catch {
                return new Paragraph({ children: [] });
            }
        };

        const literalBullet = (block: DocxBlock): boolean =>
            /^\s*[•●◦▪‣·*]\s/.test(block.runs.map(r => r.text).join(''));

        const blockToParagraph = (block: DocxBlock): Paragraph => {
            if (block.type === 'image') {
                return imageBlockToParagraph(block, 700);
            }
            if (block.type === 'spacer') {
                return new Paragraph({ spacing: { before: 240 }, children: [] });
            }
            const runs = block.runs.filter(r => sanitizeXmlText(r.text).length > 0).map(r => runToDocx(r));
            const opts: any = {
                children: runs.length > 0 ? runs : [new TextRun({ text: '' })],
            };

            // Spacing — prefer the measured PDF geometry (exact line advance +
            // real inter-paragraph gap) threaded onto the block by
            // processColumnRunsEnhanced; fall back to sane single-spacing for
            // any block that didn't come through that path.
            const spacing: any = {};
            if (block.spacing?.before !== undefined) spacing.before = block.spacing.before;
            else if (block.type === 'heading1') spacing.before = 240;
            else if (block.type === 'heading2') spacing.before = 160;
            else if (block.type === 'heading3') spacing.before = 120;
            else spacing.before = 0;

            spacing.after = block.spacing?.after ?? 0;

            if (block.spacing?.line) {
                spacing.line = block.spacing.line;
                spacing.lineRule = block.spacing.lineRule === 'auto' ? 'auto' : 'exact';
            } else {
                spacing.line = 240; // single spacing
            }

            opts.spacing = spacing;

            // Heading level
            if (block.type === 'heading1') opts.heading = HeadingLevel.HEADING_1;
            else if (block.type === 'heading2') opts.heading = HeadingLevel.HEADING_2;
            else if (block.type === 'heading3') opts.heading = HeadingLevel.HEADING_3;
            else if (block.type === 'list' && !literalBullet(block)) {
                opts.bullet = { level: 0 };
                opts.indent = { left: 420, hanging: 220 };
            }

            // Alignment
            if (block.alignment === 'center') opts.alignment = AlignmentType.CENTER;
            else if (block.alignment === 'right') opts.alignment = AlignmentType.RIGHT;
            else if (block.alignment === 'justify') opts.alignment = AlignmentType.JUSTIFIED;

            // Indentation
            if (block.indent) {
                if (!opts.indent) opts.indent = {};
                if (block.indent.left) opts.indent.left = block.indent.left;
                if (block.indent.right) opts.indent.right = block.indent.right;
                if (block.indent.firstLine) opts.indent.firstLine = block.indent.firstLine;
            }

            return new Paragraph(opts);
        };

        const blockToCellParagraph = (block: DocxBlock): Paragraph => {
            if (block.type === 'image') {
                return imageBlockToParagraph(block, 340);
            }
            if (block.type === 'spacer') {
                return new Paragraph({ spacing: { before: 120 }, children: [] });
            }
            const forceHeadingBold = block.type === 'heading1' || block.type === 'heading2' || block.type === 'heading3';
            const runs = block.runs.filter(r => sanitizeXmlText(r.text).length > 0).map(r => runToDocx(forceHeadingBold ? { ...r, bold: true } : r));
            const cellSpacing: any = { after: block.spacing?.after ?? 0 };
            if (block.spacing?.line) {
                cellSpacing.line = block.spacing.line;
                cellSpacing.lineRule = block.spacing.lineRule === 'auto' ? 'auto' : 'exact';
            } else {
                cellSpacing.line = 240;
            }
            if (block.spacing?.before) cellSpacing.before = block.spacing.before;
            const opts: any = {
                spacing: cellSpacing,
                children: runs.length > 0 ? runs : [new TextRun({ text: '' })],
            };
            if (block.type === 'heading1') opts.heading = HeadingLevel.HEADING_1;
            else if (block.type === 'heading2') opts.heading = HeadingLevel.HEADING_2;
            else if (block.type === 'heading3') opts.heading = HeadingLevel.HEADING_3;
            else if (block.type === 'list' && !literalBullet(block)) {
                opts.bullet = { level: 0 };
                opts.indent = { left: 200, hanging: 110 };
            }
            if (block.alignment === 'center') opts.alignment = AlignmentType.CENTER;
            else if (block.alignment === 'right') opts.alignment = AlignmentType.RIGHT;
            else if (block.alignment === 'justify') opts.alignment = AlignmentType.JUSTIFIED;
            return new Paragraph(opts);
        };

        const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

        // Per-column widths (twips) + gutter derived from the SOURCE column
        // x-extents — never from block counts. The last column absorbs rounding
        // so widths + gutters fill the printable width exactly.
        const columnLayout = (n: number, ranges: { minX: number; maxX: number }[] | undefined, printableTwips: number): { widths: number[]; gutter: number } => {
            const usable = Math.max(1, printableTwips);
            if (ranges && ranges.length === n && ranges.every(r => Number.isFinite(r.minX) && Number.isFinite(r.maxX) && r.maxX > r.minX)) {
                const spans = ranges.map(r => r.maxX - r.minX);
                const totalSpan = spans.reduce((a, b) => a + b, 0) || 1;
                let gutter = 0;
                if (n >= 2) {
                    let gapSum = 0;
                    for (let g = 0; g < n - 1; g++) gapSum += Math.max(0, ranges[g + 1].minX - ranges[g].maxX);
                    gutter = Math.round((gapSum / (n - 1)) * 20);
                }
                const avail = Math.max(1, usable - gutter * (n - 1));
                const widths = spans.map(s => Math.max(1, Math.round((s / totalSpan) * avail)));
                widths[widths.length - 1] += avail - widths.reduce((a, b) => a + b, 0);
                return { widths, gutter };
            }
            const gutter = n >= 2 ? Math.max(1, Math.round((usable / n) * 0.05)) : 0;
            const avail = Math.max(1, usable - gutter * (n - 1));
            const base = Math.floor(avail / n);
            const widths = new Array(n).fill(base);
            widths[n - 1] += avail - base * n;
            return { widths, gutter };
        };

        // Spec-correct FIXED-DXA borderless table (author grid / no-geometry
        // fallback). tblLayout=fixed, tblW in DXA, tblGrid gridCol in DXA and
        // every tcW in DXA matching the grid exactly — Word otherwise ignores
        // percentage widths and autofits, crushing columns.
        const buildColumnTable = (validCols: DocxBlock[][], ranges: { minX: number; maxX: number }[] | undefined, printableTwips: number): Table | null => {
            const totalBlocks = validCols.reduce((sum, col) => sum + col.length, 0);
            if (totalBlocks === 0) return null;
            const n = validCols.length;
            const { widths, gutter } = columnLayout(n, ranges, printableTwips);
            const tableWidth = widths.reduce((a, b) => a + b, 0) + gutter * (n - 1);
            return new Table({
                rows: [
                    new TableRow({
                        children: validCols.map((colBlocks, ci) => new TableCell({
                            width: { size: widths[ci], type: WidthType.DXA },
                            verticalAlign: VerticalAlign.TOP,
                            margins: { top: 0, bottom: 0, left: gutter, right: gutter },
                            borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
                            children: colBlocks.map(block => blockToCellParagraph(block)),
                        })),
                    }),
                ],
                width: { size: tableWidth, type: WidthType.DXA },
                columnWidths: widths,
                layout: 'fixed',
                borders: {
                    top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
                    insideHorizontal: noBorder, insideVertical: noBorder,
                },
            });
        };

        const startSection = (page: any, column: any, type?: string) => {
            const s: { properties: any; children: (Paragraph | Table)[] } = { properties: { page }, children: [] };
            if (column) s.properties.column = column;
            if (type) s.properties.type = type;
            sectionsOut.push(s);
            return s;
        };

        // Exact emitted height of one block in points: line advance x the number
        // of source lines it collapsed, plus its leading space. Lets a column
        // section size its own bottom margin so nothing wraps onto a new page.
        const blockHeightPts = (b: DocxBlock): number => {
            const sp = b.spacing || {};
            const before = (sp.before || 0) / 20;
            const after = (sp.after || 0) / 20;
            if (b.type === 'image' && b.image) return before + b.image.height + after;
            const line = sp.line ? sp.line / 20 : (b.fontSize || 10) * 1.2;
            return before + line * (b.lineCount || 1);
        };

        for (let i = 0; i < pages.length; i++) {
            const canvas = pages[i].canvas;
            const text = pages[i].text;
            const blocks = pages[i].blocks;
            const columnBlocks = pages[i].columnBlocks;
            const colCount = pages[i].columnCount ?? 1;
            const geometry = pages[i].pageGeometry;

            const pageWidthPts = geometry?.width || 612;
            const pageHeightPts = geometry?.height || 792;
            const pageWidthTwips = Math.round(pageWidthPts * 20);
            const pageHeightTwips = Math.round(pageHeightPts * 20);
            const marginTop = geometry ? Math.round(geometry.marginTop * 20) : 720;
            const marginBottom = geometry ? Math.round(geometry.marginBottom * 20) : 720;
            const marginLeft = geometry ? Math.round(geometry.marginLeft * 20) : 720;
            const marginRight = geometry ? Math.round(geometry.marginRight * 20) : 720;
            const printableTwips = Math.max(1, pageWidthTwips - marginLeft - marginRight);
            const contentHPts = Math.max(1, pageHeightPts - (geometry?.marginTop ?? pageHeightPts * 0.08) - (geometry?.marginBottom ?? pageHeightPts * 0.08));

            const pageProps = {
                size: {
                    width: pageWidthTwips,
                    height: pageHeightTwips,
                    orientation: isLandscape ? 'landscape' : 'portrait',
                },
                margin: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
            };

            // Accumulate this page's content as units, each with one column
            // configuration; consecutive full-width (1-col) content merges.
            type Unit = { colCount: number; widths?: number[]; gutter?: number; children: (Paragraph | Table)[]; contentHPts?: number };
            const units: Unit[] = [];
            let cur: Unit | null = null;
            const pushLinear = (items: (Paragraph | Table)[]) => {
                for (const item of items) {
                    // Word merges two adjacent tables; keep them separate.
                    if (item instanceof Table && cur && cur.children[cur.children.length - 1] instanceof Table) {
                        cur.children.push(new Paragraph({ children: [], spacing: { before: 0, after: 0, line: 120 } }));
                    }
                    if (cur && cur.colCount === 1) { cur.children.push(item); continue; }
                    cur = { colCount: 1, children: [item] };
                    units.push(cur);
                }
            };
            const pushColumns = (validCols: DocxBlock[][], validRanges: { minX: number; maxX: number }[]) => {
                // A short multi-column strip (author grid / header) is more
                // reliable as a fixed-DXA table; tall columns (body text) flow
                // as native Word section columns with explicit measured widths.
                const bandYs = validCols.flat().map(b => b.y).filter(y => typeof y === 'number');
                const bandTop = bandYs.length ? Math.max(...bandYs) : 0;
                const bandBot = bandYs.length ? Math.min(...bandYs) : 0;
                const bandHeight = Math.max(0, bandTop - bandBot);
                if (bandHeight < contentHPts * 0.4) {
                    const table = buildColumnTable(validCols, validRanges.length === validCols.length ? validRanges : undefined, printableTwips);
                    if (table) { pushLinear([table]); return; }
                }
                const { widths, gutter } = columnLayout(validCols.length, validRanges.length === validCols.length ? validRanges : undefined, printableTwips);
                const colUnit: Unit = { colCount: validCols.length, widths, gutter, children: [] };
                const colHeights = validCols.map(col => col.reduce((sum, b) => sum + blockHeightPts(b), 0));
                colUnit.contentHPts = colHeights.length ? Math.max(...colHeights) : 0;
                for (let ci = 0; ci < validCols.length; ci++) {
                    if (ci > 0) colUnit.children.push(new Paragraph({ children: [new ColumnBreak()], spacing: { before: 0, after: 0, line: 240 } }));
                    colUnit.children.push(...validCols[ci].map(blockToParagraph));
                }
                cur = colUnit;
                units.push(cur);
            };

            const segments = pages[i].segments;
            if (segments && segments.length > 0) {
                for (const seg of segments) {
                    if (seg.kind === 'linear') {
                        pushLinear((seg.blocks || []).map(blockToParagraph));
                        continue;
                    }
                    if (seg.leadBlocks?.length) pushLinear(seg.leadBlocks.map(blockToParagraph));
                    const rawCols = seg.columns || [];
                    const rawRanges = seg.columnRanges || [];
                    const validCols: DocxBlock[][] = [];
                    const validRanges: { minX: number; maxX: number }[] = [];
                    for (let ci = 0; ci < rawCols.length; ci++) {
                        if ((rawCols[ci] || []).length > 0) {
                            validCols.push(rawCols[ci]);
                            if (rawRanges[ci]) validRanges.push(rawRanges[ci]);
                        }
                    }
                    if (validCols.length >= 2) pushColumns(validCols, validRanges);
                    else pushLinear(validCols.flat().map(blockToParagraph));
                }
            } else if (colCount > 1 && columnBlocks && columnBlocks.length >= 2) {
                const validCols = columnBlocks.filter(col => col.length > 0);
                if (validCols.length >= 2) {
                    const seen = new Set<string>();
                    for (const b of (blocks || []).filter(bl => bl.fullWidth)) {
                        const key = b.runs.map(r => r.text).join('|');
                        if (seen.has(key)) continue;
                        seen.add(key);
                        pushLinear([blockToParagraph(b)]);
                    }
                    pushColumns(validCols, []);
                } else {
                    pushLinear(validCols.flat().map(blockToParagraph));
                }
            } else if (blocks && blocks.length > 0) {
                pushLinear(blocks.map(blockToParagraph));
            } else if (text && text.length > 0) {
                pushLinear(text.map(paraText => new Paragraph({
                    spacing: { after: 0, line: 240 },
                    children: [new TextRun({ text: sanitizeXmlText(paraText) })],
                })));
            } else if (canvas) {
                const contentWPx = (pageWidthTwips - marginLeft - marginRight) / 15;
                const contentHPx = (pageHeightTwips - marginTop - marginBottom) / 15;
                const scale = Math.min(contentWPx / canvas.width, contentHPx / canvas.height);
                const drawW = Math.max(1, Math.round(canvas.width * scale));
                const drawH = Math.max(1, Math.round(canvas.height * scale));
                const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
                if (blob) {
                    const data = new Uint8Array(await blob.arrayBuffer());
                    pushLinear([new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 0, after: 0 },
                        children: [new ImageRun({ type: 'png', data, transformation: { width: drawW, height: drawH } })],
                    })]);
                }
            }

            // Convert units into sections with correct break types.
            units.forEach((u, ui) => {
                const type = (i === 0 && ui === 0) ? undefined : (ui === 0 ? SectionType.NEXT_PAGE : SectionType.CONTINUOUS);
                const column = (u.colCount > 1 && u.widths)
                    ? { count: u.widths.length, equalWidth: false, space: u.gutter, children: u.widths.map(w => new Column({ width: w })) }
                    : undefined;
                // Self-heal column balconies: if the measured column content is
                // taller than the content-derived bottom margin allows, reclaim
                // just enough bottom margin so nothing spills onto an extra page.
                let props = pageProps;
                if (u.colCount > 1 && u.contentHPts) {
                    const reservePt = 12;
                    const neededBottomPt = pageHeightPts - (marginTop / 20) - u.contentHPts - reservePt;
                    const origBottomPt = pageProps.margin.bottom / 20;
                    if (neededBottomPt < origBottomPt - 1) {
                        const newBottomTw = Math.round(Math.max(18, neededBottomPt) * 20);
                        props = { ...pageProps, margin: { ...pageProps.margin, bottom: newBottomTw } };
                    }
                }
                const s = startSection(props, column, type);
                s.children.push(...u.children);
            });

            if (units.length === 0) startSection(pageProps, undefined, i === 0 ? undefined : SectionType.NEXT_PAGE);
        }

        const doc = new Document({
            sections: sectionsOut.map(s => ({ properties: s.properties, children: s.children })),
        });

        return await Packer.toBlob(doc);
    };
    
    const handleConvert = async () => {
        if (files.length === 0) return;
        setIsConverting(true);
        setStatusMessage(t.status.initializing);
        setConversionStages(stagesFromBackendStatus('queued', 'queued', 0));

        // All files are PDFs targeting DOCX — build these client-side so the
        // PDF's fonts, sizes, spacing and structure are preserved exactly.
        // (Converting through the backend office provider reflows the content
        // and flattens headings, font sizes and paragraph spacing.)
        const pdfToDocxFiles = files.filter(f => {
            const isPdf = f.file.type === 'application/pdf' || f.file.name.toLowerCase().endsWith('.pdf');
            const target = mergeFiles ? globalOutputFormat : f.outputFormat;
            return isPdf && target === 'docx';
        });

        if (pdfToDocxFiles.length > 0) {
            if (pdfToDocxFiles.length === files.length) {
                // Backend-primary conversion (ConvertAPI on serverless,
                // LibreOffice/pdf2docx on disk deployments) when the user is
                // signed in and the batch isn't being merged into one file.
                // Any failure falls through to the structure-preserving
                // client-side builder so conversion never breaks.
                const useBackendDocx = !!isAuthenticated && (!mergeFiles || files.length === 1);
                if (useBackendDocx) {
                    try {
                        const backendDocxFiles: DownloadableFile[] = [];
                        for (let idx = 0; idx < files.length; idx += 1) {
                            const appFile = files[idx];
                            let converted: DownloadableFile[];
                            try {
                                // Adobe PDF Services gives the highest-fidelity
                                // DOCX; unavailable/unconfigured deployments
                                // fall through to the existing provider path.
                                const adobe = await convertPdfToDocxViaAdobe(
                                    appFile.file,
                                    ({ percent, message }) => {
                                        const globalProgress = Math.round(((idx + percent / 100) / files.length) * 100);
                                        setProgress({ current: idx + 1, total: files.length, percentage: globalProgress });
                                        setStatusMessage(message);
                                    },
                                );
                                converted = [adobe];
                            } catch (adobeError) {
                                console.warn('Adobe PDF\u2192DOCX unavailable; falling back to backend provider.', adobeError);
                                converted = await runOfficeConversionViaBackend(appFile, 'docx', idx, files.length);
                            }
                            backendDocxFiles.push(...converted);
                            onAddToHistory({
                                name: `${appFile.file.name} -> .docx`,
                                status: 'Success',
                                url: converted[0]?.url,
                            });
                        }
                        onConversionComplete('success');
                        if (backendDocxFiles.length === 1) setFinalFileName(backendDocxFiles[0].name);
                        setDownloadableFiles(backendDocxFiles);
                        setStatusMessage(t.status.complete);
                        setProgress({ current: files.length, total: files.length, percentage: 100 });
                        setIsConverting(false);
                        if (autoDelete) setFiles([]);
                        return;
                    } catch (backendError) {
                        console.warn('Backend PDF\u2192DOCX conversion failed; falling back to client-side builder.', backendError);
                    }
                }
                // All files are PDF→DOCX: handled by the structure-preserving
                // client-side builder below with its own staged progress.
                setClientDocxStages('reading');
                setStatusMessage(`${t.status.processing} (preserving PDF structure)`);
            }
            // Mixed batch: warn user to separate file types
            if (pdfToDocxFiles.length > 0 && pdfToDocxFiles.length < files.length) {
                addToast('For best results, process PDF-to-DOCX conversions separately from other file types.', 'error');
                setStatusMessage(t.status.error);
                setIsConverting(false);
                return;
            }
        }

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

                const finalOfficeFiles = backendFiles;

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
                suggestFileName(files[0].pages[0].originalCanvas).then(setAiSuggestedName);

            } else if (globalOutputFormat === 'docx') {
                setStatusMessage(t.status.generating);
                const docxPages: { canvas: HTMLCanvasElement; text?: string[]; blocks?: DocxBlock[]; columnBlocks?: DocxBlock[][]; segments?: DocxSegment[]; columnCount?: number; pageGeometry?: PageGeometry }[] = [];
                let pageCounter = 0;

                for (const appFile of files) {
                    for (let i = 0; i < appFile.pages.length; i++) {
                        const page = appFile.pages[i];
                        pageCounter++;
                        setProgress({ current: pageCounter, total: totalPages, percentage: Math.round((pageCounter / totalPages) * 100) });
                        setStatusMessage(`${t.status.processing} ${pageCounter}/${totalPages}`);

                        docxPages.push({
                            canvas: getProcessedCanvas(page.originalCanvas, page.rotation, colorMode),
                            text: page.text,
                            blocks: page.docxBlocks,
                            columnBlocks: page.docxColumnBlocks,
                            segments: page.docxSegments,
                            columnCount: page.columnCount,
                            pageGeometry: page.pageGeometry,
                        });
                    }
                }

                setStatusMessage(t.status.generating);
                setClientDocxStages('generating');
                const docxBlob = await buildDocxFromPages(docxPages);
                const docxName = files[0].file.name.split('.')[0] || 'merged_document';
                const docxUrl = URL.createObjectURL(docxBlob);
                generatedFiles.push({ name: docxName, url: docxUrl, format: 'docx' });
                onConversionComplete('success');
                onAddToHistory({ name: `${docxName}.docx`, status: 'Success', url: docxUrl });
                setFinalFileName(docxName);
                setClientDocxStages('done');

            } else { // Producing individual images in the user's selected format
                setStatusMessage(t.status.processing);
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
                            const filename = `${originalFileName}_page_${i + 1}`;
                            const url = URL.createObjectURL(blob);
                            generatedFiles.push({ name: filename, url, format: globalOutputFormat });
                        }
                    }
                }

                if (generatedFiles.length === 1) {
                    setFinalFileName(generatedFiles[0].name);
                }
                onConversionComplete('success');
                onAddToHistory({ name: `${files[0].file.name} -> .${globalOutputFormat}`, status: 'Success', url: generatedFiles[0]?.url });
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
                    } else if (fileFormat === 'docx') {
                        const docxPages = appFile.pages.map(page => ({
                            canvas: getProcessedCanvas(page.originalCanvas, page.rotation, colorMode),
                            text: page.text,
                            blocks: page.docxBlocks,
                            columnBlocks: page.docxColumnBlocks,
                            segments: page.docxSegments,
                            columnCount: page.columnCount,
                            pageGeometry: page.pageGeometry,
                        }));
                        setStatusMessage(t.status.generating);
                        setClientDocxStages('generating');
                        const docxBlob = await buildDocxFromPages(docxPages);
                        const docxUrl = URL.createObjectURL(docxBlob);
                        generatedFiles.push({ name: filename, url: docxUrl, format: 'docx' });
                        setClientDocxStages('done');
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
                suggestFileName(firstCanvas).then(setAiSuggestedName);
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
    const panelClasses = `relative w-full panel-card p-8 elevation-3 ${isGlassEffect ? 'glass-surface' : ''}`;
    const managingFile = files.find(f => f.id === managingFileId);
    
    const mergeLabel = globalOutputFormat === 'pdf' 
        ? t.options.merge.pdf
        : globalOutputFormat === 'docx'
            ? t.options.merge.docx
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
                    <div className="w-16 h-16 success-chip rounded-full flex items-center justify-center mb-4">
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
                        <div className="absolute inset-0 glass-surface z-10 flex flex-col items-center justify-center rounded-2xl pointer-events-none">
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
                                    jobId=""
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
                                <div className="p-5 well rounded-xl">
                                    <p className="caption-text font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Select Output Format:</p>
                                    <div className="segmented-control w-full">
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
                                {showMergeToggle && <ToggleSwitch label={mergeLabel} enabled={mergeFiles} onChange={setMergeFiles} />}
                                
                                <ConversionOptions
                                    watermark={watermark} setWatermark={setWatermark}
                                    pageSize={pageSize} setPageSize={setPageSize}
                                    orientation={orientation} setOrientation={setOrientation}
                                    colorMode={colorMode} setColorMode={setColorMode}
                                    outputFormat={globalOutputFormat}
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
                                            className="success-btn pill-btn w-full sm:w-auto font-medium py-3 px-8 disabled:opacity-50 disabled:cursor-not-allowed min-w-[240px] flex items-center justify-center transition-all duration-300"
                                        >
                                           {isConverting ? (
                                               <span className="flex items-center gap-2"><SpinnerIcon /> Combining images...</span>
                                           ) : (
                                               <span className="flex items-center gap-2"><FileTextIcon className="w-4 h-4" /> Combine {files.length} Images to PDF</span>
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
                                                <span className="flex items-center gap-1">
                                                    {t.options.convertButton} {files.length} {files.length > 1 ? t.options.files : t.options.file}
                                                    <span className="btn-icon-wrap"><ArrowUpRightIcon className="w-4 h-4" /></span>
                                                </span>
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
             <header className="view-header">
                <div className="view-eyebrow">
                    <span className="eyebrow-dot" />
                    Convert & merge
                </div>
                <div className="flex items-center gap-3">
                    <h1 className="display-md">{t.title}</h1>
                </div>
                <p className="body-sm mt-1">{t.subtitle}</p>
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
