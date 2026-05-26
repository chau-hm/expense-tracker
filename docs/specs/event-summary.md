# Spec Slice: Event Summary

## Behavior

`event summary` shows an event-level overview without needing receipt/OCR support. It uses persisted expenses and pure domain settlement output.

## Acceptance Criteria

- Summary includes event id, name, status, and participants.
- Summary participant IDs include people introduced later by linked expenses.
- Summary includes active item count.
- Summary excludes deleted items from active totals.
- Summary includes totals by currency.
- Summary includes category totals grouped by currency.
- Summary includes settlement transfers grouped by currency.
- JSON output serializes bigint values as strings.
- Missing events return non-zero.
