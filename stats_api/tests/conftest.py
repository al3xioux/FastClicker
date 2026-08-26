import os
import sys

# main.py lit ces variables à l'import de la connexion : on les fournit avant
# tout import. La base n'est jamais contactée, get_connection est remplacée.
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("POSTGRES_DB", "test")
os.environ.setdefault("POSTGRES_USER", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
