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

  it("keeps rounding remainders balanced across repeated uneven splits", () => {
    const expenses: Expense[] = [
      {
        id: "exp_first_remainder",
        type: "shared",
        status: "active",
        paidBy: A,
        currency: "HKD",
        amountMinor: 100n,
        category: "snack",
        participants: [A, B, C],
      },
      {
        id: "exp_second_remainder",
        type: "shared",
        status: "active",
        paidBy: B,
        currency: "HKD",
        amountMinor: 101n,
        category: "snack",
        participants: [C, B, A],
      },
    ];

    const settlement = calculateSettlement({ participants: [A, B, C], expenses });

    expect(settlement.categoryTotals.HKD).toEqual({ snack: 201n });
    expect(settlement.byCurrency.HKD.balances).toEqual({
      A: 33n,
      B: 34n,
      C: -67n,
    });
    expect(settlement.byCurrency.HKD.transfers).toEqual([
      { from: C, to: A, amountMinor: 33n, currency: "HKD" },
      { from: C, to: B, amountMinor: 34n, currency: "HKD" },
    ]);
  });

  it("supports shared expenses with unequal participant sets in one event", () => {
    const expenses: Expense[] = [
      {
        id: "exp_ab_taxi",
        type: "shared",
        status: "active",
        paidBy: A,
        currency: "HKD",
        amountMinor: 90n,
        category: "taxi",
        participants: [A, B],
      },
      {
        id: "exp_bc_snack",
        type: "shared",
        status: "active",
        paidBy: C,
        currency: "HKD",
        amountMinor: 120n,
        category: "snack",
        participants: [B, C],
      },
    ];

    const settlement = calculateSettlement({ participants: [A, B, C], expenses });

    expect(settlement.byCurrency.HKD.balances).toEqual({
      A: 45n,
      B: -105n,
      C: 60n,
    });
    expect(settlement.byCurrency.HKD.transfers).toEqual([
      { from: B, to: A, amountMinor: 45n, currency: "HKD" },
      { from: B, to: C, amountMinor: 60n, currency: "HKD" },
    ]);
  });

  it("preserves fronted personal repayments alongside shared settlement transfers", () => {
    const expenses: Expense[] = [
      {
        id: "exp_shared_meal",
        type: "shared",
        status: "active",
        paidBy: A,
        currency: "HKD",
        amountMinor: 120n,
        category: "meal",
        participants: [A, B],
      },
      {
        id: "exp_fronted_ticket",
        type: "fronted_personal",
        status: "active",
        paidBy: B,
        beneficiary: A,
        currency: "HKD",
        amountMinor: 30n,
        category: "ticket",
      },
    ];

    const settlement = calculateSettlement({ participants: [A, B], expenses });

    expect(settlement.byCurrency.HKD.balances).toEqual({
      A: 60n,
      B: -60n,
    });
    expect(settlement.byCurrency.HKD.transfers).toEqual([
      { from: B, to: A, amountMinor: 60n, currency: "HKD" },
      { from: A, to: B, amountMinor: 30n, currency: "HKD" },
    ]);
    expect(settlement.categoryTotals.HKD).toEqual({
      meal: 120n,
      ticket: 30n,
    });
  });
});
