export type FormatType = 'document' | 'image' | 'spreadsheet' | 'presentation' | 'archive' | 'audio' | 'video';
export type SupportStatus = 'supported' | 'lossy' | 'unsupported';

export interface ConversionCapability {
    targetFormat: string;
    status: SupportStatus;
    note?: string;
}

export interface FormatDefinition {
    type: FormatType;
    targets: ConversionCapability[];
}

export type ConversionMatrix = Record<string, FormatDefinition>;

// NOTE: these targets must reflect what the converter ENGINES can actually do, NOT an
// ideal wish-list. The frontend renders this matrix directly into its output format
// selector, so advertising a pair we can't perform reliably bricks the conversion flow.
//
// Real capability map (see services/converters/*):
//  - LibreOfficeEngine : office docs -> pdf, AND pdf -> docx/doc/odt/rtf/html/txt
//  - SharpEngine       : raster->raster (png/jpg/jpeg/webp/gif/tiff/heic/heif/avif)
//  - PdfEngine         : pdf -> jpg/png(+webp via pdftocairo)
//  - FfmpegEngine      : audio<->audio, video->video/audio/gif
//  - ArchiveEngine     : zip/tar/tar.gz/7z <-> each other
//  - Client-side (jsPDF/canvas) : pdf, jpg, png, webp rendering and merging

const AUDIO_TARGETS = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'];
const VIDEO_TARGETS = ['mp4', 'mov', 'webm', 'avi', 'mkv'];

const buildTargets = (supported: string[], lossy: string[] = []): ConversionCapability[] => {
    return [
        ...supported.map(t => ({ targetFormat: t, status: 'supported' as SupportStatus })),
        ...lossy.map(t => ({ targetFormat: t, status: 'lossy' as SupportStatus, note: 'May lose quality or formatting' }))
    ];
};

