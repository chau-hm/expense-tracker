#!/usr/bin/env bash
set -euo pipefail

DB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/expense-openclaw-preflight.XXXXXX")"
trap 'rm -rf "$DB_DIR"' EXIT
DB_PATH="$DB_DIR/preflight.sqlite"
DRY_RUN_DB_PATH="$DB_DIR/event-create-dry-run.sqlite"
ARTIFACT_DIR="$DB_DIR/run-artifacts"
OPENCLAW_HOME="${OPENCLAW_HOME:-/Users/openclaw}"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "missing command: $name" >&2
    exit 1
  fi
}

check_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "failed check: $label" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

require_command openclaw
require_command expense-tracker
require_command expense-openclaw

SKILL_INFO="$(HOME="$OPENCLAW_HOME" openclaw skills info expense)"
check_contains "$SKILL_INFO" "Visible to model: yes" "expense skill visible to model"
check_contains "$SKILL_INFO" "Available as command: yes" "expense skill available as command"

GLOBAL_NATIVE_SKILLS="$(HOME="$OPENCLAW_HOME" openclaw config get commands.nativeSkills --json)"
TELEGRAM_NATIVE_SKILLS="$(HOME="$OPENCLAW_HOME" openclaw config get channels.telegram.commands.nativeSkills --json)"
check_contains "$GLOBAL_NATIVE_SKILLS" '"auto"' "global native skill commands"
check_contains "$TELEGRAM_NATIVE_SKILLS" 'true' "telegram native skill commands"

EVENT_DRY_RUN_OUTPUT="$(expense-openclaw --db "$DRY_RUN_DB_PATH" --artifact-dir "$ARTIFACT_DIR" /expense event create "Preflight Preview" --currencies HKD,JPY --people A,B --dry-run --format json)"
check_contains "$EVENT_DRY_RUN_OUTPUT" '"command":"event.create"' "event creation dry-run through /expense wrapper"
check_contains "$EVENT_DRY_RUN_OUTPUT" '"sideEffects":[]' "event creation dry-run has no side effects"
check_contains "$EVENT_DRY_RUN_OUTPUT" '"supportedCurrencies":["HKD","JPY"]' "event creation dry-run previews currencies"
check_contains "$EVENT_DRY_RUN_OUTPUT" '"artifactPath":' "event creation dry-run artifact through /expense wrapper"
test ! -e "$DRY_RUN_DB_PATH"

CREATE_OUTPUT="$(expense-openclaw --db "$DB_PATH" /expense event create "Preflight" --people A,B --format json)"
check_contains "$CREATE_OUTPUT" '"name":"Preflight"' "event creation through /expense wrapper"
check_contains "$CREATE_OUTPUT" '"participantIds":["self","A","B"]' "participant defaults through wrapper"

ADD_OUTPUT="$(expense-openclaw --db "$DB_PATH" /expense expense add --event "Preflight" --paid-by A --currency HKD --amount-minor 12345 --shared-by A,B --category smoke --description "preflight" --format json)"
check_contains "$ADD_OUTPUT" '"description":"preflight"' "expense creation through /expense wrapper"

DRY_RUN_OUTPUT="$(expense-openclaw --db "$DB_PATH" --artifact-dir "$ARTIFACT_DIR" /expense item delete missing --dry-run --format json 2>/dev/null || true)"
check_contains "$DRY_RUN_OUTPUT" '"code":"ITEM_NOT_FOUND"' "typed error through /expense wrapper"
check_contains "$DRY_RUN_OUTPUT" '"artifactPath":' "run artifact path through /expense wrapper"
test "$(find "$ARTIFACT_DIR" -type f -name 'expense-run-*.json' | wc -l | tr -d ' ')" -eq 2

SUMMARY_OUTPUT="$(expense-openclaw --db "$DB_PATH" /expense event summary "Preflight" --format json)"
check_contains "$SUMMARY_OUTPUT" '"event":{"id":"evt_preflight","name":"Preflight"' "event summary through /expense wrapper"
check_contains "$SUMMARY_OUTPUT" '"activeItemCount":1' "summary active item count"

RICH_SUMMARY_OUTPUT="$(expense-openclaw --db "$DB_PATH" /expense event summary "Preflight" --format rich-json)"
check_contains "$RICH_SUMMARY_OUTPUT" '"richMessage":' "rich-json includes rich message"
check_contains "$RICH_SUMMARY_OUTPUT" '"data":{"event":{"id":"evt_preflight","name":"Preflight"' "rich-json preserves summary data"
check_contains "$RICH_SUMMARY_OUTPUT" '"fallbackText":' "rich-json includes fallback text"

RECEIPT_DRAFT_ERROR="$(expense-openclaw --db "$DB_PATH" /expense receipt draft missing 2>&1 >/dev/null || true)"
check_contains "$RECEIPT_DRAFT_ERROR" "Receipt not found: missing" "receipt command routing through /expense wrapper"

echo "expense OpenClaw preflight passed"
