import type { OcrLanguagePreference } from "./event-ocr-context.js";

export type ReceiptOcrLine = {
  text: string;
  confidence: number;
};

export type ReceiptOcrResult = {
  provider: string;
  languages: string[];
  lines: ReceiptOcrLine[];
};

export type ExtractedReceiptItem = {
  name?: string;
  amount: string;
  confidence: number;
  sourceLine: string;
};

export type ExtractedReceiptDraft = {
  currency: string;
  incurredAt?: string;
  total?: string;
  items: ExtractedReceiptItem[];
  warnings: string[];
};

export type ReceiptOcrProvider = {
  recognize(input: {
    imagePath: string;
    languagePreferences: OcrLanguagePreference[];
  }): Promise<ReceiptOcrResult>;
};

export function formatReceiptOcrText(result: ReceiptOcrResult): string {
  return result.lines.map((line) => line.text).join("\n");
}

export function averageReceiptOcrConfidence(result: ReceiptOcrResult): number | undefined {
  if (result.lines.length === 0) {
    return undefined;
  }

  const total = result.lines.reduce((sum, line) => sum + line.confidence, 0);
  return Number((total / result.lines.length).toFixed(4));
}

export function extractReceiptDraft(input: {
  ocr: ReceiptOcrResult;
  currencies: string[];
  minimumConfidence?: number;
}): ExtractedReceiptDraft {
  const minimumConfidence = input.minimumConfidence ?? 0.55;
  const currency = chooseReceiptCurrency(input.currencies, input.ocr.lines);
  const candidates = input.ocr.lines
    .map((line, index) => ({ line, index, amount: parseReceiptAmount(line.text) }))
    .filter((candidate) => candidate.amount !== undefined && candidate.line.confidence >= minimumConfidence);
  const totalCandidate = chooseTotalCandidate(candidates);
  const items = candidates
    .filter((candidate) => candidate !== totalCandidate && !isNonItemAmountLine(candidate.line.text))
    .map((candidate) => ({
      name: extractItemName(candidate.line.text),
      amount: candidate.amount ?? "",
      confidence: candidate.line.confidence,
      sourceLine: candidate.line.text,
    }))
    .filter((item) => item.amount !== "");
  const warnings: string[] = [];

  if (!totalCandidate) {
    warnings.push("total_not_found");
  }
  if (items.length === 0) {
    warnings.push("items_not_found");
  }
  if (input.ocr.lines.some((line) => line.confidence < minimumConfidence)) {
    warnings.push("low_confidence_lines_ignored");
  }

  return {
    currency,
    incurredAt: extractReceiptDate(input.ocr.lines),
    total: totalCandidate?.amount,
    items,
    warnings,
  };
}

function chooseReceiptCurrency(currencies: string[], lines: ReceiptOcrLine[]): string {
  if (currencies.includes("HKD") && lines.some((line) => /[$＄]|港幣|港币|hkd/i.test(line.text))) {
    return "HKD";
  }
  return currencies[0] ?? "HKD";
}

function chooseTotalCandidate(
  candidates: Array<{ line: ReceiptOcrLine; index: number; amount?: string }>,
): { line: ReceiptOcrLine; index: number; amount?: string } | undefined {
  const explicit = candidates
    .filter((candidate) => /總|总|total|合計|应付|應付|net\s*amount/i.test(candidate.line.text))
    .at(-1);
  if (explicit) {
    return explicit;
  }

  return candidates
    .filter((candidate) => !isNonItemAmountLine(candidate.line.text))
    .sort((a, b) => Number.parseFloat(b.amount ?? "0") - Number.parseFloat(a.amount ?? "0"))[0];
}

function extractReceiptDate(lines: ReceiptOcrLine[]): string | undefined {
  for (const line of lines) {
    const normalized = line.text.replace(/[./]/g, "-");
    const match = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
      return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${minute}:${second}+08:00`;
    }
  }
  return undefined;
}

function parseReceiptAmount(text: string): string | undefined {
  const matches = [...text.matchAll(/(?:[$＄]\s*)?(-?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)/g)];
  const numeric = matches
    .map((match) => match[1].replace(/,/g, ""))
    .filter((value) => !looksLikeDateOrTimeNumber(text, value))
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  const amount = numeric.at(-1);
  if (amount === undefined) {
    return undefined;
  }
  return amount.toFixed(2);
}

function extractItemName(text: string): string | undefined {
  const withoutAmount = text
    .replace(/[$＄]?\s*-?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?\s*$/g, "")
    .replace(/^\d+\s*[xX*]\s*/g, "")
    .trim();
  return withoutAmount.length > 0 ? withoutAmount : undefined;
}

function isNonItemAmountLine(text: string): boolean {
  return /找續|找续|cash|visa|master|octopus|八達通|八达通|alipay|wechat|付款|支付|service|服務費|服务费|折扣|discount|subtotal|小計|小计/i.test(text);
}

function looksLikeDateOrTimeNumber(text: string, value: string): boolean {
  return /\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(text)
    || /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(text)
    || value.length === 4 && value.startsWith("20");
}

function pad2(value: string): string {
  return value.padStart(2, "0");
}
