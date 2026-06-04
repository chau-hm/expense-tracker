import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Command, CommanderError } from "commander";
import { AppleVisionOcrProvider } from "../adapters/ocr/apple-vision.js";
import { createDatabase } from "../adapters/sqlite/database.js";
import {
  createEvent,
  deleteReceiptImage,
  findEventByName,
  getEventById,
  getReceipt,
  insertExpense,
  insertReceipt,
  type InsertExpenseInput,
  listEvents,
  listExpenses,
  listEventExpenses,
  updateExpense,
} from "../adapters/sqlite/repository.js";
import {
  deleteStoredReceiptImage,
  storeReceiptImage,
} from "../adapters/storage/attachments.js";
import {
  deleteItem,
  editItem,
  listItems,
  resolveItemTarget,
  restoreItem,
  searchItems,
  type ItemSearchFilter,
} from "../domain/items.js";
import { calculateSettlement, type Expense, type ParticipantId } from "../domain/settlement.js";
import { summarizeEvent, type EventSummary } from "../domain/summary.js";
import { exportEvent } from "../domain/export.js";
import {
  applyCorrectionToDraft,
  parseChatCorrection,
  parseChatExpense,
  parseChatEventIntent,
  parseChatItemIntent,
  parseChatItemMutationIntent,
  type ChatCorrectionPatch,
  type ChatEventIntent,
  type ChatExpenseDraft,
  type ChatItemIntent,
  type ChatItemMutationIntent,
  type ChatParseResult,
} from "../domain/chat-intake.js";
import { normalizeOcrLanguagePreferences } from "../domain/event-ocr-context.js";
import {
  averageReceiptOcrConfidence,
  buildReceiptClarificationQuestions,
  extractReceiptDraft,
  type ExtractedReceiptItem,
  formatReceiptOcrText,
} from "../domain/receipt-ocr.js";

export type CliIo = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

