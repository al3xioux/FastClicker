# Image de base épinglée sur une version précise (jamais latest).
# Variante "alpine-slim" : même nginx, sans les modules njs/perl ni les scripts
# d'entrypoint dont ce site statique ne se sert pas.
#
# Relevée de 1.27.4 à 1.31.4 au jour 3 : Trivy remontait 17 CVE HIGH/CRITICAL sur
# l'ancienne base, dont deux CRITICAL sur OpenSSL. Épingler protège de la dérive,
# mais une version épinglée vieillit — c'est au scanner de le rappeler.
FROM nginx:1.31.4-alpine-slim

# Les correctifs de sécurité publiés depuis la construction de l'image de base
# n'y sont pas encore. Sans cette ligne, il reste 2 CVE HIGH sur OpenSSL alors
# qu'un correctif existe déjà côté Alpine.
#
# Coût mesuré : 21,5 -> 30,2 Mo. Mettre à jour un fichier dans une nouvelle
# couche duplique celui de la couche de base, d'où les +9 Mo. Cibler les seuls
# paquets fautifs (libcrypto3 libssl3) n'en économise que 0,7 : arbitrage assumé
# en faveur de zéro CVE HIGH/CRITICAL, plutôt que d'une liste à maintenir.
RUN apk upgrade --no-cache

# Configuration nginx adaptée à une exécution non-root (port 8080, temp dans /tmp)
COPY docker/nginx.conf /etc/nginx/nginx.conf

# Le site statique, et rien d'autre
COPY frontend/ /usr/share/nginx/html/

# Ne garder que notre site (la page d'erreur par défaut de l'image n'est pas utilisée),
# et donner à l'utilisateur nginx la lecture du site et l'écriture de son cache
RUN rm -f /usr/share/nginx/html/50x.html \
    && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
