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

