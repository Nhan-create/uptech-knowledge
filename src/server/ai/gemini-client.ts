import { request as httpsRequest } from "node:https";

export interface GroundedSourcePassage {
  readonly number: number;
  readonly documentId: string;
  readonly title: string;
  readonly location: string;
  readonly heading: string;
  readonly knowledgeSpace: string;
  readonly governanceWarning: boolean;
  readonly content: string;
}

export interface GroundedConversationMessage {
  readonly prompt: string;
  readonly answerSummary: string;
}

export interface GeminiGroundedAnswer {
  readonly model: string;
  readonly intro: string;
  readonly points: readonly Readonly<{
    heading: string;
    detail: string;
    citationNumber: number;
  }>[];
}

export interface PdfExtractedSection {
  readonly heading: string;
  readonly locator: string;
  readonly content: string;
}

export class GeminiServiceError extends Error {
  readonly code: "NOT_CONFIGURED" | "UPSTREAM_ERROR" | "INVALID_RESPONSE";

  constructor(
    code: "NOT_CONFIGURED" | "UPSTREAM_ERROR" | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "GeminiServiceError";
  }
}

const GEMINI_API_HOST = "generativelanguage.googleapis.com";
const DEFAULT_CHAT_MODEL = "gemini-3-flash-preview";
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";
const FALLBACK_CHAT_MODELS = [
  "gemini-3-flash-preview",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.8-flash",
] as const;

export function readGeminiConfig(): {
  readonly apiKey: string;
  readonly chatModel: string;
  readonly embeddingModel: string;
} | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (!apiKey || apiKey === "replace_with_gemini_api_key") {
    return null;
  }
  const chatModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_CHAT_MODEL;
  const embeddingModel =
    process.env.GEMINI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;

  return { apiKey, chatModel, embeddingModel };
}

function parseJsonResponseSafely<T>(rawText: string): T | null {
  const trimmed = rawText.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFences) as T;
  } catch {
    return null;
  }
}

function postJsonOverIpv4(
  path: string,
  apiKey: string,
  payload: unknown,
  timeoutMs: number,
): Promise<{ readonly status: number; readonly body: string }> {
  const serialized = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: GEMINI_API_HOST,
        port: 443,
        path,
        method: "POST",
        family: 4,
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(serialized),
          "x-goog-api-key": apiKey,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 500,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("Gemini HTTPS request timed out"));
    });
    req.on("error", (err) => {
      reject(err);
    });
    req.write(serialized);
    req.end();
  });
}

async function callGeminiEndpoint(
  model: string,
  action: "generateContent" | "embedContent",
  apiKey: string,
  payload: unknown,
  timeoutMs = 15_000,
): Promise<unknown> {
  const path = `/v1beta/models/${encodeURIComponent(model)}:${action}`;

  let result: { readonly status: number; readonly body: string };
  try {
    result = await postJsonOverIpv4(path, apiKey, payload, timeoutMs);
  } catch {
    throw new GeminiServiceError(
      "UPSTREAM_ERROR",
      "Unable to reach Gemini API within timeout.",
    );
  }

  if (result.status < 200 || result.status >= 300) {
    throw new GeminiServiceError(
      "UPSTREAM_ERROR",
      `Gemini upstream returned status ${result.status}.`,
    );
  }

  try {
    return JSON.parse(result.body) as unknown;
  } catch {
    throw new GeminiServiceError(
      "INVALID_RESPONSE",
      "Gemini upstream returned malformed JSON.",
    );
  }
}

