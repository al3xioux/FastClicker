const GAME_DURATION_SECONDS = 5;

const scoreValue = document.getElementById("score-value");
const timerValue = document.getElementById("timer-value");
const clickButton = document.getElementById("click-button");
const statusBand = document.getElementById("status-band");

let score = 0;
let remainingSeconds = GAME_DURATION_SECONDS;

function render() {
  scoreValue.textContent = String(score);
  timerValue.textContent = String(remainingSeconds);
}

render();
