# Run Artifact Contract

## Behavior

- `--artifact-dir <dir>` is a global option for agent callers that need durable provenance.
- Structured JSON mutation success, mutation dry-run, and typed error results write one compact JSON run receipt.
- The command JSON result includes the absolute/selected `artifactPath`.
- Read-only command results do not write run receipts.
- Artifact writing does not touch the expense database or change settlement behavior.

## Receipt Shape

```json
{
  "app": "expense-tracker",
  "version": "0.1.0",
  "createdAt": "2026-06-04T00:00:00.000Z",
  "result": {}
}
```

The stored `result` excludes `artifactPath` so the receipt does not recursively refer to itself.

## Acceptance Criteria

- A successful JSON mutation with `--artifact-dir` writes a receipt and returns its path.
- A JSON dry-run with `--artifact-dir` writes a receipt and returns its path without changing the database.
- `event create --dry-run` with `--artifact-dir` may create the artifact directory and receipt, but must not create the SQLite database.
- A typed JSON error with `--artifact-dir` writes a receipt and returns its path.
- Read-only JSON commands with `--artifact-dir` do not create artifacts.
