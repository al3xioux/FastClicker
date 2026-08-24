const app = require("./app");
const { initSchema } = require("./db");

const PORT = Number(process.env.PORT ?? 3000);

async function start() {
  await initSchema();

  app.listen(PORT, () => {
    console.log(`[scores-api] écoute sur le port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("[scores-api] démarrage impossible :", err.message);
  process.exit(1);
});
