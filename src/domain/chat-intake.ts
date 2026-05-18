import type { ParticipantId } from "./settlement.js";

export type ChatExpenseDraft = {
  eventName: string;
  amountMinor: bigint;
  currency: string;
  category: string;
  description: string;
  paidBy: ParticipantId;
  sharedBy: ParticipantId[];
  sourceText: string;
  commandArgs: string[];
  needsConfirmation: true;
};

export type ChatParseResult =
  | {
    kind: "draft";
    draft: ChatExpenseDraft;
  }
  | {
    kind: "needs_clarification";
    missing: Array<"event" | "amount">;
    sourceText: string;
  };

export type ChatParseContext = {
  eventName?: string;
  defaultCurrency?: string;
  paidBy?: ParticipantId;
  sharedBy?: ParticipantId[];
};

type ParsedAmount = {
  amountMinor: bigint;
  currency?: string;
};

const DEFAULT_CURRENCY = "HKD";
const DEFAULT_PARTICIPANT = "self" as ParticipantId;

export function parseChatExpense(input: string, context: ChatParseContext = {}): ChatParseResult {
  const sourceText = input.trim();
  const amount = parseAmount(sourceText, context.defaultCurrency ?? DEFAULT_CURRENCY);
  const missing: Array<"event" | "amount"> = [];
  if (!context.eventName) {
    missing.push("event");
  }
  if (!amount) {
    missing.push("amount");
  }
  if (missing.length > 0) {
    return {
      kind: "needs_clarification",
      missing,
      sourceText,
    };
  }
  const eventName = context.eventName;
  if (!eventName || !amount) {
    throw new Error("Chat parser invariant failed after clarification guard");
  }

  const paidBy = context.paidBy ?? DEFAULT_PARTICIPANT;
  const sharedBy = context.sharedBy && context.sharedBy.length > 0 ? context.sharedBy : [DEFAULT_PARTICIPANT];
  const currency = amount.currency ?? context.defaultCurrency ?? DEFAULT_CURRENCY;
  const category = inferCategory(sourceText);
  const description = inferDescription(sourceText, category);
  const commandArgs = [
    "expense",
    "add",
    "--event",
    eventName,
    "--paid-by",
    paidBy,
    "--currency",
    currency,
    "--amount-minor",
    amount.amountMinor.toString(),
    "--shared-by",
    sharedBy.join(","),
    "--category",
    category,
    "--description",
    description,
  ];

  return {
    kind: "draft",
    draft: {
      eventName,
      amountMinor: amount.amountMinor,
      currency,
      category,
      description,
      paidBy,
      sharedBy,
      sourceText,
      commandArgs,
      needsConfirmation: true,
    },
  };
}

function parseAmount(text: string, defaultCurrency: string): ParsedAmount | undefined {
  const match = text.match(/(?:(HKD|USD|JPY|港幣|美元|日圓|日元)\s*)?(\$)?\s*(\d+(?:\.\d{1,2})?)/i);
  if (!match) {
    return undefined;
  }
  const explicitCurrency = normalizeCurrency(match[1], match[2]);
  const currency = explicitCurrency ?? defaultCurrency;
  return {
    amountMinor: decimalToMinorUnits(match[3], currency),
    currency: explicitCurrency,
  };
}

function decimalToMinorUnits(value: string, currency: string): bigint {
  const [major, rawMinor = ""] = value.split(".");
  const decimals = currency === "JPY" ? 0 : 2;
  if (decimals === 0) {
    return BigInt(major);
  }
  const minor = rawMinor.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(major) * 100n + BigInt(minor || "0");
}

function normalizeCurrency(value?: string, dollarSign?: string): string | undefined {
  if (!value && dollarSign) {
    return DEFAULT_CURRENCY;
  }
  const upper = value?.toUpperCase();
  if (upper === "HKD" || value === "港幣") {
    return "HKD";
  }
  if (upper === "USD" || value === "美元") {
    return "USD";
  }
  if (upper === "JPY" || value === "日圓" || value === "日元") {
    return "JPY";
  }
  return undefined;
}

function inferCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/(交通|車費|地鐵|巴士|的士|taxi|uber|mtr|bus|train)/i.test(lower)) {
    return "transport";
  }
  if (/(食|飯|餐|早餐|午餐|晚餐|咖啡|茶|lunch|dinner|breakfast|coffee|food|meal)/i.test(lower)) {
    return "food";
  }
  return "general";
}

function inferDescription(text: string, category: string): string {
  const withoutAmount = text
    .replace(/(?:(HKD|USD|JPY|港幣|美元|日圓|日元)\s*)?\$?\s*\d+(?:\.\d{1,2})?/gi, "")
    .replace(/[，,。.;；:：]+/g, " ")
    .trim();
  return withoutAmount || category;
}
