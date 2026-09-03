import type { LeasedJob } from "../jobs/core";
import type {
  DirectoryTraversal,
  GoogleDirectoryCustomer,
  GoogleDirectoryDirectMember,
  GoogleDirectoryGroup,
  GoogleDirectoryOrgUnit,
  GoogleDirectoryTransport,
  GoogleDirectoryUser,
} from "./google-directory-transport";

export class GoogleDirectoryTransportError extends Error {
  override readonly name = "GoogleDirectoryTransportError";
}

export interface GoogleDirectoryAccessTokenProvider {
  /** Resolves an existing server-side DIRECTORY connector credential. */
  getAccessToken(lease: LeasedJob): Promise<string>;
}

export interface GoogleDirectoryHttpDependencies {
  readonly accessTokenProvider: GoogleDirectoryAccessTokenProvider;
  readonly fetch?: typeof globalThis.fetch;
  readonly freshFor?: number;
  readonly maxPages?: number;
  readonly timeoutMs?: number;
}

const DIRECTORY_ORIGIN = "https://admin.googleapis.com/admin/directory/v1";
export const APPROVED_DIRECTORY_FRESHNESS_TTL_MS = 5 * 60_000;
const DEFAULT_DIRECTORY_REQUEST_TIMEOUT_MS = 10_000;
const MAX_DIRECTORY_REQUEST_TIMEOUT_MS = 30_000;

function requireText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GoogleDirectoryTransportError(`${label} is invalid`);
  }
  return value;
}

function array(value: unknown, label: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "object" && item !== null)) {
    throw new GoogleDirectoryTransportError(`${label} is invalid`);
  }
  return value as readonly Record<string, unknown>[];
}

function primaryDepartment(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const primary = value.find(
    (organization): organization is Record<string, unknown> =>
      typeof organization === "object" && organization !== null &&
      (organization as Record<string, unknown>).primary === true,
  );
  return typeof primary?.department === "string" && primary.department.trim().length > 0
    ? primary.department
    : null;
}

