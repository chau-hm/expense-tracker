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
- Multi-item receipt-like natural-language input
- Rich category taxonomy management

# Spec Slice: Chat Correction Flow

## Behavior

Chat correction turns short natural-language fixes into deterministic draft or item patches. It must only mutate saved expenses when the target resolves to one exact item ID or one exact search result. Ambiguous saved-item targets must return candidates and leave stored data unchanged.

This slice handles simple corrections such as:

- `/expense chat correct 改做 $6 --draft-json '{...}'`
- `/expense chat correct 改做 $6 --event "Daily Expenses" --item-id exp_...`
- `/expense chat correct 改做 transport --event Trip --text tickets`

## Acceptance Criteria

- Corrections can update amount, explicit currency, and inferred category.
- Draft correction is non-mutating and returns a revised draft plus equivalent `expense add` arguments.
- Saved-item correction updates the item only when `--item-id` or `--text` resolves to a single active item.
- Search-target correction returns candidates and does not mutate when more than one item matches.
- Missing correction content, event, or target returns clarification/error output without mutation.

# Spec Slice: Chat Item List/Search Intent

## Behavior

Chat item intent handling turns short list/search requests into deterministic item list or item search calls. It must not mutate stored expenses. Unknown natural-language expense entries should continue to use the draft parser.

This slice handles requests such as:

- `/expense list`
- `/expense list taxi`
- `/expense search food`
- `/expense 搵 taxi`

## Acceptance Criteria

- List/search keywords route through `chat items` instead of expense draft parsing.
- Empty list intent returns active items, optionally scoped by event.
- Search intent can pass text queries to item search.
- Food and transport terms can infer category filters.
- The OpenClaw wrapper fallback treats unknown `/expense list ...` or `/expense search ...` text as item intent.
- Item intent output is read-only and never mutates expenses.

# Spec Slice: Chat Item Mutation Intent

## Behavior

Chat item mutation intent turns short edit/delete/restore requests into deterministic item operations. Mutating operations must resolve a single target before changing storage. Ambiguous targets must return candidates and leave stored data unchanged.

This slice handles requests such as:

- `/expense delete taxi`
- `/expense restore taxi`
- `/expense edit taxi 改做 $6`
- `/expense edit exp_... category:transport`

## Acceptance Criteria

- Edit/delete/restore keywords route through `chat item`.
- Exact item IDs can be targeted directly.
- Text targets are resolved through item search scoped to the event when provided.
- Delete searches active items; restore searches deleted items; edit searches active items.
- Ambiguous or missing targets return candidates/no-match output and do not mutate expenses.
- Edit requires a supported correction patch before mutation.

# Spec Slice: Chat Event Summary And Settlement Response

## Behavior

Chat event intent turns short read-only event requests into deterministic summary or settlement responses. It must not mutate stored expenses and must not guess an event when no event context/name is available.

This slice handles requests such as:

- `/expense summary Daily Expenses`
- `/expense settle Trip`
- `/expense settlement Japan Trip`

## Acceptance Criteria

- Summary and settlement keywords route through `chat event`.
- Event name can be supplied in the chat text or by explicit event context.
- Missing event returns clarification without mutation.
- Summary output includes event status, participants, active item count, totals, category totals, and settlement.
- Settlement output groups transfers by currency and reports when no settlement is needed.
- The OpenClaw wrapper fallback treats unknown `/expense summary ...` and `/expense settle ...` text as event intent.
