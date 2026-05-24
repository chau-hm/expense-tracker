import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runOpenClawCommand } from "../../src/cli/openclaw-wrapper.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("OpenClaw wrapper", () => {
  it("strips a slash command prefix and forwards to the core CLI", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const errors: string[] = [];

    await expect(runOpenClawCommand([
      "--db",
      dbPath,
      "/expense",
      "event",
      "create",
      "Japan Trip",
      "--people",
      "A,B",
      "--format",
      "json",
    ], { stdout: output.push.bind(output), stderr: errors.push.bind(errors) })).resolves.toBe(0);

    expect(errors).toEqual([]);
    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      name: "Japan Trip",
      participantIds: ["self", "A", "B"],
    });
  });

  it("accepts a plain command prefix", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];

    await expect(runOpenClawCommand([
      "--db",
      dbPath,
      "expense",
      "event",
      "create",
      "Japan Trip",
      "--format",
      "json",
    ], { stdout: output.push.bind(output), stderr: () => undefined })).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      name: "Japan Trip",
      participantIds: ["self"],
    });
  });

  it("forwards receipt commands instead of treating them as natural language", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const errors: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: errors.push.bind(errors) };

    await expect(runOpenClawCommand([
      "--db",
      dbPath,
      "expense",
      "receipt",
      "image",
      "delete",
      "missing",
    ], io)).resolves.toBe(1);

    expect(output.join("\n")).not.toContain("Needs clarification");
    expect(errors).toEqual(["Receipt not found: missing"]);
  });

  it("shows help for empty input", async () => {
    const output: string[] = [];
    const errors: string[] = [];

    await expect(runOpenClawCommand([], {
      stdout: output.push.bind(output),
      stderr: errors.push.bind(errors),
    })).resolves.toBe(0);

    expect(errors).toEqual([]);
    expect(output.join("\n")).toContain("Usage: expense-tracker");
  });

  it("treats unknown slash command text as natural-language chat parse input", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await expect(runOpenClawCommand([
      "--db",
      dbPath,
      "/expense",
      "交通費，$5.8",
    ], io)).resolves.toBe(0);

    expect(output.pop()).toContain("Missing: event");
  });

  it("corrects a draft JSON without saving it", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runOpenClawCommand([
      "--db",
      dbPath,
      "event",
      "create",
      "Daily Expenses",
    ], io);
    await runOpenClawCommand([
      "--db",
      dbPath,
      "chat",
      "parse",
      "交通費，$5.8",
      "--event",
      "Daily Expenses",
      "--format",
      "json",
    ], io);
    const parsed = JSON.parse(output.pop() ?? "");

    await expect(runOpenClawCommand([
      "--db",
      dbPath,
      "chat",
      "correct",
      "改做 $6",
      "--draft-json",
      JSON.stringify(parsed),
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toEqual({
      kind: "corrected_draft",
      draft: expect.objectContaining({
        amountMinor: "600",
        commandArgs: expect.arrayContaining(["600"]),
      }),
    });
  });

  it("routes list/search text to read-only item intent handling", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runOpenClawCommand(["--db", dbPath, "event", "create", "Daily Expenses"], io);
    await runOpenClawCommand([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Daily Expenses",
      "--amount-minor",
      "580",
      "--category",
      "transport",
      "--description",
      "taxi",
    ], io);
    await runOpenClawCommand([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Daily Expenses",
      "--amount-minor",
      "6800",
      "--category",
      "food",
      "--description",
      "lunch",
    ], io);

    await expect(runOpenClawCommand([
      "--db",
      dbPath,
      "/expense",
      "list",
      "taxi",
    ], io)).resolves.toBe(0);

    const result = output.pop() ?? "";
    expect(result).toContain("taxi");
    expect(result).not.toContain("lunch");
  });

  it("routes mutation text to safe chat item mutation handling", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runOpenClawCommand(["--db", dbPath, "event", "create", "Daily Expenses"], io);
    await runOpenClawCommand([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Daily Expenses",
      "--amount-minor",
      "580",
      "--category",
      "transport",
      "--description",
      "taxi",
      "--format",
      "json",
    ], io);
    const added = JSON.parse(output.pop() ?? "");

    await expect(runOpenClawCommand([
      "--db",
      dbPath,
      "/expense",
      "delete",
      added.id,
    ], io)).resolves.toBe(0);

    expect(output.pop()).toContain("Updated item");
  });

  it("routes summary and settlement text to chat event responses", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runOpenClawCommand(["--db", dbPath, "event", "create", "Trip", "--people", "A,B"], io);
    await runOpenClawCommand([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Trip",
      "--paid-by",
      "A",
      "--amount-minor",
      "240000",
      "--shared-by",
      "A,B",
      "--category",
      "flight",
    ], io);

    await expect(runOpenClawCommand([
      "--db",
      dbPath,
      "/expense",
      "summary",
      "Trip",
    ], io)).resolves.toBe(0);
    expect(output.pop()).toContain("Summary: Trip");

    await expect(runOpenClawCommand([
      "--db",
      dbPath,
      "/expense",
      "settle",
      "Trip",
    ], io)).resolves.toBe(0);
    expect(output.pop()).toContain("B -> A: 120000 HKD");
  });

  it("keeps core CLI errors and exit codes", async () => {
    const errors: string[] = [];

    await expect(runOpenClawCommand([
      "event",
      "settle",
      "Missing",
    ], { stdout: () => undefined, stderr: errors.push.bind(errors) })).resolves.toBe(1);

    expect(errors.join("\n")).toContain("Event not found: Missing");
  });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "expense-tracker-"));
  tempDirs.push(dir);
  return join(dir, "test.sqlite");
}
