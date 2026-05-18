# Spec Slice: Chat Intake Draft Parser

## Behavior

Chat intake turns natural-language expense text into a structured draft. It must not mutate stored expenses by itself. The agent or caller can show the draft for confirmation, then invoke `expense add` with the generated arguments.

This slice handles simple single-expense text entries such as:

- `/expense 交通費，$5.8`
- `/expense lunch HKD 68`

## Acceptance Criteria

- Natural-language text can be parsed through `chat parse`.
- Parsed drafts include event name, amount in minor units, currency, category, description, payer, shared participants, and equivalent `expense add` arguments.
- Amount parsing avoids floating-point arithmetic.
- `$` defaults to `HKD` unless another currency is explicit.
- Category is inferred for common food and transport terms.
- Missing amount or event returns a clarification result and does not create an expense.
- OpenClaw wrapper fallback treats unknown `/expense ...` text as `chat parse ...`.

## Deferred

- Persistent draft records
- Multi-turn confirmation storage
- Correction flow for latest draft or saved expense
- Multi-item receipt-like natural-language input
- Rich category taxonomy management
