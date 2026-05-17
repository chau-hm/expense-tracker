import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/adapters/sqlite/database.js";
import {
  deleteReceiptImage,
  insertReceipt,
  getReceipt,
} from "../../src/adapters/sqlite/repository.js";
import {
  deleteStoredReceiptImage,
  storeReceiptImage,
} from "../../src/adapters/storage/attachments.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("receipt storage skeleton", () => {
  it("stores receipt images locally by default and records metadata", () => {
    const dir = tempDir();
    const sourcePath = join(dir, "receipt.jpg");
    const attachmentsDir = join(dir, "attachments");
    writeFileSync(sourcePath, "fake image bytes");
    const db = createInMemoryDatabase();

    const stored = storeReceiptImage({
      receiptId: "rcp_1",
      sourcePath,
      attachmentsDir,
      storeImage: true,
    });
    insertReceipt(db, {
      id: "rcp_1",
      ...stored,
      retainedRawOcr: true,
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    const receipt = getReceipt(db, "rcp_1");

    expect(receipt).toEqual(expect.objectContaining({
      id: "rcp_1",
      imageStored: true,
      imageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      retainedRawOcr: true,
    }));
    expect(existsSync(join(attachmentsDir, receipt?.imageRef ?? ""))).toBe(true);
  });

  it("supports no-store-image and deleting retained images without deleting metadata", () => {
    const dir = tempDir();
    const sourcePath = join(dir, "receipt.jpg");
    const attachmentsDir = join(dir, "attachments");
    writeFileSync(sourcePath, "fake image bytes");
    const db = createInMemoryDatabase();

    const noStore = storeReceiptImage({
      receiptId: "rcp_no_store",
      sourcePath,
      attachmentsDir,
      storeImage: false,
    });
    insertReceipt(db, {
      id: "rcp_no_store",
      ...noStore,
      retainedRawOcr: true,
      createdAt: "2026-05-17T00:00:00.000Z",
    });
    expect(getReceipt(db, "rcp_no_store")).toEqual(expect.objectContaining({
      imageStored: false,
      imageRef: undefined,
    }));

    const stored = storeReceiptImage({
      receiptId: "rcp_delete",
      sourcePath,
      attachmentsDir,
      storeImage: true,
    });
    insertReceipt(db, {
      id: "rcp_delete",
      ...stored,
      retainedRawOcr: true,
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    deleteStoredReceiptImage({ attachmentsDir, imageRef: stored.imageRef });
    deleteReceiptImage(db, "rcp_delete", "2026-05-18T00:00:00.000Z");

    expect(getReceipt(db, "rcp_delete")).toEqual(expect.objectContaining({
      imageStored: false,
      imageDeletedAt: "2026-05-18T00:00:00.000Z",
    }));
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "expense-tracker-"));
  tempDirs.push(dir);
  return dir;
}

