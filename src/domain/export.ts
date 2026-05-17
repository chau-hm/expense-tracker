import { listItems } from "./items.js";
import { summarizeEvent, type EventSummaryInput } from "./summary.js";

export type EventExport = {
  schemaVersion: 1;
  exportedAt: string;
  event: EventSummaryInput["event"];
  items: ReturnType<typeof listItems>;
  summary: ReturnType<typeof summarizeEvent>;
};

export function exportEvent(input: EventSummaryInput & { exportedAt: string }): EventExport {
  return {
    schemaVersion: 1,
    exportedAt: input.exportedAt,
    event: input.event,
    items: listItems(input.expenses, { status: "all" }),
    summary: summarizeEvent(input),
  };
}

