import { Language, Theme } from "./App";
import { CompressionLevel } from "./components/ConversionOptions";

export type PageSize = 'a4' | 'letter';
export type Orientation = 'p' | 'l'; // portrait | landscape
export type ColorMode = 'color' | 'grayscale' | 'bw'; // bw = black & white
export type FontSize = 'sm' | 'md' | 'lg';
export type FontFamily = 'Space Grotesk' | 'Plus Jakarta Sans' | 'Inter' | 'Lato' | 'Roboto' | 'Merriweather';
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
    strikethrough?: boolean;
    url?: string;
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    characterSpacing?: number;
}

/** Spacing information for a DOCX block. */
export interface BlockSpacing {
    before?: number;   // space before in twips (1/20 of a point)
    after?: number;    // space after in twips
    line?: number;     // line spacing in twips (240 = single, 360 = 1.5, 480 = double)
}

/** One paragraph/block of a document, preserved from the source PDF layout. */
export interface DocxBlock {
    type: 'heading1' | 'heading2' | 'heading3' | 'body' | 'list' | 'spacer' | 'table_cell';
    runs: DocxRun[];
    fontSize?: number;
    fontFamily?: string;
    alignment?: 'left' | 'center' | 'right' | 'justify';
    spacing?: BlockSpacing;
    indent?: { left?: number; right?: number; firstLine?: number };
    isBold?: boolean;
    isItalic?: boolean;
    fullWidth?: boolean;
}

/** Page geometry extracted from the PDF. */
export interface PageGeometry {
    width: number;    // in points (1/72 inch)
    height: number;
    marginLeft: number;
    marginRight: number;
    marginTop: number;
    marginBottom: number;
}

export interface PageInfo {
    id: string;
    thumbnailUrl: string;
    rotation: 0 | 90 | 180 | 270;
    originalCanvas: HTMLCanvasElement;
    text?: string[];
    docxBlocks?: DocxBlock[];
    docxColumnBlocks?: DocxBlock[][];
    columnCount?: number;
    pageGeometry?: PageGeometry;
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