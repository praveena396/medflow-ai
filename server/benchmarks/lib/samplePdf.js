// Builds a multi-page, text-only PDF in memory so the pipeline benchmark
// needs no binary fixtures in the repo. Plain PDF 1.4 with the built-in
// Helvetica font; pdf-parse (used by the app) reads it like any other PDF.

const LAB_LINES = [
  'Complete blood count: haemoglobin 13.2 g/dL, white cells 6.8 x10^9/L, platelets 245 x10^9/L.',
  'Lipid panel: total cholesterol 242 mg/dL, LDL 165 mg/dL, HDL 41 mg/dL, triglycerides 180 mg/dL.',
  'Metabolic panel: fasting glucose 104 mg/dL, HbA1c 5.9 percent, creatinine 0.9 mg/dL.',
  'Thyroid: TSH 2.1 mIU/L, free T4 1.2 ng/dL, both within the reference range.',
  'Vitamin D 18 ng/mL (low). Vitamin B12 410 pg/mL. Ferritin 35 ng/mL.',
  'Impression: borderline high cholesterol and prediabetic glucose; repeat in three months.',
  'Medications reviewed: atorvastatin 10 mg nightly, vitamin D3 2000 IU daily.',
  'Allergies: penicillin (rash). No known food allergies.',
];

const escapePdfText = (text) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// Text for one page: a heading and enough report lines to fill it.
const pageLines = (pageNumber, linesPerPage) => {
  const lines = [`Sample medical report - page ${pageNumber}`];
  for (let i = 0; lines.length < linesPerPage; i++) {
    lines.push(LAB_LINES[(pageNumber + i) % LAB_LINES.length]);
  }
  return lines;
};

// blank: true writes pages with no text at all, like a scanned document.
export const buildSamplePdf = ({ pages = 20, linesPerPage = 40, blank = false } = {}) => {
  if (!Number.isInteger(pages) || pages < 1) throw new Error('pages must be a positive integer');

  // Object numbers: 1 catalog, 2 page tree, 3 font, then (page, content) pairs.
  const objects = [];
  const pageIds = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  for (let p = 0; p < pages; p++) {
    const pageId = 4 + p * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);

    const textOps = pageLines(p + 1, linesPerPage)
      .map((line, i) => `${i === 0 ? '' : '0 -18 Td '}(${escapePdfText(line)}) Tj`)
      .join('\n');
    const stream = blank ? '' : `BT\n/F1 10 Tf\n50 760 Td\n${textOps}\nET`;

    objects[pageId] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
};
