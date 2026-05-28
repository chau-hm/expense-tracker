#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$REPO_ROOT/skills/expense"
TARGET_DIR="${OPENCLAW_EXPENSE_SKILL_DIR:-/Users/openclaw/.openclaw/workspace/skills/expense}"
BACKUP_ROOT="${OPENCLAW_SKILL_BACKUP_DIR:-/Users/openclaw/.openclaw/workspace/backups/skills}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/expense-skill-install.XXXXXX")"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ ! -f "$SOURCE_DIR/SKILL.md" ]]; then
  echo "missing source skill: $SOURCE_DIR/SKILL.md" >&2
  exit 1
fi

if [[ ! -x "$SOURCE_DIR/scripts/ingest-receipt-image.sh" ]]; then
  echo "missing executable helper: $SOURCE_DIR/scripts/ingest-receipt-image.sh" >&2
  exit 1
fi

INSTALL_DIR="$TMP_DIR/expense"
mkdir -p "$INSTALL_DIR"
cp -R "$SOURCE_DIR/." "$INSTALL_DIR/"

mkdir -p "$(dirname "$TARGET_DIR")" "$BACKUP_ROOT"

if [[ -e "$TARGET_DIR" || -L "$TARGET_DIR" ]]; then
  BACKUP_DIR="$BACKUP_ROOT/expense-$STAMP"
  mv "$TARGET_DIR" "$BACKUP_DIR"
  echo "backed up existing skill to $BACKUP_DIR"
fi

mv "$INSTALL_DIR" "$TARGET_DIR"
chmod +x "$TARGET_DIR/scripts/ingest-receipt-image.sh"

echo "installed expense skill to $TARGET_DIR"
