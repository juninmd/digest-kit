// Runtime-agnostic entry: no bun:* imports, safe to load from Node.
export { createChat, redact } from "./ai.ts";
export { extractJsonObject } from "./json.ts";
export { isSafeExternalUrl } from "./net.ts";
export {
  hasEnglishSentence,
  hasModelArtifacts,
  hasPromptLeak,
  isPollutedProse,
  looksGarbled,
} from "./prose.ts";
export { clean, formatItems, idFor, splitMessage } from "./text.ts";
export type { AiProvider, ChatFn, Config } from "./types.ts";
