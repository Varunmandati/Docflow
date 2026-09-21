# Plan for integrating PdfToDocxEngine into the conversion matrix and worker

## Overview
We have implemented a new PdfToDocxEngine that converts PDF to DOCX using pdf2docx (primary) and LibreOffice (fallback). The engine is already placed in the correct location and has unit tests.

Upon inspection, we found that:
1. The engine is ALREADY registered in the conversion worker via a conditional feature flag (PDF_DOCX_ENGINE)
2. The conversion matrix already marks pdf->docx as supported with an appropriate note
3. Unit tests for the engine are passing

Therefore, the integration is essentially complete. However, we should verify everything is working correctly by running a broader set of tests.

## What was already done
- Engine implementation: `backend/src/services/converters/PdfToDocxEngine.ts`
- Engine tests: `backend/src/services/converters/PdfToDocxEngine.test.ts`
- Worker registration: Already present in `backend/src/workers/conversion.worker.ts` lines 35-37
- Feature flag: PDF_DOCX_ENGINE=auto (default) or "legacy" in `.env.example`
- Conversion matrix: Already has pdf->docx as supported in `backend/src/config/conversion-matrix.ts`

## Verification Steps
1. Run all converter tests to ensure we didn't break anything
2. Optionally run a broader backend test suite
3. Verify the feature flag works correctly

## Files that are already correctly set up
- `backend/src/workers/conversion.worker.ts`: Engine registration with feature flag
- `backend/src/config/conversion-matrix.ts`: pdf->docx marked as supported
- `backend/.env.example`: Includes PDF_DOCX_ENGINE, PDF_DOCX_MAX_PAGES, etc.

## Conclusion
No additional changes are needed. The PdfToDocxEngine is properly integrated and ready for use.