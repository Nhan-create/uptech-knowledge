import { domainToASCII } from "node:url";

export type GoogleWorkspaceDomainKind = "PRIMARY" | "SECONDARY" | "ALIAS";

export interface VerifiedGoogleWorkspaceDomain {
  readonly normalizedDomain: string;
  readonly kind: GoogleWorkspaceDomainKind;
  readonly providerParentDomain: string | null;
  readonly verified: true;
}

const MAX_DOMAINS = 1_000;
const MAX_PAYLOAD_BYTES = 256 * 1_024;

function fail(): never {
  throw new TypeError("Google Workspace domain evidence is invalid");
}

function rawEvidenceByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") return fail();
    return new TextEncoder().encode(serialized).byteLength;
  } catch {
    return fail();
  }
}

function domain(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 253 || value.trim() !== value) return fail();
  const normalized = domainToASCII(value.toLowerCase());
  if (
    normalized.length < 3 || normalized.length > 253 || normalized.endsWith(".") ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u.test(normalized)
  ) return fail();
  return normalized;
}

function recordList(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))) return fail();
  return value as readonly Readonly<Record<string, unknown>>[];
}

export function normalizeVerifiedGoogleWorkspaceDomains(input: {
  readonly customerDomain: string;
  readonly domains: readonly Readonly<Record<string, unknown>>[];
}): readonly VerifiedGoogleWorkspaceDomain[] {
  const domains = input.domains;
  if (
    !Array.isArray(domains) ||
    domains.length > MAX_DOMAINS ||
    rawEvidenceByteLength(domains) > MAX_PAYLOAD_BYTES
  ) return fail();
  const customerDomain = domain(input.customerDomain);
  const evidence: VerifiedGoogleWorkspaceDomain[] = [];
  for (const item of domains) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return fail();
    if (item.verified !== true && item.verified !== false) return fail();
    if (item.verified !== true) continue;
    const normalizedDomain = domain(item.domainName);
    const primary = item.isPrimary;
    if (primary !== true && primary !== false) return fail();
    evidence.push(Object.freeze({
      normalizedDomain,
      kind: primary ? "PRIMARY" : "SECONDARY",
      providerParentDomain: null,
      verified: true as const,
    }));
    for (const alias of recordList(item.domainAliases)) {
      if (alias.verified !== true) continue;
      const aliasDomain = domain(alias.domainAliasName);
      const parent = alias.parentDomainName === undefined
        ? normalizedDomain
        : domain(alias.parentDomainName);
      if (parent !== normalizedDomain) return fail();
      evidence.push(Object.freeze({
        normalizedDomain: aliasDomain,
        kind: "ALIAS" as const,
        providerParentDomain: normalizedDomain,
        verified: true as const,
      }));
    }
  }
  const primary = evidence.filter((item) => item.kind === "PRIMARY");
  if (primary.length !== 1 || primary[0].normalizedDomain !== customerDomain) return fail();
  evidence.sort((left, right) =>
    left.normalizedDomain.localeCompare(right.normalizedDomain) ||
    left.kind.localeCompare(right.kind) ||
    (left.providerParentDomain ?? "").localeCompare(right.providerParentDomain ?? "")
  );
  const keys = new Set<string>();
  const normalizedDomains = new Set<string>();
  for (const item of evidence) {
    const key = `${item.normalizedDomain}\u0000${item.kind}\u0000${item.providerParentDomain ?? ""}`;
    if (keys.has(key)) return fail();
    keys.add(key);
    if (normalizedDomains.has(item.normalizedDomain)) return fail();
    normalizedDomains.add(item.normalizedDomain);
  }
  if (evidence.length > MAX_DOMAINS || new TextEncoder().encode(JSON.stringify(evidence)).byteLength > MAX_PAYLOAD_BYTES) return fail();
  return Object.freeze(evidence);
}
