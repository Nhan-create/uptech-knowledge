"use client";

import {
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

const companySizes = [
  { value: "1-10", label: "1–10 nhân sự" },
  { value: "11-50", label: "11–50 nhân sự" },
  { value: "51-200", label: "51–200 nhân sự" },
  { value: "201-500", label: "201–500 nhân sự" },
  { value: "501-1000", label: "501–1.000 nhân sự" },
  { value: "1000+", label: "Trên 1.000 nhân sự" },
] as const;

const countries = [
  { value: "VN", label: "Việt Nam" },
  { value: "SG", label: "Singapore" },
  { value: "TH", label: "Thái Lan" },
  { value: "ID", label: "Indonesia" },
  { value: "MY", label: "Malaysia" },
  { value: "OTHER", label: "Quốc gia khác" },
] as const;

type SubmissionStatus = "idle" | "error" | "success";

type LeadFormValues = {
  firstName: string;
  lastName: string;
  workEmail: string;
  company: string;
  companySize: string;
  phone: string;
  country: string;
  interest: string;
  consent: boolean;
  website: string;
};

type LeadField = keyof LeadFormValues;
type LeadErrors = Partial<Record<LeadField, string>>;

const EMPTY_LEAD: LeadFormValues = {
  firstName: "",
  lastName: "",
  workEmail: "",
  company: "",
  companySize: "",
  phone: "",
  country: "VN",
  interest: "",
  consent: false,
  website: "",
};

function normalizeLead(lead: LeadFormValues): LeadFormValues {
  return {
    ...lead,
    firstName: lead.firstName.trim(),
    lastName: lead.lastName.trim(),
    workEmail: lead.workEmail.trim().toLowerCase(),
    company: lead.company.trim(),
    phone: lead.phone.trim(),
    interest: lead.interest.trim(),
    website: lead.website.trim(),
  };
}

function validateLead(lead: LeadFormValues): LeadErrors {
  const values = normalizeLead(lead);
  const errors: LeadErrors = {};

  if (!values.firstName) errors.firstName = "Vui lòng nhập tên.";
  if (!values.lastName) errors.lastName = "Vui lòng nhập họ.";

  if (!values.workEmail) {
    errors.workEmail = "Vui lòng nhập email công việc.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.workEmail)) {
    errors.workEmail = "Email công việc chưa đúng định dạng.";
  }

  if (!values.company) errors.company = "Vui lòng nhập tên công ty.";
  if (!values.companySize) errors.companySize = "Vui lòng chọn quy mô công ty.";
  if (!values.country) errors.country = "Vui lòng chọn quốc gia.";

  const phoneDigits = values.phone.replace(/\D/g, "");
  if (!values.phone) {
    errors.phone = "Vui lòng nhập số điện thoại.";
  } else if (
    !/^[+()0-9.\s-]{7,32}$/.test(values.phone) ||
    phoneDigits.length < 7 ||
    phoneDigits.length > 15
  ) {
    errors.phone = "Số điện thoại chưa đúng định dạng.";
  }

  if (!values.interest) {
    errors.interest = "Vui lòng chia sẻ lý do bạn quan tâm đến sản phẩm.";
  }

  if (!values.consent) {
    errors.consent = "Bạn cần đồng ý để chúng tôi liên hệ về buổi dùng thử.";
  }

  return errors;
}

type FieldGroupProps = Readonly<{
  children: ReactNode;
  error?: string;
  id: string;
  label: string;
  required?: boolean;
}>;

function FieldGroup({ children, error, id, label, required = false }: FieldGroupProps) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ml-1 text-[var(--status-danger)]">*</span>
            <span className="sr-only"> (bắt buộc)</span>
          </>
        ) : null}
      </label>
      {children}
      <p
        id={id + "-error"}
        className="mt-1.5 min-h-5 text-xs leading-5 text-[var(--status-danger)]"
      >
        {error ?? ""}
      </p>
    </div>
  );
}

type InlineSubmissionStateProps = Readonly<{
  status: SubmissionStatus;
}>;

