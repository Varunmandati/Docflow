#!/usr/bin/env python3
"""
Python wrapper for pdf2docx.
Reads from input.pdf, writes robust editable DOCX to output.docx.
Expects to run in a virtualenv with pdf2docx installed.
"""
import sys
import logging
from pdf2docx import Converter

# Suppress excessive pdf2docx logging
logging.getLogger('pdf2docx').setLevel(logging.WARNING)

def convert_pdf_to_docx(input_pdf: str, output_docx: str):
    cv = Converter(input_pdf)
    try:
        # Default options give the best balance for general purpose PDFs
        cv.convert(output_docx)
    finally:
        cv.close()

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.pdf> <output.docx>", file=sys.stderr)
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    try:
        convert_pdf_to_docx(input_file, output_file)
        sys.exit(0)
    except Exception as e:
        print(f"Conversion failed: {e}", file=sys.stderr)
        sys.exit(1)
