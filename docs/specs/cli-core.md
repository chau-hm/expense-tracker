# Spec Slice: Core CLI Commands

## Behavior

The CLI is the first app surface for OpenClaw/Telegram workflows. It must be non-interactive, deterministic, and able to output JSON for agent integration.

This slice implements the first useful command path:

- `event create`
- `expense add`
- `event settle`

## Acceptance Criteria

- CLI can use a caller-provided SQLite database path.
- `event create` creates an event and includes the default self participant when no people are supplied.
- `event create` stores a default currency; when omitted it defaults to `HKD`.
- `event create` should support an ordered supported currency list for receipt/OCR context; when omitted it defaults to the default currency.
- `event create` should support ordered OCR language preferences; when omitted they are inferred from supported currencies.
- `expense add` can add shared, personal, and fronted personal expenses to an event.
- `expense add` defaults omitted `--paid-by` and `--shared-by` to `self`.
- `expense add` defaults omitted `--currency` to the event default currency.
- `expense add` defaults omitted `--category` to `general`; chat/agent callers may choose a more specific category before invoking the CLI.
- `expense add --type personal` defaults omitted `--owner` to `self` and does not affect settlement.
- `expense add --type fronted-personal` requires `--beneficiary` and creates a direct repayment transfer from beneficiary to payer.
- `event settle` calculates settlement from persisted expenses.
- `--format json` returns machine-readable JSON.
- Text output remains concise.
- Missing or invalid required fields fail with a non-zero exit code.

## Deferred

- Natural language parsing
- Receipt ingestion
- Item list/search/edit/delete CLI
- Telegram/OpenClaw slash-command routing

## Future Event OCR Options

This slice currently implements only default currency. Before receipt OCR implementation, event creation should be extended according to `docs/specs/event-ocr-language-preferences.md`:

```sh
expense-tracker event create "Japan Trip" --currency HKD --currencies HKD,JPY
expense-tracker event create "Japan Trip" --currency HKD --currencies HKD,JPY --ocr-languages zh,en,jp
```

`--currency` remains the default expense currency. `--currencies` is the event's supported currency list. `--ocr-languages` is an ordered manual override; otherwise OCR language preferences are inferred from supported currencies.
