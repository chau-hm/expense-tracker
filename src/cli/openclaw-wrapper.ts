import { runCli, type CliIo } from "./program.js";

const STRIPPED_PREFIXES = new Set(["/expense", "expense"]);
const TOP_LEVEL_COMMANDS = new Set(["event", "expense", "item"]);

export async function runOpenClawCommand(argv: string[], io?: CliIo): Promise<number> {
  return runCli(normalizeOpenClawArgv(argv), io);
}

export function normalizeOpenClawArgv(argv: string[]): string[] {
  const normalized = stripCommandPrefix(argv);
  return normalized.length > 0 ? normalized : ["--help"];
}

function stripCommandPrefix(argv: string[]): string[] {
  const slashIndex = argv.findIndex((arg) => arg === "/expense");
  if (slashIndex >= 0) {
    return [...argv.slice(0, slashIndex), ...argv.slice(slashIndex + 1)];
  }

  const firstCommandIndex = findFirstCommandIndex(argv);
  if (firstCommandIndex < 0 || argv[firstCommandIndex] !== "expense") {
    return argv;
  }

  const nextCommand = argv[firstCommandIndex + 1];
  if (!STRIPPED_PREFIXES.has(argv[firstCommandIndex]) || !TOP_LEVEL_COMMANDS.has(nextCommand)) {
    return argv;
  }

  return [...argv.slice(0, firstCommandIndex), ...argv.slice(firstCommandIndex + 1)];
}

function findFirstCommandIndex(argv: string[]): number {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--db=") || arg.startsWith("-")) {
      continue;
    }
    return index;
  }
  return -1;
}
