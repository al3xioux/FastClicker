# FastClicker

[![CI](https://github.com/al3xioux/FastClicker/actions/workflows/ci.yml/badge.svg)](https://github.com/al3xioux/FastClicker/actions/workflows/ci.yml)

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
cd frontend    && npm ci && npm test              # 16 tests
cd scores-api  && npm ci && npm test              # 18 tests
cd stats_api   && pip install -r requirements-dev.txt && python -m pytest -q   # 6 tests
```

## Structure

```
frontend/            le jeu (html/css/js) + ses tests dans tests/
scores-api/          l'API des scores (Express + Postgres) + ses tests dans tests/
stats_api/           le service de stats (FastAPI, fourni par le formateur) + ses tests
docker/              nginx.conf
Dockerfile           image du jeu
docker-compose.yml   toute la stack
.env.example         les clés à remplir dans .env
.github/workflows/   la CI (tests des trois briques, puis build des images)
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

