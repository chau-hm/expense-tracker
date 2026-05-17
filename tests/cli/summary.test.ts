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

describe("event summary CLI", () => {
  it("prints event summary as JSON", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: () => undefined };

    await runCli(["--db", dbPath, "event", "create", "Trip", "--people", "A,B"], io);
    await runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Trip",
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
      "summary",
      "Trip",
      "--format",
      "json",
    ], io)).resolves.toBe(0);

    expect(JSON.parse(output.pop() ?? "")).toEqual({
      event: expect.objectContaining({
        id: "evt_trip",
        name: "Trip",
        participantIds: ["self", "A", "B"],
      }),
      activeItemCount: 1,
      totalsByCurrency: { HKD: "240000" },
      categoryTotals: { HKD: { flight: "240000" } },
      settlement: {
        HKD: {
          balances: { A: "120000", B: "-120000" },
          transfers: [{ from: "B", to: "A", amountMinor: "120000", currency: "HKD" }],
        },
      },
    });
  });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "expense-tracker-"));
  tempDirs.push(dir);
  return join(dir, "test.sqlite");
}

