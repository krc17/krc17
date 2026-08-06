#!/bin/bash
# Install the dashboard's dependencies so tests and the app run in a Claude Code
# on the web session, where the container starts bare. Safe to run repeatedly.
set -euo pipefail

# Local machines already have their environment; this is only for the web.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}/dashboard"

# App runtime + test-only deps (pytest). requirements.txt drives the app;
# requirements-dev.txt adds the test runner.
pip install --quiet --disable-pip-version-check -r requirements.txt -r requirements-dev.txt

# Node ships preinstalled; put it on PATH so the frontend parse test finds it.
if [ -x /opt/node22/bin/node ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="/opt/node22/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

echo "dashboard dependencies ready"
