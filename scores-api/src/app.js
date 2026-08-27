const express = require("express");
const cors = require("cors");
const scoresRouter = require("./routes/scores");
const errorHandler = require("./error-handler");
const { pool } = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "up" });
  } catch {
    res.status(503).json({ status: "degraded", database: "down" });
  }
});

app.use("/api/scores", scoresRouter);

app.use(errorHandler);

module.exports = app;
