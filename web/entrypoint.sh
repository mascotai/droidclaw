#!/bin/sh

echo "==> Running Drizzle schema push (auto-migrate)..."
bunx drizzle-kit push --force 2>&1 | while IFS= read -r line; do echo "  [drizzle] $line"; done
PUSH_EXIT=$?
if [ "$PUSH_EXIT" -eq 0 ]; then
  echo "==> Schema push complete"
else
  echo "⚠️  drizzle-kit push exited with code $PUSH_EXIT (non-fatal, app will start anyway)"
fi

echo "==> Starting DroidClaw web..."
exec bun build/index.js