function InlineSubmissionState({ status }: InlineSubmissionStateProps) {
  return (
    <div className="mt-4" aria-live="polite" aria-atomic="true">
      <p
        hidden={status !== "success"}
        role="status"
        className="flex items-start gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-[var(--status-success)]"
      >
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Cảm ơn bạn! Thông tin của bạn đã được tiếp nhận!
      </p>
      <p
        hidden={status !== "error"}
        role="alert"
        className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-[var(--status-danger)]"
      >
        Rất tiếc! Đã xảy ra lỗi khi gửi biểu mẫu.
      </p>
    </div>
  );
}

const inputClassName =
  "min-h-12 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 text-sm text-[var(--text-primary)] shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-[var(--text-muted)] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60";

const invalidInputClassName = " border-rose-500/70 focus:border-rose-500 focus:ring-rose-500/20";

export function DemoRequestDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const instanceId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const [lead, setLead] = useState<LeadFormValues>(EMPTY_LEAD);
  const [errors, setErrors] = useState<LeadErrors>({});
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dialogTitleId = instanceId + "-demo-title";
  const dialogDescriptionId = instanceId + "-demo-description";
  const fieldId = useCallback(
    (field: LeadField) => instanceId + "-demo-" + field,
    [instanceId],
  );

  const resetForm = useCallback(() => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setLead(EMPTY_LEAD);
    setErrors({});
    setStatus("idle");
    setIsSubmitting(false);
  }, []);

  const openDialog = () => {
    resetForm();
    dialogRef.current?.showModal();
    setIsOpen(true);
  };

  const closeDialog = () => {
    activeRequestRef.current?.abort();
    dialogRef.current?.close();
  };

  const handleDialogClose = () => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setIsOpen(false);
    setIsSubmitting(false);

    window.requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      firstFieldRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(focusFrame);
  }, [isOpen]);

  useEffect(() => {
    return () => activeRequestRef.current?.abort();
  }, []);

  const updateLeadField = <Key extends LeadField>(
    field: Key,
    value: LeadFormValues[Key],
  ) => {
    setLead((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });

    if (status === "error") setStatus("idle");
  };

  const focusFirstInvalidField = (fieldErrors: LeadErrors) => {
    const fieldOrder: LeadField[] = [
      "lastName",
      "firstName",
      "workEmail",
      "company",
      "companySize",
      "phone",
      "country",
      "interest",
      "consent",
    ];
    const firstInvalidField = fieldOrder.find((field) => fieldErrors[field]);

    if (!firstInvalidField) return;

    window.requestAnimationFrame(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>(
        '[name="' + firstInvalidField + '"]',
      );
      target?.focus({ preventScroll: false });
    });
  };

  const submitLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (activeRequestRef.current) return;

    const fieldErrors = validateLead(lead);
    setErrors(fieldErrors);
    setStatus("idle");

    if (Object.keys(fieldErrors).length > 0) {
      focusFirstInvalidField(fieldErrors);
      return;
    }

    const normalizedLead = normalizeLead(lead);
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setLead(normalizedLead);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/demo-leads", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", lead: normalizedLead }),
        signal: controller.signal,
      });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean }
        | null;

      if (!response.ok || !result?.ok) {
        throw new Error("Demo lead submission failed");
      }

      setStatus("success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("error");
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setIsSubmitting(false);
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        onClick={openDialog}
        className="group inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/35 transition-[background-color,transform,box-shadow] hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-blue-950/45 active:translate-y-0 sm:w-auto motion-reduce:transform-none motion-reduce:transition-none"
      >
        Dùng thử
        <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        aria-modal="true"
        onCancel={() => activeRequestRef.current?.abort()}
        onClose={handleDialogClose}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        className="fixed inset-0 m-auto h-[min(54rem,calc(100dvh-1rem))] max-h-[calc(100dvh-1rem)] w-[min(48rem,calc(100vw-1rem))] max-w-none overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-0 text-left text-[var(--text-primary)] shadow-[0_30px_100px_rgba(2,6,23,0.52)] backdrop:bg-slate-950/75 backdrop:backdrop-blur-md sm:max-h-[calc(100dvh-2rem)] sm:w-[min(48rem,calc(100vw-2rem))] sm:rounded-3xl"
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 pb-4 pt-4 sm:px-8 sm:pb-5 sm:pt-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--border-focus)]">
                  UPTECH KNOWLEDGE
                </p>
                <h2
                  ref={headingRef}
                  id={dialogTitleId}
                  tabIndex={-1}
                  className="mt-1 text-xl font-semibold tracking-[-0.02em] outline-none sm:text-2xl"
                >
                  Đăng ký dùng thử
                </h2>
                <p
                  id={dialogDescriptionId}
                  className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--text-muted)]"
                >
                  Chia sẻ thông tin để đội ngũ UPTECH chuẩn bị buổi tư vấn phù hợp với doanh nghiệp của bạn.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Đóng cửa sổ đăng ký dùng thử"
                title="Đóng"
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>

          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
            <form noValidate onSubmit={submitLead} aria-busy={isSubmitting}>
                <p className="mb-5 text-xs leading-5 text-[var(--text-muted)]">
                  <span className="text-[var(--status-danger)]">*</span> Thông tin bắt buộc
                </p>

                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  <FieldGroup
                    id={fieldId("lastName")}
                    label="Họ"
                    required
                    error={errors.lastName}
                  >
                    <input
                      ref={firstFieldRef}
                      id={fieldId("lastName")}
                      name="lastName"
                      type="text"
                      autoComplete="family-name"
                      maxLength={80}
                      required
                      value={lead.lastName}
                      onChange={(event) => updateLeadField("lastName", event.target.value)}
                      aria-invalid={Boolean(errors.lastName)}
                      aria-describedby={errors.lastName ? fieldId("lastName") + "-error" : undefined}
                      className={inputClassName + (errors.lastName ? invalidInputClassName : "")}
                      placeholder="Nguyễn"
                    />
                  </FieldGroup>

                  <FieldGroup
                    id={fieldId("firstName")}
                    label="Tên"
                    required
                    error={errors.firstName}
                  >
                    <input
                      id={fieldId("firstName")}
                      name="firstName"
                      type="text"
                      autoComplete="given-name"
                      maxLength={80}
                      required
                      value={lead.firstName}
                      onChange={(event) => updateLeadField("firstName", event.target.value)}
                      aria-invalid={Boolean(errors.firstName)}
                      aria-describedby={errors.firstName ? fieldId("firstName") + "-error" : undefined}
                      className={inputClassName + (errors.firstName ? invalidInputClassName : "")}
                      placeholder="An"
                    />
                  </FieldGroup>

                  <FieldGroup
                    id={fieldId("workEmail")}
                    label="Email công việc"
                    required
                    error={errors.workEmail}
                  >
                    <input
                      id={fieldId("workEmail")}
                      name="workEmail"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      maxLength={254}
                      required
                      value={lead.workEmail}
                      onChange={(event) => updateLeadField("workEmail", event.target.value)}
                      aria-invalid={Boolean(errors.workEmail)}
                      aria-describedby={errors.workEmail ? fieldId("workEmail") + "-error" : undefined}
                      className={inputClassName + (errors.workEmail ? invalidInputClassName : "")}
                      placeholder="an@congty.vn"
                    />
                  </FieldGroup>

                  <FieldGroup
                    id={fieldId("company")}
                    label="Công ty"
                    required
                    error={errors.company}
                  >
                    <input
                      id={fieldId("company")}
                      name="company"
                      type="text"
                      autoComplete="organization"
                      maxLength={120}
                      required
                      value={lead.company}
                      onChange={(event) => updateLeadField("company", event.target.value)}
                      aria-invalid={Boolean(errors.company)}
                      aria-describedby={errors.company ? fieldId("company") + "-error" : undefined}
                      className={inputClassName + (errors.company ? invalidInputClassName : "")}
                      placeholder="Tên doanh nghiệp của bạn"
                    />
                  </FieldGroup>

                  <FieldGroup
                    id={fieldId("companySize")}
                    label="Quy mô công ty"
                    required
                    error={errors.companySize}
                  >
                    <select
                      id={fieldId("companySize")}
                      name="companySize"
                      required
                      value={lead.companySize}
                      onChange={(event) => updateLeadField("companySize", event.target.value)}
                      aria-invalid={Boolean(errors.companySize)}
                      aria-describedby={errors.companySize ? fieldId("companySize") + "-error" : undefined}
                      className={inputClassName + " cursor-pointer" + (errors.companySize ? invalidInputClassName : "")}
                    >
                      <option value="">Chọn quy mô công ty</option>
                      {companySizes.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </FieldGroup>

                  <FieldGroup
                    id={fieldId("phone")}
                    label="Số điện thoại"
                    required
                    error={errors.phone}
                  >
                    <input
                      id={fieldId("phone")}
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={32}
                      required
                      value={lead.phone}
                      onChange={(event) => updateLeadField("phone", event.target.value)}
                      aria-invalid={Boolean(errors.phone)}
                      aria-describedby={errors.phone ? fieldId("phone") + "-error" : undefined}
                      className={inputClassName + (errors.phone ? invalidInputClassName : "")}
                      placeholder="+84 912 345 678"
                    />
                  </FieldGroup>

                  <FieldGroup
                    id={fieldId("country")}
                    label="Quốc gia"
                    required
                    error={errors.country}
                  >
                    <select
                      id={fieldId("country")}
                      name="country"
                      autoComplete="country"
                      required
                      value={lead.country}
                      onChange={(event) => updateLeadField("country", event.target.value)}
                      aria-invalid={Boolean(errors.country)}
                      aria-describedby={errors.country ? fieldId("country") + "-error" : undefined}
                      className={inputClassName + " cursor-pointer" + (errors.country ? invalidInputClassName : "")}
                    >
                      {countries.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </FieldGroup>

                  <div className="sm:col-span-2">
                    <FieldGroup
                      id={fieldId("interest")}
                      label="Điều gì khiến bạn quan tâm đến UPTECH KNOWLEDGE?"
                      required
                      error={errors.interest}
                    >
                      <textarea
                        id={fieldId("interest")}
                        name="interest"
                        rows={4}
                        maxLength={1000}
                        required
                        value={lead.interest}
                        onChange={(event) => updateLeadField("interest", event.target.value)}
                        aria-invalid={Boolean(errors.interest)}
                        aria-describedby={errors.interest ? fieldId("interest") + "-error" : undefined}
                        className={inputClassName + " min-h-28 resize-y py-3" + (errors.interest ? invalidInputClassName : "")}
                        placeholder="Ví dụ: tìm kiếm quy trình nội bộ nhanh hơn, hỗ trợ nhân sự mới..."
                      />
                    </FieldGroup>
                  </div>
                </div>

                <div hidden>
                  <label htmlFor={fieldId("website")}>Trang web</label>
                  <input
                    id={fieldId("website")}
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={lead.website}
                    onChange={(event) => updateLeadField("website", event.target.value)}
                  />
                </div>

                <div
                  className={
                    "rounded-xl border p-4 " +
                    (errors.consent
                      ? "border-rose-500/55 bg-rose-500/8"
                      : "border-[var(--border-subtle)] bg-[var(--bg-subtle)]")
                  }
                >
                  <label htmlFor={fieldId("consent")} className="flex cursor-pointer items-start gap-3">
                    <input
                      id={fieldId("consent")}
                      name="consent"
                      type="checkbox"
                      required
                      checked={lead.consent}
                      onChange={(event) => updateLeadField("consent", event.target.checked)}
                      aria-invalid={Boolean(errors.consent)}
                      aria-describedby={errors.consent ? fieldId("consent") + "-error" : fieldId("consent") + "-description"}
                      className="mt-0.5 size-5 shrink-0 cursor-pointer accent-blue-600"
                    />
                    <span id={fieldId("consent") + "-description"} className="text-xs leading-5 text-[var(--text-secondary)] sm:text-sm sm:leading-6">
                      Tôi đồng ý để UPTECH liên hệ tư vấn về buổi dùng thử và xử lý thông tin đã cung cấp theo Chính sách quyền riêng tư.
                      <span aria-hidden="true" className="ml-1 text-[var(--status-danger)]">*</span>
                      <span className="sr-only"> (bắt buộc)</span>
                    </span>
                  </label>
                  <p
                    id={fieldId("consent") + "-error"}
                    className="mt-2 min-h-5 pl-8 text-xs leading-5 text-[var(--status-danger)]"
                  >
                    {errors.consent ?? ""}
                  </p>
                </div>

                <InlineSubmissionState status={status} />

                {status === "success" ? (
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="mt-5 inline-flex min-h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:w-auto"
                  >
                    Hoàn tất
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="mt-5 inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/20 transition-colors hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                  >
                    {isSubmitting ? (
                      <>
                        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                        Đang gửi thông tin...
                      </>
                    ) : (
                      <>
                        Gửi thông tin
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </>
                    )}
                  </button>
                )}
              </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
