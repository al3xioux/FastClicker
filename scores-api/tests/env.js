// config.js arrête le process si une variable manque : on fournit de quoi
// démarrer. La base n'est jamais contactée, db.js est mocké dans les tests.
process.env.POSTGRES_HOST = "localhost";
process.env.POSTGRES_PORT = "5432";
process.env.POSTGRES_USER = "test";
process.env.POSTGRES_PASSWORD = "test";
process.env.POSTGRES_DB = "test";
