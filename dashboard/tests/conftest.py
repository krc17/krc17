"""Shared fixtures for the smoke tests.

The whole point of these tests is to be a fast, offline regression net: they
drive the real FastAPI app through Starlette's TestClient (no network, no live
server, no browser) against a throwaway copy of the shipped sample data. If a
change breaks an endpoint, the edit-key gate, upload, or YAML write-back, these
fail in seconds instead of on the wall.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent      # dashboard/
EDIT_KEY = "test-edit-key"                          # what the LAN must present to write

# Import the backend as a package when pytest runs from anywhere.
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="session")
def edit_key() -> str:
    return EDIT_KEY


@pytest.fixture(scope="session")
def client(tmp_path_factory):
    """A TestClient bound to a temp data dir seeded from samples/.

    Env is set before importing the app because it reads settings at import
    time. Calendar/news feeds are blanked so nothing reaches for the network.
    """
    data = tmp_path_factory.mktemp("data")
    # samples/ ships exactly the four folders the app expects, same names.
    shutil.copytree(ROOT / "samples", data, dirs_exist_ok=True)

    os.environ["DASHBOARD_DATA_DIR"] = str(data)
    os.environ["EDIT_KEY"] = EDIT_KEY
    os.environ["NEWS_FEEDS"] = ""
    os.environ["CALENDAR_ICS_URLS"] = ""
    os.environ["WEATHER_POINT"] = ""       # keep weather/traffic off the network
    os.environ["TRAFFIC_API_KEY"] = ""     # in tests; parsing is covered by units

    from fastapi.testclient import TestClient
    import backend.app as appmod

    # The context manager runs the app's lifespan (watcher + pollers) so the
    # test exercises startup/shutdown too.
    with TestClient(appmod.app) as test_client:
        yield test_client
