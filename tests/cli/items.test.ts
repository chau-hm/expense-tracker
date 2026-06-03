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

describe("item CLI commands", () => {
  it("lists, searches, edits, deletes, and restores persisted items", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const errors: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: errors.push.bind(errors) };

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
      "--description",
      "tickets",
      "--format",
      "json",
    ], io);

    const added = JSON.parse(output.pop() ?? "");
    const itemId = added.id;

    await expect(runCli([
      "--db",
      dbPath,
      "item",
      "list",
      "--event",
      "Trip",
      "--format",
      "json",
    ], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toEqual([
      expect.objectContaining({
        id: itemId,
        amountMinor: "240000",
        category: "flight",
        description: "tickets",
      }),
    ]);

    await expect(runCli([
      "--db",
      dbPath,
      "item",
      "search",
      "--text",
      "tickets",
      "--format",
      "json",
    ], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "").map((item: { id: string }) => item.id)).toEqual([itemId]);

    await expect(runCli([
      "--db",
      dbPath,
      "item",
      "edit",
      itemId,
      "--amount-minor",
      "200000",
      "--category",
      "transport",
      "--format",
      "json",
    ], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toEqual(expect.objectContaining({
      id: itemId,
      amountMinor: "200000",
      category: "transport",
    }));

    await expect(runCli(["--db", dbPath, "item", "delete", itemId, "--format", "json"], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toEqual(expect.objectContaining({
      id: itemId,
      status: "deleted",
    }));

    await runCli(["--db", dbPath, "event", "settle", "Trip", "--format", "json"], io);
    expect(JSON.parse(output.pop() ?? "").byCurrency).toEqual({});

    await expect(runCli(["--db", dbPath, "item", "restore", itemId, "--format", "json"], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toEqual(expect.objectContaining({
      id: itemId,
      status: "active",
    }));

    await runCli(["--db", dbPath, "event", "settle", "Trip", "--format", "json"], io);
    expect(JSON.parse(output.pop() ?? "").byCurrency.HKD.transfers).toEqual([
      { from: "B", to: "A", amountMinor: "100000", currency: "HKD" },
    ]);
  });

  it("returns non-zero for missing item IDs", async () => {
    const dbPath = tempDbPath();
    const errors: string[] = [];

    await expect(runCli([
      "--db",
      dbPath,
      "item",
      "delete",
      "missing",
    ], { stdout: () => undefined, stderr: errors.push.bind(errors) })).resolves.toBe(1);

    expect(errors.join("\n")).toContain("Item not found");
  });

  it("corrects a saved item only when the chat target is unambiguous", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const errors: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: errors.push.bind(errors) };

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
      "--category",
      "transport",
      "--description",
      "taxi",
      "--format",
      "json",
    ], io);
    const taxiItem = JSON.parse(output.pop() ?? "");
    await runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Trip",
      "--amount-minor",
      "6800",
      "--category",
      "food",
      "--description",
      "lunch",
    ], io);

    await expect(runCli([
      "--db",
      dbPath,
      "chat",
      "correct",
      "改做 $6",
      "--event",
      "Trip",
      "--text",
      "taxi",
      "--format",
      "json",
    ], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      kind: "updated_item",
      item: expect.objectContaining({
        id: taxiItem.id,
        amountMinor: "600",
        currency: "HKD",
      }),
      scope: { db: dbPath, event: "Trip", itemId: taxiItem.id },
      sideEffects: [{ action: "edit_item", itemId: taxiItem.id }],
      warnings: [],
    });

    await runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Trip",
      "--amount-minor",
      "300",
      "--category",
      "transport",
      "--description",
      "taxi toll",
    ], io);

    await expect(runCli([
      "--db",
      dbPath,
      "chat",
      "correct",
      "改做 $7",
      "--event",
      "Trip",
      "--text",
      "taxi",
      "--format",
      "json",
    ], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toEqual({
      kind: "ambiguous",
      candidates: expect.arrayContaining([
        expect.objectContaining({ id: taxiItem.id, amountMinor: "600" }),
      ]),
    });
  });

  it("applies chat item edit/delete/restore only after a single target is resolved", async () => {
    const dbPath = tempDbPath();
    const output: string[] = [];
    const errors: string[] = [];
    const io = { stdout: output.push.bind(output), stderr: errors.push.bind(errors) };

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
      "--category",
      "transport",
      "--description",
      "taxi",
      "--format",
      "json",
    ], io);
    const taxiItem = JSON.parse(output.pop() ?? "");
    await runCli([
      "--db",
      dbPath,
      "expense",
      "add",
      "--event",
      "Trip",
      "--amount-minor",
      "300",
      "--category",
      "transport",
      "--description",
      "taxi toll",
    ], io);

    await expect(runCli([
      "--db",
      dbPath,
      "chat",
      "item",
      "delete taxi",
      "--event",
      "Trip",
      "--format",
      "json",
    ], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toEqual({
      kind: "ambiguous",
      action: "delete",
      candidates: expect.arrayContaining([
        expect.objectContaining({ id: taxiItem.id, status: "active" }),
      ]),
    });

    await expect(runCli([
      "--db",
      dbPath,
      "chat",
      "item",
      `edit ${taxiItem.id} 改做 $6`,
      "--event",
      "Trip",
      "--format",
      "json",
    ], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      kind: "updated_item",
      action: "edit",
      item: expect.objectContaining({
        id: taxiItem.id,
        amountMinor: "600",
      }),
      scope: { db: dbPath, event: "Trip", itemId: taxiItem.id },
      sideEffects: [{ action: "edit_item", itemId: taxiItem.id }],
      warnings: [],
    });

    await expect(runCli([
      "--db",
      dbPath,
      "chat",
      "item",
      `delete ${taxiItem.id}`,
      "--event",
      "Trip",
      "--format",
      "json",
    ], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      kind: "updated_item",
      action: "delete",
      item: expect.objectContaining({
        id: taxiItem.id,
        status: "deleted",
      }),
      scope: { db: dbPath, event: "Trip", itemId: taxiItem.id },
      sideEffects: [{ action: "delete_item", itemId: taxiItem.id }],
      warnings: [],
    });

    await expect(runCli([
      "--db",
      dbPath,
      "chat",
      "item",
      `restore ${taxiItem.id}`,
      "--event",
      "Trip",
      "--format",
      "json",
    ], io)).resolves.toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toMatchObject({
      kind: "updated_item",
      action: "restore",
      item: expect.objectContaining({
        id: taxiItem.id,
        status: "active",
      }),
      scope: { db: dbPath, event: "Trip", itemId: taxiItem.id },
      sideEffects: [{ action: "restore_item", itemId: taxiItem.id }],
      warnings: [],
    });
  });
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "expense-tracker-"));
  tempDirs.push(dir);
  return join(dir, "test.sqlite");
}
