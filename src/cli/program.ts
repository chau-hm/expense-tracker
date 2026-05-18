import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Command, CommanderError } from "commander";
import { createDatabase } from "../adapters/sqlite/database.js";
import {
  createEvent,
  findEventByName,
  insertExpense,
  type InsertExpenseInput,
  listExpenses,
  listEventExpenses,
  updateExpense,
} from "../adapters/sqlite/repository.js";
import {
  deleteItem,
  editItem,
  listItems,
  restoreItem,
  searchItems,
  type ItemSearchFilter,
} from "../domain/items.js";
import { calculateSettlement, type ParticipantId } from "../domain/settlement.js";
import { summarizeEvent, type EventSummary } from "../domain/summary.js";
import { exportEvent } from "../domain/export.js";
import { parseChatExpense, type ChatParseResult } from "../domain/chat-intake.js";

export type CliIo = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

type Format = "text" | "json";
const DEFAULT_PARTICIPANT_ID = "self" as ParticipantId;
const DEFAULT_CURRENCY = "HKD";
const DEFAULT_CATEGORY = "general";
type ExpenseTypeOption = "shared" | "personal" | "fronted-personal" | "fronted_personal";

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const program = buildProgram(io);
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      return 0;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(message);
    return 1;
  }
}

export function buildProgram(io: CliIo = defaultIo): Command {
  const program = new Command();

  program
    .name("expense-tracker")
    .description("CLI-first agent-native expense tracker")
    .version("0.1.0")
    .option("--db <path>", "SQLite database path", defaultDbPath());
  program.configureOutput({
    writeOut: (message) => io.stdout(message.trimEnd()),
    writeErr: (message) => io.stderr(message.trimEnd()),
  });
  program.exitOverride();

  const event = program.command("event");

  event
    .command("create")
    .argument("<name>")
    .option("--people <people>", "Comma-separated participant IDs")
    .option("--currency <currency>", "Default event currency", DEFAULT_CURRENCY)
    .option("--format <format>", "Output format: text or json", "text")
    .action((name: string, options: { people?: string; currency: string; format: Format }) => {
      const db = openDb(program);
      const now = new Date().toISOString();
      const record = createEvent(db, {
        id: createId("evt", name),
        name,
        defaultCurrency: options.currency,
        defaultParticipantId: DEFAULT_PARTICIPANT_ID,
        participants: parsePeople(options.people),
        createdAt: now,
      });

      writeOutput(io, options.format, record, `Created event ${record.name}`);
    });

  event
    .command("settle")
    .argument("<name>")
    .option("--format <format>", "Output format: text or json", "text")
    .action((name: string, options: { format: Format }) => {
      const db = openDb(program);
      const record = findEventByName(db, name);
      if (!record) {
        throw new Error(`Event not found: ${name}`);
      }
      const expenses = listEventExpenses(db, record.id);
      const settlement = calculateSettlement({
        participants: record.participantIds,
        expenses,
      });
      writeOutput(io, options.format, stringifyBigInts(settlement), formatSettlementText(settlement));
    });

  event
    .command("summary")
    .argument("<name>")
    .option("--format <format>", "Output format: text or json", "text")
    .action((name: string, options: { format: Format }) => {
      const db = openDb(program);
      const record = findEventByName(db, name);
      if (!record) {
        throw new Error(`Event not found: ${name}`);
      }
      const summary = summarizeEvent({
        event: record,
        expenses: listEventExpenses(db, record.id),
      });
      writeOutput(io, options.format, stringifyBigInts(summary), formatSummaryText(summary));
    });

  event
    .command("export")
    .argument("<name>")
    .action((name: string) => {
      const db = openDb(program);
      const record = findEventByName(db, name);
      if (!record) {
        throw new Error(`Event not found: ${name}`);
      }
      const exported = exportEvent({
        exportedAt: new Date().toISOString(),
        event: record,
        expenses: listEventExpenses(db, record.id),
      });
      io.stdout(JSON.stringify(stringifyBigInts(exported)));
    });

  const expense = program.command("expense");

  expense
    .command("add")
    .requiredOption("--event <name>", "Event name")
    .option("--type <type>", "Expense type: shared, personal, fronted-personal", "shared")
    .option("--paid-by <participant>", "Payer participant ID", DEFAULT_PARTICIPANT_ID)
    .option("--currency <currency>", "Currency code")
    .requiredOption("--amount-minor <amount>", "Amount in minor units")
    .option("--shared-by <people>", "Comma-separated participants", DEFAULT_PARTICIPANT_ID)
    .option("--owner <participant>", "Owner participant ID for personal expenses", DEFAULT_PARTICIPANT_ID)
    .option("--beneficiary <participant>", "Beneficiary participant ID for fronted personal expenses")
    .option("--category <category>", "Expense category", DEFAULT_CATEGORY)
    .option("--description <description>", "Expense description")
    .option("--format <format>", "Output format: text or json", "text")
    .action((options: {
      event: string;
      type: ExpenseTypeOption;
      paidBy: string;
      currency: string;
      amountMinor: string;
      sharedBy: string;
      owner: string;
      beneficiary?: string;
      category: string;
      description?: string;
      format: Format;
    }) => {
      const db = openDb(program);
      const record = findEventByName(db, options.event);
      if (!record) {
        throw new Error(`Event not found: ${options.event}`);
      }
      const now = new Date().toISOString();
      const expenseType = normalizeExpenseType(options.type);
      const expenseBase = {
        id: createId("exp", `${options.event}-${options.category}-${now}`),
        eventId: record.id,
        status: "active" as const,
        paidBy: options.paidBy as ParticipantId,
        currency: options.currency ?? record.defaultCurrency,
        amountMinor: BigInt(options.amountMinor),
        category: options.category,
        description: options.description,
        createdAt: now,
        updatedAt: now,
      };
      const expenseRecord: InsertExpenseInput = createExpenseRecord(expenseType, expenseBase, options);
      insertExpense(db, expenseRecord);
      writeOutput(io, options.format, stringifyBigInts(expenseRecord), `Added expense ${expenseRecord.id}`);
    });

  const chat = program.command("chat");

  chat
    .command("parse")
    .argument("<text...>")
    .option("--event <name>", "Event context")
    .option("--paid-by <participant>", "Payer participant ID", DEFAULT_PARTICIPANT_ID)
    .option("--shared-by <people>", "Comma-separated participants", DEFAULT_PARTICIPANT_ID)
    .option("--format <format>", "Output format: text or json", "text")
    .action((textParts: string[], options: {
      event?: string;
      paidBy: string;
      sharedBy: string;
      format: Format;
    }) => {
      const text = textParts.join(" ");
      const db = openDb(program);
      const eventRecord = options.event ? findEventByName(db, options.event) : undefined;
      if (options.event && !eventRecord) {
        throw new Error(`Event not found: ${options.event}`);
      }
      const result = parseChatExpense(text, {
        eventName: eventRecord?.name,
        defaultCurrency: eventRecord?.defaultCurrency,
        paidBy: options.paidBy as ParticipantId,
        sharedBy: parsePeople(options.sharedBy),
      });
      writeOutput(io, options.format, stringifyBigInts(result), formatChatParseText(result));
    });

  const item = program.command("item");

  item
    .command("list")
    .option("--event <name>", "Event name")
    .option("--status <status>", "Status filter: active, deleted, all", "active")
    .option("--format <format>", "Output format: text or json", "text")
    .action((options: { event?: string; status: ItemSearchFilter["status"]; format: Format }) => {
      const db = openDb(program);
      const filter = buildItemFilter(db, options);
      const results = listItems(listExpenses(db), filter);
      writeOutput(io, options.format, stringifyBigInts(results), formatItemsText(results));
    });

  item
    .command("search")
    .option("--event <name>", "Event name")
    .option("--text <text>", "Text query")
    .option("--category <category>", "Category")
    .option("--currency <currency>", "Currency")
    .option("--status <status>", "Status filter: active, deleted, all", "active")
    .option("--format <format>", "Output format: text or json", "text")
    .action((options: {
      event?: string;
      text?: string;
      category?: string;
      currency?: string;
      status: ItemSearchFilter["status"];
      format: Format;
    }) => {
      const db = openDb(program);
      const filter = buildItemFilter(db, options);
      const results = searchItems(listExpenses(db), {
        ...filter,
        text: options.text,
        category: options.category,
        currency: options.currency,
      });
      writeOutput(io, options.format, stringifyBigInts(results), formatItemsText(results));
    });

  item
    .command("edit")
    .argument("<id>")
    .option("--amount-minor <amount>", "Amount in minor units")
    .option("--category <category>", "Category")
    .option("--description <description>", "Description")
    .option("--currency <currency>", "Currency")
    .option("--format <format>", "Output format: text or json", "text")
    .action((id: string, options: {
      amountMinor?: string;
      category?: string;
      description?: string;
      currency?: string;
      format: Format;
    }) => {
      const db = openDb(program);
      const result = editItem(listExpenses(db), id, {
        amountMinor: options.amountMinor ? BigInt(options.amountMinor) : undefined,
        category: options.category,
        description: options.description,
        currency: options.currency,
        updatedAt: new Date().toISOString(),
      });
      if (result.kind === "not_found") {
        throw new Error(`Item not found: ${id}`);
      }
      updateExpense(db, result.item);
      writeOutput(io, options.format, stringifyBigInts(result.item), `Updated item ${id}`);
    });

  item
    .command("delete")
    .argument("<id>")
    .option("--format <format>", "Output format: text or json", "text")
    .action((id: string, options: { format: Format }) => {
      const db = openDb(program);
      const result = deleteItem(listExpenses(db), id, new Date().toISOString());
      if (result.kind === "not_found") {
        throw new Error(`Item not found: ${id}`);
      }
      updateExpense(db, result.item);
      writeOutput(io, options.format, stringifyBigInts(result.item), `Deleted item ${id}`);
    });

  item
    .command("restore")
    .argument("<id>")
    .option("--format <format>", "Output format: text or json", "text")
    .action((id: string, options: { format: Format }) => {
      const db = openDb(program);
      const result = restoreItem(listExpenses(db), id);
      if (result.kind === "not_found") {
        throw new Error(`Item not found: ${id}`);
      }
      updateExpense(db, { ...result.item, updatedAt: new Date().toISOString() });
      writeOutput(io, options.format, stringifyBigInts(result.item), `Restored item ${id}`);
    });

  return program;
}

