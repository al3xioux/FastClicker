const express = require("express");
const { insertScore, listTopScores } = require("../db");

const MAX_USERNAME_LENGTH = 32;
const MAX_SCORE = 10000;
const LEADERBOARD_SIZE = 10;

const router = express.Router();

function validateScorePayload(body) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const score = body.score;

  if (username.length === 0 || username.length > MAX_USERNAME_LENGTH) {
    return { error: `username est obligatoire et fait au plus ${MAX_USERNAME_LENGTH} caractères` };
  }

  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    return { error: `score doit être un entier entre 0 et ${MAX_SCORE}` };
  }

  return { username, score };
}

router.post("/", async (req, res, next) => {
  const { error, username, score } = validateScorePayload(req.body ?? {});

  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const saved = await insertScore(username, score);
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const scores = await listTopScores(LEADERBOARD_SIZE);
    res.json(scores);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
