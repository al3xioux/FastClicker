# Base légère, équivalent Python de node:alpine niveau philosophie
# "slim" retire les paquets Debian non essentiels, sans les limitations plus poussées d'Alpine
# (Alpine existe aussi pour Python, mais certaines libs C compilent moins bien dessus)
FROM python:3.12-slim

# Ne pas écrire de fichiers .pyc pendant l'exécution : inutile dans un conteneur
# éphémère, ça évite juste des I/O disque pour rien
ENV PYTHONDONTWRITEBYTECODE=1

# Force la sortie standard de Python à ne pas être bufferisée : sans ça, les logs
# de l'appli peuvent rester coincés dans un buffer et ne jamais apparaître dans
# `docker logs` avant un moment (voire jamais si le process crash brutalement)
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Comme pour npm, on copie d'abord uniquement le fichier de dépendances
COPY requirements.txt .

# --no-cache-dir : pip ne garde pas de cache local de téléchargement, inutile dans
# une image qu'on jette et reconstruit à chaque fois, ça fait juste grossir l'image
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Contrairement à l'image node officielle, l'image python:slim ne fournit pas
# d'utilisateur non-root prêt à l'emploi : on le crée nous-même
RUN adduser --disabled-password --gecos "" appuser
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# uvicorn : le serveur ASGI qui fait tourner l'app FastAPI. --host 0.0.0.0 est
# indispensable dans un conteneur : sur 127.0.0.1 (le défaut), l'app ne serait
# joignable que depuis l'intérieur du conteneur lui-même
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
