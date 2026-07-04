/**
 * Profile Image Resizing Service
 * Handles resizing, compression, and optimization of profile pictures
 */

export interface ResizeOptions {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number; // 0.1 to 1.0
    format?: 'jpeg' | 'webp' | 'png';
}

const DEFAULT_RESIZE_OPTIONS: ResizeOptions = {
    maxWidth: 300,
    maxHeight: 300,
    quality: 0.9,
    format: 'jpeg',
};

/**
 * Resize image from File or data URL
 * @param source - Image File or data URL string
 * @param options - Resize options
 * @returns Promise<string> - Base64 data URL
 */
export const resizeImage = async (
    source: File | string,
    options: ResizeOptions = {}
): Promise<string> => {
    const opts = { ...DEFAULT_RESIZE_OPTIONS, ...options };

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        // Load image from File or data URL
        if (source instanceof File) {
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target?.result as string;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(source);
        } else {
            img.src = source;
        }

        img.onload = () => {
            try {
                // Calculate new dimensions (maintain aspect ratio)
                let { width, height } = img;
                const aspectRatio = width / height;

                if (width > (opts.maxWidth || 300) || height > (opts.maxHeight || 300)) {
                    if (aspectRatio > 1) {
                        width = opts.maxWidth || 300;
                        height = width / aspectRatio;
                    } else {
                        height = opts.maxHeight || 300;
                        width = height * aspectRatio;
                    }
                }

                // Create canvas and draw
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Could not get canvas context');

                // Draw image on canvas
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to blob with compression
                const mimeType = `image/${opts.format}`;
                canvas.toBlob(
                    (blob) => {
                        if (!blob) throw new Error('Failed to create blob');

                        const reader = new FileReader();
                        reader.onload = (e) => {
                            resolve(e.target?.result as string);
                        };
                        reader.onerror = () => reject(new Error('Failed to convert blob'));
                        reader.readAsDataURL(blob);
                    },
                    mimeType,
                    opts.quality
                );
            } catch (error) {
                reject(error);
            }
        };

        img.onerror = () => reject(new Error('Failed to load image'));
    });
};

/**
 * Crop image to square (for profile pictures)
 * @param source - Image File or data URL
 * @param size - Square size in pixels
 * @returns Promise<string> - Base64 data URL
 */
export const cropToSquare = async (
    source: File | string,
    size: number = 300
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        if (source instanceof File) {
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target?.result as string;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(source);
        } else {
            img.src = source;
        }

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;

                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Could not get canvas context');

                // Calculate crop area (center crop)
                const minDimension = Math.min(img.width, img.height);
                const sx = (img.width - minDimension) / 2;
                const sy = (img.height - minDimension) / 2;

                // Draw cropped image
                ctx.drawImage(img, sx, sy, minDimension, minDimension, 0, 0, size, size);

                canvas.toBlob(
                    (blob) => {
                        if (!blob) throw new Error('Failed to create blob');

                        const reader = new FileReader();
                        reader.onload = (e) => {
                            resolve(e.target?.result as string);
                        };
                        reader.onerror = () => reject(new Error('Failed to convert blob'));
                        reader.readAsDataURL(blob);
                    },
                    'image/jpeg',
                    0.9
                );
            } catch (error) {
                reject(error);
            }
        };

        img.onerror = () => reject(new Error('Failed to load image'));
    });
};

/**
 * Compress image with size limit
 * @param source - Image File or data URL
 * @param maxSizeKB - Maximum file size in KB
 * @returns Promise<string> - Base64 data URL
 */
export const compressImage = async (
    source: File | string,
    maxSizeKB: number = 200
): Promise<string> => {
    let quality = 0.9;
    let result: string;

    // Iteratively reduce quality until size is under limit
    while (quality > 0.1) {
        result = await resizeImage(source, { quality, format: 'jpeg' });
        const sizeKB = (result.length * 0.75) / 1024; // Rough estimate

        if (sizeKB <= maxSizeKB) {
            return result;
        }

        quality -= 0.1;
    }

    return result!;
};

/**
 * Get image dimensions
 * @param source - Image File or data URL
 * @returns Promise<{width, height}>
 */
export const getImageDimensions = async (
    source: File | string
): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        if (source instanceof File) {
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target?.result as string;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(source);
        } else {
            img.src = source;
        }

        img.onload = () => {
            resolve({ width: img.width, height: img.height });
        };

        img.onerror = () => reject(new Error('Failed to load image'));
    });
};

/**
 * Get cropped image from react-easy-crop pixels
 */
export const getCroppedImg = async (
    imageSrc: string,
    pixelCrop: { width: number; height: number; x: number; y: number }
): Promise<string> => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    
    return new Promise((resolve, reject) => {
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = pixelCrop.width;
            canvas.height = pixelCrop.height;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                reject(new Error('No 2d context'));
                return;
            }

            ctx.drawImage(
                image,
                pixelCrop.x,
                pixelCrop.y,
                pixelCrop.width,
                pixelCrop.height,
                0,
                0,
                pixelCrop.width,
                pixelCrop.height
            );

            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Canvas is empty'));
                    return;
                }
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.readAsDataURL(blob);
            }, 'image/jpeg');
        };
        image.onerror = () => reject(new Error('Failed to load image'));
        image.src = imageSrc;
    });
};
