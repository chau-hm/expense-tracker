#!/usr/bin/env bash
set -euo pipefail

DB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/expense-openclaw-preflight.XXXXXX")"
trap 'rm -rf "$DB_DIR"' EXIT
DB_PATH="$DB_DIR/preflight.sqlite"
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

CREATE_OUTPUT="$(expense-openclaw --db "$DB_PATH" /expense event create "Preflight" --people A,B --format json)"
check_contains "$CREATE_OUTPUT" '"name":"Preflight"' "event creation through /expense wrapper"
check_contains "$CREATE_OUTPUT" '"participantIds":["self","A","B"]' "participant defaults through wrapper"

ADD_OUTPUT="$(expense-openclaw --db "$DB_PATH" /expense expense add --event "Preflight" --paid-by A --currency HKD --amount-minor 12345 --shared-by A,B --category smoke --description "preflight" --format json)"
check_contains "$ADD_OUTPUT" '"description":"preflight"' "expense creation through /expense wrapper"

SUMMARY_OUTPUT="$(expense-openclaw --db "$DB_PATH" /expense event summary "Preflight" --format json)"
check_contains "$SUMMARY_OUTPUT" '"event":{"id":"evt_preflight","name":"Preflight"' "event summary through /expense wrapper"
check_contains "$SUMMARY_OUTPUT" '"activeItemCount":1' "summary active item count"

echo "expense OpenClaw preflight passed"
