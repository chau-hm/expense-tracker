import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

export type StoredReceiptImage = {
  imageRef?: string;
  imageSha256: string;
  imageStored: boolean;
};

export function storeReceiptImage(input: {
  receiptId: string;
  sourcePath: string;
  attachmentsDir: string;
  storeImage: boolean;
}): StoredReceiptImage {
  const bytes = readFileSync(input.sourcePath);
  const imageSha256 = createHash("sha256").update(bytes).digest("hex");

  if (!input.storeImage) {
    return {
      imageSha256,
      imageStored: false,
    };
  }

  const receiptDir = join(input.attachmentsDir, "receipts");
  mkdirSync(receiptDir, { recursive: true });
  const imageRef = join("receipts", `${input.receiptId}-${basename(input.sourcePath)}`);
  copyFileSync(input.sourcePath, join(input.attachmentsDir, imageRef));

  return {
    imageRef,
    imageSha256,
    imageStored: true,
  };
}

export function deleteStoredReceiptImage(input: {
  attachmentsDir: string;
  imageRef?: string;
}): void {
  if (!input.imageRef) {
    return;
  }
  rmSync(join(input.attachmentsDir, input.imageRef), { force: true });
}

