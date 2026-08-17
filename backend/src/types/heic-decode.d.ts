declare module 'heic-decode' {
    interface HeicDecodeResult {
        width: number;
        height: number;
        data: Uint8Array;
    }
    interface HeicDecodeOptions {
        buffer: Buffer | Uint8Array | ArrayBuffer;
    }
    export default function heicDecode(options: HeicDecodeOptions): Promise<HeicDecodeResult>;
}
