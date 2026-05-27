import { calculateSettlement, type Expense, type ParticipantId } from "./settlement.js";

export type EventSummaryInput = {
  event: {
    id: string;
    name: string;
    status: "active" | "closed";
    participantIds: ParticipantId[];
  };
  expenses: Expense[];
};

export type EventSummary = {
  event: {
    id: string;
    name: string;
    status: "active" | "closed";
    participantIds: ParticipantId[];
  };
  activeItemCount: number;
  totalsByCurrency: Record<string, bigint>;
  categoryTotals: Record<string, Record<string, bigint>>;
  participantTotals: Record<string, Record<string, {
    paid: bigint;
    share: bigint;
    net: bigint;
  }>>;
  settlement: ReturnType<typeof calculateSettlement>["byCurrency"];
};

export function summarizeEvent(input: EventSummaryInput): EventSummary {
  const activeExpenses = input.expenses.filter((expense) => expense.status === "active");
  const settlement = calculateSettlement({
    participants: input.event.participantIds,
    expenses: activeExpenses,
  });

  return {
    event: input.event,
    activeItemCount: activeExpenses.length,
    totalsByCurrency: calculateTotalsByCurrency(activeExpenses),
    categoryTotals: settlement.categoryTotals,
    participantTotals: calculateParticipantTotals(input.event.participantIds, activeExpenses),
    settlement: settlement.byCurrency,
  };
}

function calculateTotalsByCurrency(expenses: Expense[]): Record<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const expense of expenses) {
    totals.set(expense.currency, (totals.get(expense.currency) ?? 0n) + expense.amountMinor);
  }
  return Object.fromEntries(totals.entries());
}

function calculateParticipantTotals(
  participantIds: ParticipantId[],
  expenses: Expense[],
): EventSummary["participantTotals"] {
  const totals = new Map<string, Map<ParticipantId, { paid: bigint; share: bigint }>>();

  for (const participant of participantIds) {
    for (const currency of currenciesFor(expenses)) {
      ensureParticipantTotal(totals, currency, participant);
    }
  }

  for (const expense of expenses) {
    const paidTotal = ensureParticipantTotal(totals, expense.currency, expense.paidBy);
    paidTotal.paid += expense.amountMinor;

    if (expense.type === "shared") {
      const shares = splitEvenly(expense.amountMinor, expense.participants);
      for (const [participant, share] of shares) {
        ensureParticipantTotal(totals, expense.currency, participant).share += share;
      }
      continue;
    }

    if (expense.type === "personal") {
      ensureParticipantTotal(totals, expense.currency, expense.owner).share += expense.amountMinor;
      continue;
    }

    ensureParticipantTotal(totals, expense.currency, expense.beneficiary).share += expense.amountMinor;
  }

  return Object.fromEntries(
    [...totals.entries()].map(([currency, participantTotals]) => [
      currency,
      Object.fromEntries(
        [...participantTotals.entries()].map(([participant, total]) => [
          participant,
          {
            paid: total.paid,
            share: total.share,
            net: total.paid - total.share,
          },
        ]),
      ),
    ]),
  );
}

function currenciesFor(expenses: Expense[]): string[] {
  return [...new Set(expenses.map((expense) => expense.currency))];
}

function ensureParticipantTotal(
  totals: Map<string, Map<ParticipantId, { paid: bigint; share: bigint }>>,
  currency: string,
  participant: ParticipantId,
): { paid: bigint; share: bigint } {
  const currencyTotals = totals.get(currency) ?? new Map<ParticipantId, { paid: bigint; share: bigint }>();
  totals.set(currency, currencyTotals);

  const participantTotal = currencyTotals.get(participant) ?? { paid: 0n, share: 0n };
  currencyTotals.set(participant, participantTotal);
  return participantTotal;
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
