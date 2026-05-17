# Spec Slice: Receipt Storage Skeleton

## Behavior

Receipt ingestion stores receipt metadata and optionally retains the original image locally. This slice does not implement OCR; it prepares the persistence/storage path.

## Acceptance Criteria

- Receipt image files are copied into a local attachments directory by default.
- Receipt records store `imageRef`, `imageSha256`, `imageStored`, and OCR placeholder metadata.
- `--no-store-image` stores metadata without retaining the original image.
- SQLite stores metadata only, not image binary content.
- `receipt image delete <id>` removes the retained local image and keeps the receipt metadata.
- Receipt image deletion does not delete expense items.

## Deferred

- Actual OCR provider calls
- Receipt-to-expense draft parsing
- Full purge command

