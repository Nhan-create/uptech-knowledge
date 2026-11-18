import type { Locale } from "./preferences";

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export interface UserProfileSnapshot {
  readonly authenticated: boolean;
  readonly authSource: "WEB_SESSION" | "ONBOARDING" | null;
  readonly fullName: string | null;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly hostedDomain: string | null;
  readonly pictureUrl: string | null;
  readonly department: string | null;
  readonly orgUnitPath: string | null;
  readonly workspaceRole: WorkspaceRole | null;
  readonly googleIsAdmin: boolean | null;
  readonly googleIsDelegatedAdmin: boolean | null;
}

export const EMPTY_USER_PROFILE: UserProfileSnapshot = Object.freeze({
  authenticated: false,
  authSource: null,
  fullName: null,
  email: null,
  emailVerified: false,
  hostedDomain: null,
  pictureUrl: null,
  department: null,
  orgUnitPath: null,
  workspaceRole: null,
  googleIsAdmin: null,
  googleIsDelegatedAdmin: null,
});

export function getProfileInitials(name: string | null | undefined): string {
  if (typeof name !== "string") return "";
  const parts = name
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "";
  if (parts.length === 1) {
    return Array.from(parts[0]!)[0]?.toLocaleUpperCase() ?? "";
  }
  const first = Array.from(parts[0]!)[0] ?? "";
  const last = Array.from(parts[parts.length - 1]!)[0] ?? "";
  return `${first}${last}`.toLocaleUpperCase();
}

export function formatWorkspaceRole(
  role: WorkspaceRole | null | undefined,
  locale: Locale,
): string {
  if (role === "OWNER") {
    return locale === "vi" ? "Chủ sở hữu (OWNER)" : "Owner (OWNER)";
  }
  if (role === "ADMIN") {
    return locale === "vi" ? "Quản trị viên (ADMIN)" : "Administrator (ADMIN)";
  }
  if (role === "MEMBER") {
    return locale === "vi" ? "Thành viên (MEMBER)" : "Member (MEMBER)";
  }
  return "";
}
