"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  BellOff,
  BookOpenCheck,
  Check,
  CheckCheck,
  FileCheck2,
  FilePenLine,
  FileX2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";

import { usePreferences } from "@/components/preferences/PreferencesProvider";
import { Badge, Card } from "@/components/ui";
import {
  IconTile,
  PageIntro,
  SectionHeading,
  WorkspacePage,
  type IconTone,
} from "@/components/workspace/WorkspacePrimitives";
import { cn } from "@/lib/utils";
import type {
  WorkspaceNotificationKind,
  WorkspaceNotificationRecord,
} from "@/server/knowledge/repository";

type NotificationReadFilter = "all" | "unread";
type NotificationGroupFilter = "all" | "documents" | "knowledge" | "utility";

type NotificationCenterProps = Readonly<{
  initialNotifications: readonly WorkspaceNotificationRecord[];
}>;

const KIND_META: Record<
  WorkspaceNotificationKind,
  {
    icon: typeof Bell;
    tone: IconTone;
    group: "documents" | "knowledge" | "utility";
    badgeVariant: "info" | "success" | "warning" | "neutral";
  }
> = {
  document_uploaded: {
    icon: FileCheck2,
    tone: "emerald",
    group: "documents",
    badgeVariant: "success",
  },
  document_updated: {
    icon: FilePenLine,
    tone: "blue",
    group: "documents",
    badgeVariant: "info",
  },
  document_deleted: {
    icon: FileX2,
    tone: "amber",
    group: "documents",
    badgeVariant: "warning",
  },
  knowledge_created: {
    icon: BookOpenCheck,
    tone: "violet",
    group: "knowledge",
    badgeVariant: "info",
  },
  knowledge_verified: {
    icon: ShieldCheck,
    tone: "emerald",
    group: "knowledge",
    badgeVariant: "success",
  },
  utility_completed: {
    icon: Sparkles,
    tone: "blue",
    group: "utility",
    badgeVariant: "info",
  },
};

