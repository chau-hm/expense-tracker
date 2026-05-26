import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/program.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("core CLI commands", () => {
  it("creates an event, adds a shared expense, and settles from persisted SQLite data", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const errors: string[] = [];

    await expect(runCli([
      "--db",
      dbPath,
      "event",
      "create",
      "Japan Trip",
      "--people",
      "A,B",
      "--format",
      "json",
    ], { stdout: output.push.bind(output), stderr: errors.push.bind(errors) })).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toEqual({
      id: expect.stringMatching(/^evt_/),
      name: "Japan Trip",
      defaultCurrency: "HKD",
      supportedCurrencies: ["HKD"],
      ocrLanguagePreferences: ["zh", "en"],
      ocrLanguageSource: "inferred",
      status: "active",
      participantIds: ["self", "A", "B"],
    });

    await expect(runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Japan Trip",
      "--paid-by",
      "A",
      "--currency",
      "HKD",
      "--amount-minor",
      "240000",
      "--shared-by",
      "A,B",
      "--category",
      "flight",
      "--description",
      "tickets",
    ], { stdout: output.push.bind(output), stderr: errors.push.bind(errors) })).resolves.toBe(0);

    await expect(runCli([
      "--db",
      dbPath,
      "event",
      "settle",
      "Japan Trip",
      "--format",
      "json",
    ], { stdout: output.push.bind(output), stderr: errors.push.bind(errors) })).resolves.toBe(0);

    const settlement = JSON.parse(output.pop() ?? "");
    expect(settlement.byCurrency.HKD.transfers).toEqual([
      { from: "B", to: "A", amountMinor: "120000", currency: "HKD" },
    ]);
  });

  it("creates events with supported currencies and OCR language preferences", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];

    await expect(runCli([
      "--db",
      dbPath,
      "event",
      "create",
      "Japan Trip",
      "--currency",
      "HKD",
      "--currencies",
      "JPY,HKD",
      "--ocr-languages",
      "jp,zh",
      "--format",
      "json",
    ], { stdout: output.push.bind(output), stderr: () => undefined })).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      name: "Japan Trip",
      defaultCurrency: "HKD",
      supportedCurrencies: ["HKD", "JPY"],
      ocrLanguagePreferences: ["jp", "zh"],
      ocrLanguageSource: "manual",
    });
  });

  it("lists events and shows event detail for review", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "event", "create", "Daily Expenses"], io);
    await runCli(["--db", dbPath, "event", "create", "Japan Trip", "--people", "A,B"], io);
    await runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Japan Trip",
      "--paid-by",
      "A",
      "--currency",
      "HKD",
      "--amount-minor",
      "240000",
      "--shared-by",
      "A,B",
      "--category",
      "flight",
    ], io);

    await expect(runCli([
      "--db",
      dbPath,
      "event",
      "list",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toEqual([
      expect.objectContaining({ name: "Daily Expenses", participantIds: ["self"] }),
      expect.objectContaining({ name: "Japan Trip", participantIds: ["self", "A", "B"] }),
    ]);

    await expect(runCli([
      "--db",
      dbPath,
      "event",
      "detail",
      "Japan Trip",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toEqual({
      event: expect.objectContaining({
        name: "Japan Trip",
        defaultCurrency: "HKD",
        supportedCurrencies: ["HKD"],
        participantIds: ["self", "A", "B"],
      }),
      summary: expect.objectContaining({
        activeItemCount: 1,
        totalsByCurrency: { HKD: "240000" },
      }),
    });
  });

  it("defaults event currency and personal expense fields for fast chat entry", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const errors: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: errors.push.bind(errors) };

    await expect(runCli([
      "--db",
      dbPath,
      "event",
      "create",
      "Daily Expenses",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      name: "Daily Expenses",
      defaultCurrency: "HKD",
      participantIds: ["self"],
    });

    await expect(runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Daily Expenses",
      "--amount-minor",
      "580",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      paidBy: "self",
      currency: "HKD",
      amountMinor: "580",
      category: "general",
      participants: ["self"],
    });
    expect(errors).toEqual([]);
  });

  it("parses natural-language chat expense input into a non-mutating draft", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "event", "create", "Daily Expenses"], io);

    await expect(runCli([
      "--db",
      dbPath,
      "chat",
      "parse",
      "--event",
      "Daily Expenses",
      "交通費，$5.8",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toEqual({
      kind: "draft",
      draft: expect.objectContaining({
        eventName: "Daily Expenses",
        amountMinor: "580",
        currency: "HKD",
        category: "transport",
        description: "交通費",
        paidBy: "self",
        sharedBy: ["self"],
        needsConfirmation: true,
        commandArgs: [
          "expense",
          "add",
          "--event",
          "Daily Expenses",
          "--paid-by",
          "self",
          "--currency",
          "HKD",
          "--amount-minor",
          "580",
          "--shared-by",
          "self",
          "--category",
          "transport",
          "--description",
          "交通費",
        ],
      }),
    });

    await runCli(["--db", dbPath, "event", "summary", "Daily Expenses", "--format", "json"], io);
    expect(JSON.parse(output.pop() ?? "").activeItemCount).toBe(0);
  });

  it("adds personal expenses without settlement transfers", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "event", "create", "Daily Expenses"], io);

    await expect(runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Daily Expenses",
      "--type",
      "personal",
      "--amount-minor",
      "18600",
      "--category",
      "food",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      type: "personal",
      paidBy: "self",
      owner: "self",
      currency: "HKD",
      amountMinor: "18600",
      category: "food",
    });

    await runCli(["--db", dbPath, "event", "summary", "Daily Expenses", "--format", "json"], io);
    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      activeItemCount: 1,
      totalsByCurrency: { HKD: "18600" },
      categoryTotals: { HKD: { food: "18600" } },
      settlement: {},
    });
  });

  it("adds fronted personal expenses as direct repayment transfers", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const errors: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: errors.push.bind(errors) };

    await runCli(["--db", dbPath, "event", "create", "Trip", "--people", "A,B"], io);

    await expect(runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Trip",
      "--type",
      "fronted-personal",
      "--paid-by",
      "A",
      "--beneficiary",
      "B",
      "--amount-minor",
      "3000",
      "--category",
      "souvenir",
    ], io)).resolves.toBe(0);

    await runCli(["--db", dbPath, "event", "settle", "Trip", "--format", "json"], io);
    expect(JSON.parse(output.pop() ?? "").byCurrency.HKD.transfers).toEqual([
      { from: "B", to: "A", amountMinor: "3000", currency: "HKD" },
    ]);

    await expect(runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Trip",
      "--type",
      "fronted-personal",
      "--amount-minor",
      "3000",
    ], io)).resolves.toBe(1);
    expect(errors.join("\n")).toContain("--beneficiary");
  });

  it("returns non-zero for missing events", async () => {
    const dbPath = tempDbPath();
    const errors: string[] = [];

    await expect(runCli([
      "--db",
      dbPath,
      "event",
      "settle",
      "Missing",
    ], { stdout: () => undefined, stderr: errors.push.bind(errors) })).resolves.toBe(1);

    expect(errors.join("\n")).toContain("Event not found");
  });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "expense-tracker-"));
  tempDirs.push(dir);
  return join(dir, "test.sqlite");
}
