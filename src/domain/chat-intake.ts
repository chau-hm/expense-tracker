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

export type ChatCorrectionPatch = {
  amountMinor?: bigint;
  currency?: string;
  category?: string;
  description?: string;
};

export type ChatItemIntent =
  | {
    kind: "item_list";
    eventName?: string;
    commandArgs: string[];
    sourceText: string;
  }
  | {
    kind: "item_search";
    eventName?: string;
    text?: string;
    category?: string;
    commandArgs: string[];
    sourceText: string;
  };

export type ChatItemMutationIntent = {
  kind: "item_mutation";
  action: "edit" | "delete" | "restore";
  targetId?: string;
  targetText?: string;
  correctionText?: string;
  eventName?: string;
  commandArgs: string[];
  sourceText: string;
};

export type ChatEventIntent = {
  kind: "event_summary" | "event_settlement";
  eventName?: string;
  commandArgs: string[];
  sourceText: string;
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

export type ChatCorrectionResult =
  | {
    kind: "patch";
    patch: ChatCorrectionPatch;
    sourceText: string;
  }
  | {
    kind: "needs_clarification";
    missing: Array<"correction">;
    sourceText: string;
  };

export type ChatParseContext = {
  eventName?: string;
  defaultCurrency?: string;
  paidBy?: ParticipantId;
  sharedBy?: ParticipantId[];
  participants?: ParticipantId[];
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
  const sharedBy = resolveSharedBy(context);
  const currency = amount.currency ?? context.defaultCurrency ?? DEFAULT_CURRENCY;
  const category = inferCategory(sourceText);
  const description = inferDescription(sourceText, category);
  const commandArgs = buildExpenseAddArgs({
    eventName,
    paidBy,
    currency,
    amountMinor: amount.amountMinor,
    sharedBy,
    category,
    description,
  });

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

function resolveSharedBy(context: ChatParseContext): ParticipantId[] {
  if (context.sharedBy && context.sharedBy.length > 0) {
    return context.sharedBy;
  }
  if (context.participants && context.participants.length > 1) {
    return context.participants;
  }
  return [DEFAULT_PARTICIPANT];
}

export function parseChatCorrection(
  input: string,
  context: { defaultCurrency?: string } = {},
): ChatCorrectionResult {
  const sourceText = input.trim();
  const amount = parseAmount(sourceText, context.defaultCurrency ?? DEFAULT_CURRENCY);
  const category = parseExplicitCategory(sourceText) ?? inferSpecificCategory(sourceText);
  const description = parseExplicitDescription(sourceText);
  const patch: ChatCorrectionPatch = {};

  if (amount) {
    patch.amountMinor = amount.amountMinor;
    if (amount.currency) {
      patch.currency = amount.currency;
    }
  }
  if (category) {
    patch.category = category;
  }
  if (description) {
    patch.description = description;
  }

  if (Object.keys(patch).length === 0) {
    return {
      kind: "needs_clarification",
      missing: ["correction"],
      sourceText,
    };
  }

  return {
    kind: "patch",
    patch,
    sourceText,
  };
}

export function applyCorrectionToDraft(
  draft: ChatExpenseDraft,
  patch: ChatCorrectionPatch,
): ChatExpenseDraft {
  const nextDraft = {
    ...draft,
    amountMinor: patch.amountMinor ?? draft.amountMinor,
    currency: patch.currency ?? draft.currency,
    category: patch.category ?? draft.category,
    description: patch.description ?? draft.description,
  };

  return {
    ...nextDraft,
    commandArgs: buildExpenseAddArgs(nextDraft),
  };
}

export function isChatItemIntentText(input: string): boolean {
  return parseItemIntentParts(input).isItemIntent;
}

export function isChatItemMutationIntentText(input: string): boolean {
  return parseItemMutationParts(input).isMutationIntent;
}

export function isChatEventIntentText(input: string): boolean {
  return parseEventIntentParts(input).isEventIntent;
}

export function parseChatItemIntent(
  input: string,
  context: { eventName?: string } = {},
): ChatItemIntent {
  const sourceText = input.trim();
  const parts = parseItemIntentParts(sourceText);
  const category = parseExplicitCategory(sourceText) ?? inferSpecificCategory(parts.query);
  const text = normalizeItemQuery(parts.query, category);

  if (!parts.isSearchIntent && !text && !category) {
    return {
      kind: "item_list",
      eventName: context.eventName,
      commandArgs: buildItemListArgs(context.eventName),
      sourceText,
    };
  }

  return {
    kind: "item_search",
    eventName: context.eventName,
    text,
    category,
    commandArgs: buildItemSearchArgs({ eventName: context.eventName, text, category }),
    sourceText,
  };
}

export function parseChatItemMutationIntent(
  input: string,
  context: { eventName?: string } = {},
): ChatItemMutationIntent {
  const sourceText = input.trim();
  const parts = parseItemMutationParts(sourceText);
  const commandArgs = buildItemMutationArgs({
    action: parts.action,
    eventName: context.eventName,
    targetId: parts.targetId,
    targetText: parts.targetText,
    correctionText: parts.correctionText,
  });

  return {
    kind: "item_mutation",
    action: parts.action,
    targetId: parts.targetId,
    targetText: parts.targetText,
    correctionText: parts.correctionText,
    eventName: context.eventName,
    commandArgs,
    sourceText,
  };
}

export function parseChatEventIntent(
  input: string,
  context: { eventName?: string } = {},
): ChatEventIntent {
  const sourceText = input.trim();
  const parts = parseEventIntentParts(sourceText);
  const eventName = parts.eventName || context.eventName;
  const kind = parts.action === "settle" ? "event_settlement" : "event_summary";
  const commandArgs = buildEventIntentArgs(kind, eventName);

  return {
    kind,
    eventName,
    commandArgs,
    sourceText,
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
  return inferSpecificCategory(text) ?? "general";
}

function inferSpecificCategory(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/(交通|車費|地鐵|巴士|的士|taxi|uber|mtr|bus|train|transport)/i.test(lower)) {
    return "transport";
  }
  if (/(食|飯|餐|早餐|午餐|晚餐|咖啡|茶|lunch|dinner|breakfast|coffee|food|meal)/i.test(lower)) {
    return "food";
  }
  return undefined;
}

function inferDescription(text: string, category: string): string {
  const withoutAmount = text
    .replace(/(?:(HKD|USD|JPY|港幣|美元|日圓|日元)\s*)?\$?\s*\d+(?:\.\d{1,2})?/gi, "")
    .replace(/[，,。.;；:：]+/g, " ")
    .trim();
  return withoutAmount || category;
}

function parseExplicitCategory(text: string): string | undefined {
  const match = text.match(/(?:category|分類|類別)\s*[:：=]?\s*([a-z][a-z0-9_-]*)/i);
  return match?.[1]?.toLowerCase();
}

function parseExplicitDescription(text: string): string | undefined {
  const match = text.match(/(?:description|desc|描述|備註)\s*[:：=]\s*(.+)$/i);
  return match?.[1]?.trim();
}

function parseItemIntentParts(text: string): {
  isItemIntent: boolean;
  isSearchIntent: boolean;
  query: string;
} {
  const trimmed = text.trim();
  const match = trimmed.match(/^(list|show|items?|expenses?|search|find|查|搵|搜尋|列出?|睇)\b\s*(.*)$/i);
  if (!match) {
    return {
      isItemIntent: false,
      isSearchIntent: false,
      query: trimmed,
    };
  }

  const keyword = match[1].toLowerCase();
  const query = match[2]
    .replace(/^(items?|expenses?|記錄|項目)\b\s*/i, "")
    .trim();
  return {
    isItemIntent: true,
    isSearchIntent: /^(search|find|查|搵|搜尋)$/i.test(keyword),
    query,
  };
}

function parseItemMutationParts(text: string): {
  isMutationIntent: boolean;
  action: "edit" | "delete" | "restore";
  targetId?: string;
  targetText?: string;
  correctionText?: string;
} {
  const trimmed = text.trim();
  const match = trimmed.match(/^(edit|update|change|修改|更改|改|delete|remove|del|刪除|删除|restore|undelete|還原|復原)\b\s*(.*)$/i);
  if (!match) {
    return {
      isMutationIntent: false,
      action: "edit",
    };
  }

  const action = normalizeMutationAction(match[1]);
  const remainder = match[2].trim();
  const [target, correction] = splitMutationRemainder(action, remainder);
  return {
    isMutationIntent: true,
    action,
    targetId: isItemId(target) ? target : undefined,
    targetText: target && !isItemId(target) ? target : undefined,
    correctionText: correction,
  };
}

function parseEventIntentParts(text: string): {
  isEventIntent: boolean;
  action: "summary" | "settle";
  eventName?: string;
} {
  const trimmed = text.trim();
  const match = trimmed.match(/^(summary|summarize|status|overview|總結|摘要|settle|settlement|結算)\b\s*(.*)$/i);
  if (!match) {
    return {
      isEventIntent: false,
      action: "summary",
    };
  }

  const action = /^(settle|settlement|結算)$/i.test(match[1]) ? "settle" : "summary";
  const eventName = match[2]
    .replace(/^(event|活動|帳簿|账簿)\b\s*/i, "")
    .trim() || undefined;
  return {
    isEventIntent: true,
    action,
    eventName,
  };
}

function normalizeMutationAction(value: string): "edit" | "delete" | "restore" {
  if (/^(delete|remove|del|刪除|删除)$/i.test(value)) {
    return "delete";
  }
  if (/^(restore|undelete|還原|復原)$/i.test(value)) {
    return "restore";
  }
  return "edit";
}

function splitMutationRemainder(action: "edit" | "delete" | "restore", remainder: string): [string | undefined, string | undefined] {
  if (!remainder) {
    return [undefined, undefined];
  }
  if (action !== "edit") {
    return [remainder, undefined];
  }

  const marker = remainder.match(/\s(?:改做|改成|to|做|變成|change to)\s/i);
  if (marker?.index !== undefined) {
    const target = remainder.slice(0, marker.index).trim();
    const correction = remainder.slice(marker.index).trim();
    return [target || undefined, correction || undefined];
  }

  const words = remainder.split(/\s+/);
  if (words.length > 1 && isItemId(words[0])) {
    return [words[0], words.slice(1).join(" ")];
  }

  return [remainder, undefined];
}

function isItemId(value?: string): boolean {
  return Boolean(value && /^exp_[a-z0-9_]+$/i.test(value));
}

function normalizeItemQuery(query: string, category?: string): string | undefined {
  const normalized = query.trim();
  if (!normalized) {
    return undefined;
  }
  if (category && /^(food|meal|transport|交通|食|飯|餐)$/i.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function buildExpenseAddArgs(input: {
  eventName: string;
  paidBy: ParticipantId;
  currency: string;
  amountMinor: bigint;
  sharedBy: ParticipantId[];
  category: string;
  description: string;
}): string[] {
  return [
    "expense",
    "add",
    "--event",
    input.eventName,
    "--paid-by",
    input.paidBy,
    "--currency",
    input.currency,
    "--amount-minor",
    input.amountMinor.toString(),
    "--shared-by",
    input.sharedBy.join(","),
    "--category",
    input.category,
    "--description",
    input.description,
  ];
}

function buildItemListArgs(eventName?: string): string[] {
  const args = ["item", "list"];
  if (eventName) {
    args.push("--event", eventName);
  }
  return args;
}

function buildItemSearchArgs(input: {
  eventName?: string;
  text?: string;
  category?: string;
}): string[] {
  const args = ["item", "search"];
  if (input.eventName) {
    args.push("--event", input.eventName);
  }
  if (input.text) {
    args.push("--text", input.text);
  }
  if (input.category) {
    args.push("--category", input.category);
  }
  return args;
}

function buildItemMutationArgs(input: {
  action: "edit" | "delete" | "restore";
  eventName?: string;
  targetId?: string;
  targetText?: string;
  correctionText?: string;
}): string[] {
  const args = ["chat", "item", input.action];
  if (input.targetId) {
    args.push("--item-id", input.targetId);
  }
  if (input.targetText) {
    args.push("--text", input.targetText);
  }
  if (input.correctionText) {
    args.push("--correction", input.correctionText);
  }
  if (input.eventName) {
    args.push("--event", input.eventName);
  }
  return args;
}

function buildEventIntentArgs(kind: ChatEventIntent["kind"], eventName?: string): string[] {
  const args = ["event", kind === "event_settlement" ? "settle" : "summary"];
  if (eventName) {
    args.push(eventName);
  }
  return args;
}
