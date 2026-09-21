import React, { useState, useRef, useCallback } from 'react';
import { FileTextIcon, SpinnerIcon, ExclamationCircleIcon, DownloadIcon, CheckIcon, FolderZipIcon, RotateCwIcon } from './Icons';

// ── Types ──────────────────────────────────────────────────────────────────

interface ExtractedImage {
  id: string;
  dataUrl: string;         // base64 data URL for preview
  width: number;
  height: number;
  sizeBytes: number;
  sourcePageNumber: number; // which page of the original doc this came from
  format: string;           // 'png' | 'jpeg'
  fileName: string;         // auto-generated name
  selected: boolean;        // user toggle
}

type ImagesPerPage = 1 | 2 | 4 | 6 | 9;
type IEOutputFormat = 'pdf' | 'zip';

interface LayoutPreset {
  value: ImagesPerPage;
  label: string;
  description: string;
  gridCols: number;
  gridRows: number;
}

// ── Global declarations for CDN libraries ──────────────────────────────────
declare const pdfjsLib: any;
declare const jspdf: any;
declare const JSZip: any;

// ── Constants ──────────────────────────────────────────────────────────────

const LAYOUT_PRESETS: LayoutPreset[] = [
  { value: 1,  label: '1 per page',  description: 'Full page — one large image',       gridCols: 1, gridRows: 1 },
  { value: 2,  label: '2 per page',  description: 'Two images stacked vertically',      gridCols: 1, gridRows: 2 },
  { value: 4,  label: '4 per page',  description: '2×2 grid layout',                    gridCols: 2, gridRows: 2 },
  { value: 6,  label: '6 per page',  description: '2×3 grid layout',                    gridCols: 2, gridRows: 3 },
  { value: 9,  label: '9 per page',  description: '3×3 grid — compact thumbnails',      gridCols: 3, gridRows: 3 },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const generateImageId = (): string =>
  `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// ── PDF Image Extraction ───────────────────────────────────────────────────
// Uses pdf.js to iterate every page and extract embedded image XObjects.
// This extracts the ACTUAL embedded images, not page screenshots.

const extractImagesFromPDF = async (
  file: File,
  onProgress: (pct: number, msg: string) => void
): Promise<ExtractedImage[]> => {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const totalPages = pdf.numPages;
  const images: ExtractedImage[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress(
      Math.round((pageNum / totalPages) * 100),
      `Scanning page ${pageNum} of ${totalPages}...`
    );

    const page = await pdf.getPage(pageNum);
    const operatorList = await page.getOperatorList();

    // Walk the operator list to find paintImageXObject operations
    for (let i = 0; i < operatorList.fnArray.length; i++) {
      const fnId = operatorList.fnArray[i];

      // OPS.paintImageXObject = 85, OPS.paintJpegXObject = 82
      if (fnId === 85 || fnId === 82) {
        const imgName = operatorList.argsArray[i][0];

        try {
          // Retrieve the image data from the page's object store
          const imgData: any = await new Promise((resolve, reject) => {
            // pdf.js exposes page.objs for resolved image XObjects
            page.objs.get(imgName, (data: any) => {
              if (data) resolve(data);
              else reject(new Error(`Image ${imgName} not found`));
            });
          });

          // pdf.js >= 3.4.120 delivers embedded images as a wrapper object with
          // an ImageBitmap (.bitmap) when OffscreenCanvas is available, and as
          // raw pixel data ({ data, width, height, kind }) otherwise. Handle both.
          const bitmap = imgData?.bitmap instanceof ImageBitmap ? imgData.bitmap : (imgData instanceof ImageBitmap ? imgData : null);
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;

          if (bitmap) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            ctx.drawImage(bitmap, 0, 0);
          } else if (imgData?.data && imgData?.width && imgData?.height) {
            canvas.width = imgData.width;
            canvas.height = imgData.height;
            const imageDataObj = ctx.createImageData(imgData.width, imgData.height);

            // Handle both RGB and RGBA data
            if (imgData.data.length === imgData.width * imgData.height * 4) {
              imageDataObj.data.set(imgData.data);
            } else if (imgData.data.length === imgData.width * imgData.height * 3) {
              // Convert RGB to RGBA
              for (let j = 0, k = 0; j < imgData.data.length; j += 3, k += 4) {
                imageDataObj.data[k]     = imgData.data[j];
                imageDataObj.data[k + 1] = imgData.data[j + 1];
                imageDataObj.data[k + 2] = imgData.data[j + 2];
                imageDataObj.data[k + 3] = 255;
              }
            }
            ctx.putImageData(imageDataObj, 0, 0);
          } else {
            continue; // Skip unrecognized format
          }

          // Skip tiny images (likely icons, bullets, decorative dots)
          if (canvas.width < 50 || canvas.height < 50) continue;

          const dataUrl = canvas.toDataURL('image/png');
          const sizeBytes = Math.round((dataUrl.length - 'data:image/png;base64,'.length) * 0.75);

          images.push({
            id: generateImageId(),
            dataUrl,
            width: canvas.width,
            height: canvas.height,
            sizeBytes,
            sourcePageNumber: pageNum,
            format: 'png',
            fileName: `${file.name.replace(/\.[^.]+$/, '')}_page${pageNum}_img${images.length + 1}.png`,
            selected: true, // all selected by default
          });
        } catch {
          // Skip individual image extraction failures silently
          continue;
        }
      }
    }
  }

  return images;
};

// ── DOCX Image Extraction ──────────────────────────────────────────────────
// DOCX is a ZIP file. Images live in word/media/*.
// We use JSZip to extract them directly — no rendering needed.

const extractImagesFromDOCX = async (
  file: File,
  onProgress: (pct: number, msg: string) => void
): Promise<ExtractedImage[]> => {
  onProgress(10, 'Unpacking document structure...');

  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const images: ExtractedImage[] = [];

  // Find all image files in word/media/
  const mediaFiles = Object.keys(zip.files).filter(
    (path: string) =>
      path.startsWith('word/media/') &&
      /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg)$/i.test(path)
  );

  onProgress(20, `Found ${mediaFiles.length} embedded image(s)...`);

  for (let i = 0; i < mediaFiles.length; i++) {
    const mediaPath = mediaFiles[i];
    const mediaFileName = mediaPath.split('/').pop() ?? mediaPath;
    const ext = mediaFileName.split('.').pop()?.toLowerCase() ?? 'png';

    onProgress(
      20 + Math.round((i / mediaFiles.length) * 70),
      `Extracting image ${i + 1} of ${mediaFiles.length}...`
    );

    try {
      const blob = await zip.files[mediaPath].async('blob');
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Load image to get dimensions
      const { width, height } = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = reject;
          img.src = dataUrl;
        }
      );

      // Skip tiny images (bullets, icons, decorative dots)
      if (width < 50 || height < 50) continue;

      // Skip EMF/WMF (vector formats that don't render well as raster)
      if (['emf', 'wmf'].includes(ext)) continue;

      images.push({
        id: generateImageId(),
        dataUrl,
        width,
        height,
        sizeBytes: blob.size,
        sourcePageNumber: 0, // DOCX doesn't have page numbers at this level
        format: ['jpg', 'jpeg'].includes(ext) ? 'jpeg' : 'png',
        fileName: `${file.name.replace(/\.[^.]+$/, '')}_${mediaFileName}`,
        selected: true,
      });
    } catch {
      continue;
    }
  }

  onProgress(95, 'Finalizing extraction...');
  return images;
};

// ── PDF Generation with Grid Layout ────────────────────────────────────────
// Uses jsPDF to create a multi-page PDF with images arranged in the chosen grid.

const generateImageDocument = async (
  images: ExtractedImage[],
  imagesPerPage: ImagesPerPage,
  onProgress: (pct: number, msg: string) => void
): Promise<Blob> => {
  const { jsPDF } = jspdf;

  // A4 dimensions in mm
  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN = 12;
  const GAP = 8;

  const preset = LAYOUT_PRESETS.find(p => p.value === imagesPerPage)!;
  const cols = preset.gridCols;
  const rows = preset.gridRows;

  const usableW = PAGE_W - 2 * MARGIN - (cols - 1) * GAP;
  const usableH = PAGE_H - 2 * MARGIN - (rows - 1) * GAP;
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let slotIndex = 0;

  for (let i = 0; i < images.length; i++) {
    onProgress(
      Math.round((i / images.length) * 100),
      `Placing image ${i + 1} of ${images.length}...`
    );

    if (slotIndex > 0 && slotIndex % imagesPerPage === 0) {
      doc.addPage();
    }

    const posInPage = slotIndex % imagesPerPage;
    const col = posInPage % cols;
    const row = Math.floor(posInPage / cols);

    const x = MARGIN + col * (cellW + GAP);
    const y = MARGIN + row * (cellH + GAP);

    // Maintain aspect ratio within the cell
    const img = images[i];
    const aspectRatio = img.width / img.height;
    let drawW = cellW;
    let drawH = cellW / aspectRatio;

    if (drawH > cellH) {
      drawH = cellH;
      drawW = cellH * aspectRatio;
    }

    // Center image within the cell
    const offsetX = x + (cellW - drawW) / 2;
    const offsetY = y + (cellH - drawH) / 2;

    try {
      doc.addImage(
        img.dataUrl,
        img.format.toUpperCase() === 'JPEG' ? 'JPEG' : 'PNG',
        offsetX,
        offsetY,
        drawW,
        drawH
      );
    } catch (err) {
      console.warn(`Failed to add image ${i + 1}:`, err);
    }

    slotIndex++;
  }

  onProgress(100, 'Finalizing PDF...');
  return doc.output('blob');
};

// ── Generate ZIP of individual images ──────────────────────────────────────

const generateImageZip = async (
  images: ExtractedImage[],
  onProgress: (pct: number, msg: string) => void
): Promise<Blob> => {
  const zip = new JSZip();

  for (let i = 0; i < images.length; i++) {
    onProgress(
      Math.round((i / images.length) * 100),
      `Packing image ${i + 1} of ${images.length}...`
    );

    const img = images[i];
    // Convert data URL to blob
    const base64 = img.dataUrl.split(',')[1];
    zip.file(img.fileName, base64, { base64: true });
  }

  onProgress(100, 'Compressing ZIP...');
  return zip.generateAsync({ type: 'blob' });
};

// ── Main Component ─────────────────────────────────────────────────────────

const ImageExtractorView: React.FC = () => {
  // State
  const [extractedImages, setExtractedImages] = useState<ExtractedImage[]>([]);
  const [imagesPerPage, setImagesPerPage] = useState<ImagesPerPage>(4);
  const [outputFormat, setOutputFormat] = useState<IEOutputFormat>('pdf');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [sourceFileName, setSourceFileName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedImages = extractedImages.filter(img => img.selected);
  const totalSelectedSize = selectedImages.reduce((sum, img) => sum + img.sizeBytes, 0);

  // ── Handle file upload ───────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase();
    const isPDF = ext.endsWith('.pdf') || file.type === 'application/pdf';
    const isDOCX = ext.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (!isPDF && !isDOCX) {
      setError('Please upload a PDF or Word (.docx) file.');
      return;
    }

    setError('');
    setExtractedImages([]);
    setIsExtracting(true);
    setProgress(0);
    setSourceFileName(file.name);
    setStatusMessage(`Opening ${file.name}...`);

    try {
      const onProgress = (pct: number, msg: string) => {
        setProgress(pct);
        setStatusMessage(msg);
      };

      let images: ExtractedImage[];

      if (isPDF) {
        images = await extractImagesFromPDF(file, onProgress);
      } else {
        images = await extractImagesFromDOCX(file, onProgress);
      }

      if (images.length === 0) {
        setError(
          `No images found in "${file.name}". The document may contain only text, or the images may be in an unsupported format (e.g., SVG, EMF).`
        );
        setExtractedImages([]);
      } else {
        setExtractedImages(images);
        setStatusMessage(`✓ Extracted ${images.length} image(s) from ${file.name}`);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to extract images from the document.');
    } finally {
      setIsExtracting(false);
    }
  }, []);

  // ── Toggle image selection ───────────────────────────────────────────────
  const toggleImage = (id: string) => {
    setExtractedImages(prev =>
      prev.map(img => (img.id === id ? { ...img, selected: !img.selected } : img))
    );
  };

  const selectAll = () => {
    setExtractedImages(prev => prev.map(img => ({ ...img, selected: true })));
  };

  const deselectAll = () => {
    setExtractedImages(prev => prev.map(img => ({ ...img, selected: false })));
  };

  // ── Generate & download output ───────────────────────────────────────────
  const handleGenerate = async () => {
    if (selectedImages.length === 0) {
      setError('Please select at least one image.');
      return;
    }

    setError('');
    setIsGenerating(true);
    setProgress(0);

    try {
      const onProgress = (pct: number, msg: string) => {
        setProgress(pct);
        setStatusMessage(msg);
      };

      let blob: Blob;
      let extension: string;

      if (outputFormat === 'pdf') {
        blob = await generateImageDocument(selectedImages, imagesPerPage, onProgress);
        extension = 'pdf';
      } else {
        blob = await generateImageZip(selectedImages, onProgress);
        extension = 'zip';
      }

      // Auto-download
      const baseName = sourceFileName.replace(/\.[^.]+$/, '');
      const outputName = `${baseName}_extracted_images.${extension}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = outputName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up after a delay
      setTimeout(() => URL.revokeObjectURL(url), 30000);

      setStatusMessage(`✓ Downloaded ${outputName}`);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to generate the image document.');
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Start over ───────────────────────────────────────────────────────────
  const handleReset = () => {
    setExtractedImages([]);
    setError('');
    setStatusMessage('');
    setProgress(0);
    setSourceFileName('');
    setIsExtracting(false);
    setIsGenerating(false);
  };

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  // ── Calculate layout preview ─────────────────────────────────────────────
  const totalPages = Math.ceil(selectedImages.length / imagesPerPage);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-8 w-full">

      {/* ──────────── HEADER ──────────── */}
      <header className="view-header">
        <div className="flex items-center justify-between">
          <div>
            <div className="view-eyebrow">
              <span className="eyebrow-dot" />
              Batch extraction
            </div>
            <h1 className="display-md">Image Extractor</h1>
          </div>
          {extractedImages.length > 0 && (
            <button className="ie-reset-btn" onClick={handleReset}>
              <RotateCwIcon className="w-4 h-4" />
              Start Over
            </button>
          )}
        </div>
        <p className="body-sm mt-1">
          Extract embedded pictures from PDF & Word documents. Choose your layout and download.
        </p>
      </header>
      <div className="w-full max-w-4xl mx-auto">

      {/* ──────────── DROP ZONE ──────────── */}
      {extractedImages.length === 0 && !isExtracting && (
        <div
          className={`ie-drop-zone ${isDragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            id="image-extractor-input"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <div className="ie-drop-icon"><FileTextIcon className="w-14 h-14 mx-auto" /></div>
          <p className="ie-drop-title">
            Drop your <strong>PDF</strong> or <strong>Word</strong> document here
          </p>
          <p className="ie-drop-sub">
            or click to browse — we'll extract all embedded images
          </p>
          <div className="ie-supported-formats">
            <span className="ie-format-badge">PDF</span>
            <span className="ie-format-badge">DOCX</span>
          </div>
        </div>
      )}

      {/* ──────────── EXTRACTION PROGRESS ──────────── */}
      {isExtracting && (
        <div className="ie-progress-section">
          <div className="ie-progress-icon"><SpinnerIcon className="w-12 h-12 mx-auto" /></div>
          <p className="ie-progress-title">Extracting images...</p>
          <div className="ie-progress-bar-track">
            <div
              className="ie-progress-bar-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="ie-progress-msg">{statusMessage}</p>
        </div>
      )}

      {/* ──────────── ERROR ──────────── */}
      {error && (
        <div className="ie-error-box">
          <span className="ie-error-icon"><ExclamationCircleIcon className="w-5 h-5" /></span>
          <div>
            <p className="ie-error-text">{error}</p>
            <button className="ie-try-again-btn" onClick={handleReset}>
              Try another file
            </button>
          </div>
        </div>
      )}

      {/* ──────────── EXTRACTED IMAGES GALLERY ──────────── */}
      {extractedImages.length > 0 && !isExtracting && (
        <>
          {/* Summary bar */}
          <div className="ie-summary-bar">
            <div className="ie-summary-left">
              <span className="ie-summary-count">
                {extractedImages.length} image(s) found
              </span>
              <span className="ie-summary-selected">
                {selectedImages.length} selected
              </span>
              <span className="ie-summary-size">
                {formatBytes(totalSelectedSize)}
              </span>
            </div>
            <div className="ie-summary-right">
              <button className="ie-select-btn" onClick={selectAll}>
                Select All
              </button>
              <button className="ie-select-btn" onClick={deselectAll}>
                Deselect All
              </button>
            </div>
          </div>

          {/* Image gallery grid */}
          <div className="ie-gallery">
            {extractedImages.map((img) => (
              <div
                key={img.id}
                className={`ie-gallery-item ${img.selected ? 'selected' : ''}`}
                onClick={() => toggleImage(img.id)}
              >
                <div className="ie-gallery-checkbox">
                  {img.selected ? <CheckIcon className="w-4 h-4" /> : <span className="block w-4 h-4 rounded border border-current opacity-40" />}
                </div>
                <img
                  src={img.dataUrl}
                  alt={img.fileName}
                  className="ie-gallery-thumb"
                  loading="lazy"
                />
                <div className="ie-gallery-meta">
                  <span className="ie-gallery-dim">
                    {img.width}×{img.height}
                  </span>
                  <span className="ie-gallery-size">
                    {formatBytes(img.sizeBytes)}
                  </span>
                  {img.sourcePageNumber > 0 && (
                    <span className="ie-gallery-page">
                      p.{img.sourcePageNumber}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ──────────── LAYOUT OPTIONS ──────────── */}
          <div className="ie-options-section">
            <h3 className="ie-options-title">Output Layout</h3>

            {/* Output format toggle */}
            <div className="ie-format-toggle">
              <button
                className={`ie-format-btn ${outputFormat === 'pdf' ? 'active' : ''}`}
                onClick={() => setOutputFormat('pdf')}
              >
                <span className="flex items-center justify-center gap-2">
                  <FileTextIcon className="w-4 h-4" /> PDF Document
                </span>
              </button>
              <button
                className={`ie-format-btn ${outputFormat === 'zip' ? 'active' : ''}`}
                onClick={() => setOutputFormat('zip')}
              >
                <span className="flex items-center justify-center gap-2">
                  <FolderZipIcon className="w-4 h-4" /> ZIP (Individual Files)
                </span>
              </button>
            </div>

            {/* Images per page selector — only shown for PDF output */}
            {outputFormat === 'pdf' && (
              <div className="ie-layout-grid">
                {LAYOUT_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    className={`ie-layout-card ${imagesPerPage === preset.value ? 'active' : ''}`}
                    onClick={() => setImagesPerPage(preset.value)}
                  >
                    {/* Mini grid preview */}
                    <div
                      className="ie-layout-preview"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${preset.gridCols}, 1fr)`,
                        gridTemplateRows: `repeat(${preset.gridRows}, 1fr)`,
                        gap: '2px',
                      }}
                    >
                      {Array.from({ length: preset.value }).map((_, j) => (
                        <div key={j} className="ie-layout-cell" />
                      ))}
                    </div>
                    <span className="ie-layout-label">{preset.label}</span>
                    <span className="ie-layout-desc">{preset.description}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Page count preview */}
            {outputFormat === 'pdf' && selectedImages.length > 0 && (
              <div className="ie-page-preview">
                This will generate <strong>{totalPages} page(s)</strong> with{' '}
                <strong>{selectedImages.length} image(s)</strong> at{' '}
                <strong>{imagesPerPage} per page</strong>.
              </div>
            )}
          </div>

          {/* ──────────── GENERATE BUTTON ──────────── */}
          <div className="ie-generate-section">
            {isGenerating ? (
              <div className="ie-generating-state">
                <div className="ie-progress-bar-track">
                  <div
                    className="ie-progress-bar-fill generating"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="ie-progress-msg">{statusMessage}</p>
              </div>
            ) : (
              <button
                className="ie-generate-btn"
                onClick={handleGenerate}
                disabled={selectedImages.length === 0}
              >
                <span className="flex items-center justify-center gap-2">
                  <DownloadIcon className="w-4 h-4" />
                  {outputFormat === 'pdf'
                    ? `Download PDF (${totalPages} ${totalPages === 1 ? 'page' : 'pages'}, ${selectedImages.length} images)`
                    : `Download ZIP (${selectedImages.length} images)`}
                </span>
              </button>
            )}
          </div>

          {/* Status message */}
          {statusMessage && !isExtracting && !isGenerating && (
            <p className="ie-status-msg">{statusMessage}</p>
          )}
        </>
      )}
      </div>
    </div>
  );
};

export default ImageExtractorView;
