import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  stripDecisionContext,
  isWrongDecision,
  formatWrongDecisions,
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
    // Counts reported alongside each rate.
    expect(result).toMatchObject({
      unanswerableQueries: 1,
      hitsAtK: 2,
      hitsAt1: 2,
      falseDeclines: 1,
      correctDeclines: 1,
    });
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

  // The owner can only run the eval against a live model, so one run has to
  // explain every wrong decision: the judge's own reply and the text it saw.
  it('records the judge reply and the judged text for each decision', async () => {
    // Wrongly declines a2, an answerable question: the case the diagnostics exist for.
    const judge = async (question) => {
      const grounded = question.startsWith('a') && question !== 'a2';
      return { grounded, raw: `{"answerable": ${grounded}}` };
    };
    const result = await evaluateDeclines(perQuery, { threshold: 0.45, judge });

    const a1 = result.decisions.find((d) => d.question === 'a1');
    expect(a1.raw).toBe('{"answerable": true}');
    expect(a1.context).toEqual([
      { documentId: 'd0', score: 0.8, text: 'chunk 0 for a1' },
      { documentId: 'd1', score: 0.5, text: 'chunk 1 for a1' },
    ]);
    // Declined before the judge ran: no reply and nothing judged.
    const u2 = result.decisions.find((d) => d.question === 'u2');
    expect(u2).toMatchObject({ decision: 'low-similarity', verdict: null, raw: null, context: [] });

    // Wrong decisions are the rows the diagnostic block prints.
    expect(result.decisions.filter(isWrongDecision).map((d) => d.question)).toEqual(['a2']);
    const a2 = result.decisions.find((d) => d.question === 'a2');
    expect(a2).toMatchObject({ decision: 'not-grounded', verdict: false, raw: '{"answerable": false}' });
    expect(a2.context[0].text).toBe('chunk 0 for a2');

    // The judged document text is not written to the saved result file.
    const saved = stripDecisionContext({ run: result });
    expect(saved.run.decisions.every((d) => d.context === undefined)).toBe(true);
    expect(saved.run.decisions[0].raw).toBe('{"answerable": true}');
    expect(saved.run.correctDeclineRate).toBe(result.correctDeclineRate);
  });

  it('prints the question, the judge reply and the judged text for every wrong decision', () => {
    const lines = formatWrongDecisions('test similarity+grounding @0.45', [
      { question: 'am I allergic to latex', expected: 'allergy', decision: 'not-grounded', verdict: false, raw: '{"answerable": false}', context: [{ documentId: 'allergy', score: 0.61, text: `Allergy record. Latex: mild contact dermatitis. ${'x'.repeat(400)}` }] },
      { question: 'what was my ferritin result', expected: null, decision: 'answer', verdict: true, raw: '{"answerable": true}', context: [{ documentId: 'cbc', score: 0.68, text: 'Ferritin to follow.' }] },
      { question: 'what is my blood type', expected: null, decision: 'answer', verdict: null, raw: null, context: [] },
      { question: 'my cholesterol', expected: 'lipids', decision: 'answer', verdict: true, raw: '{"answerable": true}', context: [] }, // right, so not printed
    ]);
    const text = lines.join('\n');

    expect(lines[0]).toBe('test similarity+grounding @0.45, wrong decisions (3) - question, judge verdict, text the judge saw:');
    expect(text).toContain('  - am I allergic to latex\n    answerable, declined (not-grounded); expected allergy');
    expect(text).toContain('judge verdict: false | raw: {"answerable": false}');
    expect(text).toContain('[allergy score 0.61] Allergy record. Latex: mild contact dermatitis.');
    expect(text).toContain('unanswerable, answered; expected no answer in the records');
    expect(text).toContain('judge verdict: unreadable | raw: (empty)');
    expect(text).toContain('none above the threshold (declined before the judge ran)');
    expect(text).not.toContain('my cholesterol');
    // Each excerpt stays on one readable line.
    expect(lines.every((line) => line.length <= 260)).toBe(true);
    expect(text).toContain('xxx...');
  });

  it('marks a wrong decision in both directions', () => {
    expect(isWrongDecision({ expected: 'd0', decision: 'not-grounded' })).toBe(true);
    expect(isWrongDecision({ expected: 'd0', decision: 'answer' })).toBe(false);
    expect(isWrongDecision({ expected: null, decision: 'answer' })).toBe(true);
    expect(isWrongDecision({ expected: null, decision: 'low-similarity' })).toBe(false);
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


// The eval sets are hand-labelled, so check the labels themselves: every
// non-null `expected` must name a real document, no question may appear twice,
// and no test question may also be a calibration question (the calibration set
// is the only one allowed to choose a threshold). These assertions are about
// the data, not about any measured result.
describe('retrieval eval question sets', () => {
  const dataDir = path.join(fileURLToPath(new URL('.', import.meta.url)), '../../benchmarks/data');
  const load = (file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'));
  const testSet = load('retrieval-eval.json');
  const calibrationSet = load('decline-calibration.json');
  const normalise = (q) => q.question.trim().toLowerCase();

  it('labels every test question with a real document or null', () => {
    const ids = new Set(testSet.documents.map((d) => d.id));
    const unknown = testSet.queries.filter((q) => q.expected !== null && !ids.has(q.expected));
    expect(unknown).toEqual([]);
    expect(testSet.queries.every((q) => typeof q.question === 'string' && q.question.trim())).toBe(true);
  });

  it('labels every calibration question against the shared documents', () => {
    expect(calibrationSet.documentsFrom).toBe('retrieval-eval.json');
    const ids = new Set(testSet.documents.map((d) => d.id));
    const unknown = calibrationSet.queries.filter((q) => q.expected !== null && !ids.has(q.expected));
    expect(unknown).toEqual([]);
  });

  it('has no duplicate questions and no overlap between the two sets', () => {
    for (const set of [testSet, calibrationSet]) {
      const questions = set.queries.map(normalise);
      expect(new Set(questions).size).toBe(questions.length);
    }
    const calibration = new Set(calibrationSet.queries.map(normalise));
    const shared = testSet.queries.map(normalise).filter((q) => calibration.has(q));
    expect(shared).toEqual([]);
  });

  it('is big enough to report refusal rates on', () => {
    const answerable = testSet.queries.filter((q) => q.expected);
    const unanswerable = testSet.queries.filter((q) => !q.expected);
    expect(testSet.queries.length).toBeGreaterThanOrEqual(100);
    expect(unanswerable.length).toBeGreaterThanOrEqual(30);
    expect(answerable.length).toBeGreaterThanOrEqual(60);
    // Every document is the source of at least one answerable question.
    const covered = new Set(answerable.map((q) => q.expected));
    expect(covered.size).toBe(testSet.documents.length);
  });
});
