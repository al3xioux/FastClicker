const GAME_DURATION_SECONDS = 5;
const TICK_INTERVAL_MS = 1000;

const scoreValue = document.getElementById("score-value");
const timerValue = document.getElementById("timer-value");
const clickButton = document.getElementById("click-button");
const statusBand = document.getElementById("status-band");

let score = 0;
let remainingSeconds = GAME_DURATION_SECONDS;
let isRunning = false;
let isFinished = false;
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
  isFinished = false;
  statusBand.textContent = "Partie en cours, clique !";
  render();
  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
}

function endGame() {
  clearInterval(tickTimer);
  tickTimer = null;
  isRunning = false;
  isFinished = true;
  remainingSeconds = 0;
  render();
  clickButton.textContent = "Rejouer";
  statusBand.textContent = `Terminé — score figé à ${score} clic(s).`;
}

function handleClick() {
  if (isFinished) {
    clickButton.textContent = "Clique !";
    startGame();
    return;
  }

  if (!isRunning) {
    startGame();
  }

  score += 1;
  render();
}

clickButton.addEventListener("click", handleClick);

render();
