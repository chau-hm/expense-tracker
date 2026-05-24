import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OcrLanguagePreference } from "../../domain/event-ocr-context.js";
import type { ReceiptOcrProvider, ReceiptOcrResult } from "../../domain/receipt-ocr.js";

const execFileAsync = promisify(execFile);

const DEFAULT_SCRIPT_PATH = "/Users/openclaw/.openclaw/skills/apple-vision-ocr/scripts/apple_vision_ocr.sh";

const APPLE_VISION_LANGUAGE_IDS: Record<OcrLanguagePreference, string> = {
  zh: "zh-Hant",
  en: "en-US",
  jp: "ja-JP",
};

type AppleVisionPayload = Array<{
  file: string;
  languages?: string[];
  lines?: Array<{
    text?: string;
    confidence?: number;
  }>;
}>;

export class AppleVisionOcrProvider implements ReceiptOcrProvider {
  constructor(private readonly scriptPath = process.env.EXPENSE_TRACKER_APPLE_VISION_OCR ?? DEFAULT_SCRIPT_PATH) {}

  async recognize(input: {
    imagePath: string;
    languagePreferences: OcrLanguagePreference[];
  }): Promise<ReceiptOcrResult> {
    const { stdout } = await execFileAsync(this.scriptPath, [input.imagePath], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const payload = parseAppleVisionPayload(stdout);
    const first = payload[0];

    return {
      provider: "apple-vision",
      languages: first?.languages?.length
        ? first.languages
        : input.languagePreferences.map((language) => APPLE_VISION_LANGUAGE_IDS[language]),
      lines: (first?.lines ?? []).map((line) => ({
        text: line.text ?? "",
        confidence: typeof line.confidence === "number" ? line.confidence : 0,
      })).filter((line) => line.text.length > 0),
    };
  }
}

function parseAppleVisionPayload(stdout: string): AppleVisionPayload {
  const jsonStart = stdout.indexOf("[");
  if (jsonStart === -1) {
    throw new Error("Apple Vision OCR did not return JSON");
  }

  return JSON.parse(stdout.slice(jsonStart)) as AppleVisionPayload;
}
