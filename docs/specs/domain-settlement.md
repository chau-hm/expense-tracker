# Spec Slice: Domain Settlement

## Behavior

The domain layer calculates event settlement by currency. It accepts already-validated expense records and returns participant balances plus suggested transfers.

The domain layer must not depend on LLM/OCR output, CLI parsing, database state, or Telegram/OpenClaw adapters.

## Expense Types

- `shared`: payer paid an amount split among selected participants.
- `personal`: owner/payer expense that affects totals but not settlement.
- `fronted_personal`: payer paid for one beneficiary; beneficiary repays payer in full.

## Acceptance Criteria

- Shared expenses create equal shares in the same currency.
- Multiple currencies are calculated independently.
- Personal expenses do not affect settlement balances.
- Fronted personal expenses create full direct repayment from beneficiary to payer.
- Fronted personal direct repayments are preserved in the suggested transfers and are not silently netted away against unrelated shared expenses.
- Settlement simplification never mixes currencies.
- Category totals include active personal expenses.
- Deleted expenses are ignored by settlement and category totals.
- Equal split remainders are assigned deterministically by participant order.

## First Scenario

Given participants A, B, and C:

- A pays HKD 2400 for flights shared by A, B, and C.
- B pays JPY 9000 for dinner shared by A, B, and C.
- C pays USD 1200 for hotel shared by A, B, and C.
- A pays HKD 500 for A's personal souvenirs.
- C pays JPY 3000 for B's personal souvenirs.

Expected result:

- HKD: B pays A 800; C pays A 800.
- JPY: A pays B 3000; C pays B 3000 for dinner; B pays C 3000 for the fronted souvenir.
- USD: A pays C 400; B pays C 400.
- HKD category totals include `flight: 2400` and `souvenir: 500`.
