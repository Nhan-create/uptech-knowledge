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
  readonly orgUnitPath: string;
  readonly lifecycleState: "ACTIVE" | "SUSPENDED" | "DELETED";
  /** Setup eligibility metadata only; it is never membership authority. */
  readonly isAdmin: boolean;
  /** Setup eligibility metadata only; it is never membership authority. */
  readonly isDelegatedAdmin: boolean;
}

/** Immutable customer binding returned by Directory `customers.get(my_customer)`. */
export interface GoogleDirectoryCustomer {
  readonly googleCustomerId: string;
  readonly primaryDomain: string;
}

/** Stable Directory organizational-unit identity and its immediate parent. */
export interface GoogleDirectoryOrgUnit {
  readonly googleOrgUnitId: string;
  readonly orgUnitPath: string;
  readonly parentGoogleOrgUnitId: string | null;
}

export interface GoogleDirectoryGroup {
  readonly googleGroupId: string;
  readonly groupName: string;
}

export interface GoogleDirectoryDirectMember {
  readonly googleSubject: string;
}

export interface GoogleDirectoryTransport {
  getCustomer(): Promise<GoogleDirectoryCustomer>;
  listUsers(): Promise<DirectoryTraversal<GoogleDirectoryUser>>;
  listOrgUnits(): Promise<DirectoryTraversal<GoogleDirectoryOrgUnit>>;
  listGroups(): Promise<DirectoryTraversal<GoogleDirectoryGroup>>;
  listDirectMembers(
    googleGroupId: string,
  ): Promise<DirectoryTraversal<GoogleDirectoryDirectMember>>;
}
