import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/adapters/sqlite/database.js";
import { createEvent, insertReceipt } from "../../src/adapters/sqlite/repository.js";
import { runCli } from "../../src/cli/program.js";
import type { ParticipantId } from "../../src/domain/settlement.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("agent-first CLI contracts", () => {
  it("exposes machine-readable capabilities", async () => {
    const output: string[] = [];

    await expect(runCli(["capabilities", "--format", "json"], {
      stdout: output.push.bind(output),
      stderr: () => undefined,
    })).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      ok: true,
      app: "expense-tracker",
      guarantees: {
        structuredJson: true,
        typedErrors: true,
        explicitScopeInJson: true,
        stableIds: true,
      },
      commands: expect.arrayContaining([
        expect.objectContaining({ path: "event create", mutates: true, dryRun: true }),
        expect.objectContaining({ path: "expense add", mutates: true }),
        expect.objectContaining({ path: "receipt confirm", mutates: true }),
      ]),
    });
  });

  it("writes an event-create dry-run artifact without writing the database", async () => {
    const dbPath = tempDbPath();
    const artifactDir = join(mkdtempSync(join(tmpdir(), "expense-event-artifacts-")), "runs");
    tempDirs.push(dirname(artifactDir));
    const output: string[] = [];

    await expect(runCli([
      "--db", dbPath, "--artifact-dir", artifactDir,
      "event", "create", "Trip", "--people", "A,B", "--dry-run", "--format", "json",
    ], { stdout: output.push.bind(output), stderr: () => undefined })).resolves.toBe(0);

    const result = JSON.parse(output.pop() ?? "{}");
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      command: "event.create",
      artifactPath: expect.stringContaining(artifactDir),
      event: { name: "Trip", participantIds: ["self", "A", "B"] },
    });
    expect(existsSync(dbPath)).toBe(false);
    expect(readdirSync(artifactDir)).toHaveLength(1);
    expect(JSON.parse(readFileSync(result.artifactPath, "utf8"))).toMatchObject({
      result: { ok: true, dryRun: true, command: "event.create" },
    });
  });

  it("returns typed JSON errors when --format json is requested", async () => {
    const output: string[] = [];
    const errors: string[] = [];

    await expect(runCli([
      "--db",
      tempDbPath(),
      "expense",
      "add",
      "--event",
      "Missing",
      "--amount-minor",
      "1000",
      "--format",
      "json",
    ], { stdout: output.push.bind(output), stderr: errors.push.bind(errors) })).resolves.toBe(1);

    expect(errors).toEqual([]);
    expect(JSON.parse(output.pop() ?? "")).toEqual({
      ok: false,
      error: {
        code: "EVENT_NOT_FOUND",
        message: "Event not found: Missing",
        nextAction: "Check the event name or create the event first.",
        candidates: [],
        retryable: false,
      },
    });
  });

  it("writes run artifacts for mutation success, dry-run, and typed errors", async () => {
    const dbPath = tempDbPath();
    const artifactDir = join(mkdtempSync(join(tmpdir(), "expense-artifacts-")), "runs");
    tempDirs.push(dirname(artifactDir));
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "--artifact-dir", artifactDir, "event", "create", "Trip", "--format", "json"], io);
    const success = JSON.parse(output.pop() ?? "{}");
    expect(success).toMatchObject({ name: "Trip", artifactPath: expect.stringContaining(artifactDir) });

    await runCli([
      "--db", dbPath, "--artifact-dir", artifactDir, "expense", "add",
      "--event", "Trip", "--amount-minor", "580", "--dry-run", "--format", "json",
    ], io);
    const dryRun = JSON.parse(output.pop() ?? "{}");
    expect(dryRun).toMatchObject({ ok: true, dryRun: true, artifactPath: expect.stringContaining(artifactDir) });

    await expect(runCli([
      "--db", dbPath, "--artifact-dir", artifactDir, "item", "delete", "missing", "--format", "json",
    ], io)).resolves.toBe(1);
    const failure = JSON.parse(output.pop() ?? "{}");
    expect(failure).toMatchObject({ ok: false, error: { code: "ITEM_NOT_FOUND" }, artifactPath: expect.stringContaining(artifactDir) });

    expect(readdirSync(artifactDir)).toHaveLength(3);
    const artifact = JSON.parse(readFileSync(failure.artifactPath, "utf8"));
    expect(artifact).toMatchObject({
      app: "expense-tracker",
      version: "0.1.0",
      createdAt: expect.any(String),
      result: { ok: false, error: { code: "ITEM_NOT_FOUND" } },
    });
    expect(artifact.result.artifactPath).toBeUndefined();
  });

  it("does not write run artifacts for read-only JSON results", async () => {
    const dbPath = tempDbPath();
    const artifactDir = join(mkdtempSync(join(tmpdir(), "expense-read-artifacts-")), "runs");
    tempDirs.push(dirname(artifactDir));
    const output: string[] = [];

    await expect(runCli([
      "--db", dbPath, "--artifact-dir", artifactDir, "event", "list", "--format", "json",
    ], { stdout: output.push.bind(output), stderr: () => undefined })).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "[]")).toEqual([]);
    expect(() => readdirSync(artifactDir)).toThrow();
  });

  it("adds scope and side-effect metadata to expense add JSON", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "event", "create", "Trip"], io);
    output.length = 0;

    await expect(runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Trip",
      "--amount-minor",
      "580",
      "--category",
      "transport",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      id: expect.stringMatching(/^exp_/),
      amountMinor: "580",
      category: "transport",
      scope: {
        db: dbPath,
        event: "Trip",
        currency: "HKD",
        participants: ["self"],
      },
      sideEffects: [expect.objectContaining({ action: "add_expense" })],
      warnings: [],
    });
  });

  it("previews expense add without writing and includes settlement impact", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "event", "create", "Trip"], io);
    output.length = 0;

    await expect(runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Trip",
      "--amount-minor",
      "580",
      "--paid-by",
      "self",
      "--shared-by",
      "self,A",
      "--dry-run",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      ok: true,
      dryRun: true,
      command: "expense.add",
      plannedOperations: [expect.objectContaining({ action: "add_expense" })],
      sideEffects: [],
      settlementImpact: {
        introducedParticipants: ["A"],
        after: {
          byCurrency: {
            HKD: {
              transfers: [{ from: "A", to: "self", amountMinor: "290", currency: "HKD" }],
            },
          },
        },
      },
    });

    await runCli(["--db", dbPath, "event", "summary", "Trip", "--format", "json"], io);
    expect(JSON.parse(output.pop() ?? "")).toMatchObject({ activeItemCount: 0 });
  });

  it("previews receipt confirm without creating expenses", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };
    const db = createDatabase(dbPath);
    createEvent(db, {
      id: "evt_trip",
      name: "Trip",
      defaultCurrency: "HKD",
      defaultParticipantId: "self" as ParticipantId,
      participants: [],
      createdAt: "2026-06-03T00:00:00.000Z",
    });
    insertReceipt(db, {
      id: "rcp_lunch",
      eventId: "evt_trip",
      imageStored: false,
      merchant: "Cafe",
      extractedItemsJson: JSON.stringify([{ name: "tea", amount: "10.00" }]),
      extractedTotal: "10.00",
      retainedRawOcr: true,
      createdAt: "2026-06-03T00:00:00.000Z",
    });

    await expect(runCli([
      "--db",
      dbPath,
      "receipt",
      "confirm",
      "rcp_lunch",
      "--shared-by",
      "self,A",
      "--dry-run",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      ok: true,
      dryRun: true,
      command: "receipt.confirm",
      itemCount: 1,
      sideEffects: [],
      plannedOperations: [
        expect.objectContaining({ action: "confirm_receipt", receiptId: "rcp_lunch", itemCount: 1 }),
      ],
      settlementImpact: {
        introducedParticipants: ["A"],
      },
    });

    await runCli(["--db", dbPath, "event", "summary", "Trip", "--format", "json"], io);
    expect(JSON.parse(output.pop() ?? "")).toMatchObject({ activeItemCount: 0 });
  });

  it("previews item delete without changing item status", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "event", "create", "Trip"], io);
    await runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Trip",
      "--amount-minor",
      "580",
      "--format",
      "json",
    ], io);
    const saved = JSON.parse(output.pop() ?? "");

    await expect(runCli([
      "--db",
      dbPath,
      "item",
      "delete",
      saved.id,
      "--dry-run",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      ok: true,
      dryRun: true,
      command: "item.delete",
      item: { id: saved.id, status: "deleted" },
      sideEffects: [],
    });

    await runCli(["--db", dbPath, "item", "list", "--event", "Trip", "--format", "json"], io);
    expect(JSON.parse(output.pop() ?? "")).toEqual([
      expect.objectContaining({ id: saved.id, status: "active" }),
    ]);
  });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "expense-tracker-"));
  tempDirs.push(dir);
  return join(dir, "test.sqlite");
}
