export const GOOGLE_DIRECTORY_LEGACY_READ_ONLY_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
] as const);

export const GOOGLE_DIRECTORY_READ_ONLY_SCOPES = Object.freeze([
  ...GOOGLE_DIRECTORY_LEGACY_READ_ONLY_SCOPES,
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
] as const);

export function classifyGoogleDirectoryReadOnlyScopes(
  scopes: readonly string[],
): "LEGACY_FOUR" | "CURRENT_FIVE" | null {
  if (!Array.isArray(scopes)) return null;
  const matching = (expected: readonly string[]) =>
    scopes.length === expected.length &&
    new Set(scopes).size === expected.length &&
    expected.every((scope) => scopes.includes(scope));
  if (matching(GOOGLE_DIRECTORY_LEGACY_READ_ONLY_SCOPES)) return "LEGACY_FOUR";
  if (matching(GOOGLE_DIRECTORY_READ_ONLY_SCOPES)) return "CURRENT_FIVE";
  return null;
}

export function hasExactGoogleDirectoryReadOnlyScopes(
  scopes: readonly string[],
): boolean {
  return classifyGoogleDirectoryReadOnlyScopes(scopes) === "CURRENT_FIVE";
}
