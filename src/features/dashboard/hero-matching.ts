import type {
  DocumentSummaryView,
  SpaceSummaryView,
} from "@/features/knowledge/model";

export type ChatScopeSlug = "all" | "hr" | "operations" | "atlas";

export type HeroPreset = Readonly<{
  id: string;
  vi: string;
  en: string;
}>;

export type HeroMatchResult = Readonly<{
  matches: readonly DocumentSummaryView[];
  readyCountInScope: number;
  processingCountInScope: number;
  nonReadyCountInScope: number;
}>;

export const SPACE_ID_TO_CHAT_SCOPE: Readonly<Record<string, Exclude<ChatScopeSlug, "all">>> = {
  spc_8f2a01: "hr",
  spc_c14d72: "operations",
  spc_6be903: "atlas",
};

export const DASHBOARD_HERO_PRESETS: readonly HeroPreset[] = [
  {
    id: "remote-work",
    vi: "Quy định làm việc từ xa 2026 và bảo mật ngoài văn phòng",
    en: "Remote work policy 2026 and off-site security",
  },
  {
    id: "team-handbook",
    vi: "Cẩm nang quản lý đội nhóm phân tán",
    en: "Distributed team management handbook",
  },
  {
    id: "project-ops",
    vi: "Hướng dẫn vận hành và theo dõi đầu việc bàn giao",
    en: "Project operations guide and handover checklist",
  },
] as const;

const ENGLISH_QUERY_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bremote\b/, "lam viec tu xa"],
  [/\bpolicy\b/, "quy dinh"],
  [/\bsecurity\b/, "bao mat"],
  [/\bhandbook\b/, "cam nang"],
  [/\bmanagers?\b|\bmanagement\b/, "quan ly"],
  [/\bteams?\b/, "doi nhom"],
  [/\bdistributed\b|\bcoordinate\b/, "phan tan phoi hop"],
  [/\boperations?\b/, "van hanh"],
  [/\bguide\b/, "huong dan"],
  [/\bproject\b/, "du an"],
  [/\bhandover\b/, "ban giao"],
];

/** Fold Vietnamese diacritics and lowercase text for accent-tolerant matching. */
export function normalizeFold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

/** Map a workspace space ID (or normalized space name) to the /chat ?scope slug. */
export function resolveChatScopeForSpace(
  spaceId: string,
  spaces: readonly SpaceSummaryView[] = [],
): ChatScopeSlug {
  if (spaceId === "all") return "all";
  const direct = SPACE_ID_TO_CHAT_SCOPE[spaceId];
  if (direct) return direct;

  const matchedSpace = spaces.find((space) => space.id === spaceId);
  if (!matchedSpace) return "all";

  const folded = normalizeFold(matchedSpace.name);
  if (folded.includes("nhan su") || folded.includes("hr")) return "hr";
  if (folded.includes("van hanh") || folded.includes("operation")) return "operations";
  if (folded.includes("atlas")) return "atlas";
  return "all";
}

/** Build a /chat URL preserving non-empty prompt and mapped ?scope query params. */
export function buildDashboardChatHref(
  query: string,
  spaceId: string,
  spaces: readonly SpaceSummaryView[] = [],
): string {
  const params = new URLSearchParams();
  const cleaned = query.trim();
  if (cleaned) params.set("prompt", cleaned);

  const scope = resolveChatScopeForSpace(spaceId, spaces);
  if (scope !== "all") params.set("scope", scope);

  const qs = params.toString();
  return qs ? `/chat?${qs}` : "/chat";
}

/** Build a /search URL preserving non-empty q and scoped ?space query params. */
export function buildDashboardSearchHref(query: string, spaceId: string): string {
  const params = new URLSearchParams();
  const cleaned = query.trim();
  if (cleaned) params.set("q", cleaned);
  if (spaceId !== "all") params.set("space", spaceId);

  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

function expandQueryTokens(query: string): string[] {
  let folded = normalizeFold(query);
  for (const [pattern, viHint] of ENGLISH_QUERY_ALIASES) {
    if (pattern.test(folded)) {
      folded = `${folded} ${viHint}`;
    }
  }
  const unique = new Set(
    folded
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1),
  );
  return Array.from(unique);
}

/**
 * Rank only Ready-state documents in the selected scope for dashboard preview.
 * Non-ready documents (OCR, indexing, failed, uploading) are strictly excluded
 * to uphold the Ready-Only provenance contract on /dashboard.
 */
export function findHeroMatchingDocuments(
  documents: readonly DocumentSummaryView[],
  query: string,
  spaceId: string,
  options?: Readonly<{
    getExtraText?: (doc: DocumentSummaryView) => string;
  }>,
): HeroMatchResult {
  const scopedDocs =
    spaceId === "all"
      ? documents
      : documents.filter((doc) => doc.space.id === spaceId);

  const readyPool = scopedDocs.filter((doc) => doc.processing.kind === "ready");
  const processingCountInScope = scopedDocs.filter(
    (doc) => doc.processing.kind !== "ready" && doc.processing.kind !== "failed",
  ).length;
  const nonReadyCountInScope = scopedDocs.length - readyPool.length;

  const baseCounts = {
    readyCountInScope: readyPool.length,
    processingCountInScope,
    nonReadyCountInScope,
  };

  if (readyPool.length === 0) {
    return { matches: [], ...baseCounts };
  }

  const tokens = expandQueryTokens(query);
  if (tokens.length === 0) {
    return { matches: readyPool.slice(0, 3), ...baseCounts };
  }

  const minMatchedTokens = tokens.length >= 4 ? 2 : 1;

  const matches = readyPool
    .map((doc) => {
      const nameFold = normalizeFold(doc.name);
      const extraText = options?.getExtraText ? options.getExtraText(doc) : "";
      const metaFold = normalizeFold(
        `${doc.detail} ${doc.space.name} ${doc.ownerLabel} ${extraText}`,
      );
      let score = 0;
      let matchedTokens = 0;

      for (const token of tokens) {
        const inName = nameFold.includes(token);
        const inMeta = metaFold.includes(token);
        if (inName || inMeta) {
          matchedTokens += 1;
          score += inName ? 3 : 2;
        }
      }

      return { doc, score, matchedTokens };
    })
    .filter((entry) => entry.matchedTokens >= minMatchedTokens)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.doc);

  return { matches, ...baseCounts };
}
