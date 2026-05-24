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

type ReceiptAmountCandidate = {
  line: ReceiptOcrLine;
  index: number;
  amount: string;
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
    .filter((candidate): candidate is ReceiptAmountCandidate => {
      return candidate.amount !== undefined
        && candidate.line.confidence >= minimumConfidence
        && !isMetadataAmountLine(candidate.line.text);
    });
  const totalCandidate = chooseTotalCandidate(candidates);
  const items = candidates
    .filter((candidate) => {
      return candidate !== totalCandidate
        && !isNonItemAmountLine(candidate.line.text)
        && !looksLikeTotalDuplicate(candidate, totalCandidate)
        && candidate.index < (totalCandidate?.index ?? Number.POSITIVE_INFINITY);
    })
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
  candidates: ReceiptAmountCandidate[],
): ReceiptAmountCandidate | undefined {
  const explicit = candidates
    .filter((candidate) => /總|总|total|合計|应付|應付|net\s*amount/i.test(candidate.line.text))
    .at(-1);
  if (explicit) {
    return explicit;
  }

  const beforePayment = candidates.filter((candidate) => {
    return !isNonItemAmountLine(candidate.line.text)
      && !hasPriorPaymentMarker(candidates, candidate.index);
  });
  const repeated = mostLikelyRepeatedTotal(beforePayment);
  if (repeated) {
    return repeated;
  }

  return candidates
    .filter((candidate) => !isNonItemAmountLine(candidate.line.text))
    .sort((a, b) => Number.parseFloat(b.amount ?? "0") - Number.parseFloat(a.amount ?? "0"))[0];
}

function extractReceiptDate(lines: ReceiptOcrLine[]): string | undefined {
  for (const line of lines) {
    const normalized = line.text.replace(/[./]/g, "-");
    const isoMatch = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (isoMatch) {
      const [, year, month, day, hour = "00", minute = "00", second = "00"] = isoMatch;
      return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${minute}:${second}+08:00`;
    }
    const dayFirstMatch = normalized.match(/\b(\d{1,2})-(\d{1,2})-(20\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (dayFirstMatch) {
      const [, day, month, year, hour = "00", minute = "00", second = "00"] = dayFirstMatch;
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

function isMetadataAmountLine(text: string): boolean {
  if (/\b(?:tel|phone|ref|invoice|receipt|order|table|station)\b/i.test(text)) {
    return true;
  }
  if (/^\d{1,2}$/.test(text.trim())) {
    return true;
  }
  if (/^[#:：]|[#＃][^0-9]*\d+/.test(text)) {
    return true;
  }
  if (/\*/.test(text) && (/[()]/.test(text) || !/\d+\s*[xX*]\s*\S+/.test(text))) {
    return true;
  }
  if (/\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}|\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text)) {
    return true;
  }
  if (/[A-Z]\d{3,}|[A-Z]{2,}\d+/i.test(text) && /[-:]/.test(text)) {
    return true;
  }
  return false;
}

function hasPriorPaymentMarker(candidates: ReceiptAmountCandidate[], index: number): boolean {
  return candidates.some((candidate) => candidate.index < index && /cash|visa|master|octopus|八達通|八达通|alipay|wechat/i.test(candidate.line.text));
}

function mostLikelyRepeatedTotal(candidates: ReceiptAmountCandidate[]): ReceiptAmountCandidate | undefined {
  const byAmount = new Map<string, ReceiptAmountCandidate[]>();
  for (const candidate of candidates) {
    const amountCandidates = byAmount.get(candidate.amount) ?? [];
    amountCandidates.push(candidate);
    byAmount.set(candidate.amount, amountCandidates);
  }

  return [...byAmount.values()]
    .filter((amountCandidates) => amountCandidates.length > 1)
    .map((amountCandidates) => amountCandidates.at(-1))
    .filter((candidate): candidate is ReceiptAmountCandidate => candidate !== undefined)
    .sort((a, b) => Number.parseFloat(b.amount) - Number.parseFloat(a.amount))[0];
}

function looksLikeTotalDuplicate(candidate: ReceiptAmountCandidate, totalCandidate?: ReceiptAmountCandidate): boolean {
  return totalCandidate !== undefined && candidate.amount === totalCandidate.amount;
}

function looksLikeDateOrTimeNumber(text: string, value: string): boolean {
  return /\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(text)
    || /\b\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}\b/.test(text)
    || /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(text)
    || value.length === 4 && value.startsWith("20");
}

function pad2(value: string): string {
  return value.padStart(2, "0");
}
