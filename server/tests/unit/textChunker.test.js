import { describe, it, expect } from 'vitest';
import { chunkText } from '../../src/utils/textChunker.js';

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('chunkText', () => {
  it('returns an empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });

  it('returns one chunk when the text is shorter than the chunk size', () => {
    const text = 'a short medical note';
    expect(chunkText(text)).toEqual([text]);
  });

  it('splits long text into multiple chunks', () => {
    const chunks = chunkText(words(1200), 500, 50);
    expect(chunks.length).toBe(3);
  });

  it('overlaps consecutive chunks so no sentence is lost at a boundary', () => {
    const chunks = chunkText(words(1000), 500, 50);
    const firstChunkWords = chunks[0].split(' ');
    const secondChunkWords = chunks[1].split(' ');
    // Last 50 words of chunk 1 must equal first 50 words of chunk 2.
    expect(firstChunkWords.slice(-50)).toEqual(secondChunkWords.slice(0, 50));
  });

  it('normalizes messy whitespace', () => {
    const chunks = chunkText('hello   world\n\nnew    line\ttab');
    expect(chunks).toEqual(['hello world new line tab']);
  });

  it('respects custom chunk size and overlap', () => {
    const chunks = chunkText(words(30), 10, 2);
    expect(chunks[0].split(' ').length).toBe(10);
    expect(chunks.length).toBe(4); // step 8: 0-10, 8-18, 16-26, 24-30
  });
});
