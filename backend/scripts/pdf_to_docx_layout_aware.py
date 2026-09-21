#!/usr/bin/env python3
"""
Layout-aware PDF to DOCX converter using PyMuPDF (fitz) and python-docx.
Preserves: multi-column layouts, fonts, images, spacing, page structure.
"""

import sys
import os
import json
import tempfile
import shutil
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Any
import math

import fitz  # PyMuPDF
from docx import Document
from docx.shared import Pt, Inches, Cm, Emu, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_ORIENT
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml


class TextSpan:
    """Represents a single text span with formatting and position."""
    def __init__(self, text: str, x0: float, y0: float, x1: float, y1: float,
                 font: str, size: float, flags: int, color: int):
        self.text = text
        self.x0 = x0
        self.y0 = y0
        self.x1 = x1
        self.y1 = y1
        self.font = font
        self.size = size
        self.flags = flags
        self.color = color
        self.is_bold = bool(flags & 16)  # 16 = bold
        self.is_italic = bool(flags & 2)  # 2 = italic
        self.is_underline = False  # Not directly available in fitz
        self.page_num = 0
        self.block_num = 0
        self.line_num = 0
        self.span_num = 0

    @property
    def center_x(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def center_y(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0


class ImageInfo:
    """Represents an image with position and metadata."""
    def __init__(self, xref: int, page_num: int, x0: float, y0: float, x1: float, y1: float,
                 width: int, height: int, ext: str, image_bytes: bytes):
        self.xref = xref
        self.page_num = page_num
        self.x0 = x0
        self.y0 = y0
        self.x1 = x1
        self.y1 = y1
        self.width = width
        self.height = height
        self.ext = ext
        self.image_bytes = image_bytes

    @property
    def center_x(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def center_y(self) -> float:
        return (self.y0 + self.y1) / 2


class LayoutAnalyzer:
    """Analyzes PDF page layout: columns, margins, reading order."""

    def __init__(self, page: fitz.Page):
        self.page = page
        self.page_rect = page.rect
        self.page_width = page_rect.width
        self.page_height = page_rect.height

    def detect_columns(self, spans: List[TextSpan]) -> List[Tuple[float, float]]:
        """Detect column boundaries from text spans."""
        if not spans:
            return [(0, self.page_width)]

        # Get all unique x positions of span starts
        x_starts = sorted(set(round(s.x0, 1) for s in spans))
        x_ends = sorted(set(round(s.x1, 1) for s in spans))

        # Cluster x positions to find column boundaries
        columns = []
        if len(x_starts) <= 2:
            # Single column
            left = min(x_starts)
            right = max(x_ends)
            return [(left, right)]

        # Try to detect 2-column layout
        # Find gap in the middle
        mid = self.page_width / 2
        left_spans = [s for s in spans if s.center_x < mid * 0.9]
        right_spans = [s for s in spans if s.center_x > mid * 1.1]

        if left_spans and right_spans:
            # Two columns detected
            left_min = min(s.x0 for s in left_spans)
            left_max = max(s.x1 for s in left_spans)
            right_min = min(s.x0 for s in right_spans)
            right_max = max(s.x1 for s in right_spans)
            return [(left_min, left_max), (right_min, right_max)]

        # Single column
        return [(min(x_starts), max(x_ends))]

    def detect_margins(self, spans: List[TextSpan]) -> Tuple[float, float, float, float]:
        """Detect page margins from text spans."""
        if not spans:
            return 72, 72, 72, 72  # 1 inch default

        left = min(s.x0 for s in spans)
        right = self.page_width - max(s.x1 for s in spans)
        top = min(s.y0 for s in spans)
        bottom = self.page_height - max(s.y1 for s in spans)

        return max(left, 36), max(top, 36), max(right, 36), max(bottom, 36)


class PDFToDOCXConverter:
    """Main converter class."""

    def __init__(self, input_path: str, output_path: str):
        self.input_path = input_path
        self.output_path = output_path
        self.doc = fitz.open(input_path)
        self.output_doc = Document()
        self.temp_dir = tempfile.mkdtemp(prefix="docflow_pdf2docx_")
        self._setup_document()

    def _setup_document(self):
        """Set up document defaults."""
        style = self.output_doc.styles['Normal']
        font = style.font
        font.name = 'Calibri'
        font.size = Pt(11)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.line_spacing = 1.15

    def convert(self) -> bool:
        """Main conversion entry point."""
        try:
            for page_num in range(len(self.doc)):
                page = self.doc[page_num]
                self._process_page(page, page_num)

            self.output_doc.save(self.output_path)
            return True
        except Exception as e:
            print(f"Conversion error: {e}", file=sys.stderr)
            return False
        finally:
            self._cleanup()

    def _process_page(self, page: fitz.Page, page_num: int):
        """Process a single PDF page."""
        # Add page break except for first page
        if page_num > 0:
            self.output_doc.add_page_break()

        # Set page size and margins
        self._setup_page_geometry(page)

        # Extract all content
        spans = self._extract_text_spans(page, page_num)
        images = self._extract_images(page, page_num)

        if not spans and not images:
            return

        # Analyze layout
        analyzer = LayoutAnalyzer(page)
        columns = analyzer.detect_columns(spans)
        margins = analyzer.detect_margins(spans)

        # Group spans by column and reading order
        column_groups = self._group_by_column(spans, columns)

        # Process each column
        for col_idx, (col_spans, col_bounds) in enumerate(column_groups):
            if not col_spans:
                continue

            # Process column content in reading order
            self._render_column(col_spans, col_bounds, images, page_num, col_idx)

    def _setup_page_geometry(self, page: fitz.Page):
        """Configure page size and orientation in DOCX."""
        section = self.output_doc.sections[-1]
        page_width = page.rect.width
        page_height = page.rect.height

        # Convert points to inches (1 inch = 72 points)
        section.page_width = Inches(page_width / 72)
        section.page_height = Inches(page_height / 72)

        if page_width > page_height:
            section.orientation = WD_ORIENT.LANDSCAPE
        else:
            section.orientation = WD_ORIENT.PORTRAIT

    def _extract_text_spans(self, page: fitz.Page, page_num: int) -> List[TextSpan]:
        """Extract all text spans with formatting and position."""
        spans = []
        blocks = page.get_text("dict", flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXTFLAGS_SEARCH)["blocks"]

        for block_idx, block in enumerate(blocks):
            if block["type"] != 0:  # Not text
                continue

            for line_idx, line in enumerate(block["lines"]):
                for span_idx, span in enumerate(line["spans"]):
                    text = span["text"].strip()
                    if not text:
                        continue

                    ts = TextSpan(
                        text=text,
                        x0=span["bbox"][0],
                        y0=span["bbox"][1],
                        x1=span["bbox"][2],
                        y1=span["bbox"][3],
                        font=span["font"],
                        size=span["size"],
                        flags=span["flags"],
                        color=span["color"]
                    )
                    ts.page_num = page_num
                    ts.block_num = block_idx
                    ts.line_num = line_idx
                    ts.span_num = span_idx
                    spans.append(ts)

        return spans

    def _extract_images(self, page: fitz.Page, page_num: int) -> List[ImageInfo]:
        """Extract all images with positions."""
        images = []
        image_list = page.get_images(full=True)

        for img in image_list:
            xref = img[0]
            try:
                pix = fitz.Pixmap(self.doc, xref)
                if pix.n > 4:  # CMYK
                    pix = fitz.Pixmap(fitz.csRGB, pix)

                # Get image position on page
                img_rects = page.get_image_rects(xref)
                if not img_rects:
                    continue

                rect = img_rects[0]  # Use first occurrence
                img_bytes = pix.tobytes("png")

                img_info = ImageInfo(
                    xref=xref,
                    page_num=page_num,
                    x0=rect.x0,
                    y0=rect.y0,
                    x1=rect.x1,
                    y1=rect.y1,
                    width=pix.width,
                    height=pix.height,
                    ext="png",
                    image_bytes=img_bytes
                )
                images.append(img_info)
            except Exception as e:
                print(f"Failed to extract image xref {xref}: {e}", file=sys.stderr)

        return images

    def _group_by_column(self, spans: List[TextSpan], columns: List[Tuple[float, float]]) -> List[Tuple[List[TextSpan], Tuple[float, float]]]:
        """Group spans by column based on horizontal position."""
        result = []
        for col_bounds in columns:
            col_left, col_right = col_bounds
            col_spans = [s for s in spans if s.center_x >= col_left * 0.9 and s.center_x <= col_right * 1.1]
            result.append((col_spans, col_bounds))
        return result

    def _render_column(self, spans: List[TextSpan], col_bounds: Tuple[float, float],
                       images: List[ImageInfo], page_num: int, col_idx: int):
        """Render a column's content to DOCX."""
        if not spans:
            return

        # Sort spans by reading order: top to bottom, then left to right
        spans.sort(key=lambda s: (s.y0, s.x0))

        # Group spans into paragraphs
        paragraphs = self._group_into_paragraphs(spans)

        # Find images that belong to this column
        col_left, col_right = col_bounds
        col_images = [img for img in images if img.page_num == page_num and
                      img.center_x >= col_left * 0.9 and img.center_x <= col_right * 1.1]

        # Sort images by vertical position
        col_images.sort(key=lambda i: i.y0)

        # Merge spans and images in reading order
        self._render_column_content(paragraphs, col_images, col_bounds)

    def _group_into_paragraphs(self, spans: List[TextSpan]) -> List[List[TextSpan]]:
        """Group spans into paragraphs based on vertical proximity and alignment."""
        if not spans:
            return []

        paragraphs = []
        current_para = [spans[0]]

        for i in range(1, len(spans)):
            prev = spans[i - 1]
            curr = spans[i]

            # Check if same paragraph: close vertically and similar left alignment
            v_gap = curr.y0 - prev.y1
            h_diff = abs(curr.x0 - prev.x0)

            # Thresholds
            max_v_gap = max(prev.size * 1.5, 8)  # 1.5x line height or 8pt
            max_h_diff = 10  # Allow small horizontal variation

            if v_gap <= max_v_gap and h_diff <= max_h_diff:
                current_para.append(curr)
            else:
                paragraphs.append(current_para)
                current_para = [curr]

        if current_para:
            paragraphs.append(current_para)

        return paragraphs

    def _render_column_content(self, paragraphs: List[List[TextSpan]],
                               images: List[ImageInfo], col_bounds: Tuple[float, float]):
        """Render paragraphs and images in reading order."""
        # Create a combined list of content items with vertical positions
        content_items = []

        for para in paragraphs:
            if para:
                avg_y = sum(s.y0 for s in para) / len(para)
                content_items.append(('paragraph', avg_y, para))

        for img in images:
            content_items.append(('image', img.y0, img))

        # Sort by vertical position
        content_items.sort(key=lambda x: x[1])

        # Render each item
        for item_type, _, item in content_items:
            if item_type == 'paragraph':
                self._render_paragraph(item)
            elif item_type == 'image':
                self._render_image(item)

    def _render_paragraph(self, spans: List[TextSpan]):
        """Render a paragraph with preserved formatting."""
        if not spans:
            return

        p = self.output_doc.add_paragraph()

        # Determine paragraph alignment from spans
        avg_x0 = sum(s.x0 for s in spans) / len(spans)
        page_center = self.doc[spans[0].page_num].rect.width / 2
        left_margin = min(s.x0 for s in spans)

        # Check for center alignment
        if any(abs(s.center_x - page_center) < 30 for s in spans):
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        # Check for right alignment
        elif avg_x0 > page_center * 1.2:
            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        else:
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT

        # Render each span
        for span in spans:
            run = p.add_run(span.text)
            run.font.size = Pt(max(span.size, 6))  # Minimum 6pt
            run.font.bold = span.is_bold
            run.font.italic = span.is_italic
            run.font.underline = span.is_underline

            # Set font name if available
            if span.font:
                # Map common PDF font names to system fonts
                font_map = {
                    'times': 'Times New Roman',
                    'helvetica': 'Arial',
                    'courier': 'Courier New',
                    'symbol': 'Symbol',
                    'zapfdingbats': 'ZapfDingbats'
                }
                font_lower = span.font.lower()
                for key, val in font_map.items():
                    if key in font_lower:
                        run.font.name = val
                        break
                else:
                    run.font.name = 'Calibri'

            # Set color
            if span.color != 0:
                r = (span.color >> 16) & 255
                g = (span.color >> 8) & 255
                b = span.color & 255
                run.font.color.rgb = RGBColor(r, g, b)

        # Paragraph spacing
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.line_spacing = 1.15

    def _render_image(self, img: ImageInfo):
        """Render an image to DOCX at approximate position."""
        try:
            # Save image to temp file
            img_path = os.path.join(self.temp_dir, f"img_{img.xref}.{img.ext}")
            with open(img_path, 'wb') as f:
                f.write(img.image_bytes)

            # Calculate size in inches (maintain aspect ratio)
            # Convert from points to inches
            img_width_in = img.width / 72.0
            img_height_in = img.height / 72.0

            # Cap at page width
            max_width = self.output_doc.sections[-1].page_width.inches - 1.5  # margins
            if img_width_in > max_width:
                ratio = max_width / img_width_in
                img_width_in *= ratio
                img_height_in *= ratio

            # Add image
            p = self.output_doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run()
            run.add_picture(img_path, width=Inches(img_width_in), height=Inches(img_height_in))
            p.paragraph_format.space_after = Pt(12)
        except Exception as e:
            print(f"Failed to render image: {e}", file=sys.stderr)

    def _cleanup(self):
        """Clean up temporary files."""
        try:
            shutil.rmtree(self.temp_dir, ignore_errors=True)
        except:
            pass


def main():
    if len(sys.argv) != 3:
        print("Usage: pdf_to_docx_layout_aware.py <input.pdf> <output.docx>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    converter = PDFToDOCXConverter(input_path, output_path)
    success = converter.convert()

    if success:
        print("SUCCESS")
        sys.exit(0)
    else:
        print("FAILED", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()