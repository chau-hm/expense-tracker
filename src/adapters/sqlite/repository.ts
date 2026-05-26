import { eq } from "drizzle-orm";
import {
  eventParticipants,
  events,
  expenseParticipants,
  expenses,
  participants,
  receipts,
} from "./schema.js";
import type { ExpenseTrackerDb } from "./database.js";
import type {
  Expense,
  ExpenseStatus,
  ParticipantId,
  SharedExpense,
} from "../../domain/settlement.js";
import {
  inferOcrLanguagePreferences,
  normalizeCurrencyList,
  type OcrLanguagePreference,
  type OcrLanguageSource,
} from "../../domain/event-ocr-context.js";

export type CreateEventInput = {
  id: string;
  name: string;
  defaultCurrency: string;
  supportedCurrencies?: string[];
  ocrLanguagePreferences?: OcrLanguagePreference[];
  defaultParticipantId: ParticipantId;
  participants: ParticipantId[];
  createdAt: string;
};

export type EventRecord = {
  id: string;
  name: string;
  defaultCurrency: string;
  supportedCurrencies: string[];
  ocrLanguagePreferences: OcrLanguagePreference[];
  ocrLanguageSource: OcrLanguageSource;
  status: "active" | "closed";
  participantIds: ParticipantId[];
};

export type InsertExpenseInput = Expense & {
  createdAt: string;
};

export type ReceiptRecord = {
  id: string;
  eventId?: string;
  imageRef?: string;
  imageSha256?: string;
  imageStored: boolean;
  imageDeletedAt?: string;
  ocrText?: string;
  merchant?: string;
  extractedItemsJson?: string;
  extractedTotal?: string;
  extractedWarningsJson?: string;
  confidence?: number;
  provider?: string;
  retainedRawOcr: boolean;
  createdAt: string;
};

export function createEvent(db: ExpenseTrackerDb, input: CreateEventInput): EventRecord {
  const participantIds = uniqueParticipants([
    input.defaultParticipantId,
    ...input.participants,
  ]);
  const supportedCurrencies = normalizeCurrencyList(input.supportedCurrencies ?? [], input.defaultCurrency);
  const ocrLanguagePreferences = input.ocrLanguagePreferences ?? inferOcrLanguagePreferences(supportedCurrencies);
  const ocrLanguageSource: OcrLanguageSource = input.ocrLanguagePreferences ? "manual" : "inferred";

  db.insert(events).values({
    id: input.id,
    name: input.name,
    defaultCurrency: input.defaultCurrency,
    supportedCurrenciesJson: JSON.stringify(supportedCurrencies),
    ocrLanguagePreferencesJson: JSON.stringify(ocrLanguagePreferences),
    ocrLanguageSource,
    status: "active",
    createdAt: input.createdAt,
  }).run();

  for (const participantId of participantIds) {
    ensureParticipant(db, participantId, input.createdAt);
    db.insert(eventParticipants).values({
      eventId: input.id,
      participantId,
    }).run();
  }

  return {
    id: input.id,
    name: input.name,
    defaultCurrency: input.defaultCurrency,
    supportedCurrencies,
    ocrLanguagePreferences,
    ocrLanguageSource,
    status: "active",
    participantIds,
  };
}

export function findEventByName(db: ExpenseTrackerDb, name: string): EventRecord | undefined {
  const event = db.select().from(events).where(eq(events.name, name)).get();
  return event ? toEventRecord(db, event) : undefined;
}

export function listEvents(db: ExpenseTrackerDb): EventRecord[] {
  return db.select()
    .from(events)
    .all()
    .map((event) => toEventRecord(db, event))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getEventById(db: ExpenseTrackerDb, id: string): EventRecord | undefined {
  const event = db.select().from(events).where(eq(events.id, id)).get();
  return event ? toEventRecord(db, event) : undefined;
}

function toEventRecord(db: ExpenseTrackerDb, event: typeof events.$inferSelect): EventRecord {
  const participantRows = db
    .select()
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, event.id))
    .all();

  return {
    id: event.id,
    name: event.name,
    defaultCurrency: event.defaultCurrency,
    supportedCurrencies: parseJsonList(event.supportedCurrenciesJson, [event.defaultCurrency]),
    ocrLanguagePreferences: parseJsonList(event.ocrLanguagePreferencesJson, ["zh", "en"]) as OcrLanguagePreference[],
    ocrLanguageSource: event.ocrLanguageSource,
    status: event.status,
    participantIds: sortParticipantIds(participantRows.map((row) => row.participantId as ParticipantId)),
  };
}

