import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const markup = readFileSync(join(projectRoot, "index.html"), "utf8");
const bodyMarkup = markup.slice(
  markup.indexOf("<body>") + "<body>".length,
  markup.indexOf("</body>")
);

// Le jeu ne doit pas parler au réseau pendant les tests.
jest.unstable_mockModule("../services/scores.js", () => ({
  sendScore: jest.fn(),
  fetchTopScores: jest.fn(),
}));

const GAME_DURATION_SECONDS = 5;
const RESTART_DELAY_MS = 700;

// Laisse les promesses déjà résolues se terminer, faux timers compris.
const flushPromises = () => Promise.resolve().then(() => Promise.resolve());

const clickTimes = (element, times) => {
  for (let index = 0; index < times; index += 1) {
    element.click();
  }
};

const byId = (id) => document.getElementById(id);

describe("Jeu FastClicker", () => {
  let sendScore;
  let fetchTopScores;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetModules();

    document.body.innerHTML = bodyMarkup;

    ({ sendScore, fetchTopScores } = await import("../services/scores.js"));
    sendScore.mockResolvedValue({ id: 1, username: "JohnDoe", score: 3 });
    fetchTopScores.mockResolvedValue([{ id: 1, username: "JohnDoe", score: 3 }]);

    // script.js lit le DOM dès son chargement : il s'importe en dernier.
    await import("../script.js");
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("le premier clic lance la partie et compte un point", () => {
    byId("click-button").click();

    expect(byId("score-value").textContent).toBe("1");
    expect(byId("status-band").textContent).toBe("Partie en cours, clique !");
  });

  test("le score suit le nombre de clics", () => {
    clickTimes(byId("click-button"), 7);

    expect(byId("score-value").textContent).toBe("7");
  });

  test("le chrono ne démarre pas avant le premier clic", () => {
    jest.advanceTimersByTime(GAME_DURATION_SECONDS * 1000);

    expect(byId("timer-value").textContent).toBe(String(GAME_DURATION_SECONDS));
  });

  test("le chrono décompte seconde par seconde", () => {
    byId("click-button").click();

    jest.advanceTimersByTime(2000);
    expect(byId("timer-value").textContent).toBe(String(GAME_DURATION_SECONDS - 2));

    jest.advanceTimersByTime(2000);
    expect(byId("timer-value").textContent).toBe("1");
  });

  test("la fin du chrono ouvre la popup avec le score atteint", () => {
    clickTimes(byId("click-button"), 4);
    jest.advanceTimersByTime(GAME_DURATION_SECONDS * 1000);

    expect(byId("timer-value").textContent).toBe("0");
    expect(byId("score-modal").open).toBe(true);
    expect(byId("modal-score-value").textContent).toBe("4");
    expect(byId("click-button").disabled).toBe(true);
    expect(byId("status-band").textContent).toBe("Partie terminée.");
  });

  test("le score n'augmente plus après la fin du chrono", () => {
    clickTimes(byId("click-button"), 4);
    jest.advanceTimersByTime(GAME_DURATION_SECONDS * 1000);
    clickTimes(byId("click-button"), 10);

    expect(byId("score-value").textContent).toBe("4");
  });

  test("l'envoi du score affiche le classement", async () => {
    clickTimes(byId("click-button"), 3);
    jest.advanceTimersByTime(GAME_DURATION_SECONDS * 1000);

    byId("name-field").value = "  JohnDoe  ";
    byId("name-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flushPromises();

    expect(sendScore).toHaveBeenCalledWith("JohnDoe", 3);
    expect(byId("name-form").hidden).toBe(true);
    expect(byId("score-board").hidden).toBe(false);
    expect(byId("score-board").children).toHaveLength(1);
  });

  test("un envoi refusé affiche l'erreur et laisse réessayer", async () => {
    sendScore.mockRejectedValue(new Error("username est obligatoire"));

    byId("click-button").click();
    jest.advanceTimersByTime(GAME_DURATION_SECONDS * 1000);

    byId("name-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flushPromises();

    expect(byId("form-error").hidden).toBe(false);
    expect(byId("form-error").textContent).toBe("username est obligatoire");
    expect(byId("name-field").disabled).toBe(false);
    expect(byId("score-board").hidden).toBe(true);
  });

  test("un double envoi n'enregistre le score qu'une fois", async () => {
    byId("click-button").click();
    jest.advanceTimersByTime(GAME_DURATION_SECONDS * 1000);

    byId("name-field").value = "JohnDoe";
    const form = byId("name-form");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flushPromises();

    expect(sendScore).toHaveBeenCalledTimes(1);
  });

  test("rejouer remet le jeu à zéro et débloque le bouton après le délai", () => {
    clickTimes(byId("click-button"), 5);
    jest.advanceTimersByTime(GAME_DURATION_SECONDS * 1000);

    byId("replay-button").click();

    expect(byId("score-value").textContent).toBe("0");
    expect(byId("timer-value").textContent).toBe(String(GAME_DURATION_SECONDS));
    expect(byId("click-button").disabled).toBe(true);
    expect(byId("status-band").textContent).toBe("Un instant...");

    jest.advanceTimersByTime(RESTART_DELAY_MS);

    expect(byId("click-button").disabled).toBe(false);
    expect(byId("status-band").textContent).toBe(
      "Appuie sur le bouton pour lancer la partie."
    );
  });

  test("une nouvelle partie est jouable après avoir rejoué", () => {
    byId("click-button").click();
    jest.advanceTimersByTime(GAME_DURATION_SECONDS * 1000);
    byId("replay-button").click();
    jest.advanceTimersByTime(RESTART_DELAY_MS);

    clickTimes(byId("click-button"), 2);

    expect(byId("score-value").textContent).toBe("2");
  });
});
