import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/adapters/sqlite/database.js";
import {
  createEvent,
  insertExpense,
  listEventExpenses,
} from "../../src/adapters/sqlite/repository.js";
import type { ParticipantId } from "../../src/domain/settlement.js";

const SELF = "self" as ParticipantId;
const A = "A" as ParticipantId;
const B = "B" as ParticipantId;

describe("SQLite repository", () => {
  it("creates an event with the default self participant when no participants are provided", () => {
    const db = createInMemoryDatabase();

    const event = createEvent(db, {
      id: "evt_self",
      name: "Personal",
      defaultCurrency: "HKD",
      defaultParticipantId: SELF,
      participants: [],
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    expect(event).toEqual({
      id: "evt_self",
      name: "Personal",
      defaultCurrency: "HKD",
      supportedCurrencies: ["HKD"],
      ocrLanguagePreferences: ["zh", "en"],
      ocrLanguageSource: "inferred",
      participantIds: [SELF],
      status: "active",
    });
  });

  it("stores event supported currencies and manual OCR languages", () => {
    const db = createInMemoryDatabase();

    const event = createEvent(db, {
      id: "evt_japan",
      name: "Japan",
      defaultCurrency: "HKD",
      supportedCurrencies: ["JPY"],
      ocrLanguagePreferences: ["jp", "zh"],
      defaultParticipantId: SELF,
      participants: [],
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    expect(event.supportedCurrencies).toEqual(["HKD", "JPY"]);
    expect(event.ocrLanguagePreferences).toEqual(["jp", "zh"]);
    expect(event.ocrLanguageSource).toBe("manual");
  });

  it("stores shared expense participants separately and reads domain expenses back", () => {
    const db = createInMemoryDatabase();
    createEvent(db, {
      id: "evt_trip",
      name: "Trip",
      defaultCurrency: "JPY",
      defaultParticipantId: SELF,
      participants: [A, B],
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    insertExpense(db, {
      id: "exp_dinner",
      eventId: "evt_trip",
      type: "shared",
      status: "active",
      paidBy: A,
      currency: "JPY",
      amountMinor: 9_000n,
      category: "dinner",
      description: "ramen",
      incurredAt: "2026-05-01",
      participants: [A, B],
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    });

    expect(listEventExpenses(db, "evt_trip")).toEqual([
      {
        id: "exp_dinner",
        eventId: "evt_trip",
        type: "shared",
        status: "active",
        paidBy: A,
        currency: "JPY",
        amountMinor: 9_000n,
        category: "dinner",
        description: "ramen",
        incurredAt: "2026-05-01",
        participants: [A, B],
        receiptId: undefined,
        updatedAt: "2026-05-17T00:00:00.000Z",
        deletedAt: undefined,
      },
    ]);
  });
});