const defaultIo: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

function openDb(program: Command) {
  const opts = program.opts<{ db: string }>();
  mkdirSync(dirname(opts.db), { recursive: true });
  return createDatabase(opts.db);
}

function defaultDbPath(): string {
  return join(homedir(), ".expense-tracker", "expense-tracker.sqlite");
}

function parsePeople(value?: string): ParticipantId[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((person) => person.trim())
    .filter(Boolean)
    .map((person) => person as ParticipantId);
}

function normalizeExpenseType(value: ExpenseTypeOption): "shared" | "personal" | "fronted_personal" {
  if (value === "shared" || value === "personal" || value === "fronted_personal") {
    return value;
  }
  if (value === "fronted-personal") {
    return "fronted_personal";
  }
  throw new Error(`Invalid expense type: ${value}`);
}

function createExpenseRecord(
  type: "shared" | "personal" | "fronted_personal",
  base: Omit<InsertExpenseInput, "type">,
  options: { sharedBy: string; owner: string; beneficiary?: string },
): InsertExpenseInput {
  if (type === "personal") {
    return {
      ...base,
      type,
      owner: options.owner as ParticipantId,
    };
  }

  if (type === "fronted_personal") {
    if (!options.beneficiary) {
      throw new Error("Missing required option '--beneficiary <participant>' for fronted-personal expenses");
    }
    return {
      ...base,
      type,
      beneficiary: options.beneficiary as ParticipantId,
    };
  }

  return {
    ...base,
    type,
    participants: parsePeople(options.sharedBy),
  };
}

