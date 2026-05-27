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
      participantTotals: {
        HKD: {
          A: {
            paid: 240_000n,
            share: 120_000n,
            net: 120_000n,
          },
          B: {
            paid: 0n,
            share: 120_000n,
            net: -120_000n,
          },
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

  it("calculates per-participant paid, share, and net totals across shared and personal expenses", () => {
    const expenses: Expense[] = [
      {
        id: "exp_shared",
        type: "shared",
        status: "active",
        paidBy: A,
        currency: "HKD",
        amountMinor: 10_001n,
        category: "food",
        participants: [A, B],
      },
      {
        id: "exp_personal",
        type: "personal",
        status: "active",
        paidBy: B,
        owner: B,
        currency: "HKD",
        amountMinor: 2_500n,
        category: "coffee",
      },
      {
        id: "exp_fronted",
        type: "fronted_personal",
        status: "active",
        paidBy: A,
        beneficiary: B,
        currency: "MOP",
        amountMinor: 8_800n,
        category: "shopping",
      },
    ];

    const summary = summarizeEvent({
      event: {
        id: "evt_trip",
        name: "Trip",
        status: "active",
        participantIds: [A, B],
      },
      expenses,
    });

    expect(summary.participantTotals).toEqual({
      HKD: {
        A: { paid: 10_001n, share: 5_001n, net: 5_000n },
        B: { paid: 2_500n, share: 7_500n, net: -5_000n },
      },
      MOP: {
        A: { paid: 8_800n, share: 0n, net: 8_800n },
        B: { paid: 0n, share: 8_800n, net: -8_800n },
      },
    });
  });
});
