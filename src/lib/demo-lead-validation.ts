export const DEMO_COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1000+",
] as const;

export const DEMO_COUNTRIES = ["VN", "SG", "TH", "ID", "MY", "OTHER"] as const;

export const DEMO_COMPANY_SIZE_LABELS: Record<DemoCompanySize, string> = {
  "1-10": "1–10 nhân sự",
  "11-50": "11–50 nhân sự",
  "51-200": "51–200 nhân sự",
  "201-500": "201–500 nhân sự",
  "501-1000": "501–1.000 nhân sự",
  "1000+": "Trên 1.000 nhân sự",
};

export const DEMO_COUNTRY_LABELS: Record<DemoCountry, string> = {
  VN: "Việt Nam",
  SG: "Singapore",
  TH: "Thái Lan",
  ID: "Indonesia",
  MY: "Malaysia",
  OTHER: "Khác",
};

export type DemoCompanySize = (typeof DEMO_COMPANY_SIZES)[number];
export type DemoCountry = (typeof DEMO_COUNTRIES)[number];

export interface DemoLead {
  firstName: string;
  lastName: string;
  workEmail: string;
  company: string;
  companySize: DemoCompanySize;
  phone: string;
  country: DemoCountry;
  interest: string;
  consent: true;
  website: "";
}

export interface DemoLeadRequest {
  action: "create";
  lead: DemoLead;
}

export type DemoLeadField =
  | "_form"
  | "firstName"
  | "lastName"
  | "workEmail"
  | "company"
  | "companySize"
  | "phone"
  | "country"
  | "interest"
  | "consent";

export type DemoLeadFieldErrors = Partial<Record<DemoLeadField, string>>;

export type DemoLeadValidationResult =
  | { ok: true; data: DemoLeadRequest }
  | { ok: false; fieldErrors: DemoLeadFieldErrors };

const LEAD_KEYS = new Set([
  "firstName",
  "lastName",
  "workEmail",
  "company",
  "companySize",
  "phone",
  "country",
  "interest",
  "consent",
  "website",
]);
const CREATE_KEYS = new Set(["action", "lead"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const PHONE_PATTERN = /^[+()0-9.\s-]{7,32}$/u;
const DISALLOWED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function readRequiredText(
  lead: Record<string, unknown>,
  key: Exclude<DemoLeadField, "_form" | "consent">,
  label: string,
  maxLength: number,
  errors: DemoLeadFieldErrors,
) {
  const rawValue = lead[key];

  if (typeof rawValue !== "string") {
    errors[key] = `${label} là trường bắt buộc.`;
    return "";
  }

  const value = rawValue.trim();
  if (!value) {
    errors[key] = `${label} là trường bắt buộc.`;
  } else if (value.length > maxLength) {
    errors[key] = `${label} không được vượt quá ${maxLength} ký tự.`;
  } else if (DISALLOWED_CONTROL_CHARACTERS.test(value)) {
    errors[key] = `${label} chứa ký tự không hợp lệ.`;
  }

  return value;
}

function isAllowedValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function validateLead(value: unknown, errors: DemoLeadFieldErrors): DemoLead | null {
  if (!isRecord(value) || !hasOnlyKeys(value, LEAD_KEYS)) {
    errors._form = "Dữ liệu biểu mẫu không hợp lệ.";
    return null;
  }

  const firstName = readRequiredText(value, "firstName", "Tên", 80, errors);
  const lastName = readRequiredText(value, "lastName", "Họ", 80, errors);
  const workEmail = readRequiredText(value, "workEmail", "Email công việc", 254, errors).toLowerCase();
  const company = readRequiredText(value, "company", "Công ty", 120, errors);
  const phone = readRequiredText(value, "phone", "Số điện thoại", 32, errors);
  const interest = readRequiredText(
    value,
    "interest",
    "Nội dung quan tâm",
    1_000,
    errors,
  );

  if (workEmail && !EMAIL_PATTERN.test(workEmail)) {
    errors.workEmail = "Vui lòng nhập email công việc hợp lệ.";
  }

  if (phone && !PHONE_PATTERN.test(phone)) {
    errors.phone = "Vui lòng nhập số điện thoại hợp lệ.";
  }

  if (!isAllowedValue(DEMO_COMPANY_SIZES, value.companySize)) {
    errors.companySize = "Vui lòng chọn quy mô công ty.";
  }

  if (!isAllowedValue(DEMO_COUNTRIES, value.country)) {
    errors.country = "Vui lòng chọn quốc gia.";
  }

  if (value.consent !== true) {
    errors.consent = "Bạn cần đồng ý trước khi gửi thông tin.";
  }

  if (value.website !== "") {
    errors._form = "Dữ liệu biểu mẫu không hợp lệ.";
  }

  if (Object.keys(errors).length > 0) return null;

  return {
    firstName,
    lastName,
    workEmail,
    company,
    companySize: value.companySize as DemoCompanySize,
    phone,
    country: value.country as DemoCountry,
    interest,
    consent: true,
    website: "",
  };
}

export function isHoneypotSubmission(value: unknown) {
  if (!isRecord(value) || !isRecord(value.lead)) return false;
  return typeof value.lead.website === "string" && value.lead.website.trim().length > 0;
}

export function validateDemoLeadRequest(
  value: unknown,
): DemoLeadValidationResult {
  const fieldErrors: DemoLeadFieldErrors = {};

  if (!isRecord(value) || value.action !== "create") {
    return {
      ok: false,
      fieldErrors: { _form: "Dữ liệu biểu mẫu không hợp lệ." },
    };
  }

  if (!hasOnlyKeys(value, CREATE_KEYS)) {
    fieldErrors._form = "Dữ liệu biểu mẫu không hợp lệ.";
  }

  const lead = validateLead(value.lead, fieldErrors);

  if (!lead || Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return { ok: true, data: { action: "create", lead } };
}
