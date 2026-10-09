import { describe, it, expect } from 'vitest';
import { percentile, summarize } from '../../benchmarks/lib/stats.js';
import { buildSamplePdf } from '../../benchmarks/lib/samplePdf.js';
import {
  evaluateRetrieval,
  createMemoryIndex,
  thresholdSweep,
  calibrateThreshold,
  evaluateDeclines,
  stripChunks,
} from '../../benchmarks/lib/retrievalEval.js';
import { extractText } from '../../src/utils/pdfExtractor.js';

describe('benchmark stats', () => {
  it('uses nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBeNull();
  });

  it('summarises unsorted input', () => {
    const summary = summarize([30, 10, 20]);
    expect(summary).toMatchObject({ count: 3, min: 10, p50: 20, max: 30, mean: 20 });
  });
});

describe('sample PDF generator', () => {
  it('produces a PDF that pdf-parse reads with the requested page count', async () => {
    const pdf = buildSamplePdf({ pages: 3 });
    const result = await extractText(pdf, 'application/pdf');
    expect(result.success).toBe(true);
    expect(result.pages).toBe(3);
    expect(result.text).toContain('Sample medical report - page 3');
    expect(result.text).toContain('cholesterol 242 mg/dL');
  });
});

describe('retrieval evaluation', () => {
  // Toy embedder: one dimension per keyword, so similarity is easy to predict.
  const VOCAB = ['cholesterol', 'thyroid', 'allergy', 'vaccine'];
  const embed = async (text) => VOCAB.map((word) => (text.toLowerCase().includes(word) ? 1 : 0));

  const documents = [
    { id: 'lipids', text: 'Cholesterol 242 mg/dL.' },
    { id: 'thyroid', text: 'Thyroid TSH 6.8.' },
    { id: 'allergy', text: 'Allergy: penicillin.' },
  ];

  it('scores hits, ranks and declines', async () => {
    const result = await evaluateRetrieval({
      documents,
      embed,
      topK: 2,
      threshold: 0.5,
      queries: [
        { question: 'my cholesterol?', expected: 'lipids' },
        { question: 'thyroid result?', expected: 'thyroid' },
        // Mentions nothing in VOCAB: every score is 0, so it is declined and missed.
        { question: 'penicillin reaction?', expected: 'allergy' },
        { question: 'which vaccine did I get?', expected: null },
      ],
    });

    expect(result.chunks).toBe(3);
    expect(result.answerableQueries).toBe(3);
    expect(result.hitRateAt1).toBeCloseTo(2 / 3, 3);
    expect(result.falseDeclineRate).toBeCloseTo(1 / 3, 3);
    expect(result.correctDeclineRate).toBe(1);
    expect(result.perQuery[0].rank).toBe(1);
  });

  it('runs through a custom index (as the ChromaDB benchmark does)', async () => {
    const calls = { add: 0, search: 0 };
    const memory = createMemoryIndex(embed);
    const index = {
      add: async (chunk) => { calls.add++; return memory.add(chunk); },
      search: async (text, topK) => { calls.search++; return memory.search(text, topK); },
    };
    const queries = [{ question: 'my cholesterol?', expected: 'lipids' }];
    const viaIndex = await evaluateRetrieval({ documents, queries, topK: 2, threshold: 0.5, index });
    const viaEmbed = await evaluateRetrieval({ documents, queries, embed, topK: 2, threshold: 0.5 });
    expect(calls).toEqual({ add: 3, search: 1 });
    expect(viaIndex.hitRateAt1).toBe(1);
    expect(viaIndex.perQuery).toEqual(viaEmbed.perQuery);
  });
});

describe('decline evaluation', () => {
  // Hand-made perQuery rows in evaluateRetrieval's shape.
  const row = (question, expected, scores) => ({
    question,
    expected,
    retrieved: scores.map((score, i) => ({ documentId: `d${i}`, score })),
    chunks: scores.map((score, i) => ({ documentId: `d${i}`, score, text: `chunk ${i} for ${question}` })),
  });
  const perQuery = [
    row('a1', 'd0', [0.8, 0.5]),
    row('a2', 'd0', [0.6]),
    row('a3', 'd0', [0.5]),
    row('u1', null, [0.55]),
    row('u2', null, [0.4]),
  ];

  it('sweeps similarity thresholds over both kinds of question', () => {
    const sweep = thresholdSweep(perQuery, [0.45, 0.55, 0.7]);
    expect(sweep).toEqual([
      { threshold: 0.45, falseDeclineRate: 0, correctDeclineRate: 0.5 },
      { threshold: 0.55, falseDeclineRate: 0.3333, correctDeclineRate: 0.5 },
      { threshold: 0.7, falseDeclineRate: 0.6667, correctDeclineRate: 1 },
    ]);
  });

  it('calibrates to the highest threshold within the false-decline limit', () => {
    const sweep = thresholdSweep(perQuery, [0.45, 0.5, 0.55, 0.7]);
    expect(calibrateThreshold(sweep, 0.05)).toBe(0.5);
    expect(calibrateThreshold(sweep, 0.4)).toBe(0.55);
    expect(calibrateThreshold(thresholdSweep(perQuery, [0.9]), 0.05)).toBeNull();
  });

  it('applies the threshold, then the grounding judge, like the chatbot', async () => {
    const seen = [];
    const judge = async (question, chunks) => {
      seen.push([question, chunks.map((c) => c.documentId)]);
      if (question === 'a3') return { grounded: null }; // unreadable: answer
      return { grounded: question.startsWith('a') };
    };
    const cache = new Map();
    const result = await evaluateDeclines(perQuery, { threshold: 0.45, judge, cache });

    // Only chunks above the threshold reach the judge; u2 is declined first.
    expect(seen).toEqual([
      ['a1', ['d0', 'd1']],
      ['a2', ['d0']],
      ['a3', ['d0']],
      ['u1', ['d0']],
    ]);
    expect(result.decisions.map((d) => d.decision)).toEqual([
      'answer',
      'answer',
      'answer',
      'not-grounded',
      'low-similarity',
    ]);
    expect(result).toMatchObject({
      falseDeclineRate: 0,
      correctDeclineRate: 1,
      falseDeclines: 0,
      correctDeclines: 2,
      judgeCalls: 4,
      judgeUnreadable: 1,
    });

    // The same chunks are not judged twice.
    const again = await evaluateDeclines(perQuery, { threshold: 0.45, judge, cache });
    expect(again.judgeCalls).toBe(0);
    expect(again.correctDeclineRate).toBe(1);
  });

  it('without a judge matches the similarity-only sweep', async () => {
    const result = await evaluateDeclines(perQuery, { threshold: 0.55 });
    const [sweep] = thresholdSweep(perQuery, [0.55]);
    expect(result.groundingCheck).toBe(false);
    expect(result.falseDeclineRate).toBe(sweep.falseDeclineRate);
    expect(result.correctDeclineRate).toBe(sweep.correctDeclineRate);
    expect(result.judgeCalls).toBeUndefined();
  });

  it('keeps chunk text out of saved results', async () => {
    const stripped = stripChunks(perQuery);
    expect(stripped[0].chunks).toBeUndefined();
    expect(stripped[0].retrieved).toEqual(perQuery[0].retrieved);
  });
});