function createId(prefix: string, seed: string): string {
  const normalized = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${prefix}_${normalized || Date.now().toString(36)}`;
}

function writeOutput(io: CliIo, format: Format, jsonValue: unknown, textValue: string): void {
  if (format === "json") {
    io.stdout(JSON.stringify(jsonValue));
    return;
  }
  io.stdout(textValue);
}

function stringifyBigInts(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(stringifyBigInts);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, stringifyBigInts(child)]),
    );
  }
  return value;
}

function formatSettlementText(settlement: ReturnType<typeof calculateSettlement>): string {
  const lines: string[] = [];
  for (const [currency, result] of Object.entries(settlement.byCurrency)) {
    lines.push(currency);
    for (const transfer of result.transfers) {
      lines.push(`${transfer.from} -> ${transfer.to}: ${transfer.amountMinor.toString()} ${currency}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : "No settlement needed";
}

function formatSummaryText(summary: EventSummary): string {
  const lines = [
    `${summary.event.name} (${summary.event.status})`,
    `Participants: ${summary.event.participantIds.join(", ")}`,
    `Active items: ${summary.activeItemCount}`,
  ];

  for (const [currency, total] of Object.entries(summary.totalsByCurrency)) {
    lines.push(`Total ${currency}: ${total.toString()}`);
  }

  for (const [currency, categories] of Object.entries(summary.categoryTotals)) {
    lines.push(`Categories ${currency}:`);
    for (const [category, total] of Object.entries(categories)) {
      lines.push(`- ${category}: ${total.toString()}`);
    }
  }

  const settlementText = formatSettlementText({
    byCurrency: summary.settlement,
    categoryTotals: summary.categoryTotals,
  });
  lines.push("Settlement:");
  lines.push(settlementText);

  return lines.join("\n");
}

