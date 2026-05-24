import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/program.js";
import { createInMemoryDatabase } from "../../src/adapters/sqlite/database.js";
import { createEvent } from "../../src/adapters/sqlite/repository.js";
import { AppleVisionOcrProvider } from "../../src/adapters/ocr/apple-vision.js";
import { extractReceiptDraft } from "../../src/domain/receipt-ocr.js";

const tempDirs: string[] = [];
const originalScript = process.env.EXPENSE_TRACKER_APPLE_VISION_OCR;

afterEach(() => {
  if (originalScript === undefined) {
    delete process.env.EXPENSE_TRACKER_APPLE_VISION_OCR;
  } else {
    process.env.EXPENSE_TRACKER_APPLE_VISION_OCR = originalScript;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("receipt OCR", () => {
  it("maps event OCR language preferences into the Apple Vision provider boundary", async () => {
    const scriptPath = mockAppleVisionScript([]);
    const provider = new AppleVisionOcrProvider(scriptPath);

    const result = await provider.recognize({
      imagePath: "/tmp/receipt.jpg",
      languagePreferences: ["jp", "zh"],
    });

    expect(result).toEqual({
      provider: "apple-vision",
      languages: ["ja-JP", "zh-Hant"],
      lines: [],
    });
  });

  it("ingests a receipt image, runs OCR using event preferences, and stores raw OCR metadata", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "expense.sqlite");
    const attachmentsDir = join(dir, "attachments");
    const imagePath = join(dir, "receipt.jpg");
    writeFileSync(imagePath, "fake image bytes");
    process.env.EXPENSE_TRACKER_APPLE_VISION_OCR = mockAppleVisionScript([
      { text: "2026-05-20 13:11:15", confidence: 1 },
      { text: "$273.0", confidence: 1 },
    ]);

    const output: string[] = [];
    const errors: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: errors.push.bind(errors) };

    await runCli([
      "--db",
      dbPath,
      "event",
      "create",
      "HK Food",
      "--currencies",
      "HKD,JPY",
      "--ocr-languages",
      "jp,zh",
    ], io);
    await expect(runCli([
      "--db",
      dbPath,
      "receipt",
      "ingest",
      imagePath,
      "--event",
      "HK Food",
      "--attachments-dir",
      attachmentsDir,
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(errors).toEqual([]);
    const result = JSON.parse(output.pop() ?? "");
    expect(result).toEqual(expect.objectContaining({
      kind: "receipt_ingested",
      event: "HK Food",
      ocrLanguages: ["jp", "zh"],
      lineCount: 2,
    }));
    expect(result.receipt).toEqual(expect.objectContaining({
      eventId: expect.stringMatching(/^evt_hk_food/),
      imageStored: true,
      provider: "apple-vision",
      ocrText: "2026-05-20 13:11:15\n$273.0",
      extractedItemsJson: "[]",
      extractedTotal: "273.00",
      confidence: 1,
      retainedRawOcr: true,
    }));
    expect(result.extracted).toEqual(expect.objectContaining({
      currency: "HKD",
      incurredAt: "2026-05-20T13:11:15+08:00",
      total: "273.00",
      items: [],
      warnings: ["items_not_found"],
    }));
    expect(existsSync(join(attachmentsDir, result.receipt.imageRef))).toBe(true);
  });

  it("confirms receipt parser drafts into saved expense items", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "expense.sqlite");
    const imagePath = join(dir, "receipt.jpg");
    writeFileSync(imagePath, "fake image bytes");
    process.env.EXPENSE_TRACKER_APPLE_VISION_OCR = mockAppleVisionScript([
      { text: "2026-05-20 13:11:15", confidence: 1 },
      { text: "[午市90分鐘]SRF極黑牛餐 248.00", confidence: 0.9 },
      { text: "服務費 24.80", confidence: 0.9 },
      { text: "總額 $273.00", confidence: 1 },
    ]);

    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "event", "create", "HK Food", "--people", "A,B"], io);
    await runCli([
      "--db",
      dbPath,
      "receipt",
      "ingest",
      imagePath,
      "--event",
      "HK Food",
      "--format",
      "json",
    ], io);
    const receipt = JSON.parse(output.pop() ?? "").receipt;

    await expect(runCli([
      "--db",
      dbPath,
      "receipt",
      "confirm",
      receipt.id,
      "--paid-by",
      "A",
      "--shared-by",
      "A,B",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    const confirmed = JSON.parse(output.pop() ?? "");
    expect(confirmed).toEqual(expect.objectContaining({
      kind: "receipt_confirmed",
      receiptId: receipt.id,
      event: "HK Food",
      itemCount: 1,
    }));
    expect(confirmed.expenses[0]).toEqual(expect.objectContaining({
      receiptId: receipt.id,
      paidBy: "A",
      amountMinor: "24800",
      currency: "HKD",
      category: "food",
      description: "[午市90分鐘]SRF極黑牛餐",
      participants: ["A", "B"],
    }));

    await runCli(["--db", dbPath, "event", "settle", "HK Food", "--format", "json"], io);
    expect(JSON.parse(output.pop() ?? "").byCurrency.HKD.transfers).toEqual([
      { from: "B", to: "A", amountMinor: "12400", currency: "HKD" },
    ]);
  });

  it("shows receipt drafts and confirms edited item overrides", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "expense.sqlite");
    const imagePath = join(dir, "receipt.jpg");
    writeFileSync(imagePath, "fake image bytes");
    process.env.EXPENSE_TRACKER_APPLE_VISION_OCR = mockAppleVisionScript([
      { text: "牛餐 248.00", confidence: 0.9 },
      { text: "檸茶 3.00", confidence: 0.9 },
      { text: "總額 $251.00", confidence: 1 },
    ]);

    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "event", "create", "HK Food"], io);
    await runCli([
      "--db",
      dbPath,
      "receipt",
      "ingest",
      imagePath,
      "--event",
      "HK Food",
      "--format",
      "json",
    ], io);
    const receipt = JSON.parse(output.pop() ?? "").receipt;

    await expect(runCli([
      "--db",
      dbPath,
      "receipt",
      "draft",
      receipt.id,
      "--format",
      "json",
    ], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toEqual(expect.objectContaining({
      kind: "receipt_draft",
      receiptId: receipt.id,
      total: "251.00",
      items: [
        expect.objectContaining({ name: "牛餐", amount: "248.00" }),
        expect.objectContaining({ name: "檸茶", amount: "3.00" }),
      ],
    }));

    await expect(runCli([
      "--db",
      dbPath,
      "receipt",
      "confirm",
      receipt.id,
      "--items",
      "SRF beef lunch=248.00;lemon tea=3.00",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    const confirmed = JSON.parse(output.pop() ?? "");
    expect(confirmed.itemCount).toBe(2);
    expect(confirmed.expenses).toEqual([
      expect.objectContaining({ description: "SRF beef lunch", amountMinor: "24800" }),
      expect.objectContaining({ description: "lemon tea", amountMinor: "300" }),
    ]);
  });

  it("can confirm the extracted total as a single edited item", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "expense.sqlite");
    const imagePath = join(dir, "receipt.jpg");
    writeFileSync(imagePath, "fake image bytes");
    process.env.EXPENSE_TRACKER_APPLE_VISION_OCR = mockAppleVisionScript([
      { text: "總額 $91.00", confidence: 1 },
    ]);

    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "event", "create", "HK Food"], io);
    await runCli([
      "--db",
      dbPath,
      "receipt",
      "ingest",
      imagePath,
      "--event",
      "HK Food",
      "--format",
      "json",
    ], io);
    const receipt = JSON.parse(output.pop() ?? "").receipt;

    await expect(runCli([
      "--db",
      dbPath,
      "receipt",
      "confirm",
      receipt.id,
      "--use-total",
      "--description",
      "tea receipt",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    const confirmed = JSON.parse(output.pop() ?? "");
    expect(confirmed.expenses).toEqual([
      expect.objectContaining({
        description: "tea receipt",
        amountMinor: "9100",
      }),
    ]);
  });

  it("rejects confirmation into a different event than the stored receipt event", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "expense.sqlite");
    const imagePath = join(dir, "receipt.jpg");
    writeFileSync(imagePath, "fake image bytes");
    process.env.EXPENSE_TRACKER_APPLE_VISION_OCR = mockAppleVisionScript([
      { text: "$91.00", confidence: 1 },
    ]);

    const output: string[] = [];
    const errors: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: errors.push.bind(errors) };

    await runCli(["--db", dbPath, "event", "create", "HK Food"], io);
    await runCli(["--db", dbPath, "event", "create", "Wrong Event"], io);
    await runCli([
      "--db",
      dbPath,
      "receipt",
      "ingest",
      imagePath,
      "--event",
      "HK Food",
      "--format",
      "json",
    ], io);
    const receipt = JSON.parse(output.pop() ?? "").receipt;

    await expect(runCli([
      "--db",
      dbPath,
      "receipt",
      "confirm",
      receipt.id,
      "--event",
      "Wrong Event",
    ], io)).resolves.toBe(1);

    expect(errors.join("\n")).toContain("belongs to a different event");
  });

  it("infers event OCR language preferences for receipt ingestion", () => {
    const db = createInMemoryDatabase();
    const event = createEvent(db, {
      id: "evt_hk_food",
      name: "HK Food",
      defaultCurrency: "HKD",
      supportedCurrencies: ["HKD"],
      defaultParticipantId: "self",
      participants: [],
      createdAt: "2026-05-24T00:00:00.000Z",
    });

    expect(event.ocrLanguagePreferences).toEqual(["zh", "en"]);
  });

  it("extracts date, total, and conservative item candidates from OCR lines", () => {
    const draft = extractReceiptDraft({
      currencies: ["HKD"],
      ocr: {
        provider: "apple-vision",
        languages: ["zh-Hant", "en-US"],
        lines: [
          { text: "安平燒肉", confidence: 0.91 },
          { text: "2026-05-20 13:11:15", confidence: 0.99 },
          { text: "[午市90分鐘]SRF極黑牛餐 248.00", confidence: 0.86 },
          { text: "服務費 24.80", confidence: 0.88 },
          { text: "總額 $273.00", confidence: 0.97 },
          { text: "noise 999.00", confidence: 0.2 },
        ],
      },
    });

    expect(draft).toEqual({
      currency: "HKD",
      incurredAt: "2026-05-20T13:11:15+08:00",
      total: "273.00",
      items: [
        {
          name: "[午市90分鐘]SRF極黑牛餐",
          amount: "248.00",
          confidence: 0.86,
          sourceLine: "[午市90分鐘]SRF極黑牛餐 248.00",
        },
      ],
      warnings: ["low_confidence_lines_ignored"],
    });
  });

  it("ignores receipt metadata numbers when OCR misses Chinese labels", () => {
    const draft = extractReceiptDraft({
      currencies: ["HKD"],
      ocr: {
        provider: "apple-vision",
        languages: ["zh-Hant", "en-US"],
        lines: [
          { text: "77* (*E)", confidence: 0.7 },
          { text: "#tE: 2806 1688", confidence: 1 },
          { text: ":11", confidence: 1 },
          { text: "AR#97: 4289", confidence: 1 },
          { text: "AEERS: 12/05/2026 20:18:40", confidence: 1 },
          { text: "88.00", confidence: 1 },
          { text: "3.00", confidence: 1 },
          { text: "91.00", confidence: 1 },
          { text: "91.00", confidence: 1 },
          { text: "91.00", confidence: 1 },
          { text: "10.00", confidence: 1 },
          { text: "Cash", confidence: 1 },
          { text: "101.00", confidence: 1 },
          { text: "#5: 4289", confidence: 1 },
          { text: "05 4286: A11861.504-0-01", confidence: 1 },
        ],
      },
    });

    expect(draft).toEqual(expect.objectContaining({
      incurredAt: "2026-05-12T20:18:40+08:00",
      total: "91.00",
      items: [
        expect.objectContaining({ amount: "88.00" }),
        expect.objectContaining({ amount: "3.00" }),
      ],
    }));
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "expense-tracker-"));
  tempDirs.push(dir);
  return dir;
}

function mockAppleVisionScript(lines: Array<{ text: string; confidence: number }>): string {
  const dir = tempDir();
  const scriptPath = join(dir, "apple-vision-mock.sh");
  const payload = JSON.stringify([{ file: "receipt.jpg", lines }]);
  writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' '${payload}'\n`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}