function formatRelativeTime(iso: string, locale: "vi" | "en"): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return locale === "en" ? "Just now" : "Vừa xong";
  const diffSec = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (diffSec < 60) return locale === "en" ? "Just now" : "Vừa xong";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return locale === "en" ? `${diffMin}m ago` : `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return locale === "en" ? `${diffHours}h ago` : `${diffHours} giờ trước`;
  return new Date(parsed).toLocaleDateString(locale === "en" ? "en-US" : "vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function broadcastUnreadCount(count: number) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("uptech:notifications-updated", { detail: { unreadCount: count } }),
    );
  }
}

export function NotificationCenterPrototype({
  initialNotifications,
}: NotificationCenterProps) {
  const { locale } = usePreferences();
  const [notifications, setNotifications] = useState<readonly WorkspaceNotificationRecord[]>(
    initialNotifications,
  );
  const [readFilter, setReadFilter] = useState<NotificationReadFilter>("all");
  const [groupFilter, setGroupFilter] = useState<NotificationGroupFilter>("all");
  const [busy, setBusy] = useState(false);
  const activeFilterRef = useRef<HTMLButtonElement>(null);

  const unreadCount = notifications.filter((item) => item.unread).length;

  const visibleNotifications = useMemo(() => {
    return notifications.filter((item) => {
      if (readFilter === "unread" && !item.unread) return false;
      if (groupFilter !== "all" && KIND_META[item.kind].group !== groupFilter) {
        return false;
      }
      return true;
    });
  }, [notifications, readFilter, groupFilter]);

  async function markAsRead(id: string) {
    setNotifications((prev) => {
      const next = prev.map((item) =>
        item.id === id ? { ...item, unread: false } : item,
      );
      broadcastUnreadCount(next.filter((i) => i.unread).length);
      return next;
    });

    try {
      const response = await fetch("/api/v1/workspace/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: id }),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          notifications?: WorkspaceNotificationRecord[];
          unreadCount?: number;
        };
        if (Array.isArray(data.notifications)) {
          setNotifications(data.notifications);
          broadcastUnreadCount(data.unreadCount ?? 0);
        }
      }
    } catch {
      // Optimistic state already updated
    }
  }

  async function markAllAsRead() {
    if (unreadCount === 0 || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/workspace/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          notifications?: WorkspaceNotificationRecord[];
          unreadCount?: number;
        };
        if (Array.isArray(data.notifications)) {
          setNotifications(data.notifications);
          broadcastUnreadCount(data.unreadCount ?? 0);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function clearAllNotifications() {
    if (notifications.length === 0 || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/workspace/notifications", {
        method: "DELETE",
      });
      if (response.ok) {
        setNotifications([]);
        broadcastUnreadCount(0);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow={locale === "en" ? "Activity Inbox · Live" : "Hộp tin hoạt động · Dữ liệu thật"}
        title={locale === "en" ? "Notification Center" : "Trung tâm thông báo"}
        description={
          locale === "en"
            ? "Real-time workspace activity log covering document indexing, Knowledge Cards verification, and AI utilities."
            : "Theo dõi mọi sự kiện thật trong không gian tri thức: lập chỉ mục tài liệu, xác minh Thẻ tri thức và kết quả Tiện ích AI."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={markAllAsRead}
              disabled={unreadCount === 0 || busy}
              className="glean-btn glean-btn-secondary glean-btn-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCheck aria-hidden="true" className="size-3.5" />
              <span>
                {locale === "en" ? "Mark all read" : "Đánh dấu tất cả đã đọc"}
              </span>
            </button>
            <button
              type="button"
              onClick={clearAllNotifications}
              disabled={notifications.length === 0 || busy}
              className="glean-btn glean-btn-secondary glean-btn-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              <span>{locale === "en" ? "Clear inbox" : "Dọn hộp tin"}</span>
            </button>
          </div>
        }
      />

      <div className="mt-6 space-y-4">
        <SectionHeading
          id="notification-list-heading"
          title={locale === "en" ? "Recent events" : "Hoạt động gần đây"}
          description={
            locale === "en"
              ? "Click any item link to jump directly to the target document or knowledge card."
              : "Chọn sự kiện để mở nhanh tài liệu, thẻ tri thức hoặc kết quả AI liên quan."
          }
          action={
            <Badge variant={unreadCount > 0 ? "info" : "neutral"} dot={unreadCount > 0}>
              {locale === "en"
                ? `${unreadCount} unread`
                : `${unreadCount} chưa đọc`}
            </Badge>
          }
        />

        {/* Dual Filter Bar: Read status + Category */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" aria-label={locale === "en" ? "Filter by read status" : "Lọc trạng thái đọc"}>
            <button
              ref={readFilter === "all" ? activeFilterRef : undefined}
              type="button"
              aria-pressed={readFilter === "all"}
              onClick={() => setReadFilter("all")}
              className={cn(
                "inline-flex min-h-9 items-center justify-center rounded-full border px-3.5 text-xs font-semibold transition-colors",
                readFilter === "all"
                  ? "border-[#1B44FF] bg-[#EEF1FF] text-[#1635C7]"
                  : "border-[#0D1321]/10 bg-white text-[#505A6E] hover:text-[#0D1321]",
              )}
            >
              {locale === "en"
                ? `All (${notifications.length})`
                : `Tất cả (${notifications.length})`}
            </button>
            <button
              ref={readFilter === "unread" ? activeFilterRef : undefined}
              type="button"
              aria-pressed={readFilter === "unread"}
              onClick={() => setReadFilter("unread")}
              className={cn(
                "inline-flex min-h-9 items-center justify-center rounded-full border px-3.5 text-xs font-semibold transition-colors",
                readFilter === "unread"
                  ? "border-[#1B44FF] bg-[#EEF1FF] text-[#1635C7]"
                  : "border-[#0D1321]/10 bg-white text-[#505A6E] hover:text-[#0D1321]",
              )}
            >
              {locale === "en" ? `Unread (${unreadCount})` : `Chưa đọc (${unreadCount})`}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5" aria-label={locale === "en" ? "Filter by category" : "Lọc theo loại"}>
            {(
              [
                { id: "all", vi: "Mọi loại", en: "Everything" },
                { id: "documents", vi: "Tài liệu", en: "Documents" },
                { id: "knowledge", vi: "Thẻ tri thức", en: "Knowledge Cards" },
                { id: "utility", vi: "Tiện ích AI", en: "AI Utilities" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={groupFilter === tab.id}
                onClick={() => setGroupFilter(tab.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  groupFilter === tab.id
                    ? "bg-[#0B1220] [color:#FFFFFF]"
                    : "bg-[#F3F4F8] text-[#505A6E] hover:text-[#0D1321]",
                )}
              >
                {tab[locale]}
              </button>
            ))}
          </div>
        </div>

        {/* Feed List or Empty State */}
        {visibleNotifications.length > 0 ? (
          <ol className="space-y-3">
            {visibleNotifications.map((item) => {
              const meta = KIND_META[item.kind];
              const isStale = item.href === null;
              return (
                <li key={item.id}>
                  <Card
                    className={cn(
                      "p-4 sm:p-5 transition-colors",
                      item.unread && "border-[#C8D2FF] bg-[#F6F8FF]",
                    )}
                  >
                    <article className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <IconTile icon={meta.icon} tone={meta.tone} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={isStale ? "warning" : meta.badgeVariant}
                            dot={item.unread}
                            size="sm"
                          >
                            {item.unread
                              ? locale === "en"
                                ? "Unread"
                                : "Chưa đọc"
                              : locale === "en"
                                ? "Read"
                                : "Đã đọc"}
                          </Badge>
                          <time dateTime={item.createdAtIso} className="text-xs text-[#505A6E]">
                            {formatRelativeTime(item.createdAtIso, locale)}
                          </time>
                        </div>
                        <h3 className="mt-2 text-base font-bold leading-6 text-[#0D1321]">
                          {item.title}
                        </h3>
                        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#505A6E]">
                          {item.description}
                        </p>
                      </div>

                      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
                        {item.unread ? (
                          <button
                            type="button"
                            onClick={() => markAsRead(item.id)}
                            className="glean-btn glean-btn-secondary glean-btn-sm"
                          >
                            <Check aria-hidden="true" className="size-3.5" />
                            <span>{locale === "en" ? "Mark read" : "Đã đọc"}</span>
                          </button>
                        ) : null}

                        {item.href ? (
                          <Link
                            href={item.href}
                            onClick={() => markAsRead(item.id)}
                            className="glean-btn glean-btn-navy glean-btn-sm"
                          >
                            <span>{item.actionLabel}</span>
                            <ArrowRight aria-hidden="true" className="size-3.5" />
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#0D1321]/10 bg-[#F3F4F8] px-3 py-1.5 text-xs font-semibold text-[#505A6E]">
                            {item.actionLabel}
                          </span>
                        )}
                      </div>
                    </article>
                  </Card>
                </li>
              );
            })}
          </ol>
        ) : (
          <Card className="flex flex-col items-center px-6 py-12 text-center">
            <IconTile icon={BellOff} tone="slate" className="size-12" />
            <h3 className="mt-4 text-base font-bold text-[#0D1321]">
              {notifications.length === 0
                ? locale === "en"
                  ? "No workspace notifications yet"
                  : "Chưa có thông báo hoạt động nào"
                : locale === "en"
                  ? "No matching notifications"
                  : "Không có thông báo phù hợp bộ lọc"}
            </h3>
            <p className="mt-1.5 max-w-md text-sm leading-6 text-[#505A6E]">
              {notifications.length === 0
                ? locale === "en"
                  ? "Real notifications appear automatically when you upload documents, verify Knowledge Cards, or run AI Utilities."
                  : "Thông báo thật sẽ tự động xuất hiện mỗi khi bạn tải tài liệu lên, xác minh Thẻ tri thức hoặc chạy xong Tiện ích AI."
                : locale === "en"
                  ? "Switch filter back to All to inspect earlier activity logs."
                  : "Chuyển bộ lọc về Tất cả để xem lại các hoạt động trước đó."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {notifications.length === 0 ? (
                <>
                  <Link href="/documents" className="glean-btn glean-btn-cobalt glean-btn-sm">
                    {locale === "en" ? "Go to Library" : "Tải tài liệu lên"}
                  </Link>
                  <Link href="/utility" className="glean-btn glean-btn-secondary glean-btn-sm">
                    {locale === "en" ? "Open AI Utilities" : "Mở Tiện ích AI"}
                  </Link>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setReadFilter("all");
                    setGroupFilter("all");
                  }}
                  className="glean-btn glean-btn-secondary glean-btn-sm"
                >
                  {locale === "en" ? "Show all events" : "Xem tất cả hoạt động"}
                </button>
              )}
            </div>
          </Card>
        )}
      </div>
    </WorkspacePage>
  );
}
