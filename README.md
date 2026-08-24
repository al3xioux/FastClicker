# FastClicker

Un clicker : 5 secondes pour cliquer le plus de fois possible.
Projet fil rouge de la formation DevOps / Docker / CI-CD, dockerisé étape par étape.

## Lancer le jeu

Sans Docker :

```bash
open frontend/index.html
```

Avec Docker :

```bash
docker build -t fastclicker:dev .
docker run -d -p 8080:8080 --name fastclicker fastclicker:dev
```

Puis http://localhost:8080

## Structure

```
frontend/        le jeu (html/css/js)
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
