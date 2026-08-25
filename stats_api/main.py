import os

import psycopg2
from fastapi import FastAPI, HTTPException

app = FastAPI()

# Ce nom dépend du schéma créé au chapitre 6 : à adapter au nom réel de la
# table des scores avant de lancer le service.
TABLE_NAME = "scores"

# Les deux colonnes lues plus bas : le pseudo du joueur, et son score.
USERNAME_COLUMN = "username"
SCORE_COLUMN = "score"


def get_connection():
    # Ces noms de variables doivent être exactement ceux choisis au chapitre 7
    # pour l'API des scores : les deux services lisent la même configuration,
    # il serait absurde qu'ils l'appellent différemment.
    return psycopg2.connect(
        host=os.environ["POSTGRES_HOST"],
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ["POSTGRES_DB"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
        connect_timeout=3,
    )


@app.get("/health")
def health():
    # Volontairement indépendant de Postgres : un souci base ne doit pas faire
    # passer le conteneur lui-même pour mort aux yeux du HEALTHCHECK.
    return {"status": "ok"}


@app.get("/stats")
def get_stats():
    try:
        conn = get_connection()
    except psycopg2.OperationalError:
        # Jamais de stacktrace brut renvoyé au client : un code d'erreur clair
        # et un message que l'appelant peut logger tel quel.
        raise HTTPException(
            status_code=503,
            detail="stats-api ne parvient pas à joindre la base de données",
        )

    try:
        with conn.cursor() as cursor:
            # TABLE_NAME et les noms de colonnes sont des constantes internes,
            # jamais une entrée utilisateur : l'interpolation ici ne rejoue pas
            # le risque d'injection SQL qu'on aurait avec un paramètre reçu du
            # client.
            cursor.execute(
                f"SELECT COUNT(*), COUNT(DISTINCT {USERNAME_COLUMN}), "
                f"COALESCE(MAX({SCORE_COLUMN}), 0) FROM {TABLE_NAME}"
            )
            # Une table vide renvoie quand même une ligne : les COUNT valent 0,
            # et le COALESCE remplace par un 0 le MAX qui serait sinon NULL.
            parties, joueurs, meilleur_score = cursor.fetchone()
    finally:
        conn.close()

    return {
        "parties_jouees": parties,
        "joueurs": joueurs,
        "meilleur_score": meilleur_score,
    }
