---
name: expense
description: Run the local agent-native expense tracker from OpenClaw or Telegram slash commands. Use for /expense requests, event expense recording, item list/search/edit/delete/restore, receipt OCR ingest/draft/confirm, summaries, exports, and per-currency settlement.
---

# Expense Tracker

Use the local CLI wrapper:

```bash
/opt/homebrew/bin/expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite ...
```

For receipt images from Telegram/OpenClaw media, use the helper:

```bash
/Users/openclaw/.openclaw/workspace/skills/expense/scripts/ingest-receipt-image.sh --event "Japan Trip" media://inbound/<file>.jpg
```

## Workflow

1. If the user supplied exact `/expense` arguments, pass them to `expense-openclaw`.
2. If the user asks for an event summary, settlement, export, item list, or item search in natural language, translate only when the target event/search terms are clear.
3. Before edit/delete/restore, list or search candidate items unless the user gives an exact stable item ID.
4. Do not save ambiguous money movement. Ask one concise clarification question if payer, amount, currency, participants, or event is unclear.
5. Receipt OCR is available through `receipt ingest`, followed by `receipt draft` and `receipt confirm`. If the user sends a receipt image, resolve the local media path or pass `media://inbound/<file>` to `scripts/ingest-receipt-image.sh`, ingest it into the target event, show the draft, then ask for confirmation or edited item overrides before saving expenses.
6. `capabilities --format json` is available for machine-readable discovery. JSON errors are typed, and common mutation JSON includes `scope`, `sideEffects`, and `warnings`.
7. Use `--dry-run --format json` before risky money/item mutations when the user is asking for a correction, target is not freshly verified, or settlement impact matters. Dry-run is available for `expense add`, `receipt confirm`, and `item edit/delete/restore`; it writes nothing and returns `plannedOperations`, `sideEffects:[]`, and settlement impact when applicable.

## Common Commands

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite event create "Japan Trip" --people A,B,C
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite capabilities --format json
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite expense add --event "Japan Trip" --paid-by A --currency HKD --amount-minor 240000 --shared-by A,B,C --category flight --description "tickets"
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite expense add --event "Japan Trip" --paid-by A --currency HKD --amount-minor 240000 --shared-by A,B,C --dry-run --format json
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite item search --event "Japan Trip" --text hotel
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite item edit exp_id --amount-minor 12300
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite item delete exp_id --dry-run --format json
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite item delete exp_id
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite receipt ingest /path/to/receipt.jpg --event "Japan Trip"
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite receipt draft rcp_id
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite receipt confirm rcp_id --items "ramen=90.00;tea=12.00" --paid-by A --shared-by A,B,C --dry-run --format json
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite receipt confirm rcp_id --items "ramen=90.00;tea=12.00" --paid-by A --shared-by A,B,C
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite receipt confirm rcp_id --use-total --description "dinner receipt" --paid-by A --shared-by A,B,C
/Users/openclaw/.openclaw/workspace/skills/expense/scripts/ingest-receipt-image.sh --event "Japan Trip" media://inbound/receipt.jpg
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite event summary "Japan Trip"
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite event settle "Japan Trip"
```

Reply in Traditional Chinese/Cantonese by default. Keep command output concise; include the important saved IDs because future edits/deletes need them.
