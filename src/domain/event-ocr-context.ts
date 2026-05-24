export type OcrLanguagePreference = "zh" | "en" | "jp";
export type OcrLanguageSource = "inferred" | "manual";

const CURRENCY_LANGUAGE_MAP: Record<string, OcrLanguagePreference[]> = {
  HKD: ["zh", "en"],
  JPY: ["jp"],
  USD: ["en"],
  CNY: ["zh", "en"],
  TWD: ["zh", "en"],
};

const SUPPORTED_OCR_LANGUAGES = new Set<OcrLanguagePreference>(["zh", "en", "jp"]);

export function normalizeCurrencyList(currencies: string[], defaultCurrency: string): string[] {
  return uniqueOrdered([
    normalizeCurrency(defaultCurrency),
    ...currencies.map(normalizeCurrency),
  ]);
}

export function inferOcrLanguagePreferences(currencies: string[]): OcrLanguagePreference[] {
  const inferred = currencies.flatMap((currency) => CURRENCY_LANGUAGE_MAP[normalizeCurrency(currency)] ?? []);
  return uniqueOrdered(inferred);
}

export function normalizeOcrLanguagePreferences(languages: string[]): OcrLanguagePreference[] {
  const normalized = uniqueOrdered(languages.map((language) => language.trim().toLowerCase()));
  const unsupported = normalized.filter((language) => !SUPPORTED_OCR_LANGUAGES.has(language as OcrLanguagePreference));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported OCR language preference: ${unsupported.join(", ")}`);
  }
  return normalized as OcrLanguagePreference[];
}

function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!normalized) {
    throw new Error("Currency cannot be blank");
  }
  return normalized;
}

function uniqueOrdered<T>(values: T[]): T[] {
  return [...new Set(values)];
}
