#!/bin/sh

echo "==> Running Drizzle schema push (auto-migrate)..."
if bunx drizzle-kit push --force 2>&1; then
  echo "==> Schema push complete"
else
  echo "⚠️  drizzle-kit push failed (non-fatal, app will start anyway)"
fi

echo "==> Starting DroidClaw web..."
exec bun build/index.js
