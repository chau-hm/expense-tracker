# Spec Slice: Persistence Schema

## Behavior

The app stores events, participants, expenses, and receipt metadata in SQLite. Domain calculations remain pure; persistence converts database records into validated domain records.

This slice defines the schema and a small in-memory-independent repository contract using SQLite.

## Acceptance Criteria

- Runtime data defaults to `~/.expense-tracker/expense-tracker.sqlite`.
- Schema supports events with a default self participant.
- Schema should support event-level supported currencies and OCR language preferences before receipt OCR is implemented.
- Schema supports active/deleted expenses with timestamps.
- Schema supports shared, personal, and fronted personal expense types.
- Shared expense participants are stored separately from expense rows.
- Receipt images are stored as references/metadata, not binary blobs.
- Repository can create an event and include the default participant when no participants are provided.
- Repository can insert expenses and read them back as domain `Expense` records.
- Repository adds newly introduced expense participants to the linked event membership so event review output stays complete.
- Repository can update item status/fields through item domain logic later.

## Tables

- `events`
- `participants`
- `event_participants`
- `expenses`
- `expense_participants`
- `receipts`

## Event OCR Context Fields

Before implementing receipt OCR, extend event persistence to include:

- `supported_currencies`: ordered list, defaulting to `[default_currency]`.
- `ocr_language_preferences`: ordered list of product-level language tokens such as `zh,en,jp`.
- `ocr_language_source`: `inferred` or `manual`.

These fields belong on the event because receipt language is usually event-specific. For example, a Hong Kong/Japan trip using `HKD,JPY` should infer `zh,en,jp` once when the event is created, then reuse that preference for every receipt OCR call in that event.
