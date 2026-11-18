"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  FolderTree,
  Globe,
  KeyRound,
  Languages,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  Phone,
  RotateCcw,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { usePreferences } from "@/components/preferences/PreferencesProvider";
import { SettingsLauncher } from "@/components/preferences/SettingsLauncher";
import { Badge, Button, Card, Input } from "@/components/ui";
import {
  IconTile,
  PageIntro,
  SectionHeading,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";
import type { Locale, Theme } from "@/lib/preferences";
import {
  formatWorkspaceRole,
  getProfileInitials,
  type UserProfileSnapshot,
} from "@/lib/user-profile";

interface ProfileFormState {
  fullName: string;
  email: string;
  hostedDomain: string;
  department: string;
  jobTitle: string;
  phone: string;
  orgUnitPath: string;
}

const STORAGE_KEY_PREFIX = "uptech-profile-draft-v1:";
const draftListeners = new Set<() => void>();
let cachedDraftKey: string | null = null;
let cachedDraftRaw: string | null | undefined;
let cachedDraftValue: Partial<ProfileFormState> | null = null;

function buildInitialFormState(profile: UserProfileSnapshot): ProfileFormState {
  return {
    fullName: profile.fullName ?? "",
    email: profile.email ?? "",
    hostedDomain: profile.hostedDomain ?? "",
    department: profile.department ?? "",
    jobTitle: "",
    phone: "",
    orgUnitPath: profile.orgUnitPath ?? "",
  };
}

function storageKeyForProfile(profile: UserProfileSnapshot): string {
  return `${STORAGE_KEY_PREFIX}${profile.email ?? "unauthenticated"}`;
}

function emitDraftChange() {
  cachedDraftRaw = undefined;
  for (const listener of draftListeners) {
    listener();
  }
}

function subscribeProfileDraft(listener: () => void): () => void {
  draftListeners.add(listener);
  if (typeof window === "undefined") {
    return () => {
      draftListeners.delete(listener);
    };
  }
  function onStorage(event: StorageEvent) {
    if (event.key === null || event.key.startsWith(STORAGE_KEY_PREFIX)) {
      emitDraftChange();
    }
  }
  window.addEventListener("storage", onStorage);
  return () => {
    draftListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSavedDraftSnapshot(key: string): Partial<ProfileFormState> | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (cachedDraftKey === key && cachedDraftRaw === raw) {
    return cachedDraftValue;
  }
  cachedDraftKey = key;
  cachedDraftRaw = raw;
  if (!raw) {
    cachedDraftValue = null;
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      cachedDraftValue = null;
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const next: Partial<ProfileFormState> = {};
    for (const field of [
      "fullName",
      "email",
      "hostedDomain",
      "department",
      "jobTitle",
      "phone",
      "orgUnitPath",
    ] as const) {
      if (typeof record[field] === "string") {
        next[field] = record[field];
      }
    }
    cachedDraftValue = next;
    return next;
  } catch {
    cachedDraftValue = null;
    return null;
  }
}

function getServerDraftSnapshot(): Partial<ProfileFormState> | null {
  return null;
}

export function ProfileWorkbench({
  initialProfile,
  initialLocale,
  initialTheme,
}: Readonly<{
  initialProfile: UserProfileSnapshot;
  initialLocale: Locale;
  initialTheme: Theme;
}>) {
  const router = useRouter();
  const { locale: contextLocale, theme: contextTheme } = usePreferences();
  const locale = contextLocale ?? initialLocale;
  const theme = contextTheme ?? initialTheme;
  const isVi = locale === "vi";

  const storageKey = storageKeyForProfile(initialProfile);
  const savedDraft = useSyncExternalStore(
    subscribeProfileDraft,
    () => getSavedDraftSnapshot(storageKey),
    getServerDraftSnapshot,
  );
  const [edits, setEdits] = useState<Partial<ProfileFormState>>({});
  const [avatarError, setAvatarError] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const baseForm = buildInitialFormState(initialProfile);
  const form: ProfileFormState = {
    fullName:
      initialProfile.fullName ?? edits.fullName ?? savedDraft?.fullName ?? baseForm.fullName,
    email:
      initialProfile.email ?? edits.email ?? savedDraft?.email ?? baseForm.email,
    hostedDomain:
      initialProfile.hostedDomain ??
      edits.hostedDomain ??
      savedDraft?.hostedDomain ??
      baseForm.hostedDomain,
    department:
      edits.department ??
      savedDraft?.department ??
      baseForm.department,
    jobTitle: edits.jobTitle ?? savedDraft?.jobTitle ?? baseForm.jobTitle,
    phone: edits.phone ?? savedDraft?.phone ?? baseForm.phone,
    orgUnitPath:
      initialProfile.orgUnitPath ??
      edits.orgUnitPath ??
      savedDraft?.orgUnitPath ??
      baseForm.orgUnitPath,
  };

  const roleDisplay = formatWorkspaceRole(initialProfile.workspaceRole, locale);
  const displayName = form.fullName.trim();
  const displayEmail = form.email.trim();
  const initials = getProfileInitials(displayName);
  const hasGoogleAvatar = Boolean(initialProfile.pictureUrl) && !avatarError;

  const googleSourced = {
    fullName: initialProfile.fullName !== null,
    email: initialProfile.email !== null,
    hostedDomain: initialProfile.hostedDomain !== null,
    department: initialProfile.department !== null,
    orgUnitPath: initialProfile.orgUnitPath !== null,
    workspaceRole: initialProfile.workspaceRole !== null,
  };

  function updateField(field: keyof ProfileFormState, value: string) {
    setSaveMessage(null);
    if (field === "email") {
      setEmailError(null);
    }
    setEdits((current) => ({ ...current, [field]: value }));
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveMessage(null);
    const trimmedEmail = form.email.trim();
    if (
      !googleSourced.email &&
      trimmedEmail.length > 0 &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmedEmail)
    ) {
      setEmailError(
        isVi
          ? "Vui lòng nhập địa chỉ email hợp lệ hoặc để trống."
          : "Please enter a valid email address or leave it blank.",
      );
      return;
    }
    try {
      const payload: ProfileFormState = {
        fullName: form.fullName.trim(),
        email: trimmedEmail,
        hostedDomain: form.hostedDomain.trim(),
        department: form.department.trim(),
        jobTitle: form.jobTitle.trim(),
        phone: form.phone.trim(),
        orgUnitPath: form.orgUnitPath.trim(),
      };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
      emitDraftChange();
      setEdits({});
      setSaveMessage(
        isVi
          ? "Đã lưu thông tin hồ sơ trên trình duyệt này."
          : "Profile details saved in this browser.",
      );
    } catch {
      setSaveMessage(
        isVi
          ? "Không thể lưu cục bộ trên trình duyệt này."
          : "Unable to save locally in this browser.",
      );
    }
  }

  function handleReset() {
    try {
      window.localStorage.removeItem(storageKey);
      emitDraftChange();
    } catch {
      // Ignore storage removal errors in restricted browser contexts.
    }
    setEmailError(null);
    setEdits({});
    setSaveMessage(
      isVi
        ? "Đã đặt lại các trường chưa khóa về trạng thái mặc định."
        : "Reset editable fields to their default state.",
    );
  }

  async function handleLogout() {
    setLogoutBusy(true);
    setLogoutError(null);
    try {
      if (initialProfile.authSource === "WEB_SESSION") {
        const bootstrap = await fetch("/api/v1/auth/session", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (bootstrap.status === 401) {
          router.replace("/login?error=session_expired");
          router.refresh();
          return;
        }
        if (!bootstrap.ok) {
          throw new Error("session unavailable");
        }
        const payload = (await bootstrap.json()) as { csrf_token?: unknown };
        if (typeof payload.csrf_token !== "string") {
          throw new Error("invalid csrf token");
        }
        const response = await fetch("/api/v1/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "X-CSRF-Token": payload.csrf_token },
        });
        if (response.status === 204 || response.status === 401) {
          router.replace("/login");
          router.refresh();
          return;
        }
        throw new Error("logout failed");
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError(
        isVi
          ? "Chưa thể đăng xuất phiên hiện tại. Vui lòng thử lại."
          : "Unable to sign out right now. Please try again.",
      );
      setLogoutBusy(false);
    }
  }

  const selfServiceRules = isVi
    ? [
        "Tên, email và thông tin tổ chức được lấy trực tiếp từ Google khi có phiên đăng nhập hợp lệ.",
        "Các trường không có dữ liệu từ Google được để trống hoàn toàn để bạn tự điền.",
        "Không thay đổi vai trò, quyền sở hữu hoặc cấu hình bảo mật workspace tại đây.",
      ]
    : [
        "Name, email, and organization fields are populated directly from Google when signed in.",
        "Fields unavailable from Google remain blank for you to fill in.",
        "Workspace roles, ownership, and security policies cannot be changed here.",
      ];

  const sourceBadge = (fromGoogle: boolean) =>
    fromGoogle ? (
      <Badge variant="info" size="sm">
        {isVi ? "Từ Google" : "From Google"}
      </Badge>
    ) : null;

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow={isVi ? "Hồ sơ & bảo mật" : "Profile & Security"}
        title={isVi ? "Hồ sơ & bảo mật cá nhân" : "Personal Profile & Security"}
        description={
          initialProfile.authenticated
            ? isVi
              ? "Thông tin định danh được đồng bộ từ tài khoản Google của bạn. Các trường chưa có dữ liệu từ Google được để trống để bạn tự điền."
              : "Identity details synced from your Google account. Fields not returned by Google are left blank for you to fill in."
            : isVi
              ? "Chưa phát hiện phiên đăng nhập Google. Toàn bộ thông tin cá nhân được để trống để bạn điền mẫu hoặc đăng nhập Google Workspace để tự động lấy thông tin thật."
              : "No active Google session detected. All personal fields are left blank for manual entry, or sign in with Google Workspace to populate real account data."
        }
        actions={
          initialProfile.authenticated ? (
            <Badge variant="success" dot className="min-h-8 px-3">
              {isVi ? "Đã kết nối Google" : "Google connected"}
            </Badge>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral" className="min-h-8 px-3">
                {isVi ? "Chưa đăng nhập Google" : "Not signed in"}
              </Badge>
              <Link
                href="/login"
                className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[#1B44FF] px-4 text-xs font-semibold [color:#FFFFFF] shadow-sm transition-colors hover:bg-[#1436D6]"
              >
                <LogIn aria-hidden="true" className="size-3.5" />
                {isVi ? "Đăng nhập Google" : "Sign in with Google"}
              </Link>
            </div>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="profile-information-heading">
          <SectionHeading
            id="profile-information-heading"
            title={isVi ? "Thông tin cá nhân" : "Personal information"}
            description={
              isVi
                ? "Dữ liệu lấy được từ Google được điền tự động; các trường chưa có dữ liệu được để trống để bạn tự nhập."
                : "Fields retrieved from Google are pre-filled; unavailable fields are kept blank for manual entry."
            }
          />

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-5 border-b border-[#0D1321]/8 p-5 sm:flex-row sm:items-center sm:p-6">
              <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#C8D2FF] bg-gradient-to-br from-[#EEF1FF] to-[#DBEAFE] text-xl font-bold text-[#1635C7]">
                {hasGoogleAvatar ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={initialProfile.pictureUrl ?? ""}
                    alt={displayName || displayEmail || "Google profile avatar"}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarError(true)}
                    className="size-full object-cover"
                  />
                ) : initials ? (
                  <span>{initials}</span>
                ) : (
                  <UserRound aria-hidden="true" className="size-8 text-[#1635C7]" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-[#0D1321]">
                    {displayName ||
                      (isVi ? "Chưa có tên hiển thị" : "No display name")}
                  </h2>
                  {initialProfile.authenticated ? (
                    <Badge variant="info" size="sm">
                      Google Workspace
                    </Badge>
                  ) : (
                    <Badge variant="neutral" size="sm">
                      {isVi ? "Chưa liên kết Google" : "Not linked"}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 break-all text-sm text-[#505A6E]">
                  <span>
                    {displayEmail ||
                      (isVi
                        ? "Chưa có email — điền bên dưới hoặc đăng nhập Google"
                        : "No email — fill in below or sign in with Google")}
                  </span>
                  {initialProfile.emailVerified &&
                  displayEmail === initialProfile.email ? (
                    <span
                      title={
                        isVi
                          ? "Email đã được Google xác minh"
                          : "Email verified by Google"
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#076944]"
                    >
                      <CheckCircle2 aria-hidden="true" className="size-3.5" />
                      {isVi ? "Đã xác minh" : "Verified"}
                    </span>
                  ) : null}
                </p>
                {form.hostedDomain ? (
                  <p className="mt-1.5 text-xs text-[#505A6E]">
                    {isVi ? "Tên miền tổ chức:" : "Organization domain:"}{" "}
                    <span className="font-medium text-[#0D1321]">
                      {form.hostedDomain}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>

            <form onSubmit={handleSave} noValidate>
              <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="profile-full-name"
                      className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#505A6E]"
                    >
                      <UserRound aria-hidden="true" className="size-3.5 text-[#1945C2]" />
                      {isVi ? "Họ và tên" : "Full name"}
                    </label>
                    {sourceBadge(googleSourced.fullName)}
                  </div>
                  <Input
                    id="profile-full-name"
                    name="fullName"
                    value={form.fullName}
                    onChange={(event) => updateField("fullName", event.target.value)}
                    readOnly={googleSourced.fullName}
                    placeholder=""
                    autoComplete="name"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="profile-email"
                      className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#505A6E]"
                    >
                      <Mail aria-hidden="true" className="size-3.5 text-[#1945C2]" />
                      {isVi ? "Email định danh" : "Email address"}
                    </label>
                    {sourceBadge(googleSourced.email)}
                  </div>
                  <Input
                    id="profile-email"
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={(event) => updateField("email", event.target.value)}
                    readOnly={googleSourced.email}
                    error={emailError !== null}
                    placeholder=""
                    autoComplete="email"
                  />
                  {emailError ? (
                    <p role="alert" className="text-xs text-[#B32018]">
                      {emailError}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="profile-hosted-domain"
                      className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#505A6E]"
                    >
                      <Globe aria-hidden="true" className="size-3.5 text-[#1945C2]" />
                      {isVi ? "Tên miền tổ chức" : "Organization domain"}
                    </label>
                    {sourceBadge(googleSourced.hostedDomain)}
                  </div>
                  <Input
                    id="profile-hosted-domain"
                    name="hostedDomain"
                    value={form.hostedDomain}
                    onChange={(event) => updateField("hostedDomain", event.target.value)}
                    readOnly={googleSourced.hostedDomain}
                    placeholder=""
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="profile-department"
                      className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#505A6E]"
                    >
                      <Building2 aria-hidden="true" className="size-3.5 text-[#1945C2]" />
                      {isVi ? "Phòng ban" : "Department"}
                    </label>
                    {sourceBadge(googleSourced.department)}
                  </div>
                  <Input
                    id="profile-department"
                    name="department"
                    value={form.department}
                    onChange={(event) => updateField("department", event.target.value)}
                    placeholder=""
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="profile-job-title"
                    className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#505A6E]"
                  >
                    <BriefcaseBusiness
                      aria-hidden="true"
                      className="size-3.5 text-[#1945C2]"
                    />
                    {isVi ? "Chức danh" : "Job title"}
                  </label>
                  <Input
                    id="profile-job-title"
                    name="jobTitle"
                    value={form.jobTitle}
                    onChange={(event) => updateField("jobTitle", event.target.value)}
                    placeholder=""
                    autoComplete="organization-title"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="profile-phone"
                    className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#505A6E]"
                  >
                    <Phone aria-hidden="true" className="size-3.5 text-[#1945C2]" />
                    {isVi ? "Số điện thoại" : "Phone number"}
                  </label>
                  <Input
                    id="profile-phone"
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={(event) => updateField("phone", event.target.value)}
                    placeholder=""
                    autoComplete="tel"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="profile-org-unit"
                      className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#505A6E]"
                    >
                      <FolderTree aria-hidden="true" className="size-3.5 text-[#1945C2]" />
                      {isVi ? "Đơn vị tổ chức (Org Unit)" : "Organizational unit"}
                    </label>
                    {sourceBadge(googleSourced.orgUnitPath)}
                  </div>
                  <Input
                    id="profile-org-unit"
                    name="orgUnitPath"
                    value={form.orgUnitPath}
                    onChange={(event) => updateField("orgUnitPath", event.target.value)}
                    readOnly={googleSourced.orgUnitPath}
                    placeholder=""
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="profile-workspace-role"
                      className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#505A6E]"
                    >
                      <BadgeCheck aria-hidden="true" className="size-3.5 text-[#1945C2]" />
                      {isVi ? "Vai trò workspace" : "Workspace role"}
                    </label>
                    {sourceBadge(googleSourced.workspaceRole)}
                  </div>
                  <Input
                    id="profile-workspace-role"
                    name="workspaceRole"
                    value={roleDisplay}
                    readOnly
                    placeholder=""
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-[#0D1321]/8 bg-[#FAF9FB] p-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-[#505A6E]">
                  {saveMessage ? (
                    <span className="font-medium text-[#076944]">{saveMessage}</span>
                  ) : isVi ? (
                    "Các trường lấy từ Google được giữ nguyên; các trường trống do bạn tự điền."
                  ) : (
                    "Google-sourced fields stay verified; blank fields are editable."
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                    {isVi ? "Đặt lại" : "Reset"}
                  </Button>
                  <Button type="submit" variant="primary" size="sm">
                    {isVi ? "Lưu thông tin" : "Save details"}
                  </Button>
                </div>
              </div>
            </form>
          </Card>
        </section>

        <aside aria-labelledby="self-service-heading" className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={Languages} tone="blue" />
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-[#0D1321]">
                  {isVi ? "Ngôn ngữ & giao diện" : "Language & appearance"}
                </h2>
                <p className="mt-1 text-sm leading-6 text-[#505A6E]">
                  {isVi
                    ? `Hiện tại: Tiếng Việt · ${theme === "light" ? "Sáng" : "Tối"}`
                    : `Current: English · ${theme === "light" ? "Light" : "Dark"}`}
                </p>
              </div>
            </div>
            <SettingsLauncher className="mt-4 w-full" />
          </Card>

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={ShieldCheck} tone="emerald" />
              <div>
                <h2 id="self-service-heading" className="font-bold text-[#0D1321]">
                  {isVi ? "Phạm vi tự phục vụ" : "Self-service scope"}
                </h2>
                <p className="mt-1 text-sm leading-6 text-[#505A6E]">
                  {isVi
                    ? "Màn hình hồ sơ chỉ đại diện cho chính người dùng hiện tại."
                    : "Profile view applies strictly to the current user."}
                </p>
              </div>
            </div>
            <ul className="mt-5 space-y-3">
              {selfServiceRules.map((rule) => (
                <li
                  key={rule}
                  className="flex items-start gap-2.5 text-sm leading-6 text-[#323B4D]"
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-[#076944]"
                  />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={BadgeCheck} tone="violet" />
              <div>
                <h2 className="font-bold text-[#0D1321]">
                  {isVi ? "Vai trò workspace" : "Workspace role"}
                </h2>
                <p className="mt-1 text-sm leading-6 text-[#505A6E]">
                  {roleDisplay ||
                    (isVi
                      ? "Chưa xác định (chưa đăng nhập hoặc chưa gắn workspace)."
                      : "Unassigned (not signed in or no active workspace membership).")}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#0D1321]/8 bg-[#FAF9FB] px-3 py-3 text-xs text-[#505A6E]">
              <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
              {isVi
                ? "Quyền truy cập workspace được quản lý tập trung qua Google Workspace."
                : "Workspace permissions are managed centrally via Google Workspace."}
            </div>
          </Card>
        </aside>
      </div>

      <section aria-labelledby="security-heading">
        <SectionHeading
          id="security-heading"
          title={isVi ? "Bảo mật tài khoản" : "Account security"}
          description={
            isVi
              ? "Xác thực được thực hiện thông qua Google Workspace OIDC; hệ thống không lưu mật khẩu cục bộ."
              : "Authentication is handled via Google Workspace OIDC; no local passwords are stored."
          }
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
            <IconTile icon={KeyRound} tone="blue" />
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-[#0D1321]">
                {isVi ? "Xác thực Google OIDC" : "Google OIDC authentication"}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#505A6E]">
                {isVi
                  ? "Mật khẩu và xác thực hai bước được quản lý trực tiếp trên tài khoản Google của bạn."
                  : "Password and two-step verification are managed directly in your Google account."}
              </p>
            </div>
            <Link
              href="/login"
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-[#0D1321]/12 bg-white px-4 text-xs font-semibold text-[#0D1321] transition-colors hover:bg-[#F3F4F8]"
            >
              {initialProfile.authenticated
                ? isVi
                  ? "Đổi tài khoản Google"
                  : "Switch Google account"
                : isVi
                  ? "Đăng nhập Google"
                  : "Sign in with Google"}
            </Link>
          </Card>

          <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
            <IconTile icon={LogOut} tone="amber" />
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-[#0D1321]">
                {isVi ? "Phiên làm việc" : "Workspace session"}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#505A6E]">
                {initialProfile.authenticated
                  ? isVi
                    ? "Thu hồi phiên đăng nhập hiện tại và quay lại màn hình đăng nhập."
                    : "Revoke the active session and return to the sign-in screen."
                  : isVi
                    ? "Chưa có phiên đăng nhập đang hoạt động."
                    : "No active authenticated session."}
              </p>
              {logoutError ? (
                <p role="alert" className="mt-2 text-xs text-[#B32018]">
                  {logoutError}
                </p>
              ) : null}
            </div>
            {initialProfile.authenticated ? (
              <button
                type="button"
                disabled={logoutBusy}
                onClick={handleLogout}
                className="inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[#F6D59B] bg-[#FFF3DE] px-4 text-xs font-semibold text-[#924D05] transition-colors hover:bg-[#FDE6BF] disabled:cursor-wait disabled:opacity-60"
              >
                {logoutBusy
                  ? isVi
                    ? "Đang đăng xuất…"
                    : "Signing out…"
                  : isVi
                    ? "Đăng xuất"
                    : "Sign out"}
              </button>
            ) : (
              <Link
                href="/"
                replace
                className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-[#0D1321]/12 bg-white px-4 text-xs font-semibold text-[#0D1321] transition-colors hover:bg-[#F3F4F8]"
              >
                {isVi ? "Về trang chủ" : "Back to home"}
              </Link>
            )}
          </Card>
        </div>
      </section>
    </WorkspacePage>
  );
}
