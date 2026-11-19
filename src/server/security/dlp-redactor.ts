export type DlpFindingKind =
  | "API_SECRET"
  | "PAYMENT_CARD"
  | "CITIZEN_ID"
  | "PHONE_NUMBER";

export interface DlpRedactionResult {
  readonly sanitizedText: string;
  readonly redactionCount: number;
  readonly findings: readonly DlpFindingKind[];
}

const API_SECRET_REGEX =
  /\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{24,}|xox[baprs]-[A-Za-z0-9-]{20,}|upt_live_[A-Za-z0-9]{24,})\b/g;

const CITIZEN_ID_REGEX =
  /\b((?:CCCD|CMND|Số\s*định\s*danh|Citizen\s*ID)\s*[:#-]?\s*)(\d{9}|\d{12})\b/giu;

const PAYMENT_CARD_REGEX =
  /\b(?:\d{4}[-\s]){3}\d{4}\b|\b(?:4\d{15}|5[1-5]\d{14}|3[47]\d{13})\b/g;

const VN_PHONE_REGEX =
  /(?:(?:\+84|84)[\s.-]?(?:3|5|7|8|9)\d[\s.-]?\d{3}[\s.-]?\d{4}|\b0(?:3|5|7|8|9)\d[\s.-]?\d{3}[\s.-]?\d{4}\b)/g;

/**
 * Enterprise DLP (Data Loss Prevention) & PII Redaction Engine.
 * Automatically masks credentials, API keys, payment cards, citizen IDs (CCCD/CMND),
 * and phone numbers before sending text to external LLM APIs or indexing when enabled.
 */
export function redactSensitiveDlpContent(
  input: string,
  enabled = true,
): DlpRedactionResult {
  if (!enabled || !input) {
    return {
      sanitizedText: input,
      redactionCount: 0,
      findings: [],
    };
  }

  let text = input;
  let redactionCount = 0;
  const findingSet = new Set<DlpFindingKind>();

  text = text.replace(API_SECRET_REGEX, () => {
    redactionCount += 1;
    findingSet.add("API_SECRET");
    return "[REDACTED_SECRET]";
  });

  text = text.replace(CITIZEN_ID_REGEX, (_full, prefix: string) => {
    redactionCount += 1;
    findingSet.add("CITIZEN_ID");
    return `${prefix}[REDACTED_CCCD]`;
  });

  text = text.replace(PAYMENT_CARD_REGEX, () => {
    redactionCount += 1;
    findingSet.add("PAYMENT_CARD");
    return "[REDACTED_CARD]";
  });

  text = text.replace(VN_PHONE_REGEX, () => {
    redactionCount += 1;
    findingSet.add("PHONE_NUMBER");
    return "[REDACTED_PHONE]";
  });

  return {
    sanitizedText: text,
    redactionCount,
    findings: Array.from(findingSet),
  };
}
