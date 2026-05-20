# Spec Slice: Event OCR Language Preferences

## Behavior

Receipt OCR should use an event-level ordered language preference list. This is needed because the local Apple Vision OCR adapter requires languages to be supplied up front, and a travel/event expense set often has predictable receipt languages based on the currencies used in that event.

Events should support both:

- a default currency, used when an expense omits currency;
- a supported currency list, used to infer OCR language preferences.

If the user explicitly supplies OCR languages when creating or editing an event, those languages take precedence. Otherwise, language preferences are inferred from the event's supported currencies.

## Language Tokens

The product-level language preference tokens are:

- `zh`
- `en`
- `jp`

Provider adapters may map these tokens to provider-specific identifiers. For example, an Apple Vision adapter can map `jp` to the correct Japanese language identifier internally. Storage and CLI output should keep the product-level tokens stable.

## Currency Inference

Initial inference map:

- `HKD` -> `zh`, `en`
- `JPY` -> `jp`
- `USD` -> `en`
- `CNY` -> `zh`, `en`
- `TWD` -> `zh`, `en`

When an event has multiple currencies, concatenate the mapped language lists in currency order and deduplicate while preserving first appearance.

Examples:

- currencies `HKD` -> OCR languages `zh,en`
- currencies `JPY` -> OCR languages `jp`
- currencies `HKD,JPY` -> OCR languages `zh,en,jp`
- currencies `JPY,HKD` -> OCR languages `jp,zh,en`

## CLI Shape

Backward-compatible event creation remains valid:

```sh
expense-tracker event create "Daily Expenses" --currency HKD
```

New event creation should support multiple currencies and optional OCR language override:

```sh
expense-tracker event create "Japan Trip" --currency HKD --currencies HKD,JPY
expense-tracker event create "Japan Trip" --currency HKD --currencies HKD,JPY --ocr-languages zh,en,jp
```

Rules:

- `--currency` remains the default currency.
- `--currencies` defines supported currencies for the event.
- If `--currencies` is omitted, supported currencies default to `[--currency]`.
- If `--currency` is omitted, default currency remains `HKD`.
- If `--currencies` is supplied but does not include the default currency, the CLI should add the default currency first or reject with a clear validation error. Recommended MVP behavior: add the default currency first to keep chat entry forgiving.
- `--ocr-languages` is an ordered comma-separated override.
- If `--ocr-languages` is omitted, infer from supported currencies.

## Persistence Shape

Events should persist:

- `default_currency`: existing single default currency.
- `supported_currencies`: ordered JSON array or equivalent normalized relation.
- `ocr_language_preferences`: ordered JSON array or equivalent normalized relation.
- `ocr_language_source`: `inferred` or `manual`.

The repository should expose these fields in event records so receipt OCR can use them without re-inferring from raw CLI arguments.

## Receipt OCR Usage

Receipt OCR should read the event's `ocr_language_preferences` when an event is known.

If no event is known during receipt intake:

- Do not guess languages from the image silently.
- Use a conservative default of `zh,en` for local Hong Kong use, or ask for event/context when the result affects save quality.
- When the receipt is later attached to an event, the app may rerun OCR with the event's language preferences if the prior extraction is missing or low-confidence.

## Acceptance Criteria

- Event specs document default currency, supported currencies, OCR language preferences, and language source.
- Language preferences can be inferred from one or more event currencies.
- Manual OCR language preferences override currency inference.
- Inference is ordered and deterministic.
- Receipt OCR provider calls receive event language preferences instead of hard-coded language lists.
- Apple Vision-specific language identifier mapping remains inside the OCR adapter, not in domain settlement logic.

## Deferred

- Per-receipt language override.
- Confidence-based automatic OCR rerun.
- User-maintained currency-to-language mapping.
- UI for editing event OCR preferences.