export function insertExpense(db: ExpenseTrackerDb, expense: InsertExpenseInput): void {
  const participantIds = expenseParticipantIds(expense);
  for (const participantId of participantIds) {
    ensureParticipant(db, participantId, expense.createdAt);
  }
  if (expense.eventId) {
    ensureEventParticipants(db, expense.eventId, participantIds, expense.createdAt);
  }

  db.insert(expenses).values({
    id: expense.id,
    eventId: expense.eventId,
    receiptId: expense.receiptId,
    type: expense.type,
    status: expense.status,
    paidBy: expense.paidBy,
    owner: expense.type === "personal" ? expense.owner : undefined,
    beneficiary: expense.type === "fronted_personal" ? expense.beneficiary : undefined,
    currency: expense.currency,
    amountMinor: expense.amountMinor.toString(),
    category: expense.category,
    description: expense.description,
    incurredAt: expense.incurredAt,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    deletedAt: expense.deletedAt,
  }).run();

  if (expense.type === "shared") {
    for (const participantId of expense.participants) {
      db.insert(expenseParticipants).values({
        expenseId: expense.id,
        participantId,
      }).run();
    }
  }
}

export function listEventExpenses(db: ExpenseTrackerDb, eventId: string): Expense[] {
  const rows = db.select().from(expenses).where(eq(expenses.eventId, eventId)).all();

  return rows.map((row) => toDomainExpense(db, row));
}

export function listExpenses(db: ExpenseTrackerDb): Expense[] {
  return db.select().from(expenses).all().map((row) => toDomainExpense(db, row));
}

export function updateExpense(db: ExpenseTrackerDb, expense: Expense): void {
  const updatedAt = expense.updatedAt ?? new Date().toISOString();
  const participantIds = expenseParticipantIds(expense);
  for (const participantId of participantIds) {
    ensureParticipant(db, participantId, updatedAt);
  }
  if (expense.eventId) {
    ensureEventParticipants(db, expense.eventId, participantIds, updatedAt);
  }

  db.update(expenses)
    .set({
      eventId: expense.eventId,
      receiptId: expense.receiptId,
      type: expense.type,
      status: expense.status,
      paidBy: expense.paidBy,
      owner: expense.type === "personal" ? expense.owner : null,
      beneficiary: expense.type === "fronted_personal" ? expense.beneficiary : null,
      currency: expense.currency,
      amountMinor: expense.amountMinor.toString(),
      category: expense.category,
      description: expense.description,
      incurredAt: expense.incurredAt,
      updatedAt: expense.updatedAt,
      deletedAt: expense.deletedAt,
    })
    .where(eq(expenses.id, expense.id))
    .run();

  db.delete(expenseParticipants).where(eq(expenseParticipants.expenseId, expense.id)).run();
  if (expense.type === "shared") {
    for (const participantId of expense.participants) {
      db.insert(expenseParticipants)
        .values({ expenseId: expense.id, participantId })
        .run();
    }
  }
}

export function insertReceipt(db: ExpenseTrackerDb, receipt: ReceiptRecord): void {
  db.insert(receipts).values({
    id: receipt.id,
    eventId: receipt.eventId,
    imageRef: receipt.imageRef,
    imageSha256: receipt.imageSha256,
    imageStored: receipt.imageStored,
    imageDeletedAt: receipt.imageDeletedAt,
    ocrText: receipt.ocrText,
    merchant: receipt.merchant,
    extractedItemsJson: receipt.extractedItemsJson,
    extractedTotal: receipt.extractedTotal,
    extractedWarningsJson: receipt.extractedWarningsJson,
    confidence: receipt.confidence,
    provider: receipt.provider,
    retainedRawOcr: receipt.retainedRawOcr,
    createdAt: receipt.createdAt,
  }).run();
}

