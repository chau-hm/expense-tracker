# AGENTS.md - Expense Tracker

## Project Goal

Build an agent-native expense tracker where chat is the primary UI and the MVP runs as a CLI-first tool inside OpenClaw or a similar agent environment. The distinctive feature is event settlement across multiple participants and multiple currencies, with no FX conversion in v1.

## Product Rules

- Treat each currency independently for settlement.
- Default participant is the user themself. Events created without explicit participants should include that default participant only; add other event participants as needed.
- Support three expense types:
  - `shared`: split among selected participants.
  - `personal`: recorded for totals, not shared.
  - `fronted_personal`: payer fronts money for one beneficiary, beneficiary repays payer in full.
- Keep receipt OCR raw output separate from the final interpreted expense records.
- Store receipt images locally by default as file attachments, with SQLite holding `image_ref`/metadata only. Support `--no-store-image` and separate receipt image deletion.
- Support item-level edit/delete/restore. Deleted items are excluded from settlement by default but should be soft-deleted for audit/recovery in MVP.
- Implement item list/search as a first-class capability. Chat-driven edit/delete/restore must list or search candidates first when the target is not an exact stable item ID.
- Ask for clarification only when ambiguity affects saved money movement.
- Use deterministic settlement logic; do not let LLM output directly become final balances without domain validation.

## Engineering Rules

- This repo follows SDD + TDD. Write or update the relevant spec slice before implementation, then write tests before or alongside code.
- Do not start coding from a loose prompt. Convert the request into acceptance criteria first.
- If tests cannot be written yet, stop and explain the missing design decision.
- Keep money arithmetic decimal-safe. Do not use floating point for stored money values.
- Put settlement calculation in a pure domain module with unit tests.
- Keep chat/agent parsing separate from domain calculation.
- Save structured draft records before confirmation if the UX needs review/edit.
- Give saved expense items stable IDs so CLI/chat list/search/edit/delete commands can target them.
- Do not mutate data for ambiguous edit/delete/restore requests. Return candidate items and require selection instead.
- Do not upload receipt images to remote OCR providers unless the configured provider requires it and the app/user has allowed that mode.
- Prefer small, testable functions over hidden prompt-only behavior.

## SDD + TDD Workflow

Every implementation slice must follow:

1. Spec: behavior, data impact, edge cases, and acceptance criteria.
2. Test: failing tests that encode the acceptance criteria.
3. Implement: smallest code change that passes the tests.
4. Refactor: only after tests pass.
5. Document: update TODO/spec notes when behavior changes.

Definition of done:

- Spec slice exists.
- Tests cover the slice.
- Tests pass locally.
- Settlement behavior is deterministic and not dependent on LLM output.

## Suggested First Milestone

Implement the domain core first using SDD + TDD. Do not build a standalone web UI in the first milestone:

1. Event, person, expense, and settlement types.
2. Per-currency ledger calculation.
3. Shared equal split.
4. Personal expense exclusion.
5. Fronted personal direct repayment.
6. Item list/search and target selection.
7. Item edit/delete recalculation behavior.
8. Unit tests matching the trip example in the PRD.

Docs live in:

- `/Users/openclaw/Desktop/VirtualBuddyShared/Vault/side projects/expense tracker/PRD.md`
- `/Users/openclaw/Desktop/VirtualBuddyShared/Vault/side projects/expense tracker/TODO.md`
- `/Users/openclaw/Desktop/VirtualBuddyShared/Vault/side projects/expense tracker/SDD_TDD_Workflow.md`
- `/Users/openclaw/Desktop/VirtualBuddyShared/Vault/side projects/expense tracker/Architecture.md`
- `/Users/openclaw/Desktop/VirtualBuddyShared/Vault/side projects/expense tracker/Decisions.md`
