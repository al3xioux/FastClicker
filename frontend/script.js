import { sendScore, fetchTopScores } from "./services/scores.js";

const GAME_DURATION_SECONDS = 5;
const TICK_INTERVAL_MS = 1000;
// le bouton de jeu est juste sous celui de la popup : sans ce délai, le clic qui
// ferme la popup relance une partie dans la foulée
const RESTART_DELAY_MS = 700;

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
const sendButton = nameForm.querySelector(".send-button");

let score = 0;
let remainingSeconds = GAME_DURATION_SECONDS;
let isRunning = false;
let tickTimer = null;
let isSending = false;

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
  statusBand.textContent = "Un instant...";
  nameForm.hidden = false;
  nameField.disabled = false;
  sendButton.disabled = false;
  sendButton.textContent = "Envoyer";
  formError.hidden = true;
  scoreBoard.hidden = true;
  render();

  setTimeout(() => {
    clickButton.disabled = false;
    statusBand.textContent = "Appuie sur le bouton pour lancer la partie.";
  }, RESTART_DELAY_MS);
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

  // un score ne s'envoie qu'une fois : on verrouille dès le premier envoi
  if (isSending) {
    return;
  }

  isSending = true;
  formError.hidden = true;
  nameField.disabled = true;
  sendButton.disabled = true;
  sendButton.textContent = "Envoi...";

  try {
    await sendScore(nameField.value.trim(), score);
    nameForm.hidden = true;
    renderBoard(await fetchTopScores());
  } catch (err) {
    // l'envoi a échoué : on rend la main pour réessayer
    showError(err.message);
    nameField.disabled = false;
    sendButton.disabled = false;
    sendButton.textContent = "Envoyer";
  } finally {
    isSending = false;
  }
}

clickButton.addEventListener("click", handleClick);
nameForm.addEventListener("submit", handleSubmit);
replayButton.addEventListener("click", () => scoreModal.close());
scoreModal.addEventListener("close", resetGame);

render();
