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

describe("event export CLI", () => {
  it("exports a complete event payload as JSON", async () => {
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
      "export",
      "Trip",
    ], io)).resolves.toBe(0);

    const exported = JSON.parse(output.pop() ?? "");
    expect(exported).toEqual(expect.objectContaining({
      schemaVersion: 1,
      event: expect.objectContaining({ id: "evt_trip", name: "Trip" }),
      items: [
        expect.objectContaining({
          category: "flight",
          amountMinor: "240000",
        }),
      ],
      summary: expect.objectContaining({
        activeItemCount: 1,
        totalsByCurrency: { HKD: "240000" },
      }),
    }));
  });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "expense-tracker-"));
  tempDirs.push(dir);
  return join(dir, "test.sqlite");
}

