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
