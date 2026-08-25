"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Logo from "@/components/Logo";
import { usePreferences } from "@/components/preferences/PreferencesProvider";

type AuthMethod = "otp" | "password" | "sso";

const methodDefinitions: Array<{
  id: AuthMethod;
  icon: typeof Mail;
}> = [
  {
    id: "otp",
    icon: Mail,
  },
  {
    id: "password",
    icon: KeyRound,
  },
  {
    id: "sso",
    icon: Building2,
  },
];

type AuthCopy = {
  homeLabel: string;
  home: string;
  accessBadge: string;
  heroTitle: string;
  heroDescription: string;
  benefits: readonly string[];
  footer: string;
  chooseHeading: string;
  signInHeading: string;
  chooseDescription: string;
  signInDescription: string;
  workEmail: string;
  emailPlaceholder: string;
  emailHelp: string;
  checkDomain: string;
  changeEmail: string;
  domainRecognized: string;
  methodLegend: string;
  methods: Record<
    AuthMethod,
    { title: string; description: string; tag?: string }
  >;
  password: string;
  passwordPlaceholder: string;
  methodActions: Record<AuthMethod, string>;
  messages: Record<AuthMethod, string>;
  or: string;
  openDemo: string;
  disclaimer: string;
};

const authCopy: Record<"vi" | "en", AuthCopy> = {
  vi: {
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    home: "Trang chủ",
    accessBadge: "Truy cập đúng workspace của bạn",
    heroTitle: "Tri thức đúng nguồn, dành cho đúng người.",
    heroDescription:
      "Phương thức đăng nhập được lựa chọn theo domain và chính sách của từng tổ chức. Xác thực danh tính không tự động cấp quyền xem tài liệu.",
    benefits: [
      "Phương thức đăng nhập theo cấu hình doanh nghiệp",
      "Workspace và quyền tài liệu được kiểm tra riêng",
      "Không tiết lộ cấu hình tài khoản qua bước domain",
    ],
    footer: "Giao diện sản phẩm mẫu",
    chooseHeading: "Chọn cách tiếp tục",
    signInHeading: "Đăng nhập workspace",
    chooseDescription:
      "Các lựa chọn dưới đây minh hoạ luồng xác thực theo tổ chức.",
    signInDescription:
      "Nhập email công việc để minh hoạ bước kiểm tra domain.",
    workEmail: "Email công việc",
    emailPlaceholder: "ten@doanhnghiep.vn",
    emailHelp:
      "Đây là prototype: email chỉ được giữ trong trình duyệt và không được gửi đi.",
    checkDomain: "Kiểm tra domain (mô phỏng)",
    changeEmail: "Đổi email",
    domainRecognized: "Domain demo đã được nhận diện",
    methodLegend: "Chọn phương thức đăng nhập",
    methods: {
      otp: {
        title: "Mã xác minh qua email",
        description: "Nhận mã dùng một lần tại email công việc.",
        tag: "Đề xuất",
      },
      password: {
        title: "Email và mật khẩu",
        description: "Dùng thông tin đăng nhập của tài khoản doanh nghiệp.",
      },
      sso: {
        title: "Enterprise SSO",
        description: "Tiếp tục với phương thức SSO do tổ chức cấu hình.",
      },
    },
    password: "Mật khẩu",
    passwordPlaceholder: "Nhập mật khẩu demo",
    methodActions: {
      otp: "Gửi mã demo",
      password: "Đăng nhập mô phỏng",
      sso: "Tiếp tục tới SSO (mô phỏng)",
    },
    messages: {
      otp: "Prototype: chưa có mã xác minh nào được gửi.",
      password: "Prototype: thông tin chưa được gửi tới máy chủ.",
      sso: "Prototype: chưa chuyển hướng tới nhà cung cấp SSO.",
    },
    or: "hoặc",
    openDemo: "Vào bản demo giao diện — không xác thực",
    disclaimer:
      "Trang này chỉ mô phỏng trải nghiệm. Chưa kết nối API, chưa tạo session và không xác thực thông tin đăng nhập.",
  },
  en: {
    homeLabel: "UPTECH KNOWLEDGE - Home",
    home: "Home",
    accessBadge: "Access the right workspace",
    heroTitle: "Trusted knowledge, for the right people.",
    heroDescription:
      "Your organization’s domain and policies determine the available sign-in methods. Identity verification does not automatically grant document access.",
    benefits: [
      "Sign-in methods follow enterprise configuration",
      "Workspace and document access are checked separately",
      "Account configuration is not disclosed during domain lookup",
    ],
    footer: "Product interface prototype",
    chooseHeading: "Choose how to continue",
    signInHeading: "Sign in to your workspace",
    chooseDescription:
      "The options below illustrate an organization-aware authentication flow.",
    signInDescription:
      "Enter your work email to simulate the domain lookup step.",
    workEmail: "Work email",
    emailPlaceholder: "name@company.com",
    emailHelp:
      "This is a prototype: the email stays in your browser and is not sent.",
    checkDomain: "Check domain (simulation)",
    changeEmail: "Change email",
    domainRecognized: "Demo domain recognized",
    methodLegend: "Choose a sign-in method",
    methods: {
      otp: {
        title: "Email verification code",
        description: "Receive a one-time code at your work email.",
        tag: "Recommended",
      },
      password: {
        title: "Email and password",
        description: "Use your enterprise account credentials.",
      },
      sso: {
        title: "Enterprise SSO",
        description: "Continue with the SSO method configured by your organization.",
      },
    },
    password: "Password",
    passwordPlaceholder: "Enter a demo password",
    methodActions: {
      otp: "Send demo code",
      password: "Simulate sign-in",
      sso: "Continue to SSO (simulation)",
    },
    messages: {
      otp: "Prototype: no verification code was sent.",
      password: "Prototype: the credentials were not sent to a server.",
      sso: "Prototype: no redirect to an SSO provider occurred.",
    },
    or: "or",
    openDemo: "Enter the interface demo — no authentication",
    disclaimer:
      "This page only simulates the experience. It has no API connection, creates no session, and does not authenticate credentials.",
  },
};

