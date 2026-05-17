import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/program.js";

describe("CLI help", () => {
  it("returns zero for help output", async () => {
    const output: string[] = [];
    const errors: string[] = [];

    await expect(runCli(["--help"], {
      stdout: output.push.bind(output),
      stderr: errors.push.bind(errors),
    })).resolves.toBe(0);

    expect(errors).toEqual([]);
  });
});

