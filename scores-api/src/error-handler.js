// Toute erreur non prévue finit ici : le client reçoit un JSON exploitable,
// jamais une stacktrace.

// Codes réseau (Node) et SQLSTATE (Postgres) qui veulent dire "la base n'est pas là".
const DB_UNAVAILABLE_CODES = ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "57P01", "57P03", "08000", "08003", "08006"];

function isDatabaseUnavailable(err) {
  // Le timeout du pool (connectionTimeoutMillis) arrive sans code du tout :
  // c'est le cas quand le conteneur de base a été tué.
  if (!err.code) {
    return /connection|timeout|terminated/i.test(err.message);
  }

  return DB_UNAVAILABLE_CODES.includes(err.code);
}

function errorHandler(err, req, res, next) {
  console.error("[scores-api]", err.code ?? "sans code", err.message);

  if (isDatabaseUnavailable(err)) {
    return res.status(503).json({ error: "base de données injoignable" });
  }

  res.status(500).json({ error: "erreur interne" });
}

module.exports = errorHandler;
