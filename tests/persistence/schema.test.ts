import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/adapters/sqlite/database.js";
import {
  createEvent,
  findEventByName,
  getReceipt,
  insertExpense,
  insertReceipt,
  listEventExpenses,
  updateExpense,
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

  it("stores receipt event linkage", () => {
    const db = createInMemoryDatabase();
    createEvent(db, {
      id: "evt_food",
      name: "Food",
      defaultCurrency: "HKD",
      defaultParticipantId: SELF,
      participants: [],
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    insertReceipt(db, {
      id: "rcp_food",
      eventId: "evt_food",
      imageStored: false,
      extractedTotal: "91.00",
      retainedRawOcr: true,
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    expect(getReceipt(db, "rcp_food")).toEqual(expect.objectContaining({
      id: "rcp_food",
      eventId: "evt_food",
      extractedTotal: "91.00",
    }));
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

  it("adds newly introduced expense participants to the event membership", () => {
    const db = createInMemoryDatabase();
    createEvent(db, {
      id: "evt_trip",
      name: "Trip",
      defaultCurrency: "HKD",
      defaultParticipantId: SELF,
      participants: [],
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    insertExpense(db, {
      id: "exp_taxi",
      eventId: "evt_trip",
      type: "shared",
      status: "active",
      paidBy: A,
      currency: "HKD",
      amountMinor: 12_000n,
      category: "taxi",
      participants: [A, B],
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    });

    expect(findEventByName(db, "Trip")?.participantIds).toEqual([SELF, A, B]);
  });

  it("updates event membership when an expense changes payer or beneficiary", () => {
    const db = createInMemoryDatabase();
    createEvent(db, {
      id: "evt_trip",
      name: "Trip",
      defaultCurrency: "HKD",
      defaultParticipantId: SELF,
      participants: [A],
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    insertExpense(db, {
      id: "exp_ticket",
      eventId: "evt_trip",
      type: "fronted_personal",
      status: "active",
      paidBy: A,
      beneficiary: SELF,
      currency: "HKD",
      amountMinor: 12_000n,
      category: "ticket",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    });

    updateExpense(db, {
      id: "exp_ticket",
      eventId: "evt_trip",
      type: "fronted_personal",
      status: "active",
      paidBy: B,
      beneficiary: A,
      currency: "HKD",
      amountMinor: 12_000n,
      category: "ticket",
      updatedAt: "2026-05-18T00:00:00.000Z",
    });

    expect(findEventByName(db, "Trip")?.participantIds).toEqual([SELF, A, B]);
  });

  it("adds personal expense payer and owner to the event membership once", () => {
    const db = createInMemoryDatabase();
    createEvent(db, {
      id: "evt_trip",
      name: "Trip",
      defaultCurrency: "HKD",
      defaultParticipantId: SELF,
      participants: [A],
      createdAt: "2026-05-17T00:00:00.000Z",
    });

    insertExpense(db, {
      id: "exp_personal",
      eventId: "evt_trip",
      type: "personal",
      status: "active",
      paidBy: A,
      owner: B,
      currency: "HKD",
      amountMinor: 12_000n,
      category: "souvenir",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    });

    expect(findEventByName(db, "Trip")?.participantIds).toEqual([SELF, A, B]);
  });
});
