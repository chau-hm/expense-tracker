import type {
  CurrencyCode,
  Expense,
  ExpenseStatus,
  ParticipantId,
} from "./settlement.js";

export type ItemSummary = {
  id: string;
  eventId?: string;
  incurredAt?: string;
  paidBy: ParticipantId;
  amountMinor: bigint;
  currency: CurrencyCode;
  category: string;
  description?: string;
  status: ExpenseStatus;
  receiptId?: string;
};

export type ItemStatusFilter = ExpenseStatus | "all";

export type ItemSearchFilter = {
  eventId?: string;
  paidBy?: ParticipantId;
  participant?: ParticipantId;
  category?: string;
  currency?: CurrencyCode;
  minAmountMinor?: bigint;
  maxAmountMinor?: bigint;
  fromDate?: string;
  toDate?: string;
  receiptId?: string;
  text?: string;
  status?: ItemStatusFilter;
};

export type ItemTargetQuery = {
  id?: string;
  text?: string;
  eventId?: string;
  status?: ItemStatusFilter;
};

export type ItemTargetResult =
  | { kind: "selected"; item: ItemSummary }
  | { kind: "ambiguous"; candidates: ItemSummary[] }
  | { kind: "not_found"; candidates: [] };

export type ItemMutationResult =
  | { kind: "updated"; items: Expense[]; item: Expense }
  | { kind: "not_found"; items: Expense[] };

export type ItemPatch = {
  eventId?: string;
  paidBy?: ParticipantId;
  currency?: CurrencyCode;
  amountMinor?: bigint;
  category?: string;
  description?: string;
  incurredAt?: string;
  receiptId?: string;
  participants?: ParticipantId[];
  owner?: ParticipantId;
  beneficiary?: ParticipantId;
  updatedAt?: string;
};

export function listItems(items: Expense[], filter: ItemSearchFilter = {}): ItemSummary[] {
  return searchItems(items, filter);
}

export function searchItems(items: Expense[], filter: ItemSearchFilter): ItemSummary[] {
  return items
    .filter((item) => matchesStatus(item, filter.status ?? "active"))
    .filter((item) => matchesFilter(item, filter))
    .map(toItemSummary);
}

export function resolveItemTarget(items: Expense[], query: ItemTargetQuery): ItemTargetResult {
  if (query.id) {
    const item = items.find((candidate) => candidate.id === query.id);
    if (!item || !matchesStatus(item, query.status ?? "active")) {
      return { kind: "not_found", candidates: [] };
    }
    return { kind: "selected", item: toItemSummary(item) };
  }

  const candidates = searchItems(items, {
    text: query.text,
    eventId: query.eventId,
    status: query.status,
  });

  if (candidates.length === 0) {
    return { kind: "not_found", candidates: [] };
  }

  if (candidates.length === 1) {
    return { kind: "selected", item: candidates[0] };
  }

  return { kind: "ambiguous", candidates };
}

export function editItem(items: Expense[], itemId: string, patch: ItemPatch): ItemMutationResult {
  const index = items.findIndex((item) => item.id === itemId);
  if (index === -1) {
    return { kind: "not_found", items };
  }

  const nextItem = applyPatch(items[index], patch);
  const nextItems = replaceItemAt(items, index, nextItem);
  return { kind: "updated", items: nextItems, item: nextItem };
}

export function deleteItem(
  items: Expense[],
  itemId: string,
  deletedAt: string,
): ItemMutationResult {
  const index = items.findIndex((item) => item.id === itemId);
  if (index === -1) {
    return { kind: "not_found", items };
  }

  const item = items[index];
  const nextItem: Expense = {
    ...item,
    status: "deleted",
    deletedAt,
    updatedAt: deletedAt,
  };
  const nextItems = replaceItemAt(items, index, nextItem);
  return { kind: "updated", items: nextItems, item: nextItem };
}

