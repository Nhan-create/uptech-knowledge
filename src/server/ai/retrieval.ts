import { normalizeFold } from "@/features/dashboard/hero-matching";
import {
  resolveScopeToSpaceId,
  type ChatCitationSource,
  type ChatTurnEvidenceState,
  type ContextScopeType,
} from "@/features/chat/chat-engine";
import { embedTextWithGemini } from "@/server/ai/gemini-client";
import type {
  StoredDocumentChunk,
  StoredKnowledgeDocument,
} from "@/server/knowledge/repository";

export interface RetrievedReadyPassage {
  readonly number: number;
  readonly document: StoredKnowledgeDocument;
  readonly chunk: StoredDocumentChunk;
  readonly isDeprecated: boolean;
  readonly score: number;
}

export interface RetrievalOutcome {
  readonly evidenceState: ChatTurnEvidenceState;
  readonly excludedCount: number;
  readonly hasRelevantMatch: boolean;
  readonly passages: readonly RetrievedReadyPassage[];
  readonly citations: readonly ChatCitationSource[];
}

export interface RankedChunkMatch {
  readonly document: StoredKnowledgeDocument;
  readonly chunk: StoredDocumentChunk;
  readonly score: number;
  readonly lexicalHit: boolean;
  readonly semanticScore: number;
}

const SUMMARY_INTENT_PATTERN =
  /tom tat|tong hop|summary|summarize|overview|tat ca|all docs/iu;

const ENTERPRISE_SYNONYM_MAP: Readonly<Record<string, readonly string[]>> = {
  wfh: ["lam", "viec", "tu", "xa", "remote"],
  remote: ["tu", "xa", "hybrid"],
  hr: ["nhan", "su", "nghi", "phep", "onboarding"],
  sla: ["cam", "ket", "phan", "hoi", "xu", "ly", "incident"],
  adr: ["quyet", "dinh", "kien", "truc", "decision"],
  mfa: ["xac", "thuc", "hai", "lop", "bao", "mat", "vpn"],
  security: ["bao", "mat", "an", "toan", "thong", "tin"],
  handover: ["ban", "giao", "du", "an", "atlas"],
};

