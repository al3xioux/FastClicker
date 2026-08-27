# FastClicker

[![Release](https://github.com/al3xioux/FastClicker/actions/workflows/release.yml/badge.svg)](https://github.com/al3xioux/FastClicker/actions/workflows/release.yml)
[![Verify](https://github.com/al3xioux/FastClicker/actions/workflows/verify.yml/badge.svg)](https://github.com/al3xioux/FastClicker/actions/workflows/verify.yml)

Un clicker : 5 secondes pour cliquer le plus de fois possible.
Projet fil rouge de la formation DevOps / Docker / CI-CD, dockerisé étape par étape.

Par **Alexandre Bonjour** ([al3xioux](https://github.com/al3xioux)).

## Lancer le jeu

```bash
cp .env.example .env    # puis remplir les valeurs
docker compose up -d --build
```

- le jeu : http://localhost:8080
- l'API des scores : http://localhost:3000/api/scores
- les stats : http://localhost:8000/stats
- Adminer : http://localhost:8081 (serveur `db`, identifiants du `.env`)

Les commandes `docker run` une par une, avant Compose, sont dans le journal de
bord aux étapes 3 et 4.

## Lancer les tests

Aucune base n'est nécessaire : chaque suite remplace Postgres par un double.

```bash
npm ci && npm run lint                            # ESLint sur tout le JS
cd frontend    && npm ci && npm test              # 16 tests
cd scores-api  && npm ci && npm test              # 18 tests
cd stats_api   && pip install -r requirements-dev.txt && python -m pytest -q   # 6 tests
```

La pipeline lance exactement ces quatre commandes, plus les scanners de sécurité
(`npm audit`, gitleaks, Trivy, Syft).

## Structure

```
frontend/            le jeu (html/css/js) + ses tests dans tests/
scores-api/          l'API des scores (Express + Postgres) + ses tests dans tests/
stats_api/           le service de stats (FastAPI, fourni par le formateur) + ses tests
docker/              nginx.conf
Dockerfile           image du jeu
docker-compose.yml   toute la stack
.env.example         les clés à remplir dans .env
.github/workflows/   verify.yml (pull request), release.yml (push main),
                     verification.yml et resume-securite.yml (réutilisables)
eslint.config.mjs    le linter, pour les trois environnements JS du dépôt
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

### Étape 4 - le network isolé

```bash
docker network create fastclicker-net
```

Les deux conteneurs relancés dessus, la base sans `-p` cette fois :

```bash
docker run -d --name fastclicker-db --network fastclicker-net \
  -e POSTGRES_USER=fastclicker -e POSTGRES_PASSWORD=fastclicker_dev_pwd \
  -e POSTGRES_DB=fastclicker \
  -v fastclicker_pgdata:/var/lib/postgresql/data \
  postgres:16.6-alpine

docker run -d --name fastclicker-api --network fastclicker-net \
  -e DB_HOST=fastclicker-db -e DB_PORT=5432 \
  -e DB_USER=fastclicker -e DB_PASSWORD=fastclicker_dev_pwd \
  -e DB_NAME=fastclicker -e PORT=3000 \
  -p 3000:3000 \
  fastclicker-scores-api:dev
```

`DB_HOST` vaut maintenant `fastclicker-db` au lieu d'une IP. Sur un network custom
Docker fournit un DNS interne, donc le nom du conteneur suffit et ne change plus
quand on recrée la base. C'est ce qui m'avait obligé à relancer l'API à l'étape 3.

**Vérifs**

| Quoi | Résultat |
| --- | --- |
| `nc -zv localhost 5432` | `Connection refused` |
| `docker ps` sur la base | `5432/tcp`, aucun `0.0.0.0->` |
| résolution du nom depuis l'API | `getent hosts fastclicker-db` -> 172.18.0.2 |
| scores après la bascule | les 4 toujours là (même volume) |
| partie jouée, score envoyé | 201 |

Le port 3000 de l'API reste publié : c'est le navigateur qui l'appelle, et lui est
en dehors du réseau Docker. La base n'a besoin de parler qu'à l'API, donc elle
n'expose plus rien vers l'hôte.

### Étape 5 - la configuration sort du code

Un `.env` à la racine avec les vraies valeurs (dans le `.gitignore`), un
`.env.example` avec les mêmes clés et des valeurs bidons, commité.

Les mêmes noms servent partout : le conteneur Postgres lit nativement
`POSTGRES_USER`, `POSTGRES_PASSWORD` et `POSTGRES_DB`, donc l'API lit ces
variables-là plutôt que d'inventer des `DB_USER` en double. Le service Python de
l'étape 7 lira exactement les mêmes.

Les conteneurs se lancent maintenant avec `--env-file .env`, plus aucun `-e` avec
une valeur écrite dans la commande.

**Échec franc si une variable manque.** `scores-api/src/config.js` vérifie les 5
variables obligatoires au démarrage :

```
$ docker run --rm ... (sans POSTGRES_PASSWORD)
[scores-api] variables d'environnement manquantes : POSTGRES_PASSWORD
[scores-api] voir .env.example à la racine du projet
$ echo $?
1
```

Plus aucun `process.env` ailleurs que dans ce fichier.

**Ce qui a cassé.** Après avoir mis un vrai mot de passe dans le `.env`, l'API
refusait de démarrer :

```
[scores-api] démarrage impossible : password authentication failed for user "fastclicker"
```

`POSTGRES_PASSWORD` n'est lu qu'à la **première** initialisation du volume. Le
volume existait déjà avec l'ancien mot de passe, changer le `.env` n'y touche pas.
Deux sorties : repartir d'un volume vide (et perdre les scores), ou changer le mot
de passe dans la base. J'ai fait le second :

```bash
docker exec fastclicker-db psql -U fastclicker -d fastclicker \
  -c "ALTER USER fastclicker WITH PASSWORD '...';"
```

**Vérifs**

| Quoi | Résultat |
| --- | --- |
| `git check-ignore .env` | ignoré |
| `.env` dans l'historique git | aucun |
| `ls /app` dans l'image API | pas de `.env` |
| `docker history` sur l'image | aucune trace du mot de passe |
| API démarrée avec `--env-file .env` | health 200, les 5 scores toujours là |

**L'URL de l'API dans le front.** Elle est dans `frontend/config.js`, en clair.
C'est le navigateur qui appelle l'API, donc cette URL finit forcément dans le JS
livré : ce n'est pas un secret et elle n'a rien à faire dans le `.env`. La
contrepartie, c'est qu'elle est figée au moment du build de l'image du jeu :
changer d'environnement veut dire rebuilder cette image, ou injecter la valeur au
démarrage du conteneur. Un secret, lui, ne doit jamais passer par là.

### Étape 6 - toute la stack dans un fichier

`docker compose up -d --build` démarre les quatre services : `game`, `scores-api`,
`db`, `adminer`. Aucune valeur en dur dans le fichier, tout vient du `.env` par
`${...}`, y compris les ports publiés.

La base n'a pas de `ports:`, donc elle reste joignable seulement depuis le network.

**Healthcheck.** `pg_isready` toutes les 5 s, et `condition: service_healthy` sur
`scores-api` et `adminer` : l'API ne démarre plus avant que la base accepte les
connexions. Mesuré au redémarrage de la base : **healthy en 6 s** (avec
`start_period: 10s`).

**Ajustements en passant à Compose**

- `POSTGRES_HOST` vaut maintenant `db` (le nom du service) au lieu de
  `fastclicker-db` : Compose crée le DNS interne à partir des noms de services.
- Le volume et le network créés à la main aux étapes 3 et 4 ne portent pas les
  labels de Compose, qui refuse de les reprendre. J'ai fait un
  `pg_dump --data-only` de la table `scores` avant de les supprimer, puis réinjecté
  le dump dans le volume créé par Compose. Les 5 scores sont toujours là.

**Cas limite : `POSTGRES_PASSWORD` commenté dans le `.env`**

```
warning: The "POSTGRES_PASSWORD" variable is not set. Defaulting to a blank string.
```

Service par service :

| Service | État |
| --- | --- |
| db | `Up (healthy)` quand même : le mot de passe n'est lu qu'à l'initialisation du volume, qui existait déjà |
| scores-api | `Restarting (1)` en boucle, logs : `variables d'environnement manquantes : POSTGRES_PASSWORD` |
| game, adminer | intacts, ils ne lisent pas cette variable |

C'est le comportement voulu : l'API refuse de tourner à moitié configurée. La
ligne remise, un `docker compose up -d` relance le seul service concerné.

**Cas adverse : `docker compose stop db` pendant une partie**

| Appel | Réponse |
| --- | --- |
| `POST /api/scores` | 503 `base de données injoignable` |
| `GET /api/scores` | 503 |
| `/health` | 503 `{"status":"degraded","database":"down"}` |
| le jeu | 200, la page tourne toujours |

L'API reste debout. Après `docker compose start db`, elle se rebranche seule
(le pool `pg` reconnecte), aucun redémarrage manuel : un POST repasse en 201.

### Étape 7 - le service de stats en Python

Code fourni par le formateur, rien à écrire côté Python. Deux choses à ajuster :

1. `TABLE_NAME`, `USERNAME_COLUMN`, `SCORE_COLUMN` : déjà bons, ma table s'appelle
   `scores` avec les colonnes `username` et `score`.
2. Les variables d'environnement : le code livré lisait `DB_HOST`, `DB_NAME`,
   `DB_USER`... alors que le projet utilise `POSTGRES_*` depuis l'étape 5. J'ai
   renommé les clés dans `get_connection()`, la logique n'a pas bougé. Sans ça le
   service plantait au premier appel sur un `KeyError`.

Ajouté au compose : build depuis `./stats_api`, même network, mêmes variables que
`scores-api`, `depends_on: db healthy`, port 8000 publié.

**Vérifs**

| Quoi | Résultat |
| --- | --- |
| `/stats` | `{"parties_jouees":10,"joueurs":7,"meilleur_score":30}` |
| `COUNT` manuel en base | `10`, `7`, `30` : identique |
| `/health` | `{"status":"ok"}` |
| table vide (`TRUNCATE` puis restauration) | 200 avec des compteurs à zéro, pas de 500 |
| base arrêtée | 503 `stats-api ne parvient pas à joindre la base de données`, aucune stacktrace |
| `/health` base arrêtée | toujours 200, il ne dépend pas de la base |
| `whoami` dans le conteneur | `appuser` |
| network | les 5 services listés côte à côte |
| HEALTHCHECK du Dockerfile | `Up (healthy)` |

Le `/health` volontairement indépendant de Postgres est un bon réflexe : une base
coupée ne doit pas faire passer le conteneur lui-même pour mort.

### Étape 8 - publier les images et redéployer depuis le registry

Trois images taguées avec une version explicite, jamais `latest` :

```bash
docker tag fastclicker-game:latest       alexioux/fastclicker:1.0.0
docker tag fastclicker-scores-api:latest alexioux/fastclicker-scores-api:1.0.0
docker tag fastclicker-stats-api:latest  alexioux/fastclicker-stats-api:1.0.0
docker push alexioux/fastclicker:1.0.0
docker push alexioux/fastclicker-scores-api:1.0.0
docker push alexioux/fastclicker-stats-api:1.0.0
```

| Image | Digest |
| --- | --- |
| alexioux/fastclicker:1.0.0 | `sha256:e050253...9973` |
| alexioux/fastclicker-scores-api:1.0.0 | `sha256:397dfa9...e5e9` |
| alexioux/fastclicker-stats-api:1.0.0 | `sha256:37e0d98...135b` |

Sans tag explicite l'image part en `latest` et peut écraser sans bruit ce que
quelqu'un d'autre utilise.

`docker-compose.prod.yml` reprend le compose de dev à l'identique, chaque `build:`
devenu un `image:`. Le reste (network, volume, healthcheck, base non publiée,
variables `${...}`) ne bouge pas.

**Vérification des secrets.** `docker history --no-trunc` sur les trois images : une
seule correspondance sur "password", et c'est `adduser --disabled-password` dans le
Dockerfile Python. Aucune valeur du `.env`, aucun jeton.

**Le test qui compte.** Tags locaux supprimés (`docker rmi`) pour forcer un vrai
téléchargement, puis un dossier neuf avec seulement deux fichiers :

```
~/Desktop/fastclicker-prod
├── .env
└── docker-compose.prod.yml
```

```
docker compose -f docker-compose.prod.yml up -d
 Image alexioux/fastclicker-stats-api:1.0.0 Pulled
 Image alexioux/fastclicker-scores-api:1.0.0 Pulled
 Image alexioux/fastclicker:1.0.0 Pulled
 Container fastclicker-db-1 Healthy
 ...
```

| Vérification depuis le dossier neuf | Résultat |
| --- | --- |
| le jeu | 200 |
| `GET /api/scores` | 10 scores, meilleur : alexioux 30 |
| `/stats` | `{"parties_jouees":10,"joueurs":7,"meilleur_score":30}` |
| `/health` de l'API | `{"status":"ok","database":"up"}` |
| Adminer | 200 |
| `nc -zv localhost 5432` | `Connection refused` |

Zéro ligne de code source dans ce dossier. Les scores sont toujours là parce que le
volume nommé porte le même nom de projet : les données ne vivent pas dans les images.

### Étape 9 - mesurer, puis optimiser

**Avant optimisation**

| Image | Base | Taille | Couches (plus grosse) | Build froid | Build chaud | 1re réponse HTTP |
| --- | --- | --- | --- | --- | --- | --- |
| game | nginx:1.27.4-alpine | 75,5 Mo | 11 (39,4 Mo) | 1,72 s | 0,53 s | 0,24 s |
| scores-api | node:22.13.1-alpine | 227 Mo | 8 (152 Mo) | 2,94 s | 0,65 s | 0,55 s |
| stats-api | python:3.12-slim | 236 Mo | 9 (109 Mo) | 4,98 s | 0,52 s | 0,84 s |

Méthode : `docker images` pour la taille, `docker image inspect` pour les couches,
`docker history` pour la plus grosse, `time docker build --no-cache` pour le froid,
et pour la première réponse HTTP un script qui boucle sur `curl` toutes les 100 ms
entre le `docker run` et le premier 200.

Dans les trois cas, la plus grosse couche est celle de l'image de base : 39 Mo sur
75 pour nginx, 152 Mo sur 227 pour node, 109 Mo sur 236 pour python. Le code du
projet ne pèse rien à côté. C'est donc là qu'il faut chercher, pas dans les `COPY`.

**Ce qui a été tenté**

*game : `nginx:1.27.4-alpine` -> `nginx:1.27.4-alpine-slim`.* La variante slim est le
même nginx sans les modules njs/perl ni les scripts d'entrypoint, dont un site
statique n'a aucun usage. Gain immédiat : 75,5 -> 20,3 Mo.

*stats-api : `python:3.12-slim` -> `python:3.12-alpine`.* Le cours prévient que
`psycopg2` compile mal sur Alpine. Testé quand même : `psycopg2-binary` 2.9.9
fournit maintenant un wheel musl, le build passe sans outils de compilation. 236 ->
110 Mo. La mise en garde reste vraie pour d'autres libs C, mais pas pour celle-là.

*scores-api : suppression de npm et yarn du stage final.* **Échec, et régression.**
L'image est restée à 227 Mo avec une couche de plus. Supprimer des fichiers dans une
couche postérieure ne les retire pas des couches précédentes : elles restent dans
l'image, et le `rm` ajoute juste une couche de suppression. Annulé. Pour vraiment
gagner, il aurait fallu que ces fichiers n'entrent jamais dans une couche conservée.
La base `node:22.13.1-alpine` pèse 152 des 227 Mo et est déjà la plus légère
officielle ; `node_modules` ne fait que 5,66 Mo. Pas de cible atteignable ici sans
changer de famille d'image, donc scores-api reste tel quel.

**Après optimisation**

| Image | Base | Taille | Couches (plus grosse) | Build froid | Build chaud | 1re réponse HTTP |
| --- | --- | --- | --- | --- | --- | --- |
| game | nginx:1.27.4-alpine-slim | 20,3 Mo (-73 %) | 10 (8,84 Mo) | 1,21 s | 0,63 s | 0,21 s |
| scores-api | node:22.13.1-alpine | 227 Mo (inchangé) | 8 (152 Mo) | 2,94 s | 0,65 s | 0,55 s |
| stats-api | python:3.12-alpine | 110 Mo (-53 %) | 9 (48,1 Mo) | 4,77 s | 0,52 s | ~0,86 s |

**Contrôles avant de valider**

- Build à froid après `docker builder prune` : les trois passent.
- Temps de démarrage : pas de régression. Une première mesure donnait 1,10 s pour
  stats-api contre 0,84 s avant, ce qui aurait été une régression. Trois mesures de
  chaque version montrent 0,67 / 0,86 / 0,84 s pour slim et 0,90 / 0,90 / 0,77 s pour
  alpine : les plages se recouvrent, l'écart est du bruit. Une seule mesure ne suffit
  pas à conclure.
- Aucun secret ni fichier de test dans les images (`docker history`).
- Fonctionnel vérifié : jeu en 200 avec ses modules JS, `whoami` = `nginx` ;
  `/stats` et `/health` corrects, `whoami` = `appuser`.

**Le coût cumulé.** Un build à froid complet des trois images passe de 9,64 s à
8,92 s. Sur une pipeline qui rejoue ça 50 fois par jour : environ 8 minutes de calcul
par jour avant, 7,4 minutes après. L'économie de temps est marginale, le vrai gain
est ailleurs : 181 Mo de moins à transférer à chaque pull, sur 50 déploiements ça
compte beaucoup plus que les 40 secondes de CPU.

**Jusqu'où descendre ?** Je me suis arrêté là où l'image reste débogable : les trois
gardent un shell, `docker exec ... whoami` et `ls` fonctionnent, les logs sortent sur
stdout. Passer en distroless ferait gagner quelques dizaines de Mo sur scores-api mais
supprimerait le shell, donc la possibilité de vérifier l'utilisateur ou de lister un
dossier dans un conteneur qui tourne. À ce stade du projet, ce n'est pas rentable.

### Étape 10 - test de bout en bout

Dossier neuf sur le Bureau, deux fichiers dedans, rien d'autre :

```
~/Desktop/fastclicker-e2e
├── .env                      reconstruit depuis .env.example, identifiants tout neufs
└── docker-compose.prod.yml
```

Tags locaux supprimés avant, projet Compose distinct (`-p fastclicker-e2e`), donc
volume vierge et base créée de zéro. Les trois images arrivent du registry en 1.1.0.

**1. Démarrage** : les 5 conteneurs montent, `db` passe `healthy`, l'API et Adminer
attendent le healthcheck avant de démarrer.

**2. Base vide** : `/stats` répond 200 avec `{"parties_jouees":0,"joueurs":0,
"meilleur_score":0}` et le classement renvoie `[]`. Cette fois le cas limite est réel,
rien n'a été vidé à la main.

**3. Une partie jouée dans le navigateur**, trois fois, avec trois pseudos. Scores
enregistrés : maxence 35, alexandrebjr 29, alexioux 26.

**4. Entrées refusées proprement**

| Envoi | Réponse |
| --- | --- |
| sans `username` | 400 `username est obligatoire et fait au plus 32 caractères` |
| `score: 999999` | 400 `score doit être un entier entre 0 et 10000` |
| `score: "plein"` | 400 |
| `username` avec seulement des espaces | 400 |

**5. Port Postgres depuis l'hôte** : `nc -zv localhost 5432` -> `Connection refused`.

**6. `/stats` contre un `COUNT` manuel**

```
/stats : {"parties_jouees":3,"joueurs":3,"meilleur_score":35}
psql   : SELECT COUNT(*), COUNT(DISTINCT username), COALESCE(MAX(score),0) FROM scores;
         3|3|35
```

**7. `docker kill` sur la base pendant une partie**

| Appel | Réponse |
| --- | --- |
| `POST /api/scores` | 503 `base de données injoignable` |
| `GET /api/scores` | 503 |
| `/stats` | 503 `stats-api ne parvient pas à joindre la base de données` |
| `/health` de l'API | 503 `{"status":"degraded","database":"down"}` |
| `/health` de stats-api | 200, il ne dépend pas de la base |
| le jeu | 200 |

Les quatre autres conteneurs restent debout. Après `docker start`, la base repasse
`healthy` en 5,3 s et les deux API se rebranchent seules : aucun redémarrage manuel,
le POST suivant repasse en 201 et les trois scores sont intacts.

**Une chose remarquée après le kill** : le score inséré ensuite porte l'id 34 alors
que la table n'a que 4 lignes. Le `docker kill` envoie un SIGKILL, donc Postgres
redémarre en récupération de crash ; comme il ne journalise les valeurs de séquence
que tous les 32 appels, il reprend au-delà de la dernière valeur sûre pour ne jamais
réattribuer un id déjà utilisé. Aucune donnée perdue, mais les id ne sont plus
contigus. Un arrêt propre (`docker stop`) ne fait pas ça.

### Étape 11 - les tests automatisés et la CI

Jusqu'ici tout était vérifié à la main, navigateur ouvert et `curl` à côté. L'étape 10
a pris une soirée à rejouer. Ce qui a été vérifié une fois est maintenant écrit une
fois pour toutes : 40 tests, trois suites, aucune base à démarrer.

| Suite | Outils | Tests | Ce qui est couvert |
| --- | --- | --- | --- |
| `frontend/tests` | Jest + jsdom | 16 | le jeu (score, chrono, popup, rejouer) et le service HTTP |
| `scores-api/tests` | Jest + supertest | 18 | validation du payload, 201, 400, 503, 500, `/health` |
| `stats_api/tests` | pytest | 6 | `/stats`, base vide, `/health`, 503 base injoignable |

Les cas du tableau de l'étape 10 sont repris tels quels : les quatre entrées refusées
sont devenues un `test.each`, et le comportement observé après le `docker kill` (503
`base de données injoignable`) est vérifié en injectant une erreur `ECONNREFUSED`.
La base n'est jamais contactée : `db.js` est mocké côté Express, `get_connection`
est remplacée côté FastAPI. Un test qui a besoin d'un conteneur Postgres n'est plus
un test unitaire, et ne tournerait pas en CI sans service supplémentaire.

**Trois obstacles, et ce qu'ils apprennent**

`frontend/` est en modules ES natifs (`<script type="module">`), et c'est ce qui a
coûté le plus de temps :

1. En ESM, Jest n'injecte pas le global `jest`. Il faut `import { jest } from
   "@jest/globals"`, et lancer avec `NODE_OPTIONS=--experimental-vm-modules`.
2. `script.js` lit le DOM dès son chargement (`getElementById` au niveau du module).
   Un `import` statique en haut du test s'exécuterait sur un document vide. D'où
   l'`await import("../script.js")` en dernière ligne du `beforeEach`, après avoir
   posé le HTML — lu depuis `index.html` plutôt que recopié, pour que le test casse
   si un `id` change dans la page.
3. jsdom 26 reflète bien l'attribut `open` de `<dialog>` mais n'implémente ni
   `showModal()` ni `close()`, dont le jeu dépend entièrement. Sept tests plantaient
   sur `scoreModal.showModal is not a function`. Un polyfill de vingt lignes limité
   aux tests (`tests/dialog-polyfill.js`) suffit ; le code du jeu n'a pas été touché.

Côté Python, `pip install` échouait sur `psycopg2-binary` 2.9.9 : pas de wheel pour
le Python 3.14 installé sur la machine, et donc compilation depuis les sources. La CI
et le venv local sont donc sur **3.12**, la version déjà épinglée dans
`stats_api/Dockerfile`. Une dépendance de test ne doit pas obliger à changer une
dépendance de production.

**Les images restent propres**

Ajouter des tests fait grossir les dossiers, pas les images — c'était tout le travail
de l'étape 9. Vérifié plutôt que supposé :

```
image du jeu   : config.js  index.html  script.js  services/  style.css
image de stats : main.py  requirements.txt
```

`scores-api/Dockerfile` ne copiait déjà que `src/`, et `npm prune --omit=dev` retire
jest et supertest. Pour les deux autres, il a fallu compléter les `.dockerignore`
(`frontend/tests`, `frontend/package.json`, `tests`, `requirements-dev.txt`). Un
dernier pas de la CI relance ce `ls` dans l'image du jeu et échoue s'il y retrouve
un `package.json`, un dossier `tests` ou `node_modules` : la vérification ne dépend
pas du fait que quelqu'un pense à la refaire.

**La CI** (`.github/workflows/ci.yml`) : un job par brique, les trois en parallèle,
puis un quatrième qui construit les trois images — `needs` sur les précédents, parce
que construire une image dont le code échoue ses tests ne sert à rien.

---

## Jour 3 - reprendre la main sur la pipeline

Le workflow du jour 2 venait pour l'essentiel du bouton "New Workflow" de GitHub.
Dix phases pour le remplacer par une pipeline écrite à la main : stages ordonnés,
artefact tagué au sha, scanners de sécurité, et un humain avant toute publication.

### Tableau de bord

Rempli au fil des phases, jamais reconstitué à la fin.

| Repère | Run | Durée totale | Job `test` le plus long | `npm ci` (API scores) | Image du jeu | HIGH / CRITICAL |
| --- | --- | --- | --- | --- | --- | --- |
| Référence, avant cache | [33049455019](https://github.com/al3xioux/FastClicker/actions/runs/33049455019) | 72 s | 14 s | 6 s | 20,3 Mo | pas encore scanné |
| Run qui pose le cache | [33049612830](https://github.com/al3xioux/FastClicker/actions/runs/33049612830) | 52 s | 11 s | 4 s | 20,3 Mo | pas encore scanné |
| Après cache (cache hit) | [33049716158](https://github.com/al3xioux/FastClicker/actions/runs/33049716158) | 74 s | 10 s | 3 s | 20,3 Mo | pas encore scanné |
| Première publication réelle | [33052323784](https://github.com/al3xioux/FastClicker/actions/runs/33052323784) | 238 s (dont l'attente de validation) | 16 s | - | 20,3 Mo local / **5,2 Mo** poussés | voir phase 5 |

### Phase 1 - écrire ses propres stages, lint puis test

ESLint 10 en flat config (`eslint.config.mjs`), `npm run lint` dans un
`package.json` à la racine, et un stage `lint` que les trois suites de tests
attendent par `needs:`.

Le dépôt mélange trois environnements JS — le jeu en modules ES pour le
navigateur, l'API des scores en CommonJS pour Node, les tests des deux sous Jest.
Un seul bloc de règles ne pouvait pas convenir aux trois : chaque section de la
config cible ses fichiers et déclare ses globals. `stats_api/` est exclu, ESLint
ne lit pas le Python.

**Deux erreurs au premier passage**, et deux traitements différents :

- `scores-api/src/app.js` : `catch (err)` où l'erreur n'était jamais lue. Corrigé
  en `catch {}`, le code est plus juste qu'avant.
- `scores-api/src/error-handler.js` : `next` inutilisé. Ici le linter a tort :
  Express ne reconnaît un middleware d'erreur qu'à sa signature de **quatre**
  arguments, retirer `next` le rendrait ordinaire et les erreurs ne passeraient
  plus jamais par lui. Un `eslint-disable-next-line` commenté, plutôt qu'une
  règle désactivée pour tout le dépôt.

Premier réflexe pris : on configure la règle ou on documente l'exception, on ne
mutile pas le code pour faire taire le linter.

**Les trois cas demandés**

| Cas | Attendu | Observé |
| --- | --- | --- |
| normal | les deux stages au vert | run [33049201848](https://github.com/al3xioux/FastClicker/actions/runs/33049201848) : `lint` fini à 07:18:59, les tests démarrent à 07:19:01 |
| limite | une erreur de style fait échouer `lint`, `test` ne démarre jamais | PR #1, variable jamais utilisée : `Lint` en échec, les **4 autres jobs `skipped`** |
| adverse | une branche absente de `on:` ne déclenche rien | `spike/lint-rouge` poussée : **aucun run**. Il a fallu ouvrir une PR pour que quoi que ce soit se lance |

Le cas adverse est le plus instructif : le push n'a rien produit, aucun message,
aucune erreur. Une pipeline qui ne se déclenche pas ressemble à une pipeline
verte quand on ne regarde que l'absence de rouge.

### Phase 2 - publier une image taguée au sha du commit

Job `build-and-push`, après les tests, avec `docker/login-action` puis
`docker/build-push-action`. Tag : `${{ github.sha }}`, jamais `latest`. Les
identifiants viennent des secrets du dépôt, jamais du YAML.

Une condition porte tout le sens du job :

```yaml
if: github.ref == 'refs/heads/main' && github.event_name == 'push'
```

**Cas limite déjà prouvé** : sur `J3`, le run
[33049455019](https://github.com/al3xioux/FastClicker/actions/runs/33049455019)
teste et construit, et le job de publication ressort `skipped`. Une branche de
travail ne publie rien, même quand tout est vert.

### Phase 3 - mesurer avant d'optimiser

Le tableau de bord ci-dessus a été rempli **avant** d'ajouter le cache. Puis
`cache: "npm"` sur les trois jobs Node et `cache: "pip"` sur le job Python,
chacun avec son `cache-dependency-path`.

Ce que la mesure dit vraiment, et c'est le cas limite de l'énoncé : **la durée
totale du run ne prouve rien ici**. Elle passe de 72 s à 52 s puis remonte à
74 s, uniquement parce que le job `Build des images` varie de 25 s à 46 s d'un
run à l'autre — du `docker build`, sans aucun rapport avec le cache npm.

La mesure honnête est celle de l'étape d'installation :

| Étape mesurée | Avant cache | Après cache |
| --- | --- | --- |
| `npm ci` (API des scores) | 6 s | **3 s** |
| `npm ci` (jeu) | 4 s | **3 s** |
| `pip install` (stats) | 4 s | **3 s** |
| total installation des 3 jobs | 14 s | **9 s** |

Soit environ 35 % sur l'installation, et rien du tout sur le reste. Loin des
"30 à 8 secondes" du cours, et c'est logique : ce dépôt a très peu de
dépendances, il n'y a pas 30 secondes à récupérer. Le cache se juge sur l'étape
qu'il accélère, pas sur le total du run.

Le hit est vérifié dans les logs plutôt que supposé :

```
Cache hit for: node-cache-Linux-x64-npm-3d717197...   (job lint)
Cache hit for: node-cache-Linux-x64-npm-e7addc97...   (job jeu)
```

Deux clés **différentes** pour deux jobs, dérivées chacune de son propre
`package-lock.json`. C'est ce qui écarte le cas adverse : un job ne peut pas
récupérer les dépendances d'un autre dossier, la clé ne le permet pas.

### Phase 4 - brancher npm audit et gitleaks

Job `security-deps`, **sans `needs:`** : il démarre en même temps que le lint et
les tests, rien ne justifie d'attendre. `npm audit --audit-level=high` sur les
trois `package.json` du dépôt, puis `gitleaks/gitleaks-action@v2` avec
`fetch-depth: 0`, sans quoi le checkout ne ramène qu'un seul commit.

**Les deux scanners détectent pour de vrai** (le vert initial ne prouvait rien) :

| Preuve | Injection | Résultat en CI |
| --- | --- | --- |
| SCA | `lodash@4.17.4` (version de 2017) | `Severity: critical`, GHSA-xxjr-mmjv-4gpg, job en échec ([run](https://github.com/al3xioux/FastClicker/actions/runs/33050111183), PR #2) |
| Secrets | deux faux identifiants ajoutés, **fichier supprimé au commit suivant** | `14 commits scanned`, `leaks found: 2`, règle `generic-api-key` ([run](https://github.com/al3xioux/FastClicker/actions/runs/33050253522), PR #3) |

Dans les deux cas, **seul** le job de sécurité passe au rouge : lint, les trois
suites de tests et le build restent verts. L'échec est localisé, ce qui est
exactement ce qu'on demande à une pipeline en stages.

#### Deux choses apprises, qui ne figuraient pas dans l'énoncé

**1. GitHub a refusé le push avant que la CI existe.** Le premier essai de faux
secret contenait une clé au format Stripe. Le `git push` a été rejeté net :

```
remote: error: GH013: Repository rule violations found
remote:  —— Stripe API Key ——
remote:    commit: fd0e993, path: frontend/config-demo.js:4
```

Push protection s'est déclenchée côté serveur, le commit n'a jamais atteint le
dépôt. C'est le shift left poussé à son extrême : la détection la plus utile est
celle qui arrive avant la pipeline. À noter, et c'est le plus intéressant : le mot
de passe à forte entropie du même fichier n'a **pas** été bloqué, seul le format
`sk_live_` reconnaissable l'a été. GitHub reconnaît des formats de fournisseurs
connus, gitleaks a en plus des règles génériques. Les deux se complètent, aucun
ne remplace l'autre — c'est la version concrète de la famille de scanners du
chapitre 8. La branche a donc été refaite avec deux secrets génériques, que
gitleaks attrape (`generic-api-key`) et que GitHub laisse passer.

**2. `gitleaks-action` ne relit pas tout l'historique sur un push.** Les logs
montrent la commande réellement lancée :

```
gitleaks detect ... --log-opts=--no-merges --first-parent c70dcea^..50eddf39
```

C'est la plage du push, pas le dépôt. Le compteur le confirme : **14 commits
scannés** en CI contre **43** avec un `gitleaks detect` complet lancé en local
sur la même branche. La détection a fonctionné ici parce que les deux commits
(ajout puis suppression) faisaient partie du même push. Un secret introduit il y
a trois mois passerait inaperçu à chaque push suivant.

Correction apportée : `workflow_dispatch` ajouté aux déclencheurs, seul mode où
l'action scanne le dépôt entier. Un audit complet reste donc possible à la
demande, sans ralentir chaque push.

### Phase 5 - scanner l'image avec Trivy

Job `security-image`, après `build-and-push`, seuil identique à celui de la
phase 4 : blocage sur HIGH et CRITICAL.

Deux passages de Trivy sur la même image, et c'est volontaire : le premier
produit `trivy-rapport.json` avec `exit-code: 0`, le second bloque avec
`exit-code: 1`. Un seul passage bloquant s'arrêterait avant d'avoir écrit le
moindre rapport exploitable — or c'est précisément quand il échoue qu'on a besoin
de savoir sur quoi.

Le cas adverse de l'énoncé (un tag pas encore publié au moment du scan) est déjà
écarté par le `needs:`, mais un `docker manifest inspect` explicite le
transforme en message clair plutôt qu'en erreur obscure de Trivy :

```
::error::l'image alexioux/fastclicker:<sha> est introuvable sur Docker Hub
```

### Phase 6 - générer un SBOM avec Syft

`anchore/sbom-action` sur l'image publiée, format CycloneDX, déposé en artefact
par `actions/upload-artifact@v4`, `needs: build-and-push`.

Un SBOM vide est un piège : le job réussirait, l'artefact existerait, et
personne ne verrait qu'il ne contient rien. Le job compte donc les composants et
échoue à zéro, avant de publier l'artefact.

### Phase 7 - centraliser l'état de sécurité dans un résumé

Un job final écrit dans `$GITHUB_STEP_SUMMARY` un tableau qui répond en une
lecture à « peut-on publier cette version en confiance ? ». Il lit les résultats
des jobs et, quand ils existent, le rapport Trivy et le SBOM téléchargés en
artefacts.

Toute la difficulté est dans les deux cas dégradés, et ils sont vérifiés en local
avant d'être poussés :

| Situation | Comportement obtenu |
| --- | --- |
| les quatre jobs ont tourné | `1` CRITICAL, `3` HIGH, `37` composants (jeu de test) |
| un job sauté (pull request, pas d'image) | `⏭️ non applicable ici`, sortie 0 |
| un job planté avant d'écrire son rapport | `non disponible`, sortie 0 |
| rapport présent mais **JSON tronqué** | `non disponible`, sortie 0 |

Le principe tenu : `jq -e` valide le fichier avant de compter, et l'absence
s'écrit « non disponible ». Un `0` affiché signifie « zéro vulnérabilité
trouvée », jamais « je n'ai pas pu lire le rapport ». Les deux se ressemblent
sur un tableau de bord et ne veulent pas du tout dire la même chose.

### Phase 8 - faire valider la publication par un humain

Environnement `production` créé avec un reviewer obligatoire, et une politique de
branche qui n'autorise que `main` :

```
env production
  required_reviewers: al3xioux
  branches autorisées: main
```

Le job `build-and-push` porte `environment: production`. Il ne démarre plus tout
seul : le run reste en attente jusqu'au clic « approve ». C'est le passage du
Continuous Deployment au Continuous Delivery, en une ligne de YAML et un réglage
de dépôt.

### Phase 9 - séparer vérification et publication

Un seul fichier faisait tout depuis la phase 1. Il est remplacé par quatre :

| Fichier | Déclencheur | Rôle |
| --- | --- | --- |
| `verify.yml` | `pull_request` vers main, `workflow_dispatch` | vérifie, ne publie jamais |
| `release.yml` | `push` sur main | vérifie puis publie, sous validation humaine |
| `verification.yml` | `workflow_call` | lint, tests, sécurité des dépendances, build |
| `resume-securite.yml` | `workflow_call` | le résumé, qui reçoit les résultats en entrée |

L'énoncé autorisait à recopier les jobs communs dans les deux fichiers. Deux
workflows réutilisables évitent la recopie : `verification.yml` n'a **aucun
déclencheur propre**, seulement `workflow_call`. C'est plus fort qu'une
convention — une pull request ne peut pas publier parce que le fichier qui publie
ne l'écoute pas, et les deux chemins ne peuvent pas dériver l'un de l'autre
puisqu'ils lisent le même fichier.

**Cas normal vérifié** : la PR #4 (J3 → main) lance `Verify` et rien d'autre.
Run [33050802099](https://github.com/al3xioux/FastClicker/actions/runs/33050802099),
sept jobs au vert, et aucun run `Release` dans la liste.

**Effet de bord assumé** : depuis cette phase, un `git push` sur `J3` ne
déclenche plus rien du tout. C'est voulu — la vérification passe par la pull
request — mais c'est exactement le silence de la phase 1, et il faut s'en
souvenir en voyant un push sans aucun run.

#### Phase 8 en conditions réelles

Après la fusion de la PR #4, `release.yml` s'est déclenché sur `main` et s'est
**arrêté de lui-même** avant la publication :

```
run=waiting   deploiements_en_attente=1
environnement : production
reviewers requis : al3xioux
```

Approbation donnée par **al3xioux le 27/08/2026 à 08:04:12 UTC** (déploiement
`6118898827`, commit `95a10ce`). Le job a démarré à ce moment-là, pas avant.
Le geste manuel du chapitre 3 n'est plus une définition, c'est une barrière qui a
réellement retenu la pipeline.

#### Deux cas adverses prouvés par accident

Le run [33052323784](https://github.com/al3xioux/FastClicker/actions/runs/33052323784)
a échoué juste après l'approbation :

```
##[error]Password required
```

Cause trouvée en lisant le log plutôt qu'en devinant : le secret
`DOCKERHUB_TOKEN` avait bien été **créé**, mais **vide**. `gh secret set` sans
`--body` lit la valeur sur l'entrée standard ; lancé sans terminal interactif, il
a enregistré une chaîne vide. Un secret présent dans la liste des secrets n'est
pas un secret renseigné — `gh secret list` affiche un nom et une date, jamais un
contenu, donc il ne prouve rien.

Cet échec valide deux cas adverses de l'énoncé, sans avoir eu à les provoquer :

| Phase | Cas adverse attendu | Ce qui s'est passé |
| --- | --- | --- |
| 2 | un secret Docker Hub cassé fait échouer `build-and-push`, **et seulement lui** | les 6 jobs de vérification restent verts, `security-image` et `sbom` passent en `skipped`, seule la publication est rouge |
| 7 | le résumé reste correct quand un job plante avant d'écrire son rapport | le job `Résumé` a **réussi** malgré la publication en échec, en affichant « non disponible » plutôt qu'un zéro |

C'est la démonstration la plus utile de la journée : l'échec est resté confiné à
un seul job, et le résumé a continué à dire la vérité alors que la donnée
manquait.

#### La publication, pour de vrai

Trois essais avant que l'image ne parte, et chacun a appris quelque chose :

| Essai | Erreur | Cause réelle |
| --- | --- | --- |
| 1 | `##[error]Password required` | secret créé mais **vide** : `gh secret set` sans `--body` lit l'entrée standard, sans terminal interactif il enregistre une chaîne vide |
| 2 | `unauthorized: incorrect username or password` | token tronqué au collage. L'invite affichait `*********`, 9 caractères pour un token qui en fait 36 |
| 3 | ✅ publiée en 24 s | token repris du keychain local par un tube, sans jamais l'afficher |

Diagnostic de l'essai 2 : le namespace `alexioux/fastclicker` existe bien et
l'identifiant enregistré en local est bien `alexioux`, donc l'identifiant
n'était pas en cause. Restait le token. La bonne façon de le poser sans jamais
l'exposer, ni dans un historique de shell ni dans une capture :

```bash
echo "https://index.docker.io/v1/" | docker-credential-desktop get \
  | jq -r .Secret | tr -d '\n' \
  | gh secret set DOCKERHUB_TOKEN --repo al3xioux/FastClicker
```

**Résultat sur Docker Hub** :

```
95a10ce826b7b093451098b5d0ab3e65cde5cf9f   5,2 Mo   2026-08-27T08:16:25Z
1.1.0                                      5,5 Mo   2026-08-25T10:49:11Z
1.0.0                                     20,7 Mo   2026-08-25T08:26:11Z
```

Le tag est le sha complet du commit, et les tags du jour 2 n'ont pas bougé : un
artefact publié ne se réécrit pas, il s'ajoute.

#### Une action épinglée sur une version qui n'existe pas

Juste après la publication, `security-image` a échoué en 2 s — trop vite pour
être Trivy :

```
##[error]Unable to resolve action `aquasecurity/trivy-action@0.28.0`,
unable to find version `0.28.0`
```

Le job est mort au *Set up job*, avant même le premier step. Les tags de
`trivy-action` sont préfixés d'un `v` (`v0.36.0`, `v0.35.0`...), et `0.28.0` sans
préfixe n'existe pas. Épingler une version est la bonne pratique, mais épingler
une version inventée transforme le job en panne franche. À retenir : une
référence d'action se vérifie (`gh api repos/<action>/tags`), elle ne se devine
pas.

Corrigé en `@v0.36.0`. Au passage, une incohérence a été rattrapée dans le même
commit : le passage "rapport" de Trivy n'avait pas `ignore-unfixed`, contrairement
au passage bloquant. Le résumé aurait donc pu annoncer des CVE que le seuil
laissait volontairement passer — un tableau de bord qui alarme sur ce qui ne
bloque pas finit par ne plus être lu.
