"""Frontend guard: every ES module parses. Node's --check catches a syntax
slip across the frontend before it ships to the wall, where there's no console
to notice it. It checks syntax only, not behavior."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node") or "/opt/node22/bin/node"


def test_js_modules_parse():
    modules = sorted((ROOT / "frontend" / "js").glob("*.js"))
    assert modules, "no frontend modules found"
    for module in modules:
        result = subprocess.run([NODE, "--check", str(module)],
                                capture_output=True, text=True)
        assert result.returncode == 0, f"{module.name} failed to parse:\n{result.stderr}"
