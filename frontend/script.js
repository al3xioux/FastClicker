import { sendScore, fetchTopScores } from "./services/scores.js";

const GAME_DURATION_SECONDS = 5;
const TICK_INTERVAL_MS = 1000;

const scoreValue = document.getElementById("score-value");
const timerValue = document.getElementById("timer-value");
const clickButton = document.getElementById("click-button");
const statusBand = document.getElementById("status-band");
const scoreModal = document.getElementById("score-modal");
const modalScoreValue = document.getElementById("modal-score-value");
const replayButton = document.getElementById("replay-button");
const nameForm = document.getElementById("name-form");
const nameField = document.getElementById("name-field");
const formError = document.getElementById("form-error");
const scoreBoard = document.getElementById("score-board");

let score = 0;
let remainingSeconds = GAME_DURATION_SECONDS;
let isRunning = false;
let tickTimer = null;

function render() {
  scoreValue.textContent = String(score);
  timerValue.textContent = String(remainingSeconds);
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function renderBoard(scores) {
  scoreBoard.replaceChildren();

  for (const entry of scores) {
    const row = document.createElement("li");
    row.className = "board-row";

    const name = document.createElement("span");
    name.textContent = entry.username;

    const points = document.createElement("span");
    points.textContent = String(entry.score);

    row.append(name, points);
    scoreBoard.append(row);
  }

  scoreBoard.hidden = false;
}

function tick() {
  remainingSeconds -= 1;
  render();

  if (remainingSeconds <= 0) {
    endGame();
  }
}

function startGame() {
  score = 0;
  remainingSeconds = GAME_DURATION_SECONDS;
  isRunning = true;
  statusBand.textContent = "Partie en cours, clique !";
  render();
  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
}

function endGame() {
  clearInterval(tickTimer);
  tickTimer = null;
  isRunning = false;
  remainingSeconds = 0;
  render();

  // le bouton reste bloqué tant que la popup n'est pas fermée
  clickButton.disabled = true;
  statusBand.textContent = "Partie terminée.";
  modalScoreValue.textContent = String(score);
  scoreModal.showModal();
  nameField.focus();
}

function resetGame() {
  score = 0;
  remainingSeconds = GAME_DURATION_SECONDS;
  clickButton.disabled = false;
  statusBand.textContent = "Appuie sur le bouton pour lancer la partie.";
  nameForm.hidden = false;
  formError.hidden = true;
  scoreBoard.hidden = true;
  render();
}

function handleClick() {
  // sécurité : tant que la popup est ouverte, aucune partie ne redémarre
  if (scoreModal.open) {
    return;
  }

  if (!isRunning) {
    startGame();
  }

  score += 1;
  render();
}

async function handleSubmit(event) {
  event.preventDefault();
  formError.hidden = true;

  try {
    await sendScore(nameField.value.trim(), score);
    nameForm.hidden = true;
    renderBoard(await fetchTopScores());
  } catch (err) {
    showError(err.message);
  }
}

clickButton.addEventListener("click", handleClick);
nameForm.addEventListener("submit", handleSubmit);
replayButton.addEventListener("click", () => scoreModal.close());
scoreModal.addEventListener("close", resetGame);

render();