async function callGenerateContentWithFallback(
  primaryModel: string,
  apiKey: string,
  payload: unknown,
  timeoutMs = 15_000,
): Promise<{ readonly model: string; readonly raw: unknown }> {
  const modelChain = Array.from(new Set([primaryModel, ...FALLBACK_CHAT_MODELS]));
  let lastError: GeminiServiceError | null = null;

  for (const candidateModel of modelChain) {
    try {
      const raw = await callGeminiEndpoint(
        candidateModel,
        "generateContent",
        apiKey,
        payload,
        timeoutMs,
      );
      return { model: candidateModel, raw };
    } catch (error) {
      if (error instanceof GeminiServiceError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw (
    lastError ??
    new GeminiServiceError("UPSTREAM_ERROR", "All configured Gemini models failed.")
  );
}

function extractCandidateText(rawResponse: unknown): string {
  const candidates = (rawResponse as { candidates?: unknown[] } | null)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const parts = (
    candidates[0] as { content?: { parts?: Array<{ text?: unknown }> } } | undefined
  )?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

export async function generateGroundedChatAnswer(args: Readonly<{
  prompt: string;
  locale: "vi" | "en";
  passages: readonly GroundedSourcePassage[];
  history?: readonly GroundedConversationMessage[];
  scopeLabel: string;
  excludedCount: number;
}>): Promise<GeminiGroundedAnswer> {
  const config = readGeminiConfig();
  if (!config) {
    throw new GeminiServiceError(
      "NOT_CONFIGURED",
      "Gemini API key is not configured on the server.",
    );
  }

  const maxCitationNumber = args.passages.length;
  const languageInstruction =
    args.locale === "vi"
      ? "Trả lời bằng tiếng Việt tự nhiên, rõ ràng, chuyên nghiệp, đi thẳng vào trọng tâm."
      : "Respond in concise, natural professional English.";

  const systemInstruction = [
    "You are UPTECH Knowledge Assistant — an enterprise RAG assistant operating under strict Ready-Only evidence rules.",
    languageInstruction,
    `Current scope: "${args.scopeLabel}". Non-ready documents excluded from search: ${args.excludedCount}.`,
    "CRITICAL RULES:",
    "1. Answer ONLY using facts explicitly supported by the numbered [1]..[N] source passages below.",
    "2. Never fabricate policy numbers, dates, obligations, or rules not present in those passages.",
    "3. If the provided passages do not contain enough information to answer the question cleanly, say so transparently in `intro` and point out what topics the available sources cover.",
    "4. Return strict JSON matching this exact structure:",
    '   { "intro": "Concise 1-2 sentence direct answer", "points": [ { "heading": "Short point title", "detail": "Detailed grounded explanation without inline [1] tags", "citationNumber": 1 } ] }',
    "5. Provide 1 to 5 points when evidence supports them. Every `citationNumber` MUST be an integer between 1 and N referencing the numbered sources below. Do NOT put literal [1] markers inside `intro` or `detail`.",
  ].join("\n");

  const contextBlock = args.passages
    .map(
      (p) =>
        `[${p.number}] Document: ${p.title} | Space: ${p.knowledgeSpace} | Location: ${p.location} | Section: ${p.heading}${p.governanceWarning ? " | GOVERNANCE: DEPRECATED" : ""}\nExcerpt: ${p.content}`,
    )
    .join("\n\n");

  const historyContents = (args.history ?? []).slice(-4).flatMap((turn) => [
    { role: "user", parts: [{ text: turn.prompt }] },
    { role: "model", parts: [{ text: turn.answerSummary }] },
  ]);

  const userPayloadText = [
    "VERIFIED READY-ONLY PASSAGES:",
    contextBlock || "(No matching Ready passages found in the selected scope.)",
    "",
    `USER QUESTION: ${args.prompt}`,
  ].join("\n");

  const { model: usedModel, raw } = await callGenerateContentWithFallback(
    config.chatModel,
    config.apiKey,
    {
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        ...historyContents,
        {
          role: "user",
          parts: [{ text: userPayloadText }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1_200,
        responseMimeType: "application/json",
      },
    },
  );

  const text = extractCandidateText(raw);
  const parsed = parseJsonResponseSafely<{
    intro?: unknown;
    points?: Array<{ heading?: unknown; detail?: unknown; citationNumber?: unknown }>;
  }>(text);

  if (!parsed || typeof parsed.intro !== "string") {
    if (!text) {
      throw new GeminiServiceError(
        "INVALID_RESPONSE",
        "Gemini returned an empty synthesis response.",
      );
    }
    return {
      model: usedModel,
      intro: text,
      points:
        maxCitationNumber > 0
          ? [
              {
                heading: args.passages[0]!.heading,
                detail: text,
                citationNumber: 1,
              },
            ]
          : [],
    };
  }

  const cleanIntro = parsed.intro.replace(/\s*\[\d+\]\s*/g, " ").trim();
  const rawPoints = Array.isArray(parsed.points) ? parsed.points : [];
  const sanitizedPoints = rawPoints
    .map((point) => {
      const heading =
        typeof point.heading === "string"
          ? point.heading.replace(/\s*\[\d+\]\s*/g, " ").trim()
          : "";
      const detail =
        typeof point.detail === "string"
          ? point.detail.replace(/\s*\[\d+\]\s*/g, " ").trim()
          : "";
      const rawNumber =
        typeof point.citationNumber === "number"
          ? Math.trunc(point.citationNumber)
          : 1;
      const citationNumber =
        maxCitationNumber > 0
          ? Math.min(maxCitationNumber, Math.max(1, rawNumber))
          : 1;
      return {
        heading: heading || (args.passages[citationNumber - 1]?.heading ?? "Chi tiết"),
        detail,
        citationNumber,
      };
    })
    .filter((item) => item.detail.length > 0)
    .slice(0, 6);

  if (!cleanIntro && sanitizedPoints.length === 0) {
    throw new GeminiServiceError(
      "INVALID_RESPONSE",
      "Gemini returned empty synthesis content after sanitization.",
    );
  }

  return {
    model: usedModel,
    intro: cleanIntro,
    points: sanitizedPoints,
  };
}

export async function extractPdfSectionsWithGemini(args: Readonly<{
  bytes: Uint8Array;
  fileName: string;
  locale: "vi" | "en";
}>): Promise<readonly PdfExtractedSection[] | null> {
  const config = readGeminiConfig();
  if (!config) return null;

  const base64 = Buffer.from(args.bytes).toString("base64");
  const prompt = [
    `Extract the readable text from this PDF file ("${args.fileName}") faithfully without summarizing away details.`,
    "Split the extracted content into sequential sections/pages.",
    'Return ONLY JSON matching: { "sections": [ { "heading": "...", "locator": "Trang 1", "content": "..." } ] }.',
    "Preserve Vietnamese diacritics and exact numbers/rules.",
  ].join("\n");

  try {
    const { raw } = await callGenerateContentWithFallback(
      config.chatModel,
      config.apiKey,
      {
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4_096,
          responseMimeType: "application/json",
        },
      },
      25_000,
    );

    const text = extractCandidateText(raw);
    const parsed = parseJsonResponseSafely<{
      sections?: Array<{ heading?: unknown; locator?: unknown; content?: unknown }>;
    }>(text);

    if (!parsed || !Array.isArray(parsed.sections)) return null;

    const cleanSections = parsed.sections
      .map((sec, idx) => ({
        heading:
          typeof sec.heading === "string" && sec.heading.trim()
            ? sec.heading.trim()
            : args.fileName,
        locator:
          typeof sec.locator === "string" && sec.locator.trim()
            ? sec.locator.trim()
            : args.locale === "vi"
              ? `Trang ${idx + 1}`
              : `Page ${idx + 1}`,
        content: typeof sec.content === "string" ? sec.content.trim() : "",
      }))
      .filter((sec) => sec.content.length > 0);

    return cleanSections.length > 0 ? cleanSections : null;
  } catch {
    return null;
  }
}

export async function embedTextWithGemini(
  text: string,
): Promise<readonly number[] | null> {
  const config = readGeminiConfig();
  const clean = text.trim().slice(0, 3_000);
  if (!config || !clean) return null;

  try {
    const raw = await callGeminiEndpoint(
      config.embeddingModel,
      "embedContent",
      config.apiKey,
      {
        content: {
          parts: [{ text: clean }],
        },
      },
      6_000,
    );
    const values = (raw as { embedding?: { values?: unknown[] } } | null)?.embedding
      ?.values;
    if (!Array.isArray(values) || values.length === 0) return null;
    return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  } catch {
    return null;
  }
}

export interface DocumentComparisonItem {
  readonly kind: "added" | "changed" | "removed";
  readonly heading: string;
  readonly description: string;
}

export async function compareDocumentsWithGemini(args: Readonly<{
  leftTitle: string;
  leftContent: string;
  rightTitle: string;
  rightContent: string;
  locale: "vi" | "en";
}>): Promise<readonly DocumentComparisonItem[] | null> {
  const config = readGeminiConfig();
  if (!config) return null;

  const languageRule =
    args.locale === "vi"
      ? "Viết hoàn toàn bằng tiếng Việt tự nhiên, súc tích."
      : "Write concisely in natural English.";

  const systemPrompt = [
    "You compare two enterprise documents side by side (Left = baseline, Right = target).",
    languageRule,
    'Return ONLY JSON matching: { "differences": [ { "kind": "added" | "changed" | "removed", "heading": "...", "description": "..." } ] }.',
    '- "added": content present in Right document but missing in Left document.',
    '- "removed": content present in Left document but removed in Right document.',
    '- "changed": section/rule modified between Left and Right.',
    "Limit to at most 8 concrete differences grounded strictly in the provided text.",
  ].join("\n");

  const userPrompt = [
    `=== LEFT DOCUMENT: ${args.leftTitle} ===`,
    args.leftContent.slice(0, 10_000),
    "",
    `=== RIGHT DOCUMENT: ${args.rightTitle} ===`,
    args.rightContent.slice(0, 10_000),
  ].join("\n");

  try {
    const { raw } = await callGenerateContentWithFallback(config.chatModel, config.apiKey, {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1_500,
        responseMimeType: "application/json",
      },
    });
    const parsed = parseJsonResponseSafely<{
      differences?: Array<{ kind?: unknown; heading?: unknown; description?: unknown }>;
    }>(extractCandidateText(raw));
    if (!parsed || !Array.isArray(parsed.differences)) return null;

    const valid = parsed.differences
      .map((item) => {
        const kind =
          item.kind === "added" || item.kind === "changed" || item.kind === "removed"
            ? item.kind
            : "changed";
        const heading = typeof item.heading === "string" ? item.heading.trim() : "";
        const description =
          typeof item.description === "string" ? item.description.trim() : "";
        return { kind, heading, description } as const;
      })
      .filter((d) => d.heading.length > 0 && d.description.length > 0)
      .slice(0, 8);

    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

export interface ExtractedKnowledgeCardDraft {
  readonly kind: "decision" | "open-question" | "rule";
  readonly title: string;
  readonly summary: string;
  readonly rationale: string;
  readonly sourceLocator: string;
}

export async function extractKnowledgeCardsWithGemini(args: Readonly<{
  documentTitle: string;
  content: string;
  locale: "vi" | "en";
}>): Promise<readonly ExtractedKnowledgeCardDraft[] | null> {
  const config = readGeminiConfig();
  if (!config) return null;

  const languageRule =
    args.locale === "vi"
      ? "Viết hoàn toàn bằng tiếng Việt rõ ràng, chuyên nghiệp."
      : "Write concisely in clear professional English.";

  const systemPrompt = [
    "You extract structured enterprise Knowledge Cards from a real company document.",
    languageRule,
    'Return ONLY JSON matching: { "cards": [ { "kind": "decision" | "rule" | "open-question", "title": "...", "summary": "...", "rationale": "...", "sourceLocator": "..." } ] }.',
    '- "decision": agreed organizational decisions, approvals, or policy choices.',
    '- "rule": mandatory rules, numerical thresholds, SLA timelines, or compliance duties.',
    '- "open-question": unresolved ambiguities, edge cases, or ownership questions worth confirming.',
    "Extract 2 to 5 high-value cards grounded strictly in the provided text. Preserve exact numbers and section locators.",
  ].join("\n");

  const userPrompt = [
    `DOCUMENT: ${args.documentTitle}`,
    "",
    args.content.slice(0, 12_000),
  ].join("\n");

  try {
    const { raw } = await callGenerateContentWithFallback(config.chatModel, config.apiKey, {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1_800,
        responseMimeType: "application/json",
      },
    });
    const parsed = parseJsonResponseSafely<{
      cards?: Array<{
        kind?: unknown;
        title?: unknown;
        summary?: unknown;
        rationale?: unknown;
        sourceLocator?: unknown;
      }>;
    }>(extractCandidateText(raw));

    if (!parsed || !Array.isArray(parsed.cards)) return null;

    const clean = parsed.cards
      .map((card) => {
        const kind =
          card.kind === "decision" ||
          card.kind === "open-question" ||
          card.kind === "rule"
            ? card.kind
            : "rule";
        const title = typeof card.title === "string" ? card.title.trim() : "";
        const summary = typeof card.summary === "string" ? card.summary.trim() : "";
        const rationale =
          typeof card.rationale === "string" ? card.rationale.trim() : "";
        const sourceLocator =
          typeof card.sourceLocator === "string" ? card.sourceLocator.trim() : "";
        return { kind, title, summary, rationale, sourceLocator } as const;
      })
      .filter((c) => c.title.length > 0 && c.summary.length > 0)
      .slice(0, 6);

    return clean.length > 0 ? clean : null;
  } catch {
    return null;
  }
}

export type UtilityTaskKind =
  | "summary"
  | "translate"
  | "checklist"
  | "report"
  | "email";

export interface UtilitySourceExcerpt {
  readonly documentId?: string;
  readonly title: string;
  readonly spaceName?: string;
  readonly content: string;
}

export interface UtilityRunResult {
  readonly model: string;
  readonly title: string;
  readonly output: string;
  readonly takeaways: readonly string[];
}

export async function runUtilityTaskWithGemini(args: Readonly<{
  task: UtilityTaskKind;
  targetLanguage?: string;
  customInstruction?: string;
  sources: readonly UtilitySourceExcerpt[];
  locale: "vi" | "en";
}>): Promise<UtilityRunResult | null> {
  const config = readGeminiConfig();
  if (!config || args.sources.length === 0) return null;

  const targetLang = args.targetLanguage?.trim() || (args.locale === "vi" ? "English" : "Vietnamese");
  const taskDirectiveMap: Record<UtilityTaskKind, string> = {
    summary:
      "Produce a sharp executive summary with key highlights, concrete figures/SLAs/deadlines preserved verbatim, and source attributions.",
    translate:
      `Translate the full meaning and terminology accurately into ${targetLang}. Preserve section structure, numbers, proper nouns, and tone.`,
    checklist:
      "Convert all requirements, policies, steps, and obligations into an actionable verification checklist (`- [ ] ...`) grouped logically, with responsible role / timing when specified.",
    report:
      "Generate a structured internal analytical brief with sections: Context & Scope, Key Findings / Rules, Risks or Ambiguities, and Recommended Next Actions.",
    email:
      "Draft a clear, ready-to-send internal workplace email with Subject line, concise context, bulleted key points/actions, and polite sign-off grounded only in the provided source(s).",
  };

  const languageRule =
    args.task === "translate"
      ? `Write the translated output strictly in ${targetLang}. JSON "title" and "takeaways" should also match ${targetLang}.`
      : args.locale === "vi"
        ? "Viết hoàn toàn bằng tiếng Việt tự nhiên, chuyên nghiệp và rõ ràng."
        : "Write in clear, concise, professional English.";

  const systemPrompt = [
    "You are an enterprise Knowledge AI Utility inside UPTECH Knowledge.",
    taskDirectiveMap[args.task],
    languageRule,
    "CRITICAL GROUNDING RULE: Rely ONLY on facts explicitly present in the provided sources. Never invent dates, people, policies, or metrics.",
    'Return ONLY JSON matching: { "title": "...", "output": "...", "takeaways": ["...", "..."] }.',
    '- "title": short headline for this output (under 90 chars).',
    '- "output": clean markdown document text (headers, bullet lists, checkboxes, or email body).',
    '- "takeaways": 2 to 4 concise key bullets suitable to save as Knowledge Cards.',
  ].join("\n");

  const combinedSources = args.sources
    .map((source, index) => {
      const header = source.spaceName
        ? `=== SOURCE ${index + 1}: ${source.title} (${source.spaceName}) ===`
        : `=== SOURCE ${index + 1}: ${source.title} ===`;
      return `${header}\n${source.content.slice(0, 7_500)}`;
    })
    .join("\n\n");

  const customLine = args.customInstruction?.trim()
    ? `\nADDITIONAL USER INSTRUCTION:\n${args.customInstruction.trim()}\n`
    : "";

  const userPrompt = `${customLine}\n${combinedSources}`.trim();

  try {
    const { model, raw } = await callGenerateContentWithFallback(
      config.chatModel,
      config.apiKey,
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: args.task === "translate" ? 0.15 : 0.25,
          maxOutputTokens: 2_500,
          responseMimeType: "application/json",
        },
      },
      30_000,
    );

    const parsed = parseJsonResponseSafely<{
      title?: unknown;
      output?: unknown;
      takeaways?: unknown;
    }>(extractCandidateText(raw));

    if (!parsed || typeof parsed.output !== "string" || !parsed.output.trim()) {
      return null;
    }

    const title =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim()
        : args.sources[0]?.title ?? "AI Utility Output";

    const takeaways = Array.isArray(parsed.takeaways)
      ? parsed.takeaways
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim())
          .slice(0, 4)
      : [];

    return {
      model,
      title,
      output: parsed.output.trim(),
      takeaways,
    };
  } catch {
    return null;
  }
}
