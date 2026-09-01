/**
 * Read-only boundary for the subset of Google Admin Directory data needed by
 * the tenant snapshot. Credentials, OAuth setup, and authorization remain
 * outside this boundary.
 */
export interface DirectoryTraversal<T> {
  readonly items: readonly T[];
  readonly traversalComplete: boolean;
  readonly freshUntil: Date;
}

export interface GoogleDirectoryUser {
  readonly googleSubject: string;
  readonly fullName: string;
  readonly primaryEmail: string;
  readonly department: string | null;
  readonly lifecycleState: "ACTIVE" | "SUSPENDED" | "DELETED";
  /** Setup eligibility metadata only; it is never membership authority. */
  readonly isAdmin?: boolean;
}

export interface GoogleDirectoryGroup {
  readonly googleGroupId: string;
  readonly groupName: string;
}

export interface GoogleDirectoryDirectMember {
  readonly googleSubject: string;
}

export interface GoogleDirectoryTransport {
  listUsers(): Promise<DirectoryTraversal<GoogleDirectoryUser>>;
  listGroups(): Promise<DirectoryTraversal<GoogleDirectoryGroup>>;
  listDirectMembers(
    googleGroupId: string,
  ): Promise<DirectoryTraversal<GoogleDirectoryDirectMember>>;
}
