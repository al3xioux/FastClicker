// Le dépôt mélange trois environnements JS : le jeu tourne dans le navigateur en
// modules ES, l'API des scores tourne dans Node en CommonJS, et les tests des
// deux tournent sous Jest. Un seul bloc de règles ne peut pas convenir aux
// trois : chaque section cible ses fichiers et déclare ses globals.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["**/node_modules/**", "**/coverage/**", "stats_api/**"],
  },
  js.configs.recommended,
  {
    name: "jeu (navigateur, modules ES)",
    files: ["frontend/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
  },
  {
    name: "tests du jeu",
    files: ["frontend/tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.jest },
    },
  },
  {
    name: "API des scores (Node, CommonJS)",
    files: ["scores-api/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
  {
    name: "tests de l'API des scores",
    files: ["scores-api/tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.jest },
    },
  },
  {
    name: "outillage du dépôt",
    files: ["eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },
];