type Format = "text" | "json";
const DEFAULT_PARTICIPANT_ID = "self" as ParticipantId;
const DEFAULT_CURRENCY = "HKD";
const DEFAULT_CATEGORY = "general";
const DEFAULT_ATTACHMENTS_DIR = join(homedir(), ".expense-tracker", "attachments");
type ExpenseTypeOption = "shared" | "personal" | "fronted-personal" | "fronted_personal";

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const artifactDir = optionValue(argv, "--artifact-dir");
  const artifactIo = artifactDir ? withRunArtifacts(io, artifactDir) : io;
  const program = buildProgram(artifactIo);
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      return 0;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (wantsJson(argv)) {
      artifactIo.stdout(JSON.stringify(errorPayload(error)));
      return 1;
    }
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
    .option("--db <path>", "SQLite database path", defaultDbPath())
    .option("--artifact-dir <dir>", "Write compact JSON run receipts for mutations and typed errors");
  program.configureOutput({
    writeOut: (message) => io.stdout(message.trimEnd()),
    writeErr: (message) => io.stderr(message.trimEnd()),
  });
  program.exitOverride();

  program
    .command("capabilities")
    .description("Print machine-readable command capabilities for agent callers")
    .option("--format <format>", "Output format: text or json", "text")
    .action((options: { format: Format }) => {
      const result = {
        ok: true,
        app: "expense-tracker",
        version: "0.1.0",
        formats: ["text", "json"],
        guarantees: {
          structuredJson: true,
          typedErrors: true,
          explicitScopeInJson: true,
          stableIds: true,
          dryRun: true,
          runArtifacts: true,
        },
        commands: [
          { path: "event create", mutates: true, dryRun: false, scope: ["db", "event"] },
          { path: "expense add", mutates: true, dryRun: true, scope: ["db", "event", "currency", "participants"] },
          { path: "chat parse", mutates: false, dryRun: false, scope: ["db", "event?"] },
          { path: "chat correct", mutates: true, dryRun: false, scope: ["db", "event?", "itemId?"] },
          { path: "chat item", mutates: true, dryRun: false, scope: ["db", "event?", "itemId?"] },
          { path: "item edit", mutates: true, dryRun: true, scope: ["db", "itemId"] },
          { path: "item delete", mutates: true, dryRun: true, scope: ["db", "itemId"] },
          { path: "item restore", mutates: true, dryRun: true, scope: ["db", "itemId"] },
          { path: "receipt ingest", mutates: true, dryRun: false, scope: ["db", "event", "receiptId", "attachmentsDir"] },
          { path: "receipt confirm", mutates: true, dryRun: true, scope: ["db", "event", "receiptId", "participants"] },
          { path: "receipt image delete", mutates: true, dryRun: false, scope: ["db", "receiptId", "attachmentsDir"] },
        ],
      };
      writeOutput(io, options.format, result, "expense-tracker 0.1.0: JSON, typed errors, explicit mutation scope, dry-run previews, and run artifacts supported");
    });

  const event = program.command("event");

  event
    .command("create")
    .argument("<name>")
    .option("--people <people>", "Comma-separated participant IDs")
    .option("--currency <currency>", "Default event currency", DEFAULT_CURRENCY)
    .option("--currencies <currencies>", "Comma-separated supported currencies for the event")
    .option("--ocr-languages <languages>", "Comma-separated OCR language preferences: zh,en,jp")
    .option("--format <format>", "Output format: text or json", "text")
    .action((name: string, options: { people?: string; currency: string; currencies?: string; ocrLanguages?: string; format: Format }) => {
      const db = openDb(program);
      const now = new Date().toISOString();
      const record = createEvent(db, {
        id: createId("evt", name),
        name,
        defaultCurrency: options.currency.toUpperCase(),
        supportedCurrencies: parseCommaList(options.currencies),
        ocrLanguagePreferences: options.ocrLanguages
          ? normalizeOcrLanguagePreferences(parseCommaList(options.ocrLanguages))
          : undefined,
        defaultParticipantId: DEFAULT_PARTICIPANT_ID,
        participants: parsePeople(options.people),
        createdAt: now,
      });

      writeOutput(io, options.format, withMutationMetadata(record, eventScope(program, record.name), [
        { action: "create_event", eventId: record.id, event: record.name },
      ]), `Created event ${record.name}`);
    });

  event
    .command("list")
    .option("--format <format>", "Output format: text or json", "text")
    .action((options: { format: Format }) => {
      const db = openDb(program);
      const records = listEvents(db);
      writeOutput(io, options.format, records, formatEventListText(records));
    });

  event
    .command("detail")
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
      const result = { event: record, summary };
      writeOutput(io, options.format, stringifyBigInts(result), formatEventDetailText(result));
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
    .option("--dry-run", "Preview the mutation without writing to the database")
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
      dryRun?: boolean;
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
      if (options.dryRun) {
        const currentExpenses = listEventExpenses(db, record.id);
        const settlementImpact = settlementPreview(record, currentExpenses, [...currentExpenses, expenseRecord]);
        const result = dryRunMutationResult(
          "expense.add",
          expenseScope(program, record.name, expenseRecord),
          [{ action: "add_expense", itemId: expenseRecord.id, eventId: record.id }],
          { expense: stringifyBigInts(expenseRecord), settlementImpact: stringifyBigInts(settlementImpact) },
        );
        writeOutput(io, options.format, result, `Dry run: would add expense ${expenseRecord.id}`);
        return;
      }
      insertExpense(db, expenseRecord);
      writeOutput(io, options.format, withMutationMetadata(stringifyBigInts(expenseRecord), expenseScope(program, record.name, expenseRecord), [
        { action: "add_expense", itemId: expenseRecord.id, eventId: record.id },
      ]), `Added expense ${expenseRecord.id}`);
    });

  const chat = program.command("chat");

  chat
    .command("parse")
    .argument("<text...>")
    .option("--event <name>", "Event context")
    .option("--paid-by <participant>", "Payer participant ID", DEFAULT_PARTICIPANT_ID)
    .option("--shared-by <people>", "Comma-separated participants")
    .option("--format <format>", "Output format: text or json", "text")
    .action((textParts: string[], options: {
      event?: string;
      paidBy: string;
      sharedBy?: string;
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
        sharedBy: options.sharedBy ? parsePeople(options.sharedBy) : undefined,
        participants: eventRecord?.participantIds,
      });
      writeOutput(io, options.format, stringifyBigInts(result), formatChatParseText(result));
    });

  chat
    .command("correct")
    .argument("<text...>")
    .option("--draft-json <json>", "Draft JSON to correct without saving")
    .option("--event <name>", "Event context for saved item correction")
    .option("--item-id <id>", "Exact saved item ID to correct")
    .option("--text <query>", "Saved item search text to correct")
    .option("--format <format>", "Output format: text or json", "text")
    .action((textParts: string[], options: {
      draftJson?: string;
      event?: string;
      itemId?: string;
      text?: string;
      format: Format;
    }) => {
      const text = textParts.join(" ");
      const db = openDb(program);
      const eventRecord = options.event ? findEventByName(db, options.event) : undefined;
      if (options.event && !eventRecord) {
        throw new Error(`Event not found: ${options.event}`);
      }

      const correction = parseChatCorrection(text, {
        defaultCurrency: eventRecord?.defaultCurrency,
      });
      if (correction.kind === "needs_clarification") {
        writeOutput(io, options.format, stringifyBigInts(correction), formatChatCorrectionText(correction));
        return;
      }

      if (options.draftJson) {
        const draft = parseDraftJson(options.draftJson);
        const corrected = applyCorrectionToDraft(draft, correction.patch);
        const result = { kind: "corrected_draft" as const, draft: corrected };
        writeOutput(io, options.format, stringifyBigInts(result), formatCorrectedDraftText(corrected));
        return;
      }

      if (!eventRecord) {
        throw new Error("Missing required option '--event <name>' for saved item correction");
      }
      if (!options.itemId && !options.text) {
        throw new Error("Missing saved item target: provide '--item-id <id>' or '--text <query>'");
      }

      const items = listExpenses(db);
      const target = resolveItemTarget(items, {
        id: options.itemId,
        text: options.text,
        eventId: eventRecord.id,
        status: "active",
      });
      if (target.kind !== "selected") {
        const result = { kind: target.kind, candidates: target.candidates };
        writeOutput(io, options.format, stringifyBigInts(result), formatItemTargetText(result));
        return;
      }

      const updateResult = editItem(items, target.item.id, toItemPatch(correction.patch));
      if (updateResult.kind === "not_found") {
        throw new Error(`Item not found: ${target.item.id}`);
      }
      updateExpense(db, updateResult.item);
      const result = { kind: "updated_item" as const, item: updateResult.item };
      writeOutput(io, options.format, withMutationMetadata(stringifyBigInts(result), itemScope(program, updateResult.item.id, eventRecord.name), [
        { action: "edit_item", itemId: updateResult.item.id },
      ]), `Updated item ${updateResult.item.id}`);
    });

  chat
    .command("items")
    .argument("<text...>")
    .option("--event <name>", "Event context")
    .option("--format <format>", "Output format: text or json", "text")
    .action((textParts: string[], options: {
      event?: string;
      format: Format;
    }) => {
      const text = textParts.join(" ");
      const db = openDb(program);
      const eventRecord = options.event ? findEventByName(db, options.event) : undefined;
      if (options.event && !eventRecord) {
        throw new Error(`Event not found: ${options.event}`);
      }
      const intent = parseChatItemIntent(text, {
        eventName: eventRecord?.name,
      });
      const filter = eventRecord ? { eventId: eventRecord.id, status: "active" as const } : { status: "active" as const };
      const results = intent.kind === "item_list"
        ? listItems(listExpenses(db), filter)
        : searchItems(listExpenses(db), {
          ...filter,
          text: intent.text,
          category: intent.category,
        });
      const result = { ...intent, items: results };
      writeOutput(io, options.format, stringifyBigInts(result), formatChatItemsText(intent, results));
    });

  chat
    .command("item")
    .argument("<text...>")
    .option("--event <name>", "Event context")
    .option("--format <format>", "Output format: text or json", "text")
    .action((textParts: string[], options: {
      event?: string;
      format: Format;
    }) => {
      const text = textParts.join(" ");
      const db = openDb(program);
      const eventRecord = options.event ? findEventByName(db, options.event) : undefined;
      if (options.event && !eventRecord) {
        throw new Error(`Event not found: ${options.event}`);
      }
      const intent = parseChatItemMutationIntent(text, {
        eventName: eventRecord?.name,
      });
      if (!intent.targetId && !intent.targetText) {
        const result = {
          kind: "needs_clarification" as const,
          missing: ["target"],
          sourceText: intent.sourceText,
        };
        writeOutput(io, options.format, stringifyBigInts(result), formatChatItemMutationText(result));
        return;
      }
      const status = intent.action === "restore" ? "deleted" : "active";
      const target = resolveItemTarget(listExpenses(db), {
        id: intent.targetId,
        text: intent.targetText,
        eventId: eventRecord?.id,
        status,
      });

      if (target.kind !== "selected") {
        const result = { kind: target.kind, action: intent.action, candidates: target.candidates };
        writeOutput(io, options.format, stringifyBigInts(result), formatItemTargetText(result));
        return;
      }

      const now = new Date().toISOString();
      const items = listExpenses(db);
      const mutation = applyChatItemMutation(items, intent, target.item.id, now, eventRecord?.defaultCurrency);
      if (mutation.kind === "needs_clarification") {
        writeOutput(io, options.format, stringifyBigInts(mutation), formatChatItemMutationText(mutation));
        return;
      }
      if (mutation.kind === "not_found") {
        throw new Error(`Item not found: ${target.item.id}`);
      }

      updateExpense(db, mutation.item);
      const result = { kind: "updated_item" as const, action: intent.action, item: mutation.item };
      writeOutput(io, options.format, withMutationMetadata(stringifyBigInts(result), itemScope(program, mutation.item.id, eventRecord?.name), [
        { action: `${intent.action}_item`, itemId: mutation.item.id },
      ]), `Updated item ${mutation.item.id}`);
    });

  chat
    .command("event")
    .argument("<text...>")
    .option("--event <name>", "Event context")
    .option("--format <format>", "Output format: text or json", "text")
    .action((textParts: string[], options: {
      event?: string;
      format: Format;
    }) => {
      const text = textParts.join(" ");
      const db = openDb(program);
      const intent = parseChatEventIntent(text, { eventName: options.event });
      if (!intent.eventName) {
        const result = {
          kind: "needs_clarification" as const,
          missing: ["event"],
          sourceText: intent.sourceText,
        };
        writeOutput(io, options.format, stringifyBigInts(result), formatChatEventClarificationText(result));
        return;
      }

      const record = findEventByName(db, intent.eventName);
      if (!record) {
        throw new Error(`Event not found: ${intent.eventName}`);
      }

      if (intent.kind === "event_settlement") {
        const settlement = calculateSettlement({
          participants: record.participantIds,
          expenses: listEventExpenses(db, record.id),
        });
        const result = { ...intent, event: record, settlement };
        writeOutput(io, options.format, stringifyBigInts(result), formatChatSettlementText(intent, settlement));
        return;
      }

      const summary = summarizeEvent({
        event: record,
        expenses: listEventExpenses(db, record.id),
      });
      const result = { ...intent, summary };
      writeOutput(io, options.format, stringifyBigInts(result), formatChatSummaryText(intent, summary));
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
    .option("--dry-run", "Preview the mutation without writing to the database")
    .option("--format <format>", "Output format: text or json", "text")
    .action((id: string, options: {
      amountMinor?: string;
      category?: string;
      description?: string;
      currency?: string;
      dryRun?: boolean;
      format: Format;
    }) => {
      const db = openDb(program);
      const items = listExpenses(db);
      const result = editItem(items, id, {
        amountMinor: options.amountMinor ? BigInt(options.amountMinor) : undefined,
        category: options.category,
        description: options.description,
        currency: options.currency,
        updatedAt: new Date().toISOString(),
      });
      if (result.kind === "not_found") {
        throw new Error(`Item not found: ${id}`);
      }
      if (options.dryRun) {
        const resultPayload = itemDryRunResult(program, db, "item.edit", id, result.item, items, [
          { action: "edit_item", itemId: id },
        ]);
        writeOutput(io, options.format, stringifyBigInts(resultPayload), `Dry run: would update item ${id}`);
        return;
      }
      updateExpense(db, result.item);
      writeOutput(io, options.format, withMutationMetadata(stringifyBigInts(result.item), itemScope(program, id), [
        { action: "edit_item", itemId: id },
      ]), `Updated item ${id}`);
    });

  item
    .command("delete")
    .argument("<id>")
    .option("--dry-run", "Preview the mutation without writing to the database")
    .option("--format <format>", "Output format: text or json", "text")
    .action((id: string, options: { dryRun?: boolean; format: Format }) => {
      const db = openDb(program);
      const items = listExpenses(db);
      const result = deleteItem(items, id, new Date().toISOString());
      if (result.kind === "not_found") {
        throw new Error(`Item not found: ${id}`);
      }
      if (options.dryRun) {
        const resultPayload = itemDryRunResult(program, db, "item.delete", id, result.item, items, [
          { action: "delete_item", itemId: id },
        ]);
        writeOutput(io, options.format, stringifyBigInts(resultPayload), `Dry run: would delete item ${id}`);
        return;
      }
      updateExpense(db, result.item);
      writeOutput(io, options.format, withMutationMetadata(stringifyBigInts(result.item), itemScope(program, id), [
        { action: "delete_item", itemId: id },
      ]), `Deleted item ${id}`);
    });

  item
    .command("restore")
    .argument("<id>")
    .option("--dry-run", "Preview the mutation without writing to the database")
    .option("--format <format>", "Output format: text or json", "text")
    .action((id: string, options: { dryRun?: boolean; format: Format }) => {
      const db = openDb(program);
      const items = listExpenses(db);
      const result = restoreItem(items, id);
      if (result.kind === "not_found") {
        throw new Error(`Item not found: ${id}`);
      }
      const restoredItem = { ...result.item, updatedAt: new Date().toISOString() };
      if (options.dryRun) {
        const resultPayload = itemDryRunResult(program, db, "item.restore", id, restoredItem, items, [
          { action: "restore_item", itemId: id },
        ]);
        writeOutput(io, options.format, stringifyBigInts(resultPayload), `Dry run: would restore item ${id}`);
        return;
      }
      updateExpense(db, restoredItem);
      writeOutput(io, options.format, withMutationMetadata(stringifyBigInts(result.item), itemScope(program, id), [
        { action: "restore_item", itemId: id },
      ]), `Restored item ${id}`);
    });

  const receipt = program.command("receipt");

  receipt
    .command("ingest")
    .argument("<image-path>")
    .requiredOption("--event <name>", "Event context for OCR language preferences")
    .option("--attachments-dir <path>", "Local attachments directory", DEFAULT_ATTACHMENTS_DIR)
    .option("--no-store-image", "Do not retain a local copy of the receipt image")
    .option("--format <format>", "Output format: text or json", "text")
    .action(async (imagePath: string, options: {
      event: string;
      attachmentsDir: string;
      storeImage: boolean;
      format: Format;
    }) => {
      const db = openDb(program);
      const eventRecord = findEventByName(db, options.event);
      if (!eventRecord) {
        throw new Error(`Event not found: ${options.event}`);
      }

      const now = new Date().toISOString();
      const receiptId = createId("rcp", `${options.event}-${imagePath}-${now}`);
      const stored = storeReceiptImage({
        receiptId,
        sourcePath: imagePath,
        attachmentsDir: options.attachmentsDir,
        storeImage: options.storeImage,
      });
      const ocr = await new AppleVisionOcrProvider().recognize({
        imagePath,
        languagePreferences: eventRecord.ocrLanguagePreferences,
      });
      const extracted = extractReceiptDraft({
        ocr,
        currencies: eventRecord.supportedCurrencies,
      });
      const record = {
        id: receiptId,
        eventId: eventRecord.id,
        ...stored,
        ocrText: formatReceiptOcrText(ocr),
        merchant: extracted.merchant,
        extractedItemsJson: JSON.stringify(extracted.items),
        extractedTotal: extracted.total,
        extractedWarningsJson: JSON.stringify(extracted.warnings),
        provider: ocr.provider,
        confidence: averageReceiptOcrConfidence(ocr),
        retainedRawOcr: true,
        createdAt: now,
      };
      insertReceipt(db, record);
      const result = {
        kind: "receipt_ingested" as const,
        receipt: record,
        event: eventRecord.name,
        ocrLanguages: eventRecord.ocrLanguagePreferences,
        lineCount: ocr.lines.length,
        extracted,
      };
      writeOutput(io, options.format, stringifyBigInts(result), formatReceiptIngestText(result));
    });

  receipt
    .command("draft")
    .argument("<id>")
    .option("--format <format>", "Output format: text or json", "text")
    .action((id: string, options: { format: Format }) => {
      const db = openDb(program);
      const receiptRecord = getReceipt(db, id);
      if (!receiptRecord) {
        throw new Error(`Receipt not found: ${id}`);
      }
      const result = {
        kind: "receipt_draft" as const,
        receiptId: id,
        eventId: receiptRecord.eventId,
        merchant: receiptRecord.merchant,
        total: receiptRecord.extractedTotal,
        items: parseExtractedReceiptItems(receiptRecord.extractedItemsJson),
        warnings: parseReceiptWarnings(receiptRecord.extractedWarningsJson),
        clarificationQuestions: buildReceiptClarificationQuestions(parseReceiptWarnings(receiptRecord.extractedWarningsJson)),
        ocrText: receiptRecord.ocrText,
        confidence: receiptRecord.confidence,
      };
      writeOutput(io, options.format, stringifyBigInts(result), formatReceiptDraftText(result));
    });

  receipt
    .command("confirm")
    .argument("<id>")
    .option("--event <name>", "Event to save confirmed receipt items into")
    .option("--type <type>", "Expense type: shared, personal, fronted-personal", "shared")
    .option("--paid-by <participant>", "Payer participant ID", DEFAULT_PARTICIPANT_ID)
    .option("--shared-by <people>", "Comma-separated participants", DEFAULT_PARTICIPANT_ID)
    .option("--owner <participant>", "Owner participant ID for personal expenses", DEFAULT_PARTICIPANT_ID)
    .option("--beneficiary <participant>", "Beneficiary participant ID for fronted personal expenses")
    .option("--category <category>", "Expense category", "food")
    .option("--description <description>", "Override description for single-total fallback")
    .option("--items <items>", "Override items as semicolon-separated name=amount entries")
    .option("--use-total", "Confirm the extracted total as one item instead of extracted item candidates")
    .option("--dry-run", "Preview the mutation without writing to the database")
    .option("--format <format>", "Output format: text or json", "text")
    .action((id: string, options: {
      event?: string;
      type: ExpenseTypeOption;
      paidBy: string;
      sharedBy: string;
      owner: string;
      beneficiary?: string;
      category: string;
      description?: string;
      items?: string;
      useTotal?: boolean;
      dryRun?: boolean;
      format: Format;
    }) => {
      const db = openDb(program);
      const receiptRecord = getReceipt(db, id);
      if (!receiptRecord) {
        throw new Error(`Receipt not found: ${id}`);
      }
      const eventRecord = options.event
        ? findEventByName(db, options.event)
        : receiptRecord.eventId ? getEventById(db, receiptRecord.eventId) : undefined;
      if (!eventRecord && options.event) {
        throw new Error(`Event not found: ${options.event}`);
      }
      if (!eventRecord) {
        throw new Error("Missing required option '--event <name>' for receipt without stored event");
      }
      if (receiptRecord.eventId && options.event && receiptRecord.eventId !== eventRecord.id) {
        throw new Error(`Receipt ${id} belongs to a different event`);
      }

      const now = new Date().toISOString();
      const confirmedItems = receiptDraftItems(receiptRecord, {
        items: options.items,
        useTotal: options.useTotal,
        description: options.description,
      });
      const expenseType = normalizeExpenseType(options.type);
      const expenses = confirmedItems.map((item, index) => {
        const description = item.name ?? options.description ?? receiptRecord.merchant ?? `Receipt ${id}`;
        const base = {
          id: createId("exp", `${eventRecord.name}-${index}-${description}-${id}-${now}`),
          eventId: eventRecord.id,
          receiptId: id,
          status: "active" as const,
          paidBy: options.paidBy as ParticipantId,
          currency: eventRecord.defaultCurrency,
          amountMinor: decimalToMinorUnits(item.amount),
          category: options.category,
          description,
          incurredAt: undefined,
          createdAt: now,
          updatedAt: now,
        };
        return createExpenseRecord(expenseType, base, options);
      });

      if (options.dryRun) {
        const currentExpenses = listEventExpenses(db, eventRecord.id);
        const settlementImpact = settlementPreview(eventRecord, currentExpenses, [
          ...currentExpenses,
          ...expenses,
        ]);
        const result = dryRunMutationResult(
          "receipt.confirm",
          receiptScope(program, eventRecord.name, id),
          [{ action: "confirm_receipt", receiptId: id, eventId: eventRecord.id, itemCount: expenses.length }],
          {
            receiptId: id,
            event: eventRecord.name,
            itemCount: expenses.length,
            expenses: stringifyBigInts(expenses),
            settlementImpact: stringifyBigInts(settlementImpact),
          },
        );
        writeOutput(io, options.format, result, `Dry run: would confirm receipt ${id} with ${expenses.length} item(s)`);
        return;
      }

      for (const expense of expenses) {
        insertExpense(db, expense);
      }

      const result = {
        kind: "receipt_confirmed" as const,
        receiptId: id,
        event: eventRecord.name,
        itemCount: expenses.length,
        expenses,
      };
      writeOutput(io, options.format, withMutationMetadata(stringifyBigInts(result), receiptScope(program, eventRecord.name, id), [
        { action: "confirm_receipt", receiptId: id, eventId: eventRecord.id, itemCount: expenses.length },
      ]), formatReceiptConfirmText(result));
    });

  receipt
    .command("image")
    .command("delete")
    .argument("<id>")
    .option("--attachments-dir <path>", "Local attachments directory", DEFAULT_ATTACHMENTS_DIR)
    .option("--format <format>", "Output format: text or json", "text")
    .action((id: string, options: { attachmentsDir: string; format: Format }) => {
      const db = openDb(program);
      const existing = getReceipt(db, id);
      if (!existing) {
        throw new Error(`Receipt not found: ${id}`);
      }
      deleteStoredReceiptImage({ attachmentsDir: options.attachmentsDir, imageRef: existing.imageRef });
      const receiptRecord = deleteReceiptImage(db, id, new Date().toISOString());
      const result = { kind: "receipt_image_deleted" as const, receipt: receiptRecord };
      writeOutput(io, options.format, stringifyBigInts(result), `Deleted receipt image ${id}`);
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

function wantsJson(argv: string[]): boolean {
  const formatIndex = argv.findIndex((arg) => arg === "--format");
  return formatIndex >= 0 && argv[formatIndex + 1] === "json";
}

function optionValue(argv: string[], option: string): string | undefined {
  const index = argv.findIndex((arg) => arg === option);
  return index >= 0 ? argv[index + 1] : undefined;
}

function withRunArtifacts(io: CliIo, artifactDir: string): CliIo {
  return {
    ...io,
    stdout: (message) => {
      const result = parseArtifactEligibleResult(message);
      if (!result) {
        io.stdout(message);
        return;
      }
      const artifactPath = writeRunArtifact(artifactDir, result);
      io.stdout(JSON.stringify({ ...result, artifactPath }));
    },
  };
}

function parseArtifactEligibleResult(message: string): Record<string, unknown> | undefined {
  try {
    const result = JSON.parse(message) as Record<string, unknown>;
    if (result.ok === false || result.dryRun === true || Array.isArray(result.sideEffects)) {
      return result;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function writeRunArtifact(artifactDir: string, result: Record<string, unknown>): string {
  mkdirSync(artifactDir, { recursive: true });
  const now = new Date().toISOString();
  const artifactPath = join(artifactDir, `expense-run-${now.replace(/[:.]/g, "-")}.json`);
  writeFileSync(artifactPath, `${JSON.stringify({
    app: "expense-tracker",
    version: "0.1.0",
    createdAt: now,
    result,
  }, null, 2)}\n`, "utf8");
  return artifactPath;
}

function errorPayload(error: unknown): {
  ok: false;
  error: { code: string; message: string; nextAction?: string; candidates: unknown[]; retryable: boolean };
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      code: errorCodeFromMessage(message),
      message,
      nextAction: nextActionFromMessage(message),
      candidates: [],
      retryable: false,
    },
  };
}

function errorCodeFromMessage(message: string): string {
  if (/^Event not found:/.test(message)) {
    return "EVENT_NOT_FOUND";
  }
  if (/^Item not found:/.test(message)) {
    return "ITEM_NOT_FOUND";
  }
  if (/^Receipt not found:/.test(message)) {
    return "RECEIPT_NOT_FOUND";
  }
  if (/Missing required option/.test(message) || /^Missing saved item target/.test(message)) {
    return "MISSING_REQUIRED_INPUT";
  }
  if (/^Invalid /.test(message)) {
    return "INVALID_INPUT";
  }
  return "COMMAND_FAILED";
}

function nextActionFromMessage(message: string): string | undefined {
  if (/^Event not found:/.test(message)) {
    return "Check the event name or create the event first.";
  }
  if (/^Item not found:/.test(message)) {
    return "List or search items, then retry with an exact item ID.";
  }
  if (/^Receipt not found:/.test(message)) {
    return "Run receipt draft/list workflow with a valid receipt ID.";
  }
  if (/Missing required option/.test(message) || /^Missing saved item target/.test(message)) {
    return "Provide the missing option and retry.";
  }
  return undefined;
}

function withMutationMetadata<T>(
  result: T,
  scope: Record<string, unknown>,
  sideEffects: Array<Record<string, unknown>>,
  warnings: string[] = [],
): T & { scope: Record<string, unknown>; sideEffects: Array<Record<string, unknown>>; warnings: string[] } {
  return {
    ...(result as object),
    scope,
    sideEffects,
    warnings,
  } as T & { scope: Record<string, unknown>; sideEffects: Array<Record<string, unknown>>; warnings: string[] };
}

function dryRunMutationResult(
  command: string,
  scope: Record<string, unknown>,
  plannedOperations: Array<Record<string, unknown>>,
  preview: Record<string, unknown>,
  warnings: string[] = [],
): Record<string, unknown> {
  return {
    ok: true,
    dryRun: true,
    command,
    ...preview,
    scope,
    plannedOperations,
    sideEffects: [],
    warnings,
  };
}

function itemDryRunResult(
  program: Command,
  db: ReturnType<typeof openDb>,
  command: string,
  itemId: string,
  plannedItem: Expense,
  currentItems: Expense[],
  plannedOperations: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const eventRecord = plannedItem.eventId ? getEventById(db, plannedItem.eventId) : undefined;
  const eventItems = eventRecord ? currentItems.filter((item) => item.eventId === eventRecord.id) : [];
  const plannedItems = eventItems.map((item) => item.id === itemId ? plannedItem : item);
  const settlementImpact = eventRecord
    ? settlementPreview(eventRecord, eventItems, plannedItems)
    : undefined;

  return dryRunMutationResult(
    command,
    itemScope(program, itemId, eventRecord?.name),
    plannedOperations,
    {
      item: plannedItem,
      settlementImpact,
    },
  );
}

function settlementPreview(
  event: { participantIds: ParticipantId[] },
  beforeExpenses: Expense[],
  afterExpenses: Expense[],
): {
  introducedParticipants: ParticipantId[];
  before: ReturnType<typeof calculateSettlement>;
  after: ReturnType<typeof calculateSettlement>;
} {
  const beforeParticipants = uniqueParticipantIds(event.participantIds);
  const afterParticipants = uniqueParticipantIds([
    ...event.participantIds,
    ...afterExpenses.flatMap((expense) => participantScope(expense)),
  ]);

  return {
    introducedParticipants: afterParticipants.filter((participant) => !beforeParticipants.includes(participant)),
    before: calculateSettlement({ participants: beforeParticipants, expenses: beforeExpenses }),
    after: calculateSettlement({ participants: afterParticipants, expenses: afterExpenses }),
  };
}

function uniqueParticipantIds(values: Array<ParticipantId | string>): ParticipantId[] {
  return [...new Set(values.map(String))].map((participant) => participant as ParticipantId);
}

function dbScope(program: Command): Record<string, unknown> {
  return { db: program.opts<{ db: string }>().db };
}

function eventScope(program: Command, event: string): Record<string, unknown> {
  return { ...dbScope(program), event };
}

function expenseScope(program: Command, event: string, expense: InsertExpenseInput): Record<string, unknown> {
  return {
    ...eventScope(program, event),
    itemId: expense.id,
    currency: expense.currency,
    participants: participantScope(expense),
  };
}

function itemScope(program: Command, itemId: string, event?: string): Record<string, unknown> {
  return {
    ...dbScope(program),
    event,
    itemId,
  };
}

function receiptScope(program: Command, event: string, receiptId: string): Record<string, unknown> {
  return {
    ...eventScope(program, event),
    receiptId,
  };
}

function participantScope(expense: Expense): ParticipantId[] {
  if (expense.type === "shared") {
    return expense.participants;
  }
  if (expense.type === "personal") {
    return [expense.owner];
  }
  return [expense.paidBy, expense.beneficiary];
}

function parsePeople(value?: string): ParticipantId[] {
  return parseCommaList(value)
    .map((person) => person as ParticipantId);
}

function parseCommaList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function receiptDraftItems(
  receipt: { extractedItemsJson?: string; extractedTotal?: string },
  options: { items?: string; useTotal?: boolean; description?: string } = {},
): Array<{ name?: string; amount: string }> {
  if (options.items) {
    return parseReceiptItemOverride(options.items);
  }
  if (options.useTotal) {
    if (!receipt.extractedTotal) {
      throw new Error("Receipt has no extracted total to confirm");
    }
    return [{ name: options.description, amount: receipt.extractedTotal }];
  }

  const items = parseExtractedReceiptItems(receipt.extractedItemsJson);
  if (items.length > 0) {
    return items;
  }
  if (receipt.extractedTotal) {
    return [{ amount: receipt.extractedTotal }];
  }
  throw new Error("Receipt has no extracted items or total to confirm");
}

function parseReceiptItemOverride(value: string): Array<{ name?: string; amount: string }> {
  const items = value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [nameOrAmount, maybeAmount] = item.split("=").map((part) => part.trim());
      if (!maybeAmount) {
        return { amount: nameOrAmount };
      }
      return { name: nameOrAmount || undefined, amount: maybeAmount };
    });

  if (items.length === 0) {
    throw new Error("Receipt item override is empty");
  }
  for (const item of items) {
    decimalToMinorUnits(item.amount);
  }
  return items;
}

function parseExtractedReceiptItems(value?: string): Array<{ name?: string; amount: string }> {
  if (!value) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Receipt extracted items are not a JSON array");
  }

  return parsed.map((item) => {
    if (!isExtractedReceiptItem(item)) {
      throw new Error("Receipt extracted item is invalid");
    }
    return {
      name: item.name,
      amount: item.amount,
    };
  });
}

function parseReceiptWarnings(value?: string): string[] {
  if (!value) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((warning) => typeof warning === "string")) {
    throw new Error("Receipt warnings are not a JSON string array");
  }
  return parsed;
}

function isExtractedReceiptItem(value: unknown): value is ExtractedReceiptItem {
  return typeof value === "object"
    && value !== null
    && typeof (value as { amount?: unknown }).amount === "string"
    && (
      (value as { name?: unknown }).name === undefined
      || typeof (value as { name?: unknown }).name === "string"
    );
}

function decimalToMinorUnits(amount: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error(`Invalid receipt amount: ${amount}`);
  }
  const [major, rawMinor = ""] = amount.split(".");
  return BigInt(major) * 100n + BigInt(rawMinor.padEnd(2, "0").slice(0, 2));
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

function formatEventListText(events: Array<{
  name: string;
  status: string;
  defaultCurrency: string;
  supportedCurrencies: string[];
  participantIds: ParticipantId[];
}>): string {
  if (events.length === 0) {
    return "No events";
  }
  return events
    .map((event) => [
      event.name,
      event.status,
      event.defaultCurrency,
      `currencies=${event.supportedCurrencies.join(",")}`,
      `participants=${event.participantIds.join(",")}`,
    ].join(" | "))
    .join("\n");
}

function formatEventDetailText(result: {
  event: {
    name: string;
    status: string;
    defaultCurrency: string;
    supportedCurrencies: string[];
    ocrLanguagePreferences: string[];
    ocrLanguageSource: string;
  };
  summary: EventSummary;
}): string {
  return [
    `${result.event.name} (${result.event.status})`,
    `Default currency: ${result.event.defaultCurrency}`,
    `Supported currencies: ${result.event.supportedCurrencies.join(", ")}`,
    `OCR languages: ${result.event.ocrLanguagePreferences.join(", ")} (${result.event.ocrLanguageSource})`,
    formatSummaryText(result.summary),
  ].join("\n");
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

  for (const [currency, participantTotals] of Object.entries(summary.participantTotals)) {
    lines.push(`Participant totals ${currency}:`);
    for (const [participant, total] of Object.entries(participantTotals)) {
      lines.push(
        `- ${participant}: paid ${total.paid.toString()} / share ${total.share.toString()} / net ${total.net.toString()}`,
      );
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

function formatReceiptIngestText(result: {
  receipt: { id: string; provider?: string; confidence?: number; imageStored: boolean; merchant?: string };
  event: string;
  ocrLanguages: string[];
  lineCount: number;
  extracted?: { currency: string; merchant?: string; total?: string; items: unknown[]; warnings: string[] };
}): string {
  return [
    `Ingested receipt ${result.receipt.id}`,
    `Event: ${result.event}`,
    `Merchant: ${result.extracted?.merchant ?? result.receipt.merchant ?? "n/a"}`,
    `OCR: ${result.receipt.provider ?? "unknown"} (${result.ocrLanguages.join(", ")})`,
    `Lines: ${result.lineCount}`,
    `Average confidence: ${result.receipt.confidence ?? "n/a"}`,
    `Extracted total: ${result.extracted?.total ? `${result.extracted.total} ${result.extracted.currency}` : "n/a"}`,
    `Extracted items: ${result.extracted?.items.length ?? 0}`,
    `Warnings: ${result.extracted?.warnings.length ? result.extracted.warnings.join(", ") : "none"}`,
    `Image stored: ${result.receipt.imageStored ? "yes" : "no"}`,
  ].join("\n");
}

function formatReceiptDraftText(result: {
  receiptId: string;
  eventId?: string;
  merchant?: string;
  total?: string;
  items: Array<{ name?: string; amount: string }>;
  warnings?: string[];
  clarificationQuestions?: string[];
  confidence?: number;
}): string {
  return [
    `Receipt draft ${result.receiptId}`,
    `Event ID: ${result.eventId ?? "n/a"}`,
    `Merchant: ${result.merchant ?? "n/a"}`,
    `Total: ${result.total ?? "n/a"}`,
    `Average confidence: ${result.confidence ?? "n/a"}`,
    `Warnings: ${result.warnings?.length ? result.warnings.join(", ") : "none"}`,
    ...((result.clarificationQuestions ?? []).map((question) => `Question: ${question}`)),
    `Items: ${result.items.length}`,
    ...result.items.map((item, index) => `${index + 1}. ${item.name ?? "item"} | ${item.amount}`),
  ].join("\n");
}

function formatReceiptConfirmText(result: {
  receiptId: string;
  event: string;
  itemCount: number;
  expenses: Array<{ id: string; amountMinor: bigint; currency: string; description?: string }>;
}): string {
  return [
    `Confirmed receipt ${result.receiptId}`,
    `Event: ${result.event}`,
    `Items added: ${result.itemCount}`,
    ...result.expenses.map((expense) => [
      expense.id,
      expense.amountMinor.toString(),
      expense.currency,
      expense.description,
    ].filter(Boolean).join(" | ")),
  ].join("\n");
}

function formatChatCorrectionText(result: ReturnType<typeof parseChatCorrection>): string {
  if (result.kind === "needs_clarification") {
    return [
      "Needs clarification before correcting.",
      `Missing: ${result.missing.join(", ")}`,
      `Source: ${result.sourceText}`,
    ].join("\n");
  }

  return `Correction patch: ${Object.keys(result.patch).join(", ")}`;
}

function formatCorrectedDraftText(draft: ChatExpenseDraft): string {
  return [
    "Corrected draft expense (confirm before saving)",
    `Event: ${draft.eventName}`,
    `Amount: ${draft.amountMinor.toString()} ${draft.currency}`,
    `Category: ${draft.category}`,
    `Paid by: ${draft.paidBy}`,
    `Shared by: ${draft.sharedBy.join(", ")}`,
    `Description: ${draft.description}`,
    `CLI: ${draft.commandArgs.map(quoteArg).join(" ")}`,
  ].join("\n");
}

function formatItemTargetText(result: { kind: "ambiguous" | "not_found"; candidates: Array<{ id: string; amountMinor: bigint; currency: string; category: string; description?: string; status: string }> }): string {
  if (result.kind === "not_found") {
    return "No matching item found";
  }
  return [
    "Multiple matching items found. Choose one item ID before correcting.",
    formatItemsText(result.candidates),
  ].join("\n");
}

function formatChatItemMutationText(result: { kind: "needs_clarification"; missing: string[]; sourceText: string }): string {
  return [
    "Needs clarification before mutating item.",
    `Missing: ${result.missing.join(", ")}`,
    `Source: ${result.sourceText}`,
  ].join("\n");
}

function formatChatEventClarificationText(result: { kind: "needs_clarification"; missing: string[]; sourceText: string }): string {
  return [
    "Needs event before showing summary or settlement.",
    `Missing: ${result.missing.join(", ")}`,
    `Source: ${result.sourceText}`,
  ].join("\n");
}

function formatChatItemsText(intent: ChatItemIntent, items: Array<{ id: string; amountMinor: bigint; currency: string; category: string; description?: string; status: string }>): string {
  const heading = intent.kind === "item_list" ? "Items" : "Matching items";
  return [heading, formatItemsText(items)].join("\n");
}

function formatChatSummaryText(intent: ChatEventIntent, summary: EventSummary): string {
  return [
    `Summary: ${intent.eventName}`,
    formatSummaryText(summary),
  ].join("\n");
}

function formatChatSettlementText(
  intent: ChatEventIntent,
  settlement: ReturnType<typeof calculateSettlement>,
): string {
  return [
    `Settlement: ${intent.eventName}`,
    formatSettlementText(settlement),
  ].join("\n");
}

function parseDraftJson(value: string): ChatExpenseDraft {
  const raw = JSON.parse(value) as unknown;
  const parsed = isDraftParseResult(raw) ? raw.draft : raw as Omit<ChatExpenseDraft, "amountMinor"> & { amountMinor: string | number | bigint };
  return {
    ...parsed,
    amountMinor: BigInt(parsed.amountMinor),
    paidBy: parsed.paidBy as ParticipantId,
    sharedBy: parsed.sharedBy.map((person) => person as ParticipantId),
    needsConfirmation: true,
  };
}

function isDraftParseResult(value: unknown): value is { kind: "draft"; draft: Omit<ChatExpenseDraft, "amountMinor"> & { amountMinor: string | number | bigint } } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "draft" &&
      "draft" in value,
  );
}

function toItemPatch(patch: ChatCorrectionPatch) {
  return {
    amountMinor: patch.amountMinor,
    currency: patch.currency,
    category: patch.category,
    description: patch.description,
    updatedAt: new Date().toISOString(),
  };
}

function applyChatItemMutation(
  items: ReturnType<typeof listExpenses>,
  intent: ChatItemMutationIntent,
  itemId: string,
  updatedAt: string,
  defaultCurrency?: string,
) {
  if (intent.action === "delete") {
    return deleteItem(items, itemId, updatedAt);
  }
  if (intent.action === "restore") {
    const result = restoreItem(items, itemId);
    if (result.kind === "not_found") {
      return result;
    }
    return {
      ...result,
      item: {
        ...result.item,
        updatedAt,
      },
    };
  }

  if (!intent.correctionText) {
    return {
      kind: "needs_clarification" as const,
      missing: ["correction"],
      sourceText: intent.sourceText,
    };
  }
  const correction = parseChatCorrection(intent.correctionText, { defaultCurrency });
  if (correction.kind === "needs_clarification") {
    return correction;
  }
  return editItem(items, itemId, toItemPatch(correction.patch));
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

function formatItemsText(items: Array<{ id: string; amountMinor: bigint; currency: string; category: string; description?: string; status: string }>): string {
  if (items.length === 0) {
    return "No items found";
  }
  return items
    .map((item) => [
      item.id,
      item.amountMinor.toString(),
      item.currency,
      item.category,
      item.description,
      item.status,
    ].filter(Boolean).join(" "))
    .join("\n");
}
