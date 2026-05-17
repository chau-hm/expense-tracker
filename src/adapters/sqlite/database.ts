import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { schema } from "./schema.js";

export type ExpenseTrackerDb = BetterSQLite3Database<typeof schema>;

export function createInMemoryDatabase(): ExpenseTrackerDb {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db);
  return db;
}

export function createDatabase(path: string): ExpenseTrackerDb {
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrateIfNeeded(db);
  return db;
}

function migrateIfNeeded(db: ExpenseTrackerDb): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS event_participants (
      event_id TEXT NOT NULL REFERENCES events(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      PRIMARY KEY (event_id, participant_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      image_ref TEXT,
      image_sha256 TEXT,
      image_stored INTEGER NOT NULL,
      image_deleted_at TEXT,
      ocr_text TEXT,
      extracted_items_json TEXT,
      extracted_total TEXT,
      confidence INTEGER,
      provider TEXT,
      retained_raw_ocr INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      event_id TEXT REFERENCES events(id),
      receipt_id TEXT REFERENCES receipts(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      paid_by TEXT NOT NULL REFERENCES participants(id),
      owner TEXT REFERENCES participants(id),
      beneficiary TEXT REFERENCES participants(id),
      currency TEXT NOT NULL,
      amount_minor TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      incurred_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS expense_participants (
      expense_id TEXT NOT NULL REFERENCES expenses(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      PRIMARY KEY (expense_id, participant_id)
    )
  `);
}

function migrate(db: ExpenseTrackerDb): void {
  db.run(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE participants (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE event_participants (
      event_id TEXT NOT NULL REFERENCES events(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      PRIMARY KEY (event_id, participant_id)
    )
  `);
  db.run(`
    CREATE TABLE receipts (
      id TEXT PRIMARY KEY,
      image_ref TEXT,
      image_sha256 TEXT,
      image_stored INTEGER NOT NULL,
      image_deleted_at TEXT,
      ocr_text TEXT,
      extracted_items_json TEXT,
      extracted_total TEXT,
      confidence INTEGER,
      provider TEXT,
      retained_raw_ocr INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY,
      event_id TEXT REFERENCES events(id),
      receipt_id TEXT REFERENCES receipts(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      paid_by TEXT NOT NULL REFERENCES participants(id),
      owner TEXT REFERENCES participants(id),
      beneficiary TEXT REFERENCES participants(id),
      currency TEXT NOT NULL,
      amount_minor TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      incurred_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE expense_participants (
      expense_id TEXT NOT NULL REFERENCES expenses(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      PRIMARY KEY (expense_id, participant_id)
    )
  `);
}
