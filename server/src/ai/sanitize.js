// Cleans untrusted text (patient messages, symptoms, uploaded document text)
// before it is placed in an LLM prompt. It can't make prompt injection
// impossible, but it removes the tricks that rely on invisible characters,
// chat-template tokens or fake role headers, and it stops user text from
// closing the tags the prompts use to mark it as data.

// C0/C1 control characters except tab (\t) and newline (\n).
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
// Zero-width characters, bidirectional overrides and the BOM.
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
// Chat-template control tokens used by common models.
const SPECIAL_TOKENS = [
  /<\|[^|<>]{0,40}\|>/g, // <|im_start|>, <|system|>, <|endoftext|>, <|eot_id|> ...
  /<\/?s>/gi, // Llama sentence markers
  /\[\/?INST\]/gi, // Llama/Mistral instruction markers
  /<<\/?SYS>>/gi, // Llama 2 system markers
];
// Lines pretending to start a new system/assistant turn ("System:", "### Assistant:").
const ROLE_HEADER = /^[ \t>#*-]*(system|assistant|developer)\s*:/gim;
// The tags our own prompts use to fence untrusted text.
const PROMPT_TAGS = /<\/?\s*(question|documents|document|symptoms)\b[^>]*>/gi;

export const DEFAULT_MAX_LENGTH = 2000;

export const sanitizeForPrompt = (input, { maxLength = DEFAULT_MAX_LENGTH } = {}) => {
  if (typeof input !== 'string') return '';

  let text = input.normalize('NFKC').replace(/\r\n?/g, '\n');
  text = text.replace(CONTROL_CHARS, '').replace(INVISIBLE_CHARS, '');
  for (const pattern of SPECIAL_TOKENS) text = text.replace(pattern, ' ');
  text = text.replace(ROLE_HEADER, '').replace(PROMPT_TAGS, ' ');
  text = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length > maxLength ? text.slice(0, maxLength) : text;
};
