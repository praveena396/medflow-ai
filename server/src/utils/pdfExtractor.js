// Import the library internals directly: pdf-parse's index.js runs debug code
// when loaded outside CommonJS, which breaks ESM imports.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { logger } from './logger.js';

// Extract plain text from an uploaded file buffer based on its MIME type.
export const extractText = async (buffer, mimeType) => {
  try {
    if (mimeType === 'application/pdf') {
      const data = await pdfParse(buffer);
      return { success: true, text: data.text, pages: data.numpages };
    }

    if (mimeType === 'text/plain') {
      return { success: true, text: buffer.toString('utf-8'), pages: 1 };
    }

    // Images would need OCR (e.g. tesseract) — not supported yet.
    return {
      success: false,
      error: `Text extraction not supported for ${mimeType}`,
    };
  } catch (error) {
    logger.error('Text extraction error:', error.message);
    return { success: false, error: error.message };
  }
};
