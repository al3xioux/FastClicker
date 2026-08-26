import { jest } from "@jest/globals";
import { sendScore, fetchTopScores } from "../services/scores.js";

describe("Service des scores", () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    delete globalThis.fetch;
  });

  test("sendScore poste le pseudo et le score", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, username: "JohnDoe", score: 42 }),
    });

    const saved = await sendScore("JohnDoe", 42);

    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/scores$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ username: "JohnDoe", score: 42 });
    expect(saved.score).toBe(42);
  });

  test("sendScore remonte le message d'erreur de l'API", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "username est obligatoire" }),
    });

    await expect(sendScore("", 42)).rejects.toThrow("username est obligatoire");
  });

  test("sendScore reste lisible quand la réponse n'est pas du JSON", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error("pas du JSON");
      },
    });

    await expect(sendScore("JohnDoe", 42)).rejects.toThrow("envoi impossible");
  });

  test("fetchTopScores renvoie le classement", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 1, username: "JohnDoe", score: 42 }],
    });

    await expect(fetchTopScores()).resolves.toHaveLength(1);
  });

  test("fetchTopScores échoue quand l'API répond en erreur", async () => {
    globalThis.fetch.mockResolvedValue({ ok: false });

    await expect(fetchTopScores()).rejects.toThrow("classement indisponible");
  });
});
