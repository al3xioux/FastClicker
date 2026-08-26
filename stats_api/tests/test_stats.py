import psycopg2
import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


class FakeCursor:
    """Curseur minimal : retient la requête et rend une ligne fixée."""

    def __init__(self, row):
        self.row = row
        self.executed = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, query):
        self.executed = query

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, row):
        self.cursor_object = FakeCursor(row)
        self.closed = False

    def cursor(self):
        return self.cursor_object

    def close(self):
        self.closed = True


def test_health_ne_depend_pas_de_la_base():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_stats_renvoie_les_trois_compteurs(monkeypatch):
    connection = FakeConnection((12, 4, 37))
    monkeypatch.setattr(main, "get_connection", lambda: connection)

    response = client.get("/stats")

    assert response.status_code == 200
    assert response.json() == {
        "parties_jouees": 12,
        "joueurs": 4,
        "meilleur_score": 37,
    }
    assert connection.closed is True


def test_stats_sur_une_base_vide(monkeypatch):
    connection = FakeConnection((0, 0, 0))
    monkeypatch.setattr(main, "get_connection", lambda: connection)

    response = client.get("/stats")

    assert response.status_code == 200
    assert response.json()["meilleur_score"] == 0


def test_stats_lit_la_table_des_scores(monkeypatch):
    connection = FakeConnection((0, 0, 0))
    monkeypatch.setattr(main, "get_connection", lambda: connection)

    client.get("/stats")

    query = connection.cursor_object.executed
    assert "FROM scores" in query
    assert "COUNT(DISTINCT username)" in query
    assert "COALESCE(MAX(score), 0)" in query


def test_stats_repond_503_quand_la_base_est_injoignable(monkeypatch):
    def refuse():
        raise psycopg2.OperationalError("connexion refusée")

    monkeypatch.setattr(main, "get_connection", refuse)

    response = client.get("/stats")

    assert response.status_code == 503
    assert "base de données" in response.json()["detail"]


def test_la_connexion_est_fermee_meme_si_la_requete_echoue(monkeypatch):
    class BrokenConnection(FakeConnection):
        def cursor(self):
            raise psycopg2.ProgrammingError("table absente")

    connection = BrokenConnection((0, 0, 0))
    monkeypatch.setattr(main, "get_connection", lambda: connection)

    with pytest.raises(psycopg2.ProgrammingError):
        client.get("/stats")

    assert connection.closed is True
