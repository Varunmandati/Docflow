import path from 'path';
import { CompressionAnalysisBreakdown, CompressionPreset } from '../models/types.js';
import { env } from '../config/env.js';
import { executeCommand } from './command.service.js';

export type DetectedCompressionType = 'scanned' | 'text' | 'mixed' | 'image' | 'archive' | 'other';

const imageExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.bmp']);
const archiveExt = new Set(['.zip', '.rar']);
const pdfExt = new Set(['.pdf']);

export interface CompressionInputAnalysis {
    detectedType: DetectedCompressionType;
    breakdownBytes: CompressionAnalysisBreakdown;
    suggestions: string[];
    recommendedPreset: CompressionPreset;
}

function buildBreakdown(totalBytes: number, percentages: CompressionAnalysisBreakdown): CompressionAnalysisBreakdown {
    const total = Math.max(0, totalBytes);
    const toBytes = (pct: number) => Math.max(0, Math.floor((total * pct) / 100));

    const breakdown: CompressionAnalysisBreakdown = {
        images: toBytes(percentages.images),
        text: toBytes(percentages.text),
        vector: toBytes(percentages.vector),
        metadata: toBytes(percentages.metadata),
        other: 0,
    };

    const allocated = breakdown.images + breakdown.text + breakdown.vector + breakdown.metadata;
    breakdown.other = Math.max(0, total - allocated);
    return breakdown;
}

export async function detectCompressionType(inputPath: string): Promise<DetectedCompressionType> {
    const ext = path.extname(inputPath).toLowerCase();

    if (archiveExt.has(ext)) return 'archive';
    if (imageExt.has(ext)) return 'image';
    if (!pdfExt.has(ext)) return 'other';

    // Serverless runtimes have no pdftotext. The probe is only an advisory
    // input for preset *recommendations* (real compression settings come from
    // the user's choices), so skip the doomed spawn and classify as mixed.
    if (env.USE_REMOTE_ENGINE) return 'mixed';

    try {
        const result = await executeCommand(
            env.PDFTOTEXT_BINARY,
            ['-q', '-f', '1', '-l', '5', inputPath, '-'],
            Math.min(env.CONVERSION_TIMEOUT_MS, 60000)
        );

        const text = `${result.stdout || ''}`.trim();
        if (text.length < 40) {
            return 'scanned';
        }

        const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
        const ratio = alphaCount / Math.max(text.length, 1);
        if (ratio > 0.45) return 'text';
        return 'mixed';
    } catch {
        return 'mixed';
    }
}

export async function analyzeCompressionInput(inputPath: string, originalSize: number): Promise<CompressionInputAnalysis> {
    const ext = path.extname(inputPath).toLowerCase();
    const detectedType = await detectCompressionType(inputPath);

    if (archiveExt.has(ext)) {
        return {
            detectedType,
            breakdownBytes: buildBreakdown(originalSize, {
                images: 45,
                text: 15,
                vector: 10,
                metadata: 5,
                other: 25,
            }),
            suggestions: [
                'Use web or email preset for archive attachments.',
                'Large media files inside archives often drive most of the size.',
                'If fidelity matters, keep lock quality enabled for source assets.',
            ],
            recommendedPreset: originalSize > 10 * 1024 * 1024 ? 'web' : 'optimize',
        };
    }

    if (imageExt.has(ext)) {
        return {
            detectedType,
            breakdownBytes: buildBreakdown(originalSize, {
                images: 92,
                text: 0,
                vector: 0,
                metadata: 6,
                other: 2,
            }),
            suggestions: [
                'For web delivery, use quality between 68 and 78 for better savings.',
                'Resize oversized images before distribution for stronger compression.',
                'Convert PNG screenshots to JPEG/WebP when transparency is not required.',
            ],
            recommendedPreset: originalSize > 3 * 1024 * 1024 ? 'web' : 'optimize',
        };
    }

    if (pdfExt.has(ext)) {
        if (detectedType === 'scanned') {
            return {
                detectedType,
                breakdownBytes: buildBreakdown(originalSize, {
                    images: 76,
                    text: 6,
                    vector: 8,
                    metadata: 5,
                    other: 5,
                }),
                suggestions: [
                    'Scanned PDFs are image-heavy; use web or email preset for best gains.',
                    'Run OCR before sharing to improve searchability and often reduce final size.',
                    'Avoid repeated scan layers to keep page quality stable.',
                ],
                recommendedPreset: 'email',
            };
        }

        if (detectedType === 'text') {
            return {
                detectedType,
                breakdownBytes: buildBreakdown(originalSize, {
                    images: 14,
                    text: 52,
                    vector: 22,
                    metadata: 7,
                    other: 5,
                }),
                suggestions: [
                    'Text PDFs preserve clarity well; optimize preset balances size and readability.',
                    'Enable print preset only when exact typography and vector detail are critical.',
                    'Removing embedded metadata can help trim extra bytes.',
                ],
                recommendedPreset: 'optimize',
            };
        }

        return {
            detectedType,
            breakdownBytes: buildBreakdown(originalSize, {
                images: 48,
                text: 26,
                vector: 14,
                metadata: 6,
                other: 6,
            }),
            suggestions: [
                'Mixed-content PDFs benefit from optimize preset first, then web for extra reduction.',
                'If pages include screenshots, lowering quality yields the biggest savings.',
                'Split and reassemble very large PDFs to target heavy sections selectively.',
            ],
            recommendedPreset: 'optimize',
        };
    }

    return {
        detectedType,
        breakdownBytes: buildBreakdown(originalSize, {
            images: 20,
            text: 20,
            vector: 10,
            metadata: 10,
            other: 40,
        }),
        suggestions: [
            'Use optimize preset for balanced compression.',
            'If output quality is still high, retry with web preset for stronger savings.',
            'Consider converting unsupported formats to PDF before compression.',
        ],
        recommendedPreset: 'optimize',
    };
}