export function getReceipt(db: ExpenseTrackerDb, id: string): ReceiptRecord | undefined {
  const row = db.select().from(receipts).where(eq(receipts.id, id)).get();
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    eventId: row.eventId ?? undefined,
    imageRef: row.imageRef ?? undefined,
    imageSha256: row.imageSha256 ?? undefined,
    imageStored: row.imageStored,
    imageDeletedAt: row.imageDeletedAt ?? undefined,
    ocrText: row.ocrText ?? undefined,
    merchant: row.merchant ?? undefined,
    extractedItemsJson: row.extractedItemsJson ?? undefined,
    extractedTotal: row.extractedTotal ?? undefined,
    extractedWarningsJson: row.extractedWarningsJson ?? undefined,
    confidence: row.confidence ?? undefined,
    provider: row.provider ?? undefined,
    retainedRawOcr: row.retainedRawOcr,
    createdAt: row.createdAt,
  };
}

export function deleteReceiptImage(
  db: ExpenseTrackerDb,
  id: string,
  imageDeletedAt: string,
): ReceiptRecord | undefined {
  db.update(receipts)
    .set({
      imageStored: false,
      imageDeletedAt,
    })
    .where(eq(receipts.id, id))
    .run();
  return getReceipt(db, id);
}

function toDomainExpense(db: ExpenseTrackerDb, row: typeof expenses.$inferSelect): Expense {
  if (row.type === "shared") {
    const participantRows = db
      .select()
      .from(expenseParticipants)
      .where(eq(expenseParticipants.expenseId, row.id))
      .all();
    return {
      ...toExpenseBase(row),
      type: "shared",
      participants: participantRows.map((participant) => participant.participantId as ParticipantId),
    } satisfies SharedExpense;
  }

  if (row.type === "personal") {
    if (!row.owner) {
      throw new Error(`Personal expense ${row.id} is missing owner`);
    }
    return {
      ...toExpenseBase(row),
      type: "personal",
      owner: row.owner as ParticipantId,
    };
  }

  if (!row.beneficiary) {
    throw new Error(`Fronted personal expense ${row.id} is missing beneficiary`);
  }
  return {
    ...toExpenseBase(row),
    type: "fronted_personal",
    beneficiary: row.beneficiary as ParticipantId,
  };
}

function ensureParticipant(
  db: ExpenseTrackerDb,
  participantId: ParticipantId,
  createdAt: string,
): void {
  db.insert(participants)
    .values({
      id: participantId,
      displayName: participantId,
      createdAt,
    })
    .onConflictDoNothing()
    .run();
}

function ensureEventParticipants(
  db: ExpenseTrackerDb,
  eventId: string,
  participantIds: ParticipantId[],
  createdAt: string,
): void {
  for (const participantId of uniqueParticipants(participantIds)) {
    ensureParticipant(db, participantId, createdAt);
    db.insert(eventParticipants)
      .values({
        eventId,
        participantId,
      })
      .onConflictDoNothing()
      .run();
  }
}

function expenseParticipantIds(expense: Expense): ParticipantId[] {
  if (expense.type === "personal") {
    return uniqueParticipants([expense.paidBy, expense.owner]);
  }
  if (expense.type === "fronted_personal") {
    return uniqueParticipants([expense.paidBy, expense.beneficiary]);
  }
  return uniqueParticipants([expense.paidBy, ...expense.participants]);
}

function uniqueParticipants(participantIds: ParticipantId[]): ParticipantId[] {
  return [...new Set(participantIds)];
}

function sortParticipantIds(participantIds: ParticipantId[]): ParticipantId[] {
  return [...participantIds].sort((left, right) => {
    if (left === "self") {
      return -1;
    }
    if (right === "self") {
      return 1;
    }
    return left.localeCompare(right);
  });
}

function parseJsonList(value: string, fallback: string[]): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : fallback;
  } catch {
    return fallback;
  }
}

function toExpenseBase(row: typeof expenses.$inferSelect) {
  return {
    id: row.id,
    eventId: row.eventId ?? undefined,
    status: row.status as ExpenseStatus,
    paidBy: row.paidBy as ParticipantId,
    currency: row.currency,
    amountMinor: BigInt(row.amountMinor),
    category: row.category,
    description: row.description ?? undefined,
    incurredAt: row.incurredAt ?? undefined,
    receiptId: row.receiptId ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}
