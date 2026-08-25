import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Camera,
  CircleCheck,
  KeyRound,
  Languages,
  LockKeyhole,
  LogOut,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { SettingsLauncher } from "@/components/preferences/SettingsLauncher";
import { Badge, Card } from "@/components/ui";
import {
  DemoNotice,
  IconTile,
  PageIntro,
  PrototypeHint,
  SectionHeading,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";
import {
  LOCALE_COOKIE_NAME,
  parseLocale,
  parseTheme,
  THEME_COOKIE_NAME,
} from "@/lib/preferences";

export const metadata: Metadata = {
  title: "Hồ sơ & bảo mật",
};

const baseProfileDetails = [
  {
    label: "Tên hiển thị",
    value: "An Nguyễn",
    icon: UserRound,
  },
  {
    label: "Email định danh",
    value: "an.nguyen@example.test",
    icon: Mail,
  },
  {
    label: "Chức danh",
    value: "Chuyên viên vận hành · mẫu",
    icon: BriefcaseBusiness,
  },
];

const selfServiceRules = [
  "Chỉ xem và cập nhật các trường hồ sơ cá nhân được phê duyệt.",
  "Không đổi vai trò, quyền sở hữu hoặc cấu hình workspace tại đây.",
  "Thay đổi nhạy cảm cần xác minh lại và áp dụng chính sách phiên đã duyệt.",
];

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const profileDetails = [
    ...baseProfileDetails,
    {
      label: locale === "vi" ? "Ngôn ngữ & giao diện" : "Language & appearance",
      value:
        locale === "vi"
          ? `Tiếng Việt · ${theme === "light" ? "Sáng" : "Tối"}`
          : `English · ${theme === "light" ? "Light" : "Dark"}`,
      lang: locale,
      icon: Languages,
    },
  ];

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="User Profile & Security · Prototype"
        title="Hồ sơ & bảo mật cá nhân"
        description="Bản mẫu trình bày thông tin tự phục vụ của một người dùng giả lập, tách biệt với vai trò và quyền quản trị workspace."
        actions={
          <Badge variant="success" dot className="min-h-8 px-3">
            Phạm vi cá nhân · mẫu
          </Badge>
        }
      />

      <DemoNotice className="mt-6" />

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="profile-information-heading">
          <SectionHeading
            id="profile-information-heading"
            title="Thông tin hồ sơ"
            description="Dữ liệu chỉ để đánh giá bố cục; màn hình không đọc hoặc ghi thông tin tài khoản thật."
          />

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-5 border-b border-slate-800 p-5 sm:flex-row sm:items-center sm:p-6">
              <div className="relative flex size-20 shrink-0 items-center justify-center rounded-2xl border border-blue-800/60 bg-gradient-to-br from-blue-950 to-violet-950 text-xl font-bold text-blue-100">
                AN
                <span
                  aria-hidden="true"
                  className="absolute -bottom-1 -right-1 inline-flex size-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400"
                >
                  <Camera className="size-4" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-white">An Nguyễn</h2>
                  <Badge variant="neutral" size="sm">
                    Người dùng minh họa
                  </Badge>
                </div>
                <p className="mt-1 break-all text-sm text-slate-400">
                  an.nguyen@example.test
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  Ảnh đại diện và giới hạn tệp chưa được triển khai trong bản mẫu.
                </p>
              </div>
              <button
                type="button"
                disabled
                aria-describedby="profile-disabled-note"
                className="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 self-start rounded-lg border border-slate-800 px-3 text-xs font-semibold text-slate-600 sm:self-center"
              >
                <Camera aria-hidden="true" className="size-3.5" />
                Đổi ảnh · bản mẫu
              </button>
            </div>

            <dl className="grid sm:grid-cols-2">
              {profileDetails.map((detail) => {
                const Icon = detail.icon;

                return (
                  <div
                    key={detail.label}
                    className="border-b border-slate-800 p-5 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-child(odd)]:border-r"
                  >
                    <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                      <Icon aria-hidden="true" className="size-3.5" />
                      {detail.label}
                    </dt>
                    <dd
                      lang={"lang" in detail ? detail.lang : undefined}
                      className="mt-2 break-words text-sm font-medium leading-6 text-slate-200"
                    >
                      {detail.value}
                    </dd>
                  </div>
                );
              })}
            </dl>

            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <PrototypeHint>
                Email định danh và vai trò workspace không phải trường chỉnh sửa hồ
                sơ thông thường.
              </PrototypeHint>
              <button
                type="button"
                disabled
                className="inline-flex min-h-11 shrink-0 cursor-not-allowed items-center justify-center rounded-lg bg-blue-900/40 px-4 text-sm font-semibold text-blue-400 opacity-60"
              >
                Lưu thay đổi · bản mẫu
              </button>
            </div>
          </Card>
        </section>

        <aside aria-labelledby="self-service-heading" className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={Languages} tone="blue" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-white">Ngôn ngữ & giao diện</h2>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Thay đổi được lưu trên thiết bị này và áp dụng ngay cho phần giao
                  diện dùng chung.
                </p>
              </div>
            </div>
            <SettingsLauncher className="mt-4 w-full" />
          </Card>

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={ShieldCheck} tone="emerald" />
              <div>
                <h2 id="self-service-heading" className="font-semibold text-white">
                  Phạm vi tự phục vụ
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Màn hình hồ sơ chỉ đại diện cho chính chủ thể đang xem.
                </p>
              </div>
            </div>
            <ul className="mt-5 space-y-3">
              {selfServiceRules.map((rule) => (
                <li key={rule} className="flex items-start gap-2.5 text-sm leading-6 text-slate-300">
                  <CircleCheck
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-emerald-400"
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
                <h2 className="font-semibold text-white">Vai trò workspace</h2>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Thành viên · giá trị minh họa, chỉ đọc trên trang cá nhân.
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3 text-xs text-slate-400">
              <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
              Không thể thay đổi quyền từ hồ sơ cá nhân.
            </div>
          </Card>
        </aside>
      </div>

      <section aria-labelledby="security-heading" className="mt-8">
        <SectionHeading
          id="security-heading"
          title="Bảo mật tài khoản"
          description="Các hành động bên dưới chỉ mô tả ý định UX và không tác động đến mật khẩu hoặc phiên đăng nhập."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
            <IconTile icon={KeyRound} tone="blue" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-white">Đổi mật khẩu</h3>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Luồng thật cần xác minh thông tin hiện tại và xử lý phiên theo chính
                sách được phê duyệt.
              </p>
            </div>
            <button
              type="button"
              disabled
              aria-describedby="profile-disabled-note"
              className="inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-lg border border-slate-800 px-3 text-xs font-semibold text-slate-600"
            >
              Mở luồng mẫu
            </button>
          </Card>

          <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
            <IconTile icon={LogOut} tone="amber" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-white">Đăng xuất</h3>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Rời giao diện workspace và trở về trang chủ chính.
              </p>
            </div>
            <Link
              href="/"
              replace
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 text-xs font-semibold text-amber-300 transition-colors hover:border-amber-400/60 hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              Đăng xuất
            </Link>
          </Card>
        </div>
        <p id="profile-disabled-note" className="sr-only">
          Thao tác bị tắt vì trang chỉ minh họa giao diện và không kết nối tài khoản
          hoặc phiên đăng nhập.
        </p>
      </section>
    </WorkspacePage>
  );
}
