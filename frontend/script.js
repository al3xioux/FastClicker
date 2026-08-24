const GAME_DURATION_SECONDS = 5;
const TICK_INTERVAL_MS = 1000;

const scoreValue = document.getElementById("score-value");
const timerValue = document.getElementById("timer-value");
const clickButton = document.getElementById("click-button");
const statusBand = document.getElementById("status-band");
const scoreModal = document.getElementById("score-modal");
const modalScoreValue = document.getElementById("modal-score-value");
const replayButton = document.getElementById("replay-button");

let score = 0;
let remainingSeconds = GAME_DURATION_SECONDS;
let isRunning = false;
let tickTimer = null;

function render() {
  scoreValue.textContent = String(score);
  timerValue.textContent = String(remainingSeconds);
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
}

function resetGame() {
  score = 0;
  remainingSeconds = GAME_DURATION_SECONDS;
  clickButton.disabled = false;
  statusBand.textContent = "Appuie sur le bouton pour lancer la partie.";
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

clickButton.addEventListener("click", handleClick);
replayButton.addEventListener("click", () => scoreModal.close());
scoreModal.addEventListener("close", resetGame);

render();
