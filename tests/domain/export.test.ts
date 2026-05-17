import { describe, expect, it } from "vitest";
import { exportEvent } from "../../src/domain/export.js";
import type { Expense, ParticipantId } from "../../src/domain/settlement.js";

const A = "A" as ParticipantId;
const B = "B" as ParticipantId;

describe("exportEvent", () => {
  it("exports event metadata, all items, and summary", () => {
    const expenses: Expense[] = [
      {
        id: "exp_active",
        type: "shared",
        status: "active",
        paidBy: A,
        currency: "HKD",
        amountMinor: 240_000n,
        category: "flight",
        participants: [A, B],
      },
      {
        id: "exp_deleted",
        type: "personal",
        status: "deleted",
        paidBy: A,
        owner: A,
        currency: "HKD",
        amountMinor: 10_000n,
        category: "mistake",
      },
    ];

    const exported = exportEvent({
      exportedAt: "2026-05-17T00:00:00.000Z",
      event: {
        id: "evt_trip",
        name: "Trip",
        status: "active",
        participantIds: [A, B],
      },
      expenses,
    });

    expect(exported.schemaVersion).toBe(1);
    expect(exported.items.map((item) => item.id)).toEqual(["exp_active", "exp_deleted"]);
    expect(exported.summary.activeItemCount).toBe(1);
    expect(exported.summary.totalsByCurrency).toEqual({ HKD: 240_000n });
  });
});

