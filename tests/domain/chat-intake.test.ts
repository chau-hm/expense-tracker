import { describe, expect, it } from "vitest";
import { parseChatExpense } from "../../src/domain/chat-intake.js";

describe("chat expense intake parser", () => {
  it("parses a simple transport expense into a confirmation draft", () => {
    const result = parseChatExpense("交通費，$5.8", { eventName: "Daily Expenses" });

    expect(result).toEqual({
      kind: "draft",
      draft: expect.objectContaining({
        eventName: "Daily Expenses",
        amountMinor: 580n,
        currency: "HKD",
        category: "transport",
        description: "交通費",
        paidBy: "self",
        sharedBy: ["self"],
        needsConfirmation: true,
      }),
    });
    if (result.kind === "draft") {
      expect(result.draft.commandArgs).toEqual([
        "expense",
        "add",
        "--event",
        "Daily Expenses",
        "--paid-by",
        "self",
        "--currency",
        "HKD",
        "--amount-minor",
        "580",
        "--shared-by",
        "self",
        "--category",
        "transport",
        "--description",
        "交通費",
      ]);
    }
  });

  it("returns clarification when required context is missing", () => {
    expect(parseChatExpense("交通費，$5.8")).toEqual({
      kind: "needs_clarification",
      missing: ["event"],
      sourceText: "交通費，$5.8",
    });

    expect(parseChatExpense("交通費", { eventName: "Daily Expenses" })).toEqual({
      kind: "needs_clarification",
      missing: ["amount"],
      sourceText: "交通費",
    });
  });
});