export const conversionMatrix: ConversionMatrix = {
    // ---- Documents ----
    'pdf': {
        type: 'document',
        targets: [
            { targetFormat: 'docx', status: 'supported', note: 'Layout-aware editable Word document with font, column, image, and spacing preservation' },
            { targetFormat: 'jpg', status: 'supported' },
            { targetFormat: 'png', status: 'supported' },
            { targetFormat: 'webp', status: 'supported' },
        ]
    },
    'docx': {
        type: 'document',
        targets: buildTargets(['pdf'])
    },
    'doc': {
        type: 'document',
        targets: buildTargets(['pdf'])
    },
    'odt': {
        type: 'document',
        targets: buildTargets(['pdf'])
    },
    'rtf': {
        type: 'document',
        targets: buildTargets(['pdf'])
    },
    'txt': {
        type: 'document',
        targets: buildTargets(['pdf'])
    },
    'html': {
        type: 'document',
        targets: buildTargets(['pdf'])
    },
    'md': {
        type: 'document',
        targets: buildTargets(['pdf'])
    },
    'epub': {
        type: 'document',
        targets: buildTargets(['pdf'])
    },

    // ---- Images ----
    // Raster sources can be rendered client-side and exported as pdf/jpg/png/webp,
    // or re-encoded by the SharpEngine for the same formats.
    'png': {
        type: 'image',
        targets: buildTargets(['pdf', 'jpg', 'webp'])
    },
    'jpg': {
        type: 'image',
        targets: buildTargets(['pdf', 'png', 'webp'])
    },
    'jpeg': {
        type: 'image',
        targets: buildTargets(['pdf', 'png', 'webp'])
    },
    'webp': {
        type: 'image',
        targets: buildTargets(['pdf', 'png', 'jpg'])
    },
    'gif': {
        type: 'image',
        targets: buildTargets(['pdf', 'png', 'jpg', 'webp'])
    },
    'bmp': {
        type: 'image',
        targets: buildTargets(['pdf', 'png', 'jpg', 'webp'])
    },
    'tiff': {
        type: 'image',
        targets: buildTargets(['pdf', 'png', 'jpg', 'webp'])
    },
    'svg': {
        type: 'image',
        targets: buildTargets(['pdf', 'png', 'jpg', 'webp'])
    },
    'heic': {
        type: 'image',
        targets: buildTargets(['pdf', 'png', 'jpg', 'webp'])
    },
    'heif': {
        type: 'image',
        targets: buildTargets(['pdf', 'png', 'jpg', 'webp'])
    },
    'avif': {
        type: 'image',
        targets: buildTargets(['pdf', 'png', 'jpg', 'webp'])
    },
    'ico': {
        type: 'image',
        targets: buildTargets(['png'])
    },

    // ---- Spreadsheets ----
    'xlsx': {
        type: 'spreadsheet',
        targets: buildTargets(['pdf'])
    },
    'xls': {
        type: 'spreadsheet',
        targets: buildTargets(['pdf'])
    },
    'csv': {
        type: 'spreadsheet',
        targets: buildTargets(['pdf'])
    },
    'ods': {
        type: 'spreadsheet',
        targets: buildTargets(['pdf'])
    },
    'tsv': {
        type: 'spreadsheet',
        targets: buildTargets(['pdf'])
    },

    // ---- Presentations ----
    'pptx': {
        type: 'presentation',
        targets: buildTargets(['pdf'])
    },
    'ppt': {
        type: 'presentation',
        targets: buildTargets(['pdf'])
    },
    'odp': {
        type: 'presentation',
        targets: buildTargets(['pdf'])
    },

    // ---- Archives ----
    'zip': {
        type: 'archive',
        targets: buildTargets(['tar', 'tar.gz', '7z'])
    },
    'tar': {
        type: 'archive',
        targets: buildTargets(['zip', 'tar.gz', '7z'])
    },
    'tar.gz': {
        type: 'archive',
        targets: buildTargets(['zip', 'tar', '7z'])
    },
    '7z': {
        type: 'archive',
        targets: buildTargets(['zip', 'tar', 'tar.gz'])
    },

    // ---- Audio ----
    'mp3': {
        type: 'audio',
        targets: buildTargets(AUDIO_TARGETS.filter(t => t !== 'mp3'))
    },
    'wav': {
        type: 'audio',
        targets: buildTargets(AUDIO_TARGETS.filter(t => t !== 'wav'))
    },
    'aac': {
        type: 'audio',
        targets: buildTargets(AUDIO_TARGETS.filter(t => t !== 'aac'))
    },
    'flac': {
        type: 'audio',
        targets: buildTargets(AUDIO_TARGETS.filter(t => t !== 'flac'))
    },
    'ogg': {
        type: 'audio',
        targets: buildTargets(AUDIO_TARGETS.filter(t => t !== 'ogg'))
    },
    'm4a': {
        type: 'audio',
        targets: buildTargets(AUDIO_TARGETS.filter(t => t !== 'm4a'))
    },

    // ---- Video ----
    'mp4': {
        type: 'video',
        targets: buildTargets(VIDEO_TARGETS.filter(t => t !== 'mp4').concat(['mp3', 'gif']))
    },
    'mov': {
        type: 'video',
        targets: buildTargets(VIDEO_TARGETS.filter(t => t !== 'mov').concat(['mp3', 'gif']))
    },
    'webm': {
        type: 'video',
        targets: buildTargets(VIDEO_TARGETS.filter(t => t !== 'webm').concat(['mp3', 'gif']))
    },
    'avi': {
        type: 'video',
        targets: buildTargets(VIDEO_TARGETS.filter(t => t !== 'avi').concat(['mp3', 'gif']))
    },
    'mkv': {
        type: 'video',
        targets: buildTargets(VIDEO_TARGETS.filter(t => t !== 'mkv').concat(['mp3', 'gif']))
    }
};

export const validateConversion = (sourceExt: string, targetExt: string): { isValid: boolean; isLossy: boolean; note?: string } => {
    const sourceStr = sourceExt.toLowerCase().replace('.', '');
    const targetStr = targetExt.toLowerCase().replace('.', '');
    
    const formatDef = conversionMatrix[sourceStr];
    if (!formatDef) {
        return { isValid: false, isLossy: false, note: `Unsupported source format: ${sourceStr}` };
    }
    
    const targetCap = formatDef.targets.find(t => t.targetFormat === targetStr);
    if (!targetCap) {
        return { isValid: false, isLossy: false, note: `Cannot convert ${sourceStr} to ${targetStr}` };
    }
    
    return {
        isValid: true,
        isLossy: targetCap.status === 'lossy',
        note: targetCap.note
    };
};
