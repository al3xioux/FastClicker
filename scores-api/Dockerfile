# --- étape 1 : dépendances -------------------------------------------------
# On installe TOUT (dev inclus, nodemon par exemple), puis on élague.
FROM node:22.13.1-alpine AS build

WORKDIR /app

# package.json et lock d'abord : tant qu'ils ne changent pas, le npm ci reste en cache
COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src

# On jette les dépendances de développement : elles n'iront pas dans l'image finale
RUN npm prune --omit=dev

# --- étape 2 : image finale ------------------------------------------------
FROM node:22.13.1-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY package.json ./

# l'image node fournit déjà un utilisateur non-root nommé "node"
USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
