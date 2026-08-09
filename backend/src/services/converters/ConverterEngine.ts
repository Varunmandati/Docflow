export interface EngineConversionResult {
    outputPath: string; // The absolute path where the converted file was saved
    sizeBytes: number;
    pages?: number; // Only applicable for documents/PDFs
    durationMs: number;
}

export interface EngineOptions {
    dpi?: number;
    quality?: number;
    password?: string;
    // Add additional engine-specific options if needed
    [key: string]: any;
}

export interface ConverterEngine {
    /**
     * Engine Name for logging (e.g. 'LibreOffice', 'FFmpeg', 'Sharp')
     */
    name: string;

    /**
     * Checks if this engine can handle the specific conversion pair.
     */
    canHandle(sourceFormat: string, targetFormat: string): boolean;

    /**
     * Converts a file.
     * @param inputPath Absolute path to the source file
     * @param outputDir Absolute path to the directory where the output should be saved
     * @param sourceFormat The source extension/format without dot (e.g. 'docx')
     * @param targetFormat The target extension/format without dot (e.g. 'pdf')
     * @param options Additional conversion options
     * @returns Information about the generated output
     */
    convert(
        inputPath: string,
        outputDir: string,
        sourceFormat: string,
        targetFormat: string,
        options?: EngineOptions
    ): Promise<EngineConversionResult>;
}
