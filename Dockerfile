# Image de base épinglée sur une version précise (jamais latest)
FROM nginx:1.27.4-alpine

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
