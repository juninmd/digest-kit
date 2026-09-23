// Detectors proven in evo-agent (src/agent/editorial.ts) against drifted
// fallbacks; defaults target pt-BR prose.

const MODEL_ARTIFACT_TOKENS = /<unk>|<pad>|\[UNK\]|<\/?s>|�/i;

/** Placeholder tokens a broken decode leaks into plain text. */
export function hasModelArtifacts(text: string): boolean {
  return MODEL_ARTIFACT_TOKENS.test(text);
}

const PROMPT_LEAK =
  /verifiquei tudo|n[aã]o h[aá] conte[uú]do proibido|write the (technical )?content|potentially controversial content|as an ai (language )?model|como (um )?modelo de linguagem,? (eu )?n[aã]o posso/i;

/** Self-checks and instruction echoes a drifting model appends to prose. */
export function hasPromptLeak(text: string): boolean {
  return PROMPT_LEAK.test(text);
}

const ENGLISH_FUNCTION_WORDS =
  /\b(the|and|or|with|of|for|from|that|this|these|those|are|is|was|were|been|to|its|it|which|will|would|any|including|due|into|about|your|you|they|their|but|not|can|should)\b/gi;

/** A single drifted sentence is diluted by the pt-BR around it, so check each one. */
export function hasEnglishSentence(text: string, threshold = 4): boolean {
  return text
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => (sentence.match(ENGLISH_FUNCTION_WORDS) ?? []).length >= threshold);
}

const REPEATED_WORD = /(?<!\p{L})(\p{L}{3,})\s+\1(?!\p{L})/iu;
const LOWERCASE_SENTENCE_START = /[.!?]\s+\p{Ll}/gu;

/** Broken decodes stutter ("cento cento") and lose sentence casing. */
export function looksGarbled(text: string): boolean {
  return REPEATED_WORD.test(text) || (text.match(LOWERCASE_SENTENCE_START) ?? []).length >= 2;
}

/** Low-false-positive gate: model text that must never reach a reader. */
export function isPollutedProse(text: string): boolean {
  return hasPromptLeak(text) || hasModelArtifacts(text);
}
