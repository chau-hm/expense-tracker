import { describe, expect, it } from "vitest";
import {
  deleteItem,
  editItem,
  listItems,
  resolveItemTarget,
  restoreItem,
  searchItems,
} from "../../src/domain/items.js";
import { calculateSettlement, type Expense, type ParticipantId } from "../../src/domain/settlement.js";

const SELF = "self" as ParticipantId;
const A = "A" as ParticipantId;
const B = "B" as ParticipantId;

const baseItems: Expense[] = [
  {
    id: "exp_dinner",
    type: "shared",
    status: "active",
    eventId: "evt_trip",
    paidBy: A,
    currency: "JPY",
    amountMinor: 9_000n,
    category: "dinner",
    description: "ramen dinner",
    incurredAt: "2026-05-01",
    participants: [A, B],
  },
  {
    id: "exp_hotel",
    type: "shared",
    status: "active",
    eventId: "evt_trip",
    paidBy: B,
    currency: "JPY",
    amountMinor: 20_000n,
    category: "hotel",
    description: "hotel booking",
    incurredAt: "2026-05-02",
    receiptId: "rcp_hotel",
    participants: [A, B],
  },
  {
    id: "exp_deleted",
    type: "personal",
    status: "deleted",
    eventId: "evt_trip",
    paidBy: SELF,
    owner: SELF,
    currency: "HKD",
    amountMinor: 1_000n,
    category: "snack",
    description: "wrong item",
    incurredAt: "2026-05-03",
    deletedAt: "2026-05-04T00:00:00.000Z",
  },
];

describe("item list/search", () => {
  it("lists active items by default with stable item IDs and context", () => {
    expect(listItems(baseItems)).toEqual([
      expect.objectContaining({
        id: "exp_dinner",
        status: "active",
        eventId: "evt_trip",
        paidBy: A,
        amountMinor: 9_000n,
        currency: "JPY",
        category: "dinner",
        description: "ramen dinner",
      }),
      expect.objectContaining({
        id: "exp_hotel",
        status: "active",
        receiptId: "rcp_hotel",
      }),
    ]);
  });

  it("searches with filters and hides deleted items unless requested", () => {
    expect(searchItems(baseItems, { text: "hotel", currency: "JPY" }).map((item) => item.id)).toEqual([
      "exp_hotel",
    ]);
    expect(searchItems(baseItems, { text: "wrong" })).toEqual([]);
    expect(searchItems(baseItems, { text: "wrong", status: "all" }).map((item) => item.id)).toEqual([
      "exp_deleted",
    ]);
  });
});

describe("item mutation", () => {
  it("edits one item by exact ID and settlement recalculates from the returned collection", () => {
    const result = editItem(baseItems, "exp_dinner", {
      amountMinor: 10_000n,
      category: "food",
      description: "sushi dinner",
    });

    expect(result.kind).toBe("updated");
    if (result.kind !== "updated") {
      return;
    }

    expect(result.items.find((item) => item.id === "exp_dinner")).toEqual(
      expect.objectContaining({
        amountMinor: 10_000n,
        category: "food",
        description: "sushi dinner",
      }),
    );

    const settlement = calculateSettlement({ participants: [A, B], expenses: result.items });
    expect(settlement.byCurrency.JPY.transfers).toEqual([
      { from: A, to: B, amountMinor: 5_000n, currency: "JPY" },
    ]);
  });

  it("soft deletes and restores an item by exact ID", () => {
    const deleted = deleteItem(baseItems, "exp_hotel", "2026-05-05T00:00:00.000Z");

    expect(deleted.kind).toBe("updated");
    if (deleted.kind !== "updated") {
      return;
    }
    expect(deleted.items.find((item) => item.id === "exp_hotel")).toEqual(
      expect.objectContaining({
        status: "deleted",
        deletedAt: "2026-05-05T00:00:00.000Z",
      }),
    );

    const restored = restoreItem(deleted.items, "exp_hotel");

    expect(restored.kind).toBe("updated");
    if (restored.kind !== "updated") {
      return;
    }
    expect(restored.items.find((item) => item.id === "exp_hotel")).toEqual(
      expect.objectContaining({
        status: "active",
        deletedAt: undefined,
      }),
    );
  });

  it("does not mutate when target selection is ambiguous", () => {
    const target = resolveItemTarget(baseItems, { text: "dinner hotel", eventId: "evt_trip" });

    expect(target.kind).toBe("ambiguous");
    if (target.kind !== "ambiguous") {
      return;
    }
    expect(target.candidates.map((item) => item.id)).toEqual(["exp_dinner", "exp_hotel"]);
    expect(baseItems.find((item) => item.id === "exp_hotel")?.status).toBe("active");
  });

  it("fails missing exact IDs without mutating the collection", () => {
    const result = editItem(baseItems, "missing", { amountMinor: 1n });

    expect(result).toEqual({ kind: "not_found", items: baseItems });
  });
});

