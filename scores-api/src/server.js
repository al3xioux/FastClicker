const app = require("./app");
const config = require("./config");
const { initSchema } = require("./db");

async function start() {
  await initSchema();

  app.listen(config.port, () => {
    console.log(`[scores-api] écoute sur le port ${config.port}`);
  });
}

start().catch((err) => {
  console.error("[scores-api] démarrage impossible :", err.message);
  process.exit(1);
});
