# FastClicker

Un clicker : 5 secondes pour cliquer le plus de fois possible.
Projet fil rouge de la formation DevOps / Docker / CI-CD, dockerisé étape par étape.

## Lancer le jeu

```bash
docker build -t fastclicker:dev .
docker run -d -p 8080:8080 --name fastclicker fastclicker:dev
```

Puis http://localhost:8080 (les commandes de la base et de l'API sont dans le
journal de bord, étape 3).

## Structure

```
frontend/        le jeu (html/css/js)
scores-api/      l'API des scores (Express + Postgres)
docker/          nginx.conf
Dockerfile       image du jeu
.dockerignore
```

## Journal de bord

### Étape 1 - le jeu

Bouton, score, chrono de 5 secondes. À la fin du chrono le score ne bouge plus.
Rien à mesurer ici, pas encore de conteneur.

### Étape 2 - l'image du jeu

Base `nginx:1.27.4-alpine`, version épinglée.

**Ce qui a cassé.** Avec juste `USER nginx` à la fin du Dockerfile :

```
nginx: [emerg] mkdir() "/var/cache/nginx/client_temp" failed (13: Permission denied)
```

L'image officielle lance son maître en root, c'est lui qui écrit dans
`/var/cache/nginx` et `/var/run`. `USER nginx` lui enlève ces droits.

**Parade** (dans `docker/nginx.conf` + Dockerfile) : `pid` et les `*_temp_path`
dans `/tmp`, `chown -R nginx:nginx` sur le site et `/var/cache/nginx`, et
`listen 8080` parce qu'un non-root ne peut pas prendre un port < 1024. Donc
`-p 8080:8080` et pas `8080:80`. Logs sur stdout/stderr.

**Vérifs**

| Quoi | Commande | Résultat |
| --- | --- | --- |
| pas root | `docker run --rm fastclicker:dev whoami` | `nginx` |
| que le site | `docker run --rm fastclicker:dev ls -a /usr/share/nginx/html` | index.html, script.js, style.css |
| contexte | ligne `transferring context` | 425 B + 208 B |
| le jeu répond | `curl -o /dev/null -w "%{http_code}" localhost:8080` | 200 |

**Mesures**

| Mesure | Valeur |
| --- | --- |
| taille image | 75,5 Mo (21,7 Mo de contenu) |
| couches | 11 |
| build froid (avec pull de la base) | 6,3 s |
| build froid (base en local) | 0,96 s |
| build chaud | 0,49 s |

`--no-cache` ne vide pas l'image de base déjà téléchargée, d'où les deux lignes à froid.

Pas de multi-stage : rien à compiler dans du HTML/CSS/JS. Ce sera pour l'API à l'étape 3.

### Étape 3 - l'API des scores et sa base

Deux routes : `POST /api/scores` (username + score) et `GET /api/scores`
(les 10 meilleurs). Plus un `/health` qui fait un `SELECT 1`.

**Postgres**, avec un volume nommé pour les données :

```bash
docker volume create fastclicker_pgdata
docker run -d --name fastclicker-db \
  -e POSTGRES_USER=fastclicker \
  -e POSTGRES_PASSWORD=fastclicker_dev_pwd \
  -e POSTGRES_DB=fastclicker \
  -v fastclicker_pgdata:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:16.6-alpine
```

(le mot de passe en clair dans la commande, c'est réglé à l'étape 5)

**L'API**. Pas de network custom pour l'instant, donc les deux conteneurs sont sur
le bridge par défaut et l'API doit joindre la base par son IP :

```bash
docker network inspect bridge   # -> 172.17.0.3 pour fastclicker-db
docker run -d --name fastclicker-api \
  -e DB_HOST=172.17.0.3 -e DB_PORT=5432 \
  -e DB_USER=fastclicker -e DB_PASSWORD=fastclicker_dev_pwd \
  -e DB_NAME=fastclicker -e PORT=3000 \
  -p 3000:3000 \
  fastclicker-scores-api:dev
```

Cette IP change à chaque recréation du conteneur : je l'ai vu quand j'ai supprimé
puis relancé la base, il faut relancer l'API avec la nouvelle valeur. C'est le
problème que l'étape 4 règle.

Le port 3000 est publié parce que c'est le navigateur qui appelle l'API, et lui
n'est pas dans le réseau Docker.

**Dockerfile multi-stage.** Stage 1 : `npm ci` (tout, nodemon compris) puis
`npm prune --omit=dev`. Stage 2 : on copie seulement `node_modules` et `src`.

```
docker run --rm fastclicker-scores-api:dev ls node_modules | grep nodemon   # rien
docker run --rm fastclicker-scores-api:dev whoami                           # node
```

**Ce qui a cassé.** J'ai supprimé le conteneur Postgres pendant que l'API tournait,
et l'API est morte avec :

```
Error: Connection terminated unexpectedly
Emitted 'error' event on BoundPool instance
```

Un client inactif du pool `pg` perd la base, émet un événement `error`, et comme
personne ne l'écoute Node tue le process. Corrigé avec un `pool.on("error", ...)`
dans `src/db.js`. Deuxième passe : l'erreur remontait en 500 au lieu de 503, parce
que le timeout du pool arrive sans `err.code`. Le handler teste maintenant aussi
le message.

**Vérifs**

| Quoi | Résultat |
| --- | --- |
| `docker stop` + `docker start` de la base | les 3 scores sont toujours là |
| `docker rm` de la base + `docker run` sur le même volume | les 3 scores sont toujours là |
| `docker volume rm` sur un volume de test | `ERROR: relation "demo" does not exist`, données perdues |
| `docker kill` de la base pendant un POST | 503 `base de données injoignable`, l'API reste debout |
| API démarrée sans base | `démarrage impossible : connect ECONNREFUSED`, exit 1 |
| POST sans username | 400 |
| POST avec score 999999 | 400 |

**Mesures de l'image API**

| Mesure | Valeur |
| --- | --- |
| taille | 227 Mo |
| couches | 8 |
| build froid | 2,4 s |
| build chaud | 0,51 s |

**Le jeu envoie son score.** La popup de fin demande un pseudo, poste le score,
puis affiche le classement. Les appels réseau sont dans `frontend/services/scores.js`,
l'URL de l'API dans `frontend/config.js` (seul fichier à changer d'environnement).
Le front est passé en modules ES, donc il ne s'ouvre plus en double-clic : il faut
passer par le conteneur nginx.
