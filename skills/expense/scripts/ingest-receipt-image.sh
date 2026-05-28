#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${EXPENSE_DB:-/Users/openclaw/.expense-tracker/expense-tracker.sqlite}"
ATTACHMENTS_DIR="${EXPENSE_ATTACHMENTS_DIR:-/Users/openclaw/.expense-tracker/attachments}"
INBOUND_DIR="${OPENCLAW_INBOUND_MEDIA_DIR:-/Users/openclaw/.openclaw/media/inbound}"
FORMAT="text"
EVENT=""

usage() {
  cat <<'USAGE'
Usage:
  ingest-receipt-image.sh --event "Event Name" [--db PATH] [--attachments-dir PATH] [--format text|json] <image-path-or-media-uri>

Accepts local paths and OpenClaw Telegram media refs like:
  media://inbound/8d0f2e48-30db-441f-bec2-7a6fb706c036.jpg
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --event)
      EVENT="${2:-}"
      shift 2
      ;;
    --db)
      DB_PATH="${2:-}"
      shift 2
      ;;
    --attachments-dir)
      ATTACHMENTS_DIR="${2:-}"
      shift 2
      ;;
    --format)
      FORMAT="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "${IMAGE_REF:-}" ]]; then
        echo "Unexpected extra argument: $1" >&2
        usage >&2
        exit 1
      fi
      IMAGE_REF="$1"
      shift
      ;;
  esac
done

if [[ -z "${EVENT}" || -z "${IMAGE_REF:-}" ]]; then
  usage >&2
  exit 1
fi

case "$IMAGE_REF" in
  media://inbound/*)
    IMAGE_PATH="$INBOUND_DIR/${IMAGE_REF#media://inbound/}"
    ;;
  media://*)
    echo "Unsupported media URI: $IMAGE_REF" >&2
    exit 1
    ;;
  *)
    IMAGE_PATH="$IMAGE_REF"
    ;;
esac

if [[ ! -f "$IMAGE_PATH" ]]; then
  echo "Receipt image not found: $IMAGE_PATH" >&2
  exit 1
fi

INGEST_JSON="$(
  expense-openclaw \
    --db "$DB_PATH" \
    receipt ingest "$IMAGE_PATH" \
    --event "$EVENT" \
    --attachments-dir "$ATTACHMENTS_DIR" \
    --format json
)"

RECEIPT_ID="$(
  printf '%s' "$INGEST_JSON" | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => console.log(JSON.parse(s).receipt.id));'
)"

if [[ "$FORMAT" == "json" ]]; then
  DRAFT_JSON="$(expense-openclaw --db "$DB_PATH" receipt draft "$RECEIPT_ID" --format json)"
  node -e 'const ingest = JSON.parse(process.argv[1]); const draft = JSON.parse(process.argv[2]); console.log(JSON.stringify({ kind: "receipt_image_ingested", ingest, draft }));' "$INGEST_JSON" "$DRAFT_JSON"
  exit 0
fi

printf '%s\n\n' "$INGEST_JSON" | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const r = JSON.parse(s); console.log(`Ingested receipt ${r.receipt.id}`); console.log(`Event: ${r.event}`); console.log(`Total: ${r.extracted.total ?? "n/a"} ${r.extracted.currency}`); console.log(`Items: ${r.extracted.items.length}`); if (r.extracted.warnings.length) console.log(`Warnings: ${r.extracted.warnings.join(", ")}`); });'
expense-openclaw --db "$DB_PATH" receipt draft "$RECEIPT_ID"
