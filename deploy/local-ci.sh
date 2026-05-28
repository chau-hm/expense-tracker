#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_OPENCLAW_PREFLIGHT="false"
INSTALL_SKILL="false"

usage() {
  cat <<'USAGE'
Usage:
  deploy/local-ci.sh [--install-skill] [--openclaw-preflight]

Runs the local CI gate without touching the production expense database.

Options:
  --install-skill        Copy skills/expense into the OpenClaw workspace.
  --openclaw-preflight  Run scripts/openclaw-expense-preflight.sh after build/test.
                         This implies --install-skill.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-skill)
      INSTALL_SKILL="true"
      shift
      ;;
    --openclaw-preflight)
      INSTALL_SKILL="true"
      RUN_OPENCLAW_PREFLIGHT="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

cd "$REPO_ROOT"

bash -n deploy/install-openclaw-skill.sh
bash -n deploy/local-ci.sh
bash -n scripts/openclaw-expense-preflight.sh
test -f skills/expense/SKILL.md
test -x skills/expense/scripts/ingest-receipt-image.sh

npm ci
npm run build
npm test

if [[ "$INSTALL_SKILL" == "true" ]]; then
  deploy/install-openclaw-skill.sh
fi

if [[ "$RUN_OPENCLAW_PREFLIGHT" == "true" ]]; then
  scripts/openclaw-expense-preflight.sh
fi

echo "local CI passed"
