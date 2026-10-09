import { describe, it, expect, afterAll } from 'vitest';
import { extractText } from '../../src/utils/pdfExtractor.js';
import { shutdownOcr } from '../../src/services/ocrService.js';
import { renderTextPng } from '../../benchmarks/lib/textImage.js';
import { buildSamplePdf } from '../../benchmarks/lib/samplePdf.js';

afterAll(async () => {
  await shutdownOcr();
});

describe('OCR text extraction', () => {
  it('reads the text of a generated lab-result image', async () => {
    const png = renderTextPng([
      'LAB REPORT',
      'CHOLESTEROL 242 MG/DL',
      'HEMOGLOBIN 13.2 G/DL',
      'PRESCRIPTION: ATORVASTATIN 20 MG',
    ]);

    const result = await extractText(png, 'image/png');

    expect(result.success).toBe(true);
    expect(result.method).toBe('ocr');
    expect(result.ocrConfidence).toBeGreaterThan(0);
    const text = result.text.toUpperCase();
    for (const word of ['CHOLESTEROL', '242', 'HEMOGLOBIN', 'ATORVASTATIN']) {
      expect(text).toContain(word);
    }
  }, 60000);

  it('reports a PDF without a text layer as scanned instead of returning nothing', async () => {
    const result = await extractText(buildSamplePdf({ pages: 2, blank: true }), 'application/pdf');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no text layer/i);
  });

  it('still reads PDFs that have a text layer', async () => {
    const result = await extractText(buildSamplePdf({ pages: 2 }), 'application/pdf');
    expect(result.success).toBe(true);
    expect(result.method).toBe('pdf-text');
  });
});
