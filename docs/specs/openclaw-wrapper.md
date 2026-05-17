# OpenClaw Wrapper

## Behavior

The OpenClaw wrapper provides a deterministic bridge from chat slash-command text to the existing `expense-tracker` CLI.

- Accept command text from an OpenClaw skill or Telegram slash command.
- Strip a leading `/expense` or `expense` command token when present.
- Forward the remaining arguments to the core CLI without changing domain behavior.
- Return the same exit code semantics as the core CLI.
- Show core CLI help when no subcommand is provided.
- Keep the wrapper thin; chat interpretation and ambiguous money movement must remain outside the wrapper until a later parser/confirmation slice exists.

## Data Impact

- The wrapper writes only through existing core CLI commands.
- The wrapper does not create a separate database, table, or receipt storage path.
- The wrapper respects the same `--db` option and default database path as `expense-tracker`.

## Acceptance Criteria

- `/expense event create "Japan Trip" --people A,B --format json` creates the same event as `expense-tracker event create ...`.
- `expense item list --format json` lists items through the core CLI.
- Empty input returns help text with exit code `0`.
- Invalid input returns a non-zero exit code and the core CLI error text.
