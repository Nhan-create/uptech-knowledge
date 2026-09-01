import type { LeasedJob } from "../jobs/core";
import type {
  DirectoryTraversal,
  GoogleDirectoryDirectMember,
  GoogleDirectoryGroup,
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
}

const DIRECTORY_ORIGIN = "https://admin.googleapis.com/admin/directory/v1";

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
  const freshFor = dependencies.freshFor ?? 5 * 60_000;
  const maxPages = dependencies.maxPages ?? 1_000;
  if (typeof fetch !== "function" || !Number.isFinite(freshFor) || freshFor <= 0 ||
      !Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new GoogleDirectoryTransportError("Google Directory transport is not configured");
  }

  async function pages(
    path: string,
    key: string,
  ): Promise<DirectoryTraversal<Record<string, unknown>>> {
    const token = requireText("Google Directory access token", await dependencies.accessTokenProvider.getAccessToken(lease));
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
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!response.ok) throw new GoogleDirectoryTransportError("Google Directory request failed");
      const payload: unknown = await response.json();
      if (typeof payload !== "object" || payload === null) {
        throw new GoogleDirectoryTransportError("Google Directory response is invalid");
      }
      const record = payload as Record<string, unknown>;
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

  return {
    async listUsers(): Promise<DirectoryTraversal<GoogleDirectoryUser>> {
      const result = await pages("/users?customer=my_customer&projection=full", "users");
      return {
        ...result,
        items: result.items.map((user) => ({
          googleSubject: requireText("Google user id", user.id),
          fullName: requireText("Google user full name", (user.name as Record<string, unknown> | undefined)?.fullName),
          primaryEmail: requireText("Google user primary email", user.primaryEmail),
          department: typeof (user.organizations as readonly Record<string, unknown>[] | undefined)?.[0]?.department === "string"
            ? (user.organizations as readonly Record<string, unknown>[])[0].department as string : null,
          lifecycleState: user.suspended === true ? "SUSPENDED" : "ACTIVE",
          isAdmin: user.isAdmin === true,
        })),
      };
    },
    async listGroups(): Promise<DirectoryTraversal<GoogleDirectoryGroup>> {
      const result = await pages("/groups?customer=my_customer", "groups");
      return { ...result, items: result.items.map((group) => ({ googleGroupId: requireText("Google group id", group.id), groupName: requireText("Google group name", group.name) })) };
    },
    async listDirectMembers(googleGroupId): Promise<DirectoryTraversal<GoogleDirectoryDirectMember>> {
      const result = await pages(`/groups/${encodeURIComponent(requireText("Google group id", googleGroupId))}/members`, "members");
      return { ...result, items: result.items.filter((member) => member.type === "USER").map((member) => ({ googleSubject: requireText("Google member id", member.id) })) };
    },
  };
}