function formatChatParseText(result: ChatParseResult): string {
  if (result.kind === "needs_clarification") {
    return [
      "Needs clarification before saving.",
      `Missing: ${result.missing.join(", ")}`,
      `Source: ${result.sourceText}`,
    ].join("\n");
  }

  const draft = result.draft;
  return [
    "Draft expense (confirm before saving)",
    `Event: ${draft.eventName}`,
    `Amount: ${draft.amountMinor.toString()} ${draft.currency}`,
    `Category: ${draft.category}`,
    `Paid by: ${draft.paidBy}`,
    `Shared by: ${draft.sharedBy.join(", ")}`,
    `Description: ${draft.description}`,
    `CLI: ${draft.commandArgs.map(quoteArg).join(" ")}`,
  ].join("\n");
}

function quoteArg(arg: string): string {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function buildItemFilter(
  db: ReturnType<typeof openDb>,
  options: { event?: string; status?: ItemSearchFilter["status"] },
): ItemSearchFilter {
  const filter: ItemSearchFilter = {
    status: options.status,
  };
  if (options.event) {
    const event = findEventByName(db, options.event);
    if (!event) {
      throw new Error(`Event not found: ${options.event}`);
    }
    filter.eventId = event.id;
  }
  return filter;
}

function formatItemsText(items: Array<{ id: string; amountMinor: bigint; currency: string; category: string; status: string }>): string {
  if (items.length === 0) {
    return "No items found";
  }
  return items
    .map((item) => `${item.id} ${item.amountMinor.toString()} ${item.currency} ${item.category} ${item.status}`)
    .join("\n");
}
