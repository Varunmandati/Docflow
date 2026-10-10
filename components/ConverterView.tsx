import React, { useState, useCallback, useEffect, useRef } from 'react';
import { renderAsync } from 'docx-preview';
import { Document, Packer, ImageRun, Paragraph, PageBreak, AlignmentType, TextRun, ExternalHyperlink, HeadingLevel, Table, TableRow, TableCell, WidthType, VerticalAlign, BorderStyle } from 'docx';
import { AppFile, DownloadableFile, HistoryEntry, PageSize, Orientation, ColorMode, OutputFormat, SecurityOptions, PageInfo, DocxBlock, DocxRun, PageGeometry } from '../types';
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
            if (status === 'completed' || id === 'completed') {
                return { id, name, status: 'complete' as const, progress: 100 };
            }
            if (status === 'failed' && index === currentIndex) {
                return { id, name, status: 'failed' as const, progress: backendProgress, message };
            }
            if (index < currentIndex) {
                return { id, name, status: 'complete' as const, progress: 100 };
            }
            if (index === currentIndex && status !== 'queued') {
                return { id, name, status: 'in_progress' as const, progress: backendProgress, message };
            }
            if (index === currentIndex && status === 'queued') {
                return { id, name, status: 'in_progress' as const, progress: 0, message };
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

                        const { blocks: docxBlocks, columnBlocks: docxColumnBlocks, columnCount, geometry } = extractPdfDocxBlocks(textContent, annotations, pdfWidth, pdfHeight);
                        const text = blocksToPlainParagraphs(docxBlocks);

                        pages.push({
                            id: `${appFile.id}-page-${i-1}`,
                            thumbnailUrl: canvas.toDataURL('image/png'),
                            rotation: 0,
                            originalCanvas: canvas,
                            text,
                            docxBlocks,
                            docxColumnBlocks,
                            columnCount,
                            pageGeometry: geometry,
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

    const normalizePdfFontName = (fontName: string): string => {
        let name = fontName
            .replace(/^[A-Z]{6}\+/, '')       // Remove PDF subset prefix like ABCDEF+
            .replace(/,.*$/, '')                // Remove comma suffixes
            .trim();
        const lower = name.toLowerCase();
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
        };
        if (fontMap[lower]) return fontMap[lower];
        // Return title-cased version
        return name.split(/[\s_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    };

    const detectAlignment = (runs: { x: number; w: number; str: string }[], pageWidth: number, marginX: number): 'left' | 'center' | 'right' | 'justify' => {
        if (runs.length === 0) return 'left';
        if (runs.length === 1) {
            const r = runs[0];
            const center = pageWidth / 2;
            const runCenter = r.x + r.w / 2;
            if (Math.abs(runCenter - center) < pageWidth * 0.05) return 'center';
            if (r.x > pageWidth - marginX * 1.5) return 'right';
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

    const extractPdfDocxBlocks = (textContent: any, annotations: any[], pageWidth?: number, pageHeight?: number): { blocks: DocxBlock[]; columnBlocks: DocxBlock[][]; columnCount: number; geometry: PageGeometry } => {
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
        const marginLeft = pw * 0.1;
        const marginRight = pw * 0.1;
        const marginTop = ph * 0.08;
        const marginBottom = ph * 0.08;

        const rawRuns: RawRun[] = [];
        for (const it of (textContent?.items || [])) {
            const s = it?.str;
            if (typeof s !== 'string' || s.trim().length === 0) continue;
            const m = it.transform as number[] | undefined;
            if (!m || m.length < 6) continue;

            const st = it.fontName ? styles[it.fontName] : null;
            const rawFontName = String(st?.fontFamily || it.font?.name || it.fontName || '');
            const fontFamily = normalizePdfFontName(rawFontName);
            const fontSize = Math.abs(st?.fontSize || 0) || Math.abs(it.height ?? 0) || 10;
            const bold = /\bbold\b|\bblack\b|\bsemibold\b|\bheavy\b/i.test(rawFontName);
            const italic = /\bitalic\b|\boblique\b|\bcondensed\b/i.test(rawFontName);
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
        if (rawRuns.length === 0) return { blocks: [], columnBlocks: [], columnCount: 1, geometry: { width: pw, height: ph, marginLeft, marginRight, marginTop, marginBottom } };

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

        const columnRanges = detectColumns(rawRuns, pw);

        const allBlocks: DocxBlock[] = [];
        const columnBlocks: DocxBlock[][] = [];

        if (columnRanges.length >= 2) {
            // Identify the gap between columns to detect full-width elements
            const sortedRanges = [...columnRanges].sort((a, b) => a.minX - b.minX);
            const gapRight = sortedRanges[0].maxX;
            const gapLeft = sortedRanges[1].minX;

            // Group raw runs into visual lines by Y proximity
            const sortedRunsForLines = [...rawRuns].sort((a, b) => (b.y - a.y) || (a.x - b.x));
            const visualLinesForDetection: { y: number; runs: typeof rawRuns[number][] }[] = [];
            for (const r of sortedRunsForLines) {
                const last = visualLinesForDetection[visualLinesForDetection.length - 1];
                if (last && Math.abs(last.y - r.y) <= Math.max(last.runs[0]?.h || 0, r.h) * 0.5) {
                    last.runs.push(r);
                } else {
                    visualLinesForDetection.push({ y: r.y, runs: [r] });
                }
            }

            // Mark runs that belong to full-width lines (span across the column gap)
            const fullWidthRunSet = new Set<number>();
            for (const vl of visualLinesForDetection) {
                if (vl.runs.length < 2) continue;
                const minX = Math.min(...vl.runs.map(r => r.x));
                const maxX = Math.max(...vl.runs.map(r => r.x + r.w));
                // A line is full-width if it spans across the gap between columns
                if (minX < gapRight && maxX > gapLeft) {
                    for (const r of vl.runs) {
                        const idx = rawRuns.indexOf(r);
                        if (idx >= 0) fullWidthRunSet.add(idx);
                    }
                }
            }

            // Separate full-width runs from column-only runs
            const fullWidthRuns = rawRuns.filter((_, i) => fullWidthRunSet.has(i));
            const columnOnlyRuns = rawRuns.filter((_, i) => !fullWidthRunSet.has(i));

            // Process full-width runs as single-column blocks
            if (fullWidthRuns.length > 0) {
                const fullBlocks = processColumnRunsEnhanced(fullWidthRuns, findUrl, pw, pw, marginLeft);
                for (const b of fullBlocks) b.fullWidth = true;
                allBlocks.push(...fullBlocks);
            }

            // Process column-only runs into their respective columns
            for (const colRange of columnRanges) {
                const colRuns = columnOnlyRuns.filter(r => {
                    const midX = r.x + r.w / 2;
                    return midX >= colRange.minX && midX <= colRange.maxX;
                });
                if (colRuns.length === 0) continue;
                const colBlocks = processColumnRunsEnhanced(colRuns, findUrl, colRange.maxX - colRange.minX, pw, marginLeft);
                allBlocks.push(...colBlocks);
                columnBlocks.push(colBlocks);
            }
        } else {
            // Single column — process all runs together
            const singleColBlocks = processColumnRunsEnhanced(rawRuns, findUrl, pw, pw, marginLeft);
            allBlocks.push(...singleColBlocks);
            columnBlocks.push(singleColBlocks);
        }

        return { blocks: allBlocks, columnBlocks, columnCount: columnRanges.length, geometry: { width: pw, height: ph, marginLeft, marginRight, marginTop, marginBottom } };
    };

    const detectColumns = (
        rawRuns: { x: number; y: number; h: number; w: number; size: number; str: string; bold: boolean; italic: boolean }[],
        pageWidth: number
    ): { minX: number; maxX: number }[] => {
        if (rawRuns.length === 0) return [{ minX: 0, maxX: pageWidth }];

        // Build a histogram of X positions to find column boundaries
        // Sample the left edge of each run
        const xPositions = rawRuns.map(r => r.x).sort((a, b) => a - b);

        // Find significant gaps using a density-based approach
        const bucketSize = Math.max(pageWidth / 100, 1);
        const buckets = new Map<number, number>();
        for (const x of xPositions) {
            const bucket = Math.floor(x / bucketSize);
            buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
        }

        // Find empty regions (gaps) between content
        const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
        const gaps: { start: number; end: number; size: number }[] = [];
        for (let i = 1; i < sortedBuckets.length; i++) {
            const gapStart = sortedBuckets[i - 1][0] + 1;
            const gapEnd = sortedBuckets[i][0];
            const gapSize = (gapEnd - gapStart) * bucketSize;
            if (gapSize > pageWidth * 0.03) { // Gap must be at least 3% of page width
                gaps.push({
                    start: gapStart * bucketSize,
                    end: gapEnd * bucketSize,
                    size: gapSize,
                });
            }
        }

        // Sort gaps by size (largest first) - large gaps likely separate columns
        gaps.sort((a, b) => b.size - a.size);

        // If no significant gaps found, treat as single column
        if (gaps.length === 0) {
            return [{ minX: 0, maxX: pageWidth }];
        }

        // Use the top gaps as column separators (limit to reasonable number of columns)
        const separators = gaps.slice(0, 2).sort((a, b) => a.start - b.start);

        // Build column ranges
        const ranges: { minX: number; maxX: number }[] = [];
        let cursor = 0;
        for (const sep of separators) {
            if (sep.start > cursor) {
                ranges.push({ minX: cursor, maxX: sep.start });
            }
            cursor = sep.end;
        }
        if (cursor < pageWidth) {
            ranges.push({ minX: cursor, maxX: pageWidth });
        }

        // Only use column mode if we found 2+ columns with reasonable content distribution
        if (ranges.length >= 2) {
            // Verify each column has a reasonable amount of content
            const minContentPerCol = rawRuns.length * 0.05; // At least 5% of runs per column
            const validColumns = ranges.filter(range => {
                const colCount = rawRuns.filter(r => {
                    const midX = r.x + r.w / 2;
                    return midX >= range.minX && midX <= range.maxX;
                }).length;
                return colCount >= minContentPerCol;
            });
            if (validColumns.length >= 2) {
                return validColumns;
            }
        }

        return [{ minX: 0, maxX: pageWidth }];
    };

    const processColumnRunsEnhanced = (
        rawRuns: { x: number; y: number; h: number; w: number; size: number; str: string; bold: boolean; italic: boolean; underline: boolean; fontFamily: string; color: string; hasEOL: boolean }[],
        findUrl: (x: number, y: number, w: number, h: number) => string | undefined,
        colWidth: number,
        pageWidth: number,
        marginLeft: number
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

        // Body size = median font size; larger text = headings
        const sizes = rawRuns.map(r => r.size).sort((a, b) => a - b);
        const bodySize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
        const bodyFont = rawRuns.find(r => Math.abs(r.size - bodySize) < 0.5)?.fontFamily || 'Times New Roman';

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
        let prevLineFont = bodyFont;
        let currentLineStartX = 0;

        const flushParagraph = () => {
            if (currentRuns.length > 0) {
                const fullText = currentRuns.map(r => r.text).join('');
                if (fullText.trim().length > 0) {
                    // Determine alignment based on text position
                    const paraAlignment = detectAlignment(
                        [{ x: currentLineStartX, w: fullText.length * currentFontSize * 0.5, str: fullText }],
                        pageWidth,
                        marginLeft
                    );
                    blocks.push({
                        type: currentType,
                        runs: [...currentRuns],
                        fontSize: Math.round(currentFontSize),
                        fontFamily: currentFont,
                        alignment: paraAlignment !== 'left' ? paraAlignment : 'left',
                        isBold: currentRuns.some(r => r.bold),
                        isItalic: currentRuns.some(r => r.italic),
                    });
                }
                currentRuns = [];
            }
        };

        for (const lt of lineTexts) {
            const { text, runs, y, h, lineSize, lineFont, lineBold, lineItalic } = lt;

            let thisType: DocxBlock['type'] = 'body';
            if (lineSize > bodySize * 1.5) thisType = 'heading1';
            else if (lineSize > bodySize * 1.25) thisType = 'heading2';
            else if (lineSize > bodySize * 1.1) thisType = 'heading3';
            if (/^\s*[•●◦▪‣·*]\s/.test(text)) thisType = 'list';

            // Paragraph break conditions
            const gap = prevLineY === null ? 0 : prevLineY - y;
            const lineHeight = Math.max(h, prevLineH, lineSize * 1.2);
            const largeGap = gap > lineHeight * 1.3;
            const differentType = thisType !== currentType;
            const isHeading = thisType !== 'body';
            const prevWasHeading = currentType !== 'body';
            const differentFont = lineFont !== prevLineFont && prevLineFont !== '';
            const differentSize = Math.abs(lineSize - prevLineSize) > 1.5;

            // Check if text is centered
            const centerX = pageWidth / 2;
            const lineCenter = (lt.xStart + lt.xEnd) / 2;
            const isCentered = Math.abs(lineCenter - centerX) < pageWidth * 0.05;
            const prevCentered = prevLineY !== null && Math.abs(currentLineStartX + (currentRuns.reduce((sum, r) => sum + r.text.length, 0) * currentFontSize * 0.5) / 2 - centerX) < pageWidth * 0.05;
            const alignmentChanged = isCentered !== prevCentered && prevLineY !== null;

            if (largeGap || differentType || isHeading || prevWasHeading || differentFont || differentSize || alignmentChanged || blocks.length === 0) {
                flushParagraph();
                currentType = thisType;
                currentFontSize = lineSize;
                currentFont = lineFont;
                currentLineStartX = lt.xStart;
            }

            for (const run of runs) {
                currentRuns.push(run);
            }

            prevLineY = y;
            prevLineH = h;
            prevLineSize = lineSize;
            prevLineFont = lineFont;
        }

        flushParagraph();
        return blocks;
    };

    const blocksToPlainParagraphs = (blocks: DocxBlock[]): string[] =>
        blocks
            .filter(b => b.runs.length > 0)
            .map(b => b.runs.map(r => r.text).join(''));

    const buildDocxFromPages = async (pages: { canvas: HTMLCanvasElement; text?: string[]; blocks?: DocxBlock[]; columnBlocks?: DocxBlock[][]; columnCount?: number; pageGeometry?: PageGeometry }[]): Promise<Blob> => {
        const isLandscape = orientation === 'l';
        const children: (Paragraph | Table)[] = [];

        const runToDocx = (run: DocxRun): TextRun | ExternalHyperlink => {
            const opts: any = {
                text: run.text,
                bold: run.bold,
                italics: run.italic,
                underline: run.underline ? {} : undefined,
                font: run.fontFamily || undefined,
                size: run.fontSize ? run.fontSize * 2 : undefined, // half-points
                color: run.url ? '0563C1' : (run.color && run.color !== '#000000' ? run.color.replace('#', '') : undefined),
            };
            const textRun = new TextRun(opts);
            if (run.url) {
                return new ExternalHyperlink({ children: [textRun], link: run.url });
            }
            return textRun;
        };

        const blockToParagraph = (block: DocxBlock): Paragraph => {
            if (block.type === 'spacer') {
                return new Paragraph({ spacing: { before: 240 }, children: [] });
            }
            const runs = block.runs.map(r => runToDocx(r));
            const opts: any = {
                children: runs.length > 0 ? runs : [new TextRun({ text: '' })],
            };

            // Spacing
            const spacing: any = {};
            if (block.spacing?.before) spacing.before = block.spacing.before;
            else if (block.type === 'heading1') spacing.before = 360;
            else if (block.type === 'heading2') spacing.before = 240;
            else if (block.type === 'heading3') spacing.before = 200;
            else spacing.before = 0;

            if (block.spacing?.after) spacing.after = block.spacing.after;
            else if (block.type === 'heading1') spacing.after = 200;
            else if (block.type === 'heading2') spacing.after = 160;
            else if (block.type === 'heading3') spacing.after = 120;
            else spacing.after = 80;

            if (block.spacing?.line) spacing.line = block.spacing.line;
            else spacing.line = 276; // ~1.15x line spacing

            opts.spacing = spacing;

            // Heading level
            if (block.type === 'heading1') opts.heading = HeadingLevel.HEADING_1;
            else if (block.type === 'heading2') opts.heading = HeadingLevel.HEADING_2;
            else if (block.type === 'heading3') opts.heading = HeadingLevel.HEADING_3;
            else if (block.type === 'list') {
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
            if (block.type === 'spacer') {
                return new Paragraph({ spacing: { before: 120 }, children: [] });
            }
            const runs = block.runs.map(r => runToDocx(r));
            const opts: any = {
                spacing: { after: 80, line: 276 },
                children: runs.length > 0 ? runs : [new TextRun({ text: '' })],
            };
            if (block.type === 'heading1') opts.heading = HeadingLevel.HEADING_1;
            else if (block.type === 'heading2') opts.heading = HeadingLevel.HEADING_2;
            else if (block.type === 'heading3') opts.heading = HeadingLevel.HEADING_3;
            else if (block.type === 'list') {
                opts.bullet = { level: 0 };
                opts.indent = { left: 200, hanging: 110 };
            }
            if (block.alignment === 'center') opts.alignment = AlignmentType.CENTER;
            else if (block.alignment === 'right') opts.alignment = AlignmentType.RIGHT;
            else if (block.alignment === 'justify') opts.alignment = AlignmentType.JUSTIFIED;
            return new Paragraph(opts);
        };

        for (let i = 0; i < pages.length; i++) {
            const canvas = pages[i].canvas;
            const text = pages[i].text;
            const blocks = pages[i].blocks;
            const columnBlocks = pages[i].columnBlocks;
            const colCount = pages[i].columnCount ?? 1;
            const geometry = pages[i].pageGeometry;

            // Use actual PDF page dimensions if available
            const pageWidthPts = geometry?.width || 612;  // Default US Letter
            const pageHeightPts = geometry?.height || 792;
            const pageWidthTwips = Math.round(pageWidthPts * 20);   // 1 point = 20 twips
            const pageHeightTwips = Math.round(pageHeightPts * 20);
            const marginTop = geometry ? Math.round(geometry.marginTop * 20) : 720;
            const marginBottom = geometry ? Math.round(geometry.marginBottom * 20) : 720;
            const marginLeft = geometry ? Math.round(geometry.marginLeft * 20) : 720;
            const marginRight = geometry ? Math.round(geometry.marginRight * 20) : 720;

            // Section properties for this page
            const sectionProps: any = {
                page: {
                    size: {
                        width: pageWidthTwips,
                        height: pageHeightTwips,
                        orientation: isLandscape ? 'landscape' : 'portrait',
                    },
                    margin: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
                },
            };

            if (i > 0) {
                children.push(new Paragraph({ children: [new PageBreak()] }));
            }

            if (colCount > 1 && columnBlocks && columnBlocks.length >= 2) {
                const validCols = columnBlocks.filter(col => col.length > 0);
                if (validCols.length >= 2) {
                    // Render full-width blocks from allBlocks as regular paragraphs first
                    const allFullWidthBlocks = (blocks || []).filter(b => b.fullWidth);
                    const seenFullText = new Set<string>();
                    for (const block of allFullWidthBlocks) {
                        const key = block.runs.map(r => r.text).join('|');
                        if (seenFullText.has(key)) continue;
                        seenFullText.add(key);
                        children.push(blockToParagraph(block));
                    }

                    // Render column-only blocks (already separated, no fullWidth blocks in columnBlocks)
                    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
                    const totalBlocks = validCols.reduce((sum, col) => sum + col.length, 0);
                    if (totalBlocks > 0) {
                        const table = new Table({
                            rows: [
                                new TableRow({
                                    children: validCols.map(colBlocks => {
                                        const proportion = totalBlocks > 0 ? Math.round((colBlocks.length / totalBlocks) * 100) : Math.floor(100 / validCols.length);
                                        const colWidth = Math.max(proportion, Math.floor(100 / validCols.length));
                                        const cellParagraphs = colBlocks.map(block => blockToCellParagraph(block));
                                        return new TableCell({
                                            width: { size: colWidth, type: WidthType.PERCENTAGE },
                                            verticalAlign: VerticalAlign.TOP,
                                            borders: {
                                                top: noBorder,
                                                bottom: noBorder,
                                                left: noBorder,
                                                right: noBorder,
                                            },
                                            children: cellParagraphs,
                                        });
                                    }),
                                }),
                            ],
                            width: { size: 100, type: WidthType.PERCENTAGE },
                        });
                        children.push(table);
                    }
                    continue;
                }
            }

            if (blocks && blocks.length > 0) {
                for (const block of blocks) {
                    children.push(blockToParagraph(block));
                }
                continue;
            }

            if (text && text.length > 0) {
                for (const paraText of text) {
                    children.push(new Paragraph({
                        spacing: { after: 160, line: 276 },
                        children: [new TextRun({ text: paraText })],
                    }));
                }
                continue;
            }

            // Fallback: embed the canvas as an image (for scanned pages or pages without extractable text)
            const contentWPx = (pageWidthTwips - marginLeft - marginRight) / 15;
            const contentHPx = (pageHeightTwips - marginTop - marginBottom) / 15;
            const scale = Math.min(contentWPx / canvas.width, contentHPx / canvas.height);
            const drawW = Math.max(1, Math.round(canvas.width * scale));
            const drawH = Math.max(1, Math.round(canvas.height * scale));

            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) continue;
            const data = new Uint8Array(await blob.arrayBuffer());

            const imageRun = new ImageRun({
                type: 'png',
                data,
                transformation: { width: drawW, height: drawH },
            });

            const paragraph = new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [imageRun],
            });

            children.push(paragraph);
        }

        // Use first page's geometry for the document section, or default to US Letter
        const firstGeo = pages[0]?.pageGeometry;
        const docPageWidth = firstGeo ? Math.round(firstGeo.width * 20) : (isLandscape ? 15840 : 12240);
        const docPageHeight = firstGeo ? Math.round(firstGeo.height * 20) : (isLandscape ? 12240 : 15840);

        const doc = new Document({
            sections: [{
                properties: {
                    page: {
                        size: {
                            width: docPageWidth,
                            height: docPageHeight,
                            orientation: isLandscape ? 'landscape' : 'portrait',
                        },
                        margin: {
                            top: firstGeo ? Math.round(firstGeo.marginTop * 20) : 720,
                            right: firstGeo ? Math.round(firstGeo.marginRight * 20) : 720,
                            bottom: firstGeo ? Math.round(firstGeo.marginBottom * 20) : 720,
                            left: firstGeo ? Math.round(firstGeo.marginLeft * 20) : 720,
                        },
                    },
                },
                children,
            }],
        });

        return await Packer.toBlob(doc);
    };
    
    const handleConvert = async () => {
        if (files.length === 0) return;
        setIsConverting(true);
        setStatusMessage(t.status.initializing);
        setConversionStages(stagesFromBackendStatus('queued', 'queued', 0));

        // Check if all files are PDFs targeting DOCX — route through backend LibreOffice
        const pdfToDocxFiles = files.filter(f => {
            const isPdf = f.file.type === 'application/pdf' || f.file.name.toLowerCase().endsWith('.pdf');
            const target = mergeFiles ? globalOutputFormat : f.outputFormat;
            return isPdf && target === 'docx';
        });

        if (pdfToDocxFiles.length > 0) {
            // If ALL files are PDF→DOCX, try backend LibreOffice first, fall back to client-side
            if (pdfToDocxFiles.length === files.length) {
                let backendSucceeded = false;
                try {
                    const backendFiles: DownloadableFile[] = [];
                    for (let idx = 0; idx < files.length; idx += 1) {
                        const appFile = files[idx];
                        const converted = await runOfficeConversionViaBackend(appFile, 'docx', idx, files.length);
                        backendFiles.push(...converted);
                        onConversionComplete('success');
                        onAddToHistory({
                            name: `${appFile.file.name} -> .docx`,
                            status: 'Success',
                            url: converted[0]?.url,
                        });
                    }

                    const finalFiles = backendFiles;
                    if (finalFiles.length === 1) {
                        setFinalFileName(finalFiles[0].name);
                    }

                    setDownloadableFiles(finalFiles);
                    setStatusMessage(t.status.complete);
                    setProgress({ current: files.length, total: files.length, percentage: 100 });
                    setIsConverting(false);
                    backendSucceeded = true;

                    if (autoDelete && finalFiles.length > 0) {
                        setFiles([]);
                    }
                    return;
                } catch (error) {
                    // Backend LibreOffice doesn't have DOCX export filter — fall through to client-side
                    console.warn('Backend PDF→DOCX failed, falling back to client-side conversion:', error);
                }

                if (!backendSucceeded) {
                    // Fall through to client-side DOCX generation below
                    setStatusMessage(`${t.status.processing} (client-side)`);
                }
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
                const docxPages: { canvas: HTMLCanvasElement; text?: string[]; blocks?: DocxBlock[]; columnBlocks?: DocxBlock[][]; columnCount?: number; pageGeometry?: PageGeometry }[] = [];
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
                            columnCount: page.columnCount,
                            pageGeometry: page.pageGeometry,
                        });
                    }
                }

                setStatusMessage(t.status.generating);
                const docxBlob = await buildDocxFromPages(docxPages);
                const docxName = files[0].file.name.split('.')[0] || 'merged_document';
                const docxUrl = URL.createObjectURL(docxBlob);
                generatedFiles.push({ name: docxName, url: docxUrl, format: 'docx' });
                onConversionComplete('success');
                onAddToHistory({ name: `${docxName}.docx`, status: 'Success', url: docxUrl });
                setFinalFileName(docxName);

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
                            columnCount: page.columnCount,
                            pageGeometry: page.pageGeometry,
                        }));
                        const docxBlob = await buildDocxFromPages(docxPages);
                        const docxUrl = URL.createObjectURL(docxBlob);
                        generatedFiles.push({ name: filename, url: docxUrl, format: 'docx' });
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
