"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  Save,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type {
  AdminBillingProfileRecord,
  AdminKnowledgeAnalyticsRecord,
  AdminWorkspaceOverview,
} from "@/server/admin/repository";

interface BillingApiPayload {
  readonly ok: boolean;
  readonly overview: AdminWorkspaceOverview;
  readonly billing: AdminBillingProfileRecord;
  readonly analytics?: AdminKnowledgeAnalyticsRecord;
  readonly error?: { readonly message?: string };
}

const PLAN_OPTIONS: ReadonlyArray<{
  code: AdminBillingProfileRecord["planCode"];
  name: string;
  seats: string;
  storage: string;
  aiTurns: string;
  summary: string;
}> = [
  {
    code: "STARTER",
    name: "Starter",
    seats: "25 thành viên",
    storage: "5 GB tài liệu",
    aiTurns: "2.000 lượt AI/tháng",
    summary: "Phù hợp cho đội nhóm bắt đầu số hóa kho tri thức nội bộ.",
  },
  {
    code: "GROWTH",
    name: "Growth",
    seats: "100 thành viên",
    storage: "25 GB tài liệu",
    aiTurns: "15.000 lượt AI/tháng",
    summary: "Mở rộng cho doanh nghiệp nhiều phòng ban với đồng bộ Google Directory.",
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    seats: "1.000 thành viên",
    storage: "200 GB tài liệu",
    aiTurns: "100.000 lượt AI/tháng",
    summary: "Hạn mức doanh nghiệp lớn, quản trị kiểm toán và lưu trữ dài hạn.",
  },
];

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function AdminBillingClient() {
  const [data, setData] = useState<BillingApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const [planCode, setPlanCode] =
    useState<AdminBillingProfileRecord["planCode"]>("STARTER");
  const [billingCycle, setBillingCycle] =
    useState<AdminBillingProfileRecord["billingCycle"]>("MONTHLY");
  const [billingContactEmail, setBillingContactEmail] = useState("");
  const [companyLegalName, setCompanyLegalName] = useState("");
  const [taxId, setTaxId] = useState("");

  const syncForm = useCallback((billing: AdminBillingProfileRecord) => {
    setPlanCode(billing.planCode);
    setBillingCycle(billing.billingCycle);
    setBillingContactEmail(billing.billingContactEmail ?? "");
    setCompanyLegalName(billing.companyLegalName ?? "");
    setTaxId(billing.taxId ?? "");
  }, []);

  const fetchBilling = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const response = await fetch("/api/v1/admin/billing", { cache: "no-store" });
      const payload = (await response.json()) as BillingApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể tải thông tin thanh toán.");
        return;
      }
      setData(payload);
      syncForm(payload.billing);
    } catch {
      setErrorMsg("Mất kết nối tới máy chủ quản trị.");
    } finally {
      setLoading(false);
    }
  }, [syncForm]);

  useEffect(() => {
    void fetchBilling();
  }, [fetchBilling]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const response = await fetch("/api/v1/admin/billing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planCode,
          billingCycle,
          billingContactEmail: billingContactEmail.trim() || null,
          companyLegalName: companyLegalName.trim() || null,
          taxId: taxId.trim() || null,
        }),
      });
      const payload = (await response.json()) as BillingApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể lưu hồ sơ thanh toán.");
        return;
      }
      setData(payload);
      syncForm(payload.billing);
      setNoticeMsg("Đã lưu hồ sơ gói dịch vụ và thông tin xuất hóa đơn vào cơ sở dữ liệu.");
    } catch {
      setErrorMsg("Lỗi kết nối khi lưu hồ sơ thanh toán.");
    } finally {
      setSaving(false);
    }
  }

  const usedStorageMb = data
    ? Number((data.overview.storageBytes / (1024 * 1024)).toFixed(2))
    : 0;
  const seatPct = data
    ? pct(data.overview.activeMemberCount, data.billing.seatLimit)
    : 0;
  const storagePct = data ? pct(usedStorageMb, data.billing.storageLimitMb) : 0;
  const aiTurnPct = data
    ? pct(data.overview.aiTurns30d, data.billing.monthlyAiTurnLimit)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1B44FF]">
            Gói dịch vụ &amp; định mức sử dụng
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-0.025em] text-[#0D1321]">
            Thanh toán &amp; Mức tiêu thụ thực tế
          </h2>
          <p className="mt-1 text-sm text-[#52607A]">
            Số liệu ghế thành viên, dung lượng kho tài liệu và lượt hỏi đáp AI được tổng hợp trực tiếp từ dữ liệu thật của tổ chức.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchBilling()}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#0D1321]/12 bg-white px-3.5 text-sm font-semibold text-[#323B4D] hover:bg-[#F8FAFC] disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={`size-4 ${loading ? "animate-spin" : ""}`} />
          <span>Làm mới</span>
        </button>
      </div>

      {errorMsg ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      ) : null}

      {noticeMsg ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
          <span>{noticeMsg}</span>
        </div>
      ) : null}

      {/* Real Usage Meters */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[#64748B]">
              Ghế thành viên
            </span>
            <Badge variant="info">{seatPct}%</Badge>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#0D1321]">
            {data ? data.overview.activeMemberCount : "—"}{" "}
            <span className="text-sm font-medium text-[#64748B]">
              / {data ? data.billing.seatLimit.toLocaleString("vi-VN") : "—"}
            </span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#1B44FF] transition-all"
              style={{ width: `${seatPct}%` }}
            />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[#64748B]">
              Dung lượng tài liệu
            </span>
            <Badge variant="success">{storagePct}%</Badge>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#0D1321]">
            {data ? usedStorageMb : "—"} MB{" "}
            <span className="text-sm font-medium text-[#64748B]">
              / {data ? data.billing.storageLimitMb.toLocaleString("vi-VN") : "—"} MB
            </span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${storagePct}%` }}
            />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[#64748B]">
              Lượt Trợ lý AI (30 ngày)
            </span>
            <Badge variant="neutral">{aiTurnPct}%</Badge>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#0D1321]">
            {data ? data.overview.aiTurns30d.toLocaleString("vi-VN") : "—"}{" "}
            <span className="text-sm font-medium text-[#64748B]">
              / {data ? data.billing.monthlyAiTurnLimit.toLocaleString("vi-VN") : "—"}
            </span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${aiTurnPct}%` }}
            />
          </div>
        </Card>
      </div>

      {/* Plan & Billing Profile Form */}
      <form onSubmit={handleSave} className="space-y-6">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CreditCard aria-hidden="true" className="size-4 text-[#1B44FF]" />
              <h3 className="text-base font-bold text-[#0D1321]">
                Gói định mức &amp; Chu kỳ thanh toán
              </h3>
            </div>

            <div className="inline-flex rounded-xl border border-[#0D1321]/12 bg-[#F8FAFC] p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setBillingCycle("MONTHLY")}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  billingCycle === "MONTHLY"
                    ? "bg-white text-[#1635C7] shadow-sm"
                    : "text-[#52607A]"
                }`}
              >
                Theo tháng
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle("ANNUAL")}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  billingCycle === "ANNUAL"
                    ? "bg-white text-[#1635C7] shadow-sm"
                    : "text-[#52607A]"
                }`}
              >
                Theo năm
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {PLAN_OPTIONS.map((plan) => {
              const selected = planCode === plan.code;
              return (
                <button
                  key={plan.code}
                  type="button"
                  onClick={() => setPlanCode(plan.code)}
                  className={`rounded-2xl border p-4 text-left transition-all ${
                    selected
                      ? "border-[#1B44FF] bg-[#EEF1FF]/50 ring-1 ring-[#1B44FF]"
                      : "border-[#0D1321]/10 bg-white hover:border-[#C8D2FF]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-[#0D1321]">{plan.name}</span>
                    {selected ? <Badge variant="info">Đang chọn</Badge> : null}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#52607A]">{plan.summary}</p>
                  <ul className="mt-3 space-y-1 text-xs font-medium text-[#323B4D]">
                    <li>• {plan.seats}</li>
                    <li>• {plan.storage}</li>
                    <li>• {plan.aiTurns}</li>
                  </ul>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-base font-bold text-[#0D1321]">
            Thông tin doanh nghiệp xuất hóa đơn
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-semibold text-[#323B4D]">
                Tên pháp lý doanh nghiệp
              </span>
              <input
                type="text"
                maxLength={200}
                value={companyLegalName}
                onChange={(e) => setCompanyLegalName(e.target.value)}
                placeholder="Công ty Cổ phần ..."
                className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3.5 py-2.5 text-sm text-[#0D1321] focus:border-[#1B44FF] focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-[#323B4D]">Mã số thuế</span>
              <input
                type="text"
                maxLength={64}
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="010xxxxxxx"
                className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3.5 py-2.5 text-sm text-[#0D1321] focus:border-[#1B44FF] focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-[#323B4D]">
                Email nhận hóa đơn
              </span>
              <input
                type="email"
                maxLength={320}
                value={billingContactEmail}
                onChange={(e) => setBillingContactEmail(e.target.value)}
                placeholder="accounting@company.com"
                className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3.5 py-2.5 text-sm text-[#0D1321] focus:border-[#1B44FF] focus:outline-none"
              />
            </label>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1B44FF] px-5 text-sm font-semibold text-white hover:bg-[#1635C7] disabled:opacity-60"
            >
              <Save aria-hidden="true" className="size-4" />
              <span>{saving ? "Đang lưu..." : "Lưu hồ sơ thanh toán"}</span>
            </button>
          </div>
        </Card>
      </form>

      {/* Enterprise Knowledge Analytics & Content Gaps */}
      {data?.analytics ? (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-[#0D1321]">
                  Phân tích chất lượng tri thức AI (30 ngày gần nhất)
                </h3>
                <p className="text-xs text-[#64748B]">
                  Theo dõi độ phủ nguồn dẫn chứng, phản hồi của nhân viên và các câu hỏi chưa có tài liệu trả lời (Content Gaps).
                </p>
              </div>
              <Badge variant="info">
                {data.analytics.turns30d > 0
                  ? `${Math.round(
                      (data.analytics.groundedTurns30d / data.analytics.turns30d) * 100,
                    )}% có nguồn dẫn chứng`
                  : "Chưa có lượt hỏi"}
              </Badge>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-[#F8FAFC] p-3.5">
                <p className="text-xs text-[#64748B]">Trả lời đủ dẫn chứng</p>
                <p className="mt-1 text-xl font-bold text-emerald-700">
                  {data.analytics.groundedTurns30d}
                </p>
              </div>
              <div className="rounded-xl bg-[#F8FAFC] p-3.5">
                <p className="text-xs text-[#64748B]">Thiếu nguồn (Content Gaps)</p>
                <p className="mt-1 text-xl font-bold text-amber-700">
                  {data.analytics.emptyTurns30d}
                </p>
              </div>
              <div className="rounded-xl bg-[#F8FAFC] p-3.5">
                <p className="text-xs text-[#64748B]">Đánh giá Hữu ích / Cần sửa</p>
                <p className="mt-1 text-xl font-bold text-[#0D1321]">
                  {data.analytics.positiveFeedback30d} 👍 · {data.analytics.negativeFeedback30d} 👎
                </p>
              </div>
              <div className="rounded-xl bg-[#F8FAFC] p-3.5">
                <p className="text-xs text-[#64748B]">Thẻ tri thức Đã xác minh / Nháp</p>
                <p className="mt-1 text-xl font-bold text-[#1635C7]">
                  {data.analytics.verifiedCardsCount} / {data.analytics.draftCardsCount}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[#0D1321]/10 p-4">
                <h4 className="text-sm font-bold text-[#0D1321]">
                  Lỗ hổng tri thức cần bổ sung tài liệu ({data.analytics.contentGaps.length})
                </h4>
                {data.analytics.contentGaps.length === 0 ? (
                  <p className="mt-2 text-xs text-[#64748B]">
                    Chưa phát hiện câu hỏi nào thiếu tài liệu dẫn chứng trong 30 ngày qua.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-[#0D1321]/6 text-xs">
                    {data.analytics.contentGaps.map((gap, idx) => (
                      <li key={`${gap.prompt}-${idx}`} className="py-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-[#0D1321]">{gap.prompt}</span>
                          <Badge variant={gap.evidenceState === "empty" ? "warning" : "danger"}>
                            {gap.askCount}x
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#64748B]">
                          Phạm vi: {gap.scope} ·{" "}
                          {gap.evidenceState === "empty" ? "Chưa có tài liệu" : "Phản hồi chưa tốt"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-[#0D1321]/10 p-4">
                <h4 className="text-sm font-bold text-[#0D1321]">
                  Tài liệu được Trợ lý AI trích dẫn nhiều nhất ({data.analytics.topCitedDocs.length})
                </h4>
                {data.analytics.topCitedDocs.length === 0 ? (
                  <p className="mt-2 text-xs text-[#64748B]">
                    Chưa có thống kê trích dẫn tài liệu trong 30 ngày qua.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-[#0D1321]/6 text-xs">
                    {data.analytics.topCitedDocs.map((doc) => (
                      <li
                        key={doc.documentId}
                        className="flex items-center justify-between gap-2 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[#0D1321]">{doc.title}</p>
                          <p className="text-[11px] text-[#64748B]">{doc.spaceName}</p>
                        </div>
                        <Badge variant="success">{doc.citationCount} trích dẫn</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
