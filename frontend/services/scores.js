import { API_BASE_URL } from "../config.js";

const SCORES_URL = `${API_BASE_URL}/api/scores`;

export async function sendScore(username, score) {
  const response = await fetch(SCORES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, score }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error ?? "envoi impossible");
  }

  return body;
}

export async function fetchTopScores() {
  const response = await fetch(SCORES_URL);

  if (!response.ok) {
    throw new Error("classement indisponible");
  }

  return response.json();
}
