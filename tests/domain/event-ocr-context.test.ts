import { describe, expect, it } from "vitest";
import {
  inferOcrLanguagePreferences,
  normalizeCurrencyList,
  normalizeOcrLanguagePreferences,
} from "../../src/domain/event-ocr-context.js";

describe("event OCR context", () => {
  it("adds the default currency first and deduplicates supported currencies", () => {
    expect(normalizeCurrencyList(["JPY", "HKD", "JPY"], "hkd")).toEqual(["HKD", "JPY"]);
  });

  it("infers ordered OCR languages from supported currencies", () => {
    expect(inferOcrLanguagePreferences(["HKD", "JPY"])).toEqual(["zh", "en", "jp"]);
    expect(inferOcrLanguagePreferences(["JPY", "HKD"])).toEqual(["jp", "zh", "en"]);
  });

  it("validates manual OCR language preferences", () => {
    expect(normalizeOcrLanguagePreferences(["JP", "zh", "jp"])).toEqual(["jp", "zh"]);
    expect(() => normalizeOcrLanguagePreferences(["ko"])).toThrow("Unsupported OCR language preference: ko");
  });
});
