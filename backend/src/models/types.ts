export type ImageFormat = 'png' | 'jpg';

export interface OutputRequest {
    images?: boolean;
    html?: boolean;
    splitPages?: boolean;
    imageFormat?: ImageFormat;
    dpi?: number;
}

export interface UploadedFileMeta {
    fileId: string;
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
    path: string;
    createdAt: string;
}

export interface ConversionJobData {
    jobId: string;
    fileId: string;
    inputPath: string;
    inputName: string;
    sourceFormat: string;
    targetFormat: string;
    options?: any;
    userId?: string; // Firebase UID — set for authenticated jobs
}

export interface BatchImageConversionJobData {
    jobId: string;
    batchId: string;
    imageFilePaths: string[]; // Array of image paths in sequential order
    imageNames: string[]; // Original file names for reference
    outputFileName: string;
    userId?: string; // Firebase UID
}

export type CompressionPreset = 'optimize' | 'web' | 'email' | 'whatsapp' | 'print';

export interface CompressionOptions {
    quality: number;
    targetBytes?: number;
    preset?: CompressionPreset;
    lockQuality?: boolean;
}

export interface CompressionJobData {
    jobId: string;
    fileId: string;
    inputPath: string;
    inputName: string;
    options: CompressionOptions;
    userId?: string; // Firebase UID
}

export interface OutputFileRef {
    relativePath: string;
    downloadUrl: string;
    size: number;
}

export interface ConversionResult {
    jobId: string;
    fileId: string;
    outputs: {
        primary: OutputFileRef & { pageCount?: number };
        splitPages?: OutputFileRef[];
    };
    completedAt: string;
}

export interface CompressionAnalysisBreakdown {
    images: number;
    text: number;
    vector: number;
    metadata: number;
    other: number;
}

export interface CompressionResult {
    jobId: string;
    fileId: string;
    outputs: {
        primary: OutputFileRef;
    };
    analysis: {
        detectedType: 'scanned' | 'text' | 'mixed' | 'image' | 'archive' | 'other';
        originalSize: number;
        compressedSize: number;
        savingsPercent: number;
        breakdownBytes: CompressionAnalysisBreakdown;
        suggestions: string[];
        recommendedPreset: CompressionPreset;
        appliedPreset: CompressionPreset;
        qualityUsed: number;
    };
    completedAt: string;
}

export interface BatchImageConversionResult {
    jobId: string;
    batchId: string;
    outputs: {
        pdf: OutputFileRef & { pageCount: number };
    };
    completedAt: string;
}

export type JobResult = ConversionResult | CompressionResult | BatchImageConversionResult;

export interface JobStatus {
    jobId: string;
    status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'expired';
    stage: string;
    progress: number;
    message?: string;
    error?: string;
    updatedAt: string;
}