export function tokenizeQuery(query: string): string[] {
  const baseTokens = Array.from(
    new Set(
      normalizeFold(query)
        .split(/[\s,.;:!?()[\]{}"'\/\\-]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
  const expanded = new Set<string>(baseTokens);
  for (const token of baseTokens) {
    const synonyms = ENTERPRISE_SYNONYM_MAP[token];
    if (synonyms) {
      for (const syn of synonyms) expanded.add(syn);
    }
  }
  return Array.from(expanded);
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

function matchesLexicalToken(haystack: string, token: string): boolean {
  if (token.length <= 3) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "u").test(
      haystack,
    );
  }
  return haystack.includes(token);
}

function lexicalChunkMatch(
  tokens: readonly string[],
  foldedQuery: string,
  doc: StoredKnowledgeDocument,
  chunk: StoredDocumentChunk,
): { readonly score: number; readonly hit: boolean } {
  const chunkHeading = normalizeFold(chunk.heading);
  const titleHaystack = normalizeFold(`${doc.summary.name} ${chunk.heading}`);
  const haystack = normalizeFold(
    `${doc.summary.name} ${doc.summary.space.name} ${chunk.heading} ${chunk.content}`,
  );
  let score = 0;

  if (foldedQuery.length >= 3 && haystack.includes(foldedQuery)) {
    score += 18;
  }
  const rawTokens = foldedQuery
    .split(/[\s,.;:!?()[\]{}"'/\\-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  for (let i = 0; i + 1 < rawTokens.length; i += 1) {
    const bigram = `${rawTokens[i]} ${rawTokens[i + 1]}`;
    if (haystack.includes(bigram)) {
      score += 10;
      if (chunkHeading.includes(bigram)) {
        score += 6;
      }
    }
  }
  for (const token of tokens) {
    if (matchesLexicalToken(haystack, token)) {
      score += 4;
      if (matchesLexicalToken(titleHaystack, token)) {
        score += 3;
      }
      if (matchesLexicalToken(chunkHeading, token)) {
        score += 3;
      }
    }
  }

  return {
    score,
    hit: score > 0 || (tokens.length === 0 && matchesLexicalToken(haystack, foldedQuery)),
  };
}

/**
 * Shared hybrid lexical + Gemini vector ranker across Ready documents.
 */
export async function rankReadyChunksHybrid(args: Readonly<{
  query: string;
  documents: readonly StoredKnowledgeDocument[];
  includeAllOnZeroMatch?: boolean;
  prioritizeDocIds?: ReadonlySet<string>;
}>): Promise<readonly RankedChunkMatch[]> {
  const readyDocs = args.documents.filter(
    (doc) => doc.summary.processing.kind === "ready" && doc.chunks.length > 0,
  );
  if (readyDocs.length === 0) return [];

  const foldedQuery = normalizeFold(args.query);
  const tokens = tokenizeQuery(args.query);
  const hasStoredEmbeddings = readyDocs.some((doc) =>
    doc.chunks.some((c) => Array.isArray(c.embedding) && c.embedding.length > 0),
  );
  const queryEmbedding = hasStoredEmbeddings
    ? await embedTextWithGemini(args.query)
    : null;

  const ranked: RankedChunkMatch[] = [];
  for (const doc of readyDocs) {
    const selectedBonus =
      args.prioritizeDocIds?.has(doc.summary.id) || doc.isUserUploaded ? 4 : 0;
    const deprecatedPenalty = doc.summary.governance.some(
      (g) => g.kind === "deprecated",
    )
      ? -3
      : 1;

    for (const chunk of doc.chunks) {
      const lex = lexicalChunkMatch(tokens, foldedQuery, doc, chunk);
      const semanticScore =
        queryEmbedding && chunk.embedding && chunk.embedding.length > 0
          ? cosineSimilarity(queryEmbedding, chunk.embedding)
          : 0;
      const vectorBonus = semanticScore >= 0.45 ? semanticScore * 14 : 0;

      if (!lex.hit && vectorBonus === 0 && !args.includeAllOnZeroMatch) {
        continue;
      }

      const summaryBonus = SUMMARY_INTENT_PATTERN.test(foldedQuery) ? 5 : 0;
      const score =
        lex.score + vectorBonus + selectedBonus + deprecatedPenalty + summaryBonus;

      ranked.push({
        document: doc,
        chunk,
        score,
        lexicalHit: lex.hit,
        semanticScore,
      });
    }
  }

  ranked.sort((a, b) => b.score - a.score);

  if (ranked.length > 1 && queryEmbedding) {
    const byLexical = [...ranked].sort((a, b) => b.score - a.score);
    const bySemantic = [...ranked].sort((a, b) => b.semanticScore - a.semanticScore);
    const lexRankMap = new Map<string, number>();
    const semRankMap = new Map<string, number>();
    byLexical.forEach((item, idx) => lexRankMap.set(item.chunk.chunkId, idx + 1));
    bySemantic.forEach((item, idx) => semRankMap.set(item.chunk.chunkId, idx + 1));

    const rrfScored = ranked.map((item) => {
      const lRank = lexRankMap.get(item.chunk.chunkId) ?? 100;
      const sRank = semRankMap.get(item.chunk.chunkId) ?? 100;
      const rrfBonus = (1 / (60 + lRank) + 1 / (60 + sRank)) * 120;
      return {
        ...item,
        score: item.score + rrfBonus,
      };
    });
    rrfScored.sort((a, b) => b.score - a.score);
    return rrfScored;
  }

  return ranked;
}

export async function retrieveReadyPassagesForChat(args: Readonly<{
  prompt: string;
  scope: ContextScopeType;
  selectedDocumentIds: readonly string[];
  documents: readonly StoredKnowledgeDocument[];
  maxPassages?: number;
}>): Promise<RetrievalOutcome> {
  const maxPassages = args.maxPassages ?? 5;
  const scopeSpaceId = resolveScopeToSpaceId(args.scope);
  const selectedIdSet = new Set(args.selectedDocumentIds);

  const docsInScope =
    args.scope === "selected-documents"
      ? args.documents.filter((doc) => selectedIdSet.has(doc.summary.id))
      : scopeSpaceId === "all"
        ? args.documents
        : args.documents.filter((doc) => doc.summary.space.id === scopeSpaceId);

  const readyDocs = docsInScope.filter(
    (doc) => doc.summary.processing.kind === "ready" && doc.chunks.length > 0,
  );
  const excludedCount = docsInScope.filter(
    (doc) => doc.summary.processing.kind !== "ready",
  ).length;

  if (readyDocs.length === 0) {
    return {
      evidenceState: "empty",
      excludedCount,
      hasRelevantMatch: false,
      passages: [],
      citations: [],
    };
  }

  const ranked = await rankReadyChunksHybrid({
    query: args.prompt,
    documents: readyDocs,
    includeAllOnZeroMatch: true,
    prioritizeDocIds: selectedIdSet,
  });

  const selected: RankedChunkMatch[] = [];
  const perDocCount = new Map<string, number>();

  for (const candidate of ranked) {
    if (selected.length >= maxPassages) break;
    const count = perDocCount.get(candidate.document.summary.id) ?? 0;
    if (count >= 2 && readyDocs.length > 1) continue;
    selected.push(candidate);
    perDocCount.set(candidate.document.summary.id, count + 1);
  }

  const passages: RetrievedReadyPassage[] = selected.map((item, idx) => ({
    number: idx + 1,
    document: item.document,
    chunk: item.chunk,
    isDeprecated: item.document.summary.governance.some(
      (g) => g.kind === "deprecated",
    ),
    score: item.score,
  }));

  const citations: ChatCitationSource[] = passages.map((p) => ({
    id: p.document.summary.id,
    chunkId: p.chunk.chunkId,
    number: p.number,
    title: p.document.summary.name,
    fileType: p.document.summary.fileType,
    version: p.document.summary.versionLabel,
    location: p.chunk.locator,
    heading: p.chunk.heading,
    quote: p.chunk.content,
    knowledgeSpace: p.document.summary.space.name,
    spaceId: p.document.summary.space.id,
    statusLabel: p.document.summary.processing.label,
    ownerLabel: p.document.summary.ownerLabel,
    updatedLabel: p.document.summary.updatedLabel,
    isDeprecated: p.isDeprecated,
    isLocalUpload: p.document.summary.id.startsWith("local-"),
  }));

  const foldedPrompt = normalizeFold(args.prompt);
  const isSummaryIntent = SUMMARY_INTENT_PATTERN.test(foldedPrompt);
  const isPinnedScope =
    args.scope === "selected-documents" && selectedIdSet.size > 0;
  const hasSemanticOrLexicalHit = selected.some(
    (item) => (item.lexicalHit && item.score >= 8) || item.semanticScore >= 0.45,
  );
  const hasRelevantMatch =
    isPinnedScope || isSummaryIntent || hasSemanticOrLexicalHit;

  const hasCaution = passages.some((p) => p.isDeprecated);
  return {
    evidenceState: hasCaution ? "caution" : "grounded",
    excludedCount,
    hasRelevantMatch,
    passages,
    citations,
  };
}
