import { describe, expect, test } from "bun:test";
import { mapSettled, skipWhileRunning } from "../src/util/concurrency.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe("mapSettled", () => {
  test("mantém a ordem de entrada, mesmo terminando fora de ordem", async () => {
    const results = await mapSettled([30, 1, 10], async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `${index}:${ms}`;
    });
    expect(results).toEqual([
      { status: "fulfilled", value: "0:30" },
      { status: "fulfilled", value: "1:1" },
      { status: "fulfilled", value: "2:10" },
    ]);
  });

  test("nunca passa do limite de chamadas simultâneas", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapSettled(
      Array.from({ length: 20 }, (_, i) => i),
      async (n) => {
        peak = Math.max(peak, ++running);
        await tick();
        running--;
        return n * 2;
      },
      3,
    );
    expect(peak).toBe(3);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual(
      Array.from({ length: 20 }, (_, i) => i * 2),
    );
  });

  test("sem limite, dispara tudo de uma vez", async () => {
    let running = 0;
    let peak = 0;
    await mapSettled([1, 2, 3, 4, 5], async () => {
      peak = Math.max(peak, ++running);
      await tick();
      running--;
    });
    expect(peak).toBe(5);
  });

  test("uma rejeição fica no seu lugar e não interrompe o resto", async () => {
    const boom = new Error("boom");
    const results = await mapSettled(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw boom;
        return n;
      },
      1,
    );
    expect(results).toEqual([
      { status: "fulfilled", value: 1 },
      { status: "rejected", reason: boom },
      { status: "fulfilled", value: 3 },
    ]);
  });

  test("throw síncrono também vira rejeição", async () => {
    const results = await mapSettled([1], () => {
      throw new Error("sync");
    });
    expect(results[0]?.status).toBe("rejected");
  });

  test("limite inválido cai para um por vez em vez de travar", async () => {
    for (const bad of [0, -2, Number.NaN]) {
      let running = 0;
      let peak = 0;
      const results = await mapSettled(
        [1, 2, 3],
        async (n) => {
          peak = Math.max(peak, ++running);
          await tick();
          running--;
          return n;
        },
        bad,
      );
      expect(peak).toBe(1);
      expect(results).toHaveLength(3);
    }
  });

  test("lista vazia resolve vazia", async () => {
    expect(await mapSettled([], async () => 1, 4)).toEqual([]);
  });
});

describe("skipWhileRunning", () => {
  test("disparo durante uma execução é ignorado, o seguinte roda", async () => {
    let runs = 0;
    let skips = 0;
    let release!: () => void;
    const guarded = skipWhileRunning(
      async () => {
        runs++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      () => skips++,
    );

    const first = guarded();
    await guarded(); // ainda rodando: pulado
    await guarded();
    expect([runs, skips]).toEqual([1, 2]);

    release();
    await first;
    const second = guarded();
    expect(runs).toBe(2);
    release();
    await second;
  });

  test("uma falha libera a trava para a próxima execução", async () => {
    let runs = 0;
    const guarded = skipWhileRunning(async () => {
      runs++;
      throw new Error("falhou");
    });
    await expect(guarded()).rejects.toThrow("falhou");
    await expect(guarded()).rejects.toThrow("falhou");
    expect(runs).toBe(2);
  });
});
