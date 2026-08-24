const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // sans ça, une base injoignable laisse la requête pendre indéfiniment
  connectionTimeoutMillis: 5000,
});

// Un client inactif qui perd la base (conteneur tué, redémarrage) émet une erreur
// sur le pool. Sans ce handler, Node considère l'événement comme non géré et tue
// le process : l'API disparaît au lieu de renvoyer une erreur HTTP.
pool.on("error", (err) => {
  console.error("[scores-api] connexion perdue avec la base :", err.message);
});

// La table est créée au démarrage : pas d'outil de migration pour un projet de cette taille.
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scores (
      id SERIAL PRIMARY KEY,
      username VARCHAR(32) NOT NULL,
      score INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function insertScore(username, score) {
  const result = await pool.query(
    "INSERT INTO scores (username, score) VALUES ($1, $2) RETURNING id, username, score, created_at",
    [username, score]
  );

  return result.rows[0];
}

async function listTopScores(limit) {
  const result = await pool.query(
    "SELECT id, username, score, created_at FROM scores ORDER BY score DESC, created_at ASC LIMIT $1",
    [limit]
  );

  return result.rows;
}

module.exports = { pool, initSchema, insertScore, listTopScores };
