// Toute la configuration passe par des variables d'environnement.
// Une variable obligatoire manquante arrête le démarrage tout de suite, avec un
// message clair : mieux vaut ça qu'une connexion qui échoue trois couches plus loin.
const REQUIRED_VARIABLES = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
];

const DEFAULT_PORT = 3000;

function readConfig() {
  const missing = REQUIRED_VARIABLES.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    console.error(`[scores-api] variables d'environnement manquantes : ${missing.join(", ")}`);
    console.error("[scores-api] voir .env.example à la racine du projet");
    process.exit(1);
  }

  return {
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    database: {
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      name: process.env.POSTGRES_DB,
    },
  };
}

module.exports = readConfig();
