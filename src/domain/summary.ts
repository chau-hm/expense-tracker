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

