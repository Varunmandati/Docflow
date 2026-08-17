import { Language, Theme } from "./App";
import { CompressionLevel } from "./components/ConversionOptions";

export type PageSize = 'a4' | 'letter';
export type Orientation = 'p' | 'l'; // portrait | landscape
export type ColorMode = 'color' | 'grayscale' | 'bw'; // bw = black & white
export type FontSize = 'sm' | 'md' | 'lg';
export type FontFamily = 'Inter' | 'Roboto' | 'Lato' | 'Merriweather';
export type OutputFormat = 'pdf' | 'jpg' | 'png' | 'webp' | 'docx';
export type DownloadableFormat = OutputFormat | 'zip';

export interface SecurityOptions {
    password?: string;
}

/** A single text run inside a DOCX block — carries formatting + optional hyperlink. */
export interface DocxRun {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    url?: string;
}

/** One paragraph/block of a document, preserved from the source PDF layout. */
export interface DocxBlock {
    type: 'heading1' | 'heading2' | 'heading3' | 'body' | 'list' | 'spacer';
    runs: DocxRun[];
}

export interface PageInfo {
    id: string;
    thumbnailUrl: string;
    rotation: 0 | 90 | 180 | 270;
    originalCanvas: HTMLCanvasElement;
    text?: string[];
    docxBlocks?: DocxBlock[];
}

export interface AppFile {
  id: string;
  file: File;
  pages: PageInfo[];
  pageCount: number;
  progress?: number;
  status: 'loading' | 'ready' | 'processing' | 'done';
  outputFormat: OutputFormat; // Individual output format
}

export interface CompressFile {
    id: string;
    file: File;
    type: 'image' | 'pdf' | 'docx' | 'pptx' | 'other';
    quality: number; // 0-100
    isProcessing: boolean;
    originalSize: number;
    compressedSize?: number;
    previewUrl?: string;
    isPdfPage?: boolean;
    originalPdfId?: string;
    originalPdfName?: string;
    pageNumber?: number;
    originalFile?: File;
    relativePath?: string;
    detectedType?: string;
}

export interface DownloadableFile {
    name: string;
    url: string;
    format: DownloadableFormat;
}

export interface HistoryEntry {
    id: number;
    name: string;
    date: string;
    status: 'Success' | 'Failed';
    url?: string; // URL to the generated PDF for re-download
    type?: 'Convert' | 'Compress'; // Type of operation
}

export interface ConversionSettings {
    language: Language;
    theme: Theme;
    defaultCompression: CompressionLevel;
    autoDelete: boolean;
    backgroundAnimation: boolean;
    fontSize: FontSize;
    fontFamily: FontFamily;
}

export interface UserProfile {
    name: string;
    email: string;
    avatarUrl: string;
    downloadedBytes?: number;
}