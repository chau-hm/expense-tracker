import { relations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  defaultCurrency: text("default_currency").notNull().default("HKD"),
  supportedCurrenciesJson: text("supported_currencies_json").notNull().default("[\"HKD\"]"),
  ocrLanguagePreferencesJson: text("ocr_language_preferences_json").notNull().default("[\"zh\",\"en\"]"),
  ocrLanguageSource: text("ocr_language_source", { enum: ["inferred", "manual"] }).notNull().default("inferred"),
  status: text("status", { enum: ["active", "closed"] }).notNull(),
  createdAt: text("created_at").notNull(),
  closedAt: text("closed_at"),
});

export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const eventParticipants = sqliteTable("event_participants", {
  eventId: text("event_id").notNull().references(() => events.id),
  participantId: text("participant_id").notNull().references(() => participants.id),
});

export const receipts = sqliteTable("receipts", {
  id: text("id").primaryKey(),
  eventId: text("event_id").references(() => events.id),
  imageRef: text("image_ref"),
  imageSha256: text("image_sha256"),
  imageStored: integer("image_stored", { mode: "boolean" }).notNull(),
  imageDeletedAt: text("image_deleted_at"),
  ocrText: text("ocr_text"),
  merchant: text("merchant"),
  extractedItemsJson: text("extracted_items_json"),
  extractedTotal: text("extracted_total"),
  extractedWarningsJson: text("extracted_warnings_json"),
  confidence: integer("confidence"),
  provider: text("provider"),
  retainedRawOcr: integer("retained_raw_ocr", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  eventId: text("event_id").references(() => events.id),
  receiptId: text("receipt_id").references(() => receipts.id),
  type: text("type", { enum: ["shared", "personal", "fronted_personal"] }).notNull(),
  status: text("status", { enum: ["active", "deleted"] }).notNull(),
  paidBy: text("paid_by").notNull().references(() => participants.id),
  owner: text("owner").references(() => participants.id),
  beneficiary: text("beneficiary").references(() => participants.id),
  currency: text("currency").notNull(),
  amountMinor: text("amount_minor").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  incurredAt: text("incurred_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const expenseParticipants = sqliteTable("expense_participants", {
  expenseId: text("expense_id").notNull().references(() => expenses.id),
  participantId: text("participant_id").notNull().references(() => participants.id),
});

export const eventRelations = relations(events, ({ many }) => ({
  participants: many(eventParticipants),
  expenses: many(expenses),
}));

export const expenseRelations = relations(expenses, ({ many, one }) => ({
  participants: many(expenseParticipants),
  receipt: one(receipts, {
    fields: [expenses.receiptId],
    references: [receipts.id],
  }),
}));

export const schema = {
  events,
  participants,
  eventParticipants,
  receipts,
  expenses,
  expenseParticipants,
};
