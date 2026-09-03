export const GOOGLE_DIRECTORY_READ_ONLY_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
] as const);

export function hasExactGoogleDirectoryReadOnlyScopes(
  scopes: readonly string[],
): boolean {
  if (
    !Array.isArray(scopes) ||
    scopes.length !== GOOGLE_DIRECTORY_READ_ONLY_SCOPES.length
  ) return false;
  const granted = new Set(scopes);
  return granted.size === GOOGLE_DIRECTORY_READ_ONLY_SCOPES.length &&
    GOOGLE_DIRECTORY_READ_ONLY_SCOPES.every((scope) => granted.has(scope));
}
