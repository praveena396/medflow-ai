// Import the library internals directly: pdf-parse's index.js runs debug code
// when loaded outside CommonJS, which breaks ESM imports.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { logger } from './logger.js';
import { recognizeImage } from '../services/ocrService.js';

export const OCR_MIME_TYPES = ['image/png', 'image/jpeg'];

// A PDF whose text layer has fewer characters than this is treated as scanned.
const MIN_PDF_TEXT_CHARS = 20;

// Extract plain text from an uploaded file buffer based on its MIME type.
export const extractText = async (buffer, mimeType) => {
  try {
    if (mimeType === 'application/pdf') {
      const data = await pdfParse(buffer);
      if (data.text.replace(/\s+/g, '').length < MIN_PDF_TEXT_CHARS) {
        // Rasterising PDF pages for OCR is not supported (it needs a native
        // canvas); photos or scans uploaded as PNG/JPEG are OCR'd instead.
        return {
          success: false,
          error:
            'This PDF has no text layer (it looks scanned). Upload the pages as PNG or JPEG images so they can be read with OCR.',
        };
      }
      return { success: true, text: data.text, pages: data.numpages, method: 'pdf-text' };
    }

    if (mimeType === 'text/plain') {
      return { success: true, text: buffer.toString('utf-8'), pages: 1, method: 'text' };
    }

    if (OCR_MIME_TYPES.includes(mimeType)) {
      const { text, confidence } = await recognizeImage(buffer);
      return { success: true, text, pages: 1, method: 'ocr', ocrConfidence: confidence };
    }

    return {
      success: false,
      error: `Text extraction not supported for ${mimeType}`,
    };
  } catch (error) {
    logger.error('Text extraction error:', error.message);
    return { success: false, error: error.message };
  }
};
