export type ParticipantId = string & { readonly __brand: "ParticipantId" };
export type ExpenseId = string & { readonly __brand: "ExpenseId" };
export type CurrencyCode = string;
export type ExpenseStatus = "active" | "deleted";

export type ExpenseBase = {
  id: string;
  status: ExpenseStatus;
  eventId?: string;
  paidBy: ParticipantId;
  currency: CurrencyCode;
  amountMinor: bigint;
  category: string;
  description?: string;
  incurredAt?: string;
  receiptId?: string;
  updatedAt?: string;
  deletedAt?: string;
};

export type SharedExpense = ExpenseBase & {
  type: "shared";
  participants: ParticipantId[];
};

export type PersonalExpense = ExpenseBase & {
  type: "personal";
  owner: ParticipantId;
};

export type FrontedPersonalExpense = ExpenseBase & {
  type: "fronted_personal";
  beneficiary: ParticipantId;
};

export type Expense = SharedExpense | PersonalExpense | FrontedPersonalExpense;

export type Transfer = {
  from: ParticipantId;
  to: ParticipantId;
  amountMinor: bigint;
  currency: CurrencyCode;
};

export type CurrencySettlement = {
  balances: Record<string, bigint>;
  transfers: Transfer[];
};

export type Settlement = {
  byCurrency: Record<string, CurrencySettlement>;
  categoryTotals: Record<string, Record<string, bigint>>;
};

export type CalculateSettlementInput = {
  participants: ParticipantId[];
  expenses: Expense[];
};

export function calculateSettlement(input: CalculateSettlementInput): Settlement {
  const activeExpenses = input.expenses.filter((expense) => expense.status === "active");
  const sharedBalances = new Map<CurrencyCode, Map<ParticipantId, bigint>>();
  const directTransfers = new Map<CurrencyCode, Transfer[]>();
  const categoryTotals = new Map<CurrencyCode, Map<string, bigint>>();

  for (const expense of activeExpenses) {
    addCategoryTotal(categoryTotals, expense.currency, expense.category, expense.amountMinor);

    if (expense.type === "personal") {
      continue;
    }

    if (expense.type === "fronted_personal") {
      addTransfer(directTransfers, {
        from: expense.beneficiary,
        to: expense.paidBy,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
      });
      continue;
    }

    applySharedExpense(sharedBalances, expense);
  }

  const byCurrency: Record<string, CurrencySettlement> = {};
  const currencies = new Set<CurrencyCode>([
    ...sharedBalances.keys(),
    ...directTransfers.keys(),
  ]);

  for (const currency of currencies) {
    const balances = sharedBalances.get(currency) ?? new Map<ParticipantId, bigint>();
    const sharedTransfers = simplifyBalances(currency, input.participants, balances);
    const preservedDirectTransfers = directTransfers.get(currency) ?? [];
    byCurrency[currency] = {
      balances: toBalanceRecord(balances),
      transfers: [...sharedTransfers, ...preservedDirectTransfers],
    };
  }

  return {
    byCurrency,
    categoryTotals: toCategoryTotalsRecord(categoryTotals),
  };
}

function applySharedExpense(
  balancesByCurrency: Map<CurrencyCode, Map<ParticipantId, bigint>>,
  expense: SharedExpense,
): void {
  if (expense.participants.length === 0) {
    throw new Error(`Shared expense ${expense.id} must include at least one participant`);
  }

  const balances = getCurrencyBalances(balancesByCurrency, expense.currency);
  addBalance(balances, expense.paidBy, expense.amountMinor);

  const shares = splitEvenly(expense.amountMinor, expense.participants);
  for (const [participant, share] of shares) {
    addBalance(balances, participant, -share);
  }
}

function splitEvenly(
  amountMinor: bigint,
  participants: ParticipantId[],
): Array<[ParticipantId, bigint]> {
  const count = BigInt(participants.length);
  const baseShare = amountMinor / count;
  let remainder = amountMinor % count;

  return participants.map((participant) => {
    const extra = remainder > 0n ? 1n : 0n;
    if (remainder > 0n) {
      remainder -= 1n;
    }
    return [participant, baseShare + extra];
  });
}

function simplifyBalances(
  currency: CurrencyCode,
  participantOrder: ParticipantId[],
  balances: Map<ParticipantId, bigint>,
): Transfer[] {
  const orderedEntries = [...balances.entries()].sort(
    ([left], [right]) => participantRank(participantOrder, left) - participantRank(participantOrder, right),
  );
  const creditors = orderedEntries
    .filter(([, balance]) => balance > 0n)
    .map(([participant, balance]) => ({ participant, remaining: balance }));
  const debtors = orderedEntries
    .filter(([, balance]) => balance < 0n)
    .map(([participant, balance]) => ({ participant, remaining: -balance }));

  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountMinor = debtor.remaining < creditor.remaining ? debtor.remaining : creditor.remaining;

    transfers.push({
      from: debtor.participant,
      to: creditor.participant,
      amountMinor,
      currency,
    });

    debtor.remaining -= amountMinor;
    creditor.remaining -= amountMinor;

    if (debtor.remaining === 0n) {
      debtorIndex += 1;
    }
    if (creditor.remaining === 0n) {
      creditorIndex += 1;
    }
  }

  return transfers;
}

function participantRank(participantOrder: ParticipantId[], participant: ParticipantId): number {
  const index = participantOrder.indexOf(participant);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function getCurrencyBalances(
  balancesByCurrency: Map<CurrencyCode, Map<ParticipantId, bigint>>,
  currency: CurrencyCode,
): Map<ParticipantId, bigint> {
  const existing = balancesByCurrency.get(currency);
  if (existing) {
    return existing;
  }

  const balances = new Map<ParticipantId, bigint>();
  balancesByCurrency.set(currency, balances);
  return balances;
}

function addBalance(
  balances: Map<ParticipantId, bigint>,
  participant: ParticipantId,
  amountMinor: bigint,
): void {
  const next = (balances.get(participant) ?? 0n) + amountMinor;
  if (next === 0n) {
    balances.delete(participant);
    return;
  }
  balances.set(participant, next);
}

function addTransfer(transfersByCurrency: Map<CurrencyCode, Transfer[]>, transfer: Transfer): void {
  const transfers = transfersByCurrency.get(transfer.currency) ?? [];
  transfers.push(transfer);
  transfersByCurrency.set(transfer.currency, transfers);
}

function addCategoryTotal(
  totalsByCurrency: Map<CurrencyCode, Map<string, bigint>>,
  currency: CurrencyCode,
  category: string,
  amountMinor: bigint,
): void {
  const totals = totalsByCurrency.get(currency) ?? new Map<string, bigint>();
  totals.set(category, (totals.get(category) ?? 0n) + amountMinor);
  totalsByCurrency.set(currency, totals);
}

function toBalanceRecord(balances: Map<ParticipantId, bigint>): Record<string, bigint> {
  return Object.fromEntries([...balances.entries()].map(([participant, balance]) => [participant, balance]));
}

function toCategoryTotalsRecord(
  totalsByCurrency: Map<CurrencyCode, Map<string, bigint>>,
): Record<string, Record<string, bigint>> {
  return Object.fromEntries(
    [...totalsByCurrency.entries()].map(([currency, totals]) => [
      currency,
      Object.fromEntries(totals.entries()),
    ]),
  );
}
