import { describe, expect, it } from "vitest";
import { summarizeEvent } from "../../src/domain/summary.js";
import type { Expense, ParticipantId } from "../../src/domain/settlement.js";

const A = "A" as ParticipantId;
const B = "B" as ParticipantId;

describe("summarizeEvent", () => {
  it("summarizes active totals, category totals, and settlement while excluding deleted items", () => {
    const expenses: Expense[] = [
      {
        id: "exp_flight",
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

    expect(summarizeEvent({
      event: {
        id: "evt_trip",
        name: "Trip",
        status: "active",
        participantIds: [A, B],
      },
      expenses,
    })).toEqual({
      event: {
        id: "evt_trip",
        name: "Trip",
        status: "active",
        participantIds: [A, B],
      },
      activeItemCount: 1,
      totalsByCurrency: {
        HKD: 240_000n,
      },
      categoryTotals: {
        HKD: {
          flight: 240_000n,
        },
      },
      settlement: {
        HKD: {
          balances: {
            A: 120_000n,
            B: -120_000n,
          },
          transfers: [
            { from: B, to: A, amountMinor: 120_000n, currency: "HKD" },
          ],
        },
      },
    });
  });
});