export function restoreItem(items: Expense[], itemId: string): ItemMutationResult {
  const index = items.findIndex((item) => item.id === itemId);
  if (index === -1) {
    return { kind: "not_found", items };
  }

  const item = items[index];
  const nextItem = {
    ...item,
    status: "active" as const,
    deletedAt: undefined,
  };
  const nextItems = replaceItemAt(items, index, nextItem);
  return { kind: "updated", items: nextItems, item: nextItem };
}

function applyPatch(
  item: Expense,
  patch: ItemPatch,
): Expense {
  const commonPatch = {
    eventId: patch.eventId ?? item.eventId,
    paidBy: patch.paidBy ?? item.paidBy,
    currency: patch.currency ?? item.currency,
    amountMinor: patch.amountMinor ?? item.amountMinor,
    category: patch.category ?? item.category,
    description: patch.description ?? item.description,
    incurredAt: patch.incurredAt ?? item.incurredAt,
    receiptId: patch.receiptId ?? item.receiptId,
    updatedAt: patch.updatedAt ?? item.updatedAt,
  };

  if (item.type === "shared") {
    return {
      ...item,
      ...commonPatch,
      participants: patch.participants ?? item.participants,
      type: "shared",
    };
  }

  if (item.type === "personal") {
    return {
      ...item,
      ...commonPatch,
      owner: patch.owner ?? item.owner,
      type: "personal",
    };
  }

  return {
    ...item,
    ...commonPatch,
    beneficiary: patch.beneficiary ?? item.beneficiary,
    type: "fronted_personal",
  };
}

function replaceItemAt(items: Expense[], index: number, item: Expense): Expense[] {
  return [...items.slice(0, index), item, ...items.slice(index + 1)];
}

function toItemSummary(item: Expense): ItemSummary {
  return {
    id: item.id,
    eventId: item.eventId,
    incurredAt: item.incurredAt,
    paidBy: item.paidBy,
    amountMinor: item.amountMinor,
    currency: item.currency,
    category: item.category,
    description: item.description,
    status: item.status,
    receiptId: item.receiptId,
  };
}

function matchesStatus(item: Expense, status: ItemStatusFilter): boolean {
  return status === "all" || item.status === status;
}

function matchesFilter(item: Expense, filter: ItemSearchFilter): boolean {
  if (filter.eventId && item.eventId !== filter.eventId) {
    return false;
  }
  if (filter.paidBy && item.paidBy !== filter.paidBy) {
    return false;
  }
  if (filter.participant && !hasParticipant(item, filter.participant)) {
    return false;
  }
  if (filter.category && item.category !== filter.category) {
    return false;
  }
  if (filter.currency && item.currency !== filter.currency) {
    return false;
  }
  if (filter.minAmountMinor !== undefined && item.amountMinor < filter.minAmountMinor) {
    return false;
  }
  if (filter.maxAmountMinor !== undefined && item.amountMinor > filter.maxAmountMinor) {
    return false;
  }
  if (filter.fromDate && (!item.incurredAt || item.incurredAt < filter.fromDate)) {
    return false;
  }
  if (filter.toDate && (!item.incurredAt || item.incurredAt > filter.toDate)) {
    return false;
  }
  if (filter.receiptId && item.receiptId !== filter.receiptId) {
    return false;
  }
  if (filter.text && !matchesText(item, filter.text)) {
    return false;
  }
  return true;
}

function hasParticipant(item: Expense, participant: ParticipantId): boolean {
  if (item.type === "shared") {
    return item.participants.includes(participant);
  }
  if (item.type === "personal") {
    return item.owner === participant;
  }
  return item.beneficiary === participant || item.paidBy === participant;
}

function matchesText(item: Expense, text: string): boolean {
  const terms = text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  const searchable = [
    item.id,
    item.eventId,
    item.category,
    item.currency,
    item.description,
    item.receiptId,
    item.paidBy,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return terms.some((term) => searchable.includes(term));
}
