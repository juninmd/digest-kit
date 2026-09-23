import { describe, expect, test } from "bun:test";
import {
  hasEnglishSentence,
  hasModelArtifacts,
  hasPromptLeak,
  isPollutedProse,
  looksGarbled,
} from "../src/prose.ts";

describe("prose guards", () => {
  test("flags instruction echoes and self-checks", () => {
    expect(hasPromptLeak("Pronto. Verifiquei tudo.")).toBe(true);
    expect(hasPromptLeak("As an AI language model, I cannot")).toBe(true);
    expect(hasPromptLeak("O Copom cortou a Selic.")).toBe(false);
  });

  test("flags decode artifacts", () => {
    expect(hasModelArtifacts("modelo <unk> <unk>")).toBe(true);
    expect(hasModelArtifacts("texto � quebrado")).toBe(true);
    expect(hasModelArtifacts("a < b e c > d")).toBe(false);
  });

  test("catches one English sentence inside pt-BR prose", () => {
    const text = "O modelo foi lançado hoje. It is the model that will be used for any of the tasks.";
    expect(hasEnglishSentence(text)).toBe(true);
    expect(hasEnglishSentence("O Claude Code ganhou suporte a hooks.")).toBe(false);
  });

  test("catches stutter and lost casing", () => {
    expect(looksGarbled("cento cento mil")).toBe(true);
    expect(looksGarbled("Um. dois. três.")).toBe(true);
    expect(looksGarbled("Tudo certo. Nada a declarar.")).toBe(false);
  });

  test("isPollutedProse ignores empty text", () => {
    expect(isPollutedProse("")).toBe(false);
  });
});
