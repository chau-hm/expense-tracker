import { describe, expect, it } from "vitest";
import {
  calculateSettlement,
  type Expense,
  type ParticipantId,
} from "../../src/domain/settlement.js";

const A = "A" as ParticipantId;
const B = "B" as ParticipantId;
const C = "C" as ParticipantId;

describe("calculateSettlement", () => {
  it("settles shared, personal, and fronted personal expenses independently by currency", () => {
    const expenses: Expense[] = [
      {
        id: "exp_flight",
        type: "shared",
        status: "active",
        paidBy: A,
        currency: "HKD",
        amountMinor: 240_000n,
        category: "flight",
        participants: [A, B, C],
      },
      {
        id: "exp_dinner",
        type: "shared",
        status: "active",
        paidBy: B,
        currency: "JPY",
        amountMinor: 9_000n,
        category: "dinner",
        participants: [A, B, C],
      },
      {
        id: "exp_hotel",
        type: "shared",
        status: "active",
        paidBy: C,
        currency: "USD",
        amountMinor: 120_000n,
        category: "hotel",
        participants: [A, B, C],
      },
      {
        id: "exp_a_souvenir",
        type: "personal",
        status: "active",
        paidBy: A,
        owner: A,
        currency: "HKD",
        amountMinor: 50_000n,
        category: "souvenir",
      },
      {
        id: "exp_b_souvenir_fronted",
        type: "fronted_personal",
        status: "active",
        paidBy: C,
        beneficiary: B,
        currency: "JPY",
        amountMinor: 3_000n,
        category: "souvenir",
      },
    ];

    const settlement = calculateSettlement({ participants: [A, B, C], expenses });

    expect(settlement.byCurrency.HKD.transfers).toEqual([
      { from: B, to: A, amountMinor: 80_000n, currency: "HKD" },
      { from: C, to: A, amountMinor: 80_000n, currency: "HKD" },
    ]);
    expect(settlement.byCurrency.JPY.transfers).toEqual([
      { from: A, to: B, amountMinor: 3_000n, currency: "JPY" },
      { from: C, to: B, amountMinor: 3_000n, currency: "JPY" },
      { from: B, to: C, amountMinor: 3_000n, currency: "JPY" },
    ]);
    expect(settlement.byCurrency.USD.transfers).toEqual([
      { from: A, to: C, amountMinor: 40_000n, currency: "USD" },
      { from: B, to: C, amountMinor: 40_000n, currency: "USD" },
    ]);
    expect(settlement.categoryTotals.HKD).toEqual({
      flight: 240_000n,
      souvenir: 50_000n,
    });
  });

  it("ignores deleted expenses in balances and category totals", () => {
    const expenses: Expense[] = [
      {
        id: "exp_deleted",
        type: "shared",
        status: "deleted",
        paidBy: A,
        currency: "HKD",
        amountMinor: 300_000n,
        category: "mistake",
        participants: [A, B, C],
      },
    ];

    const settlement = calculateSettlement({ participants: [A, B, C], expenses });

    expect(settlement.byCurrency).toEqual({});
    expect(settlement.categoryTotals).toEqual({});
  });

  it("assigns equal-split remainder deterministically by participant order", () => {
    const expenses: Expense[] = [
      {
        id: "exp_remainder",
        type: "shared",
        status: "active",
        paidBy: A,
        currency: "HKD",
        amountMinor: 100n,
        category: "snack",
        participants: [A, B, C],
      },
    ];

    const settlement = calculateSettlement({ participants: [A, B, C], expenses });

    expect(settlement.byCurrency.HKD.balances).toEqual({
      A: 66n,
      B: -33n,
      C: -33n,
    });
    expect(settlement.byCurrency.HKD.transfers).toEqual([
      { from: B, to: A, amountMinor: 33n, currency: "HKD" },
      { from: C, to: A, amountMinor: 33n, currency: "HKD" },
    ]);
  });
});