/** Creates a read-only, lease-bound, fully paginated Google Admin transport. */
export function createGoogleDirectoryHttpTransport(
  lease: LeasedJob,
  dependencies: GoogleDirectoryHttpDependencies,
): GoogleDirectoryTransport {
  if (lease.jobKind !== "DIRECTORY_SYNC" || lease.sourceId !== null) {
    throw new GoogleDirectoryTransportError(
      "Google Directory transport requires a DIRECTORY_SYNC lease",
    );
  }
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const freshFor = dependencies.freshFor ?? APPROVED_DIRECTORY_FRESHNESS_TTL_MS;
  const maxPages = dependencies.maxPages ?? 1_000;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_DIRECTORY_REQUEST_TIMEOUT_MS;
  if (typeof fetch !== "function" || !Number.isFinite(freshFor) || freshFor <= 0 ||
      freshFor > APPROVED_DIRECTORY_FRESHNESS_TTL_MS ||
      !Number.isSafeInteger(maxPages) || maxPages < 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > MAX_DIRECTORY_REQUEST_TIMEOUT_MS) {
    throw new GoogleDirectoryTransportError("Google Directory transport is not configured");
  }

  let accessTokenPromise: Promise<string> | undefined;
  async function accessToken(): Promise<string> {
    accessTokenPromise ??= (async () => {
      try {
        return requireText(
          "Google Directory access token",
          await dependencies.accessTokenProvider.getAccessToken(lease),
        );
      } catch {
        throw new GoogleDirectoryTransportError("Google Directory request failed");
      }
    })();
    return accessTokenPromise;
  }

  async function requestJson(
    url: URL,
    token: string,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!response.ok || response.redirected) {
        throw new GoogleDirectoryTransportError("Google Directory request failed");
      }
      const payload: unknown = await response.json();
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new GoogleDirectoryTransportError("Google Directory request failed");
      }
      return payload as Record<string, unknown>;
    } catch {
      // Provider/network errors can contain serialized request headers. Never
      // propagate them across the Directory worker boundary.
      throw new GoogleDirectoryTransportError("Google Directory request failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function pages(
    path: string,
    key: string,
  ): Promise<DirectoryTraversal<Record<string, unknown>>> {
    const token = await accessToken();
    const items: Record<string, unknown>[] = [];
    const seenPageTokens = new Set<string>();
    let pageCount = 0;
    let pageToken: string | undefined;
    do {
      if (pageCount >= maxPages) {
        throw new GoogleDirectoryTransportError("Google Directory page limit exceeded");
      }
      pageCount += 1;
      if (pageToken !== undefined) {
        if (seenPageTokens.has(pageToken)) {
          throw new GoogleDirectoryTransportError("Google Directory pagination repeated a page token");
        }
        seenPageTokens.add(pageToken);
      }
      const url = new URL(`${DIRECTORY_ORIGIN}${path}`);
      url.searchParams.set("maxResults", "200");
      if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
      const record = await requestJson(url, token);
      items.push(...array(record[key] ?? [], `Google Directory ${key}`));
      const next = record.nextPageToken;
      if (next === undefined) {
        pageToken = undefined;
      } else {
        pageToken = requireText("Google Directory nextPageToken", next);
      }
    } while (pageToken !== undefined);
    return { items, traversalComplete: true, freshUntil: new Date(Date.now() + freshFor) };
  }

  async function get(
    path: string,
  ): Promise<Record<string, unknown>> {
    const token = await accessToken();
    return requestJson(new URL(`${DIRECTORY_ORIGIN}${path}`), token);
  }

  return {
    async getCustomer(): Promise<GoogleDirectoryCustomer> {
      const customer = await get("/customers/my_customer");
      return {
        googleCustomerId: requireText("Google customer id", customer.id),
        primaryDomain: requireText("Google customer domain", customer.customerDomain),
      };
    },
    async listUsers(): Promise<DirectoryTraversal<GoogleDirectoryUser>> {
      const result = await pages("/users?customer=my_customer&projection=FULL&viewType=admin_view", "users");
      return {
        ...result,
        items: result.items.map((user) => ({
          googleSubject: requireText("Google user id", user.id),
          fullName: requireText("Google user full name", (user.name as Record<string, unknown> | undefined)?.fullName),
          primaryEmail: requireText("Google user primary email", user.primaryEmail),
          department: primaryDepartment(user.organizations),
          orgUnitPath: requireText("Google user organizational unit path", user.orgUnitPath),
          lifecycleState: user.suspended === true ? "SUSPENDED" : "ACTIVE",
          isAdmin: user.isAdmin === true,
          isDelegatedAdmin: user.isDelegatedAdmin === true,
        })),
      };
    },
    async listOrgUnits(): Promise<DirectoryTraversal<GoogleDirectoryOrgUnit>> {
      // Unlike the users, groups, and members list methods, orgunits.list is
      // not paginated and rejects pagination parameters. Fetch the complete
      // tree in one supported request.
      const payload = await get(
        "/customer/my_customer/orgunits?type=ALL_INCLUDING_PARENT",
      );
      return {
        items: array(
          payload.organizationUnits ?? [],
          "Google Directory organizationUnits",
        ).map((unit) => ({
          googleOrgUnitId: requireText("Google organizational unit id", unit.orgUnitId),
          orgUnitPath: requireText("Google organizational unit path", unit.orgUnitPath),
          parentGoogleOrgUnitId: unit.parentOrgUnitId === undefined
            ? null
            : requireText("Google parent organizational unit id", unit.parentOrgUnitId),
        })),
        traversalComplete: true,
        freshUntil: new Date(Date.now() + freshFor),
      };
    },
    async listGroups(): Promise<DirectoryTraversal<GoogleDirectoryGroup>> {
      const result = await pages("/groups?customer=my_customer", "groups");
      return { ...result, items: result.items.map((group) => ({ googleGroupId: requireText("Google group id", group.id), groupName: requireText("Google group name", group.name) })) };
    },
    async listDirectMembers(googleGroupId): Promise<DirectoryTraversal<GoogleDirectoryDirectMember>> {
      const result = await pages(
        `/groups/${encodeURIComponent(requireText("Google group id", googleGroupId))}/members?includeDerivedMembership=false`,
        "members",
      );
      return { ...result, items: result.items.filter((member) => member.type === "USER").map((member) => ({ googleSubject: requireText("Google member id", member.id) })) };
    },
  };
}
