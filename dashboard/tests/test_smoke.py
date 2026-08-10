"""Backend smoke tests: the endpoints answer, the edit-key gate holds, uploads
land, and a board move is written back to the YAML and read back changed."""
from __future__ import annotations

READ_ENDPOINTS = [
    "/api/config", "/api/takeaways", "/api/updates", "/api/projects",
    "/api/coverage", "/api/agenda", "/api/news", "/api/weather", "/api/traffic",
    "/api/routes", "/api/now", "/api/state", "/api/health",
]


def test_read_endpoints_answer(client):
    for path in READ_ENDPOINTS:
        response = client.get(path)
        assert response.status_code == 200, f"{path} -> {response.status_code}"


def test_pages_render(client):
    assert client.get("/").status_code == 200          # the wall
    assert client.get("/drop").status_code == 200      # the post-a-file page


def test_config_exposes_page_cycle(client):
    config = client.get("/api/config").json()
    assert isinstance(config.get("page_cycle_seconds"), int)  # drives auto-cycling


def test_edit_gate_and_writeback(client, edit_key):
    """A LAN client (TestClient is non-loopback) is read-only without the key,
    rejected with a wrong key, and with the right key its move persists."""
    board = client.get("/api/projects").json()
    card = board["cards"][0]
    card_id = card["id"]
    target = "Done" if card["column"] != "Done" else "To Do"

    # No key and wrong key are both refused.
    assert client.post(f"/api/projects/{card_id}/status",
                       json={"status": target}).status_code == 403
    assert client.post(f"/api/projects/{card_id}/status", json={"status": target},
                       headers={"X-Edit-Key": "wrong"}).status_code == 403

    # Correct key writes the change back to the YAML on disk.
    ok = client.post(f"/api/projects/{card_id}/status", json={"status": target},
                     headers={"X-Edit-Key": edit_key})
    assert ok.status_code == 200, ok.text

    # A fresh read re-parses the file, so this proves the write reached disk.
    moved = next(c for c in client.get("/api/projects").json()["cards"] if c["id"] == card_id)
    assert moved["column"] == target


def test_create_project(client, edit_key):
    """Creating a project is edit-key gated, needs a title, and the new card
    lands in the chosen column carrying its owner."""
    # Gated like every other write.
    assert client.post("/api/projects",
                       json={"title": "X", "status": "To Do"}).status_code == 403
    # A blank title is refused.
    assert client.post("/api/projects", json={"title": "  ", "status": "To Do"},
                       headers={"X-Edit-Key": edit_key}).status_code == 400

    created = client.post("/api/projects",
                          json={"title": "Fabrication rig bring-up", "owner": "KC",
                                "status": "Selected"},
                          headers={"X-Edit-Key": edit_key})
    assert created.status_code == 200 and created.json()["ok"], created.text
    card_id = created.json()["card_id"]

    card = next((c for c in client.get("/api/projects").json()["cards"]
                 if c["id"] == card_id), None)
    assert card is not None, "new card not on the board"
    assert card["column"] == "Selected"
    assert card["owner"] == "KC"


def test_upload_lands_on_the_wall(client):
    response = client.post(
        "/api/upload",
        data={"destination": "updates"},
        files={"file": ("Smoke test note.md", b"# Smoke\n\n## This week\n- hello\n")},
    )
    assert response.status_code == 200 and response.json()["ok"], response.text
    docs = client.get("/api/updates").json()["documents"]
    assert any(d["filename"].startswith("Smoke test note") for d in docs)
