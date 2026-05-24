# Spec Slice: Receipt OCR Fixtures

## Behavior

Real receipt photos are stored under `tests/fixtures/receipts/` with a manifest of expected merchant, date, totals, and item hints. These fixtures capture OCR and parser regressions that synthetic text cannot expose.

## Acceptance Criteria

- Fixture images use stable filenames and SHA-256 hashes.
- The manifest records manually reviewed expected fields.
- The manifest distinguishes duplicate photos of the same receipt from distinct receipts.
- Tests may use mock OCR for deterministic CLI behavior, while fixture images remain available for local adapter smoke tests.
- Parser tests should prefer deterministic OCR text fixtures, then use the image fixtures for adapter smoke checks.
- Receipt parsing must stay confidence-aware: low-confidence amount lines are ignored and reported via warnings instead of becoming item drafts.
- Service charge, subtotal, payment, discount, and change lines are metadata/payment candidates, not item candidates.

## Current Fixture Set

- `kiss-tea-2026-05-12.jpg`: Chinese receipt with item lines and clear numeric total.
- `hoi-yau-2026-05-18-wide.jpg`: perspective/lighting variant of the same 海悠 receipt.
- `hoi-yau-2026-05-18-close.jpg`: close-up variant of the same 海悠 receipt.
- `anping-grill-2026-05-20.jpg`: receipt with subtotal, service charge, rounded total, and cash/change lines.
