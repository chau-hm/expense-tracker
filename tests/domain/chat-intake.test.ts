import { describe, expect, it } from "vitest";
import {
  applyCorrectionToDraft,
  isChatEventIntentText,
  isChatItemIntentText,
  isChatItemMutationIntentText,
  parseChatCorrection,
  parseChatEventIntent,
  parseChatExpense,
  parseChatItemIntent,
  parseChatItemMutationIntent,
} from "../../src/domain/chat-intake.js";

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

describe("chat correction parser", () => {
  it("parses amount and category corrections into a deterministic patch", () => {
    expect(parseChatCorrection("改做 $6 transport")).toEqual({
      kind: "patch",
      patch: {
        amountMinor: 600n,
        currency: "HKD",
        category: "transport",
      },
      sourceText: "改做 $6 transport",
    });
  });

  it("applies a correction to a draft without mutating saved expenses", () => {
    const parsed = parseChatExpense("交通費，$5.8", { eventName: "Daily Expenses" });
    expect(parsed.kind).toBe("draft");
    if (parsed.kind !== "draft") {
      return;
    }

    const correction = parseChatCorrection("改做 $6");
    expect(correction.kind).toBe("patch");
    if (correction.kind !== "patch") {
      return;
    }

    const corrected = applyCorrectionToDraft(parsed.draft, correction.patch);

    expect(corrected).toEqual(expect.objectContaining({
      amountMinor: 600n,
      currency: "HKD",
      category: "transport",
      description: "交通費",
    }));
    expect(corrected.commandArgs).toContain("600");
  });

  it("asks for clarification when there is no supported correction", () => {
    expect(parseChatCorrection("改返啱")).toEqual({
      kind: "needs_clarification",
      missing: ["correction"],
      sourceText: "改返啱",
    });
  });
});

describe("chat item intent parser", () => {
  it("parses list intent into item list args", () => {
    expect(isChatItemIntentText("list")).toBe(true);
    expect(parseChatItemIntent("list", { eventName: "Daily Expenses" })).toEqual({
      kind: "item_list",
      eventName: "Daily Expenses",
      commandArgs: ["item", "list", "--event", "Daily Expenses"],
      sourceText: "list",
    });
  });

  it("parses search intent into item search args with inferred category", () => {
    expect(parseChatItemIntent("list taxi", { eventName: "Trip" })).toEqual({
      kind: "item_search",
      eventName: "Trip",
      text: "taxi",
      category: "transport",
      commandArgs: ["item", "search", "--event", "Trip", "--text", "taxi", "--category", "transport"],
      sourceText: "list taxi",
    });
  });

  it("does not classify ordinary expense entries as item intents", () => {
    expect(isChatItemIntentText("交通費，$5.8")).toBe(false);
  });
});

describe("chat item mutation intent parser", () => {
  it("parses delete intent into a safe target search", () => {
    expect(isChatItemMutationIntentText("delete taxi")).toBe(true);
    expect(parseChatItemMutationIntent("delete taxi", { eventName: "Trip" })).toEqual({
      kind: "item_mutation",
      action: "delete",
      targetText: "taxi",
      targetId: undefined,
      correctionText: undefined,
      eventName: "Trip",
      commandArgs: ["chat", "item", "delete", "--text", "taxi", "--event", "Trip"],
      sourceText: "delete taxi",
    });
  });

  it("parses edit intent with target and correction text", () => {
    expect(parseChatItemMutationIntent("edit taxi 改做 $6")).toEqual({
      kind: "item_mutation",
      action: "edit",
      targetText: "taxi",
      targetId: undefined,
      correctionText: "改做 $6",
      eventName: undefined,
      commandArgs: ["chat", "item", "edit", "--text", "taxi", "--correction", "改做 $6"],
      sourceText: "edit taxi 改做 $6",
    });
  });

  it("does not classify list intents as mutation intents", () => {
    expect(isChatItemMutationIntentText("list taxi")).toBe(false);
  });
});

describe("chat event intent parser", () => {
  it("parses summary intent with event name", () => {
    expect(isChatEventIntentText("summary Daily Expenses")).toBe(true);
    expect(parseChatEventIntent("summary Daily Expenses")).toEqual({
      kind: "event_summary",
      eventName: "Daily Expenses",
      commandArgs: ["event", "summary", "Daily Expenses"],
      sourceText: "summary Daily Expenses",
    });
  });

  it("parses settlement intent with event context fallback", () => {
    expect(parseChatEventIntent("settle", { eventName: "Trip" })).toEqual({
      kind: "event_settlement",
      eventName: "Trip",
      commandArgs: ["event", "settle", "Trip"],
      sourceText: "settle",
    });
  });

  it("does not classify ordinary expense entries as event intents", () => {
    expect(isChatEventIntentText("交通費，$5.8")).toBe(false);
  });
});
