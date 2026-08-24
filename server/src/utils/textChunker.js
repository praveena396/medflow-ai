import { config } from '../config/index.js';

// Split text into overlapping word-based chunks so meaning isn't lost at boundaries.
export const chunkText = (
  text,
  chunkSizeWords = config.documents.chunkSizeWords,
  overlapWords = config.documents.chunkOverlapWords
) => {
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (words.length === 0) return [];
  if (words.length <= chunkSizeWords) return [words.join(' ')];

  const chunks = [];
  const step = chunkSizeWords - overlapWords;

  for (let start = 0; start < words.length; start += step) {
    const chunk = words.slice(start, start + chunkSizeWords).join(' ');
    chunks.push(chunk);
    if (start + chunkSizeWords >= words.length) break;
  }

  return chunks;
};
