const request = require("supertest");

// La base est remplacée : ces tests vérifient l'API, pas Postgres.
jest.mock("../src/db", () => ({
  pool: { query: jest.fn() },
  initSchema: jest.fn(),
  insertScore: jest.fn(),
  listTopScores: jest.fn(),
}));

const app = require("../src/app");
const { pool, insertScore, listTopScores } = require("../src/db");

const databaseError = (code) => {
  const error = new Error("connexion refusée");
  error.code = code;
  return error;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
});

describe("GET /health", () => {
  test("répond ok quand la base répond", async () => {
    pool.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: "up" });
  });

  test("répond 503 quand la base ne répond pas", async () => {
    pool.query.mockRejectedValue(databaseError("ECONNREFUSED"));

    const response = await request(app).get("/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "degraded", database: "down" });
  });
});

describe("POST /api/scores", () => {
  test("enregistre un score valide", async () => {
    insertScore.mockResolvedValue({
      id: 1,
      username: "JohnDoe",
      score: 42,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const response = await request(app)
      .post("/api/scores")
      .send({ username: "JohnDoe", score: 42 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ username: "JohnDoe", score: 42 });
    expect(insertScore).toHaveBeenCalledWith("JohnDoe", 42);
  });

  test("retire les espaces autour du pseudo", async () => {
    insertScore.mockResolvedValue({ id: 1, username: "JohnDoe", score: 7 });

    await request(app).post("/api/scores").send({ username: "  JohnDoe  ", score: 7 });

    expect(insertScore).toHaveBeenCalledWith("JohnDoe", 7);
  });

  test.each([
    ["pseudo absent", { score: 10 }],
    ["pseudo vide", { username: "   ", score: 10 }],
    ["pseudo trop long", { username: "x".repeat(33), score: 10 }],
    ["pseudo non textuel", { username: 12, score: 10 }],
    ["score absent", { username: "JohnDoe" }],
    ["score décimal", { username: "JohnDoe", score: 1.5 }],
    ["score négatif", { username: "JohnDoe", score: -1 }],
    ["score hors plafond", { username: "JohnDoe", score: 10001 }],
    ["score textuel", { username: "JohnDoe", score: "10" }],
  ])("refuse une requête avec %s", async (_label, payload) => {
    const response = await request(app).post("/api/scores").send(payload);

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(insertScore).not.toHaveBeenCalled();
  });

  test("accepte les bornes de la plage de score", async () => {
    insertScore.mockResolvedValue({ id: 1, username: "JohnDoe", score: 0 });

    const low = await request(app).post("/api/scores").send({ username: "JohnDoe", score: 0 });
    const high = await request(app).post("/api/scores").send({ username: "JohnDoe", score: 10000 });

    expect(low.status).toBe(201);
    expect(high.status).toBe(201);
  });

  test("répond 503 quand la base est injoignable", async () => {
    insertScore.mockRejectedValue(databaseError("ECONNREFUSED"));

    const response = await request(app)
      .post("/api/scores")
      .send({ username: "JohnDoe", score: 42 });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "base de données injoignable" });
  });

  test("répond 500 sur une erreur inattendue", async () => {
    insertScore.mockRejectedValue(new Error("bug inattendu"));

    const response = await request(app)
      .post("/api/scores")
      .send({ username: "JohnDoe", score: 42 });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "erreur interne" });
  });
});

describe("GET /api/scores", () => {
  test("renvoie le classement limité à dix entrées", async () => {
    listTopScores.mockResolvedValue([{ id: 1, username: "JohnDoe", score: 42 }]);

    const response = await request(app).get("/api/scores");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(listTopScores).toHaveBeenCalledWith(10);
  });

  test("répond 503 quand la base est injoignable", async () => {
    listTopScores.mockRejectedValue(databaseError("ETIMEDOUT"));

    const response = await request(app).get("/api/scores");

    expect(response.status).toBe(503);
  });
});