export function AuthPrototype() {
  const { locale } = usePreferences();
  const copy = authCopy[locale === "en" ? "en" : "vi"];
  const [email, setEmail] = useState("");
  const [domainChecked, setDomainChecked] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<AuthMethod>("otp");
  const [simulatedMethod, setSimulatedMethod] = useState<AuthMethod | null>(
    null,
  );
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  const checkDomain = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDomainChecked(true);
    setSimulatedMethod(null);
    requestAnimationFrame(() => stepHeadingRef.current?.focus());
  };

  const simulateMethod = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSimulatedMethod(selectedMethod);
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--bg-primary)] text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.07) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "linear-gradient(120deg, black 0%, transparent 72%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-1/3 size-96 rounded-full bg-blue-600/15 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 bottom-0 size-96 rounded-full bg-violet-600/10 blur-[120px]"
      />

      <div className="relative mx-auto grid min-h-dvh max-w-7xl lg:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col px-5 py-6 sm:px-8 lg:px-12 lg:py-10">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              aria-label={copy.homeLabel}
              className="inline-flex min-h-11 items-center gap-3 rounded-lg"
            >
              <Logo className="h-7 w-auto" />
              <span className="hidden border-l border-slate-700 pl-3 text-[11px] font-semibold tracking-[0.18em] text-slate-300 sm:inline">
                KNOWLEDGE
              </span>
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {copy.home}
            </Link>
          </div>

          <div className="my-auto hidden max-w-lg py-16 lg:block">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-200">
              <Sparkles aria-hidden="true" className="size-3.5" />
              {copy.accessBadge}
            </div>
            <p className="mt-7 text-balance text-5xl font-semibold leading-[1.08] tracking-[-0.045em] text-slate-100">
              {copy.heroTitle}
            </p>
            <p className="mt-6 max-w-md text-base leading-7 text-slate-400">
              {copy.heroDescription}
            </p>
            <div className="mt-10 space-y-4">
              {copy.benefits.map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-slate-300">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
                    <Check aria-hidden="true" className="size-3" />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </div>

          <p className="hidden text-xs text-slate-400 lg:block">
            © 2026 UPTECH · {copy.footer}
          </p>
        </div>

        <section className="flex items-center justify-center px-4 pb-8 sm:px-8 lg:border-l lg:border-slate-800/80 lg:px-12 lg:py-10">
          <div className="animate-fade-in-up w-full max-w-[32rem] rounded-2xl border border-slate-700/80 bg-[var(--bg-surface)] p-5 shadow-[var(--panel-shadow)] backdrop-blur sm:rounded-3xl sm:p-8">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                  <span className="size-1.5 rounded-full bg-amber-300" />
                  Prototype UI
                </div>
                <h1
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="mt-4 text-2xl font-semibold tracking-[-0.025em] text-slate-100 sm:text-3xl"
                >
                  {domainChecked ? copy.chooseHeading : copy.signInHeading}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {domainChecked
                    ? copy.chooseDescription
                    : copy.signInDescription}
                </p>
              </div>
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-400/10 text-blue-300">
                <ShieldCheck aria-hidden="true" className="size-5" />
              </div>
            </div>

            {!domainChecked ? (
              <form onSubmit={checkDomain} className="space-y-5">
                <div>
                  <label htmlFor="work-email" className="text-sm font-medium text-slate-200">
                    {copy.workEmail}
                  </label>
                  <div className="relative mt-2">
                    <Mail
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      ref={emailInputRef}
                      id="work-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder={copy.emailPlaceholder}
                      aria-describedby="email-help"
                      className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950/80 py-3 pl-10 pr-4 text-base text-slate-100 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10"
                    />
                  </div>
                  <p id="email-help" className="mt-2 text-xs leading-5 text-slate-400">
                    {copy.emailHelp}
                  </p>
                </div>
                <button
                  type="submit"
                  className="group inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-blue-700 active:translate-y-0"
                >
                  {copy.checkDomain}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              </form>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setDomainChecked(false);
                    setSimulatedMethod(null);
                    requestAnimationFrame(() => emailInputRef.current?.focus());
                  }}
                  className="mb-4 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                >
                  <ArrowLeft aria-hidden="true" className="size-4" />
                  {copy.changeEmail}
                </button>

                <div className="mb-5 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-300">
                    <Mail aria-hidden="true" className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">{email}</p>
                    <p className="text-xs text-slate-400">
                      {copy.domainRecognized}
                    </p>
                  </div>
                </div>

                <form onSubmit={simulateMethod}>
                  <fieldset>
                    <legend className="sr-only">{copy.methodLegend}</legend>
                    <div className="space-y-2.5">
                      {methodDefinitions.map((method) => {
                        const Icon = method.icon;
                        const methodCopy = copy.methods[method.id];
                        const selected = selectedMethod === method.id;
                        const inputId = `auth-method-${method.id}`;

                        return (
                          <label
                            key={method.id}
                            htmlFor={inputId}
                            className={`group flex min-h-[4.5rem] w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] focus-within:ring-2 focus-within:ring-blue-300 focus-within:ring-offset-2 focus-within:ring-offset-slate-950 ${
                              selected
                                ? "border-blue-400/60 bg-blue-400/10"
                                : "border-slate-800 bg-slate-950/35 hover:border-slate-600 hover:bg-slate-900"
                            }`}
                          >
                            <span
                              className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
                                selected
                                  ? "bg-blue-400/15 text-blue-300"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              <Icon aria-hidden="true" className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100">
                                {methodCopy.title}
                                {methodCopy.tag && (
                                  <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                    {methodCopy.tag}
                                  </span>
                                )}
                              </span>
                              <span className="mt-1 block text-xs leading-5 text-slate-400">
                                {methodCopy.description}
                              </span>
                            </span>
                            <input
                              id={inputId}
                              name="auth-method"
                              type="radio"
                              value={method.id}
                              checked={selected}
                              onChange={() => {
                                setSelectedMethod(method.id);
                                setSimulatedMethod(null);
                              }}
                              className="size-5 shrink-0 cursor-pointer accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div className="mt-5">
                    {selectedMethod === "password" && (
                      <div className="mb-4">
                        <label htmlFor="demo-password" className="text-sm font-medium text-slate-200">
                          {copy.password}
                        </label>
                        <div className="relative mt-2">
                          <LockKeyhole
                            aria-hidden="true"
                            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                          />
                          <input
                            id="demo-password"
                            type="password"
                            required
                            autoComplete="current-password"
                            placeholder={copy.passwordPlaceholder}
                            className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950/80 py-3 pl-10 pr-4 text-base text-slate-100 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10"
                          />
                        </div>
                      </div>
                    )}
                    <button
                      type="submit"
                      className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-5 py-3 text-sm font-semibold text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-700"
                    >
                      {copy.methodActions[selectedMethod]}
                    </button>
                  </div>
                </form>

                {simulatedMethod && (
                  <p
                    role="status"
                    className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-100"
                  >
                    {copy.messages[simulatedMethod]}
                  </p>
                )}
              </div>
            )}

            <div className="my-6 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-slate-800" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {copy.or}
              </span>
              <span className="h-px flex-1 bg-slate-800" />
            </div>

            <Link
              href="/dashboard"
              className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-400/10 px-5 py-3 text-sm font-semibold text-violet-100 transition-colors hover:border-violet-300/50 hover:bg-violet-400/15"
            >
              {copy.openDemo}
              <ArrowRight
                aria-hidden="true"
                className="size-4 transition-transform group-hover:translate-x-0.5"
              />
            </Link>

            <div className="mt-5 flex items-start gap-2.5 text-xs leading-5 text-slate-400">
              <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <p>{copy.disclaimer}</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
