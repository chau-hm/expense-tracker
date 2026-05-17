# Spec Slice: Persistence Schema

## Behavior

The app stores events, participants, expenses, and receipt metadata in SQLite. Domain calculations remain pure; persistence converts database records into validated domain records.

This slice defines the schema and a small in-memory-independent repository contract using SQLite.

## Acceptance Criteria

- Runtime data defaults to `~/.expense-tracker/expense-tracker.sqlite`.
- Schema supports events with a default self participant.
- Schema supports active/deleted expenses with timestamps.
- Schema supports shared, personal, and fronted personal expense types.
- Shared expense participants are stored separately from expense rows.
- Receipt images are stored as references/metadata, not binary blobs.
- Repository can create an event and include the default participant when no participants are provided.
- Repository can insert expenses and read them back as domain `Expense` records.
- Repository can update item status/fields through item domain logic later.

## Tables

- `events`
- `participants`
- `event_participants`
- `expenses`
- `expense_participants`
- `receipts`

