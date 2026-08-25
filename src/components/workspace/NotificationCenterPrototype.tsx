"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BellOff,
  Check,
  CheckCheck,
  FileCheck2,
  FileClock,
  LockKeyhole,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  DemoNotice,
  IconTile,
  PageIntro,
  PrototypeHint,
  SectionHeading,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";

type NotificationFilter = "all" | "unread";

type NotificationItem = {
  id: string;
  title: string;
  description: string;
  time: string;
  dateTime: string;
  variant: "neutral" | "info" | "warning";
  icon: LucideIcon;
  tone: "blue" | "emerald" | "amber";
  href?: string;
  action: string;
  unread: boolean;
  stale?: boolean;
};

const initialNotifications: NotificationItem[] = [
  {
    id: "document-ready",
    title: "Tài liệu mẫu đã sẵn sàng để tra cứu",
    description:
      "Quy định làm việc từ xa 2026.pdf đã hoàn tất bước xử lý minh họa.",
    time: "8 phút trước",
    dateTime: "2026-08-23T09:12:00+07:00",
    variant: "info",
    icon: FileCheck2,
    tone: "emerald",
    href: "/documents/doc_a91f07",
    action: "Mở tài liệu mẫu",
    unread: true,
  },
  {
    id: "document-processing",
    title: "Tệp mẫu đang được chuẩn bị",
    description:
      "Cẩm nang vận hành nội bộ.pdf đang ở tiến độ minh họa 68%.",
    time: "36 phút trước",
    dateTime: "2026-08-23T08:44:00+07:00",
    variant: "neutral",
    icon: FileClock,
    tone: "blue",
    href: "/documents/doc_e39b80",
    action: "Xem trạng thái mẫu",
    unread: false,
  },
  {
    id: "stale-target",
    title: "Đích thông báo mẫu không còn khả dụng",
    description:
      "Tài nguyên gốc có thể đã bị xóa hoặc quyền truy cập đã thay đổi. Thông báo không cấp lại quyền truy cập.",
    time: "Hôm qua",
    dateTime: "2026-08-22T16:20:00+07:00",
    variant: "warning",
    icon: TriangleAlert,
    tone: "amber",
    action: "Không thể mở",
    unread: false,
    stale: true,
  },
];

const filters: Array<{ id: NotificationFilter; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "unread", label: "Chưa đọc" },
];

export function NotificationCenterPrototype() {
  const [notifications, setNotifications] =
    useState<NotificationItem[]>(initialNotifications);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const activeFilterButtonRef = useRef<HTMLButtonElement>(null);

  const unreadCount = notifications.filter((item) => item.unread).length;
  const visibleNotifications =
    filter === "unread"
      ? notifications.filter((item) => item.unread)
      : notifications;

  function handoffFocusToActiveFilter() {
    window.requestAnimationFrame(() => activeFilterButtonRef.current?.focus());
  }

  function markAsRead(id: string, handoffFocus = false) {
    setNotifications((current) =>
      current.map((item) =>
        item.id === id ? { ...item, unread: false } : item,
      ),
    );
    if (handoffFocus) handoffFocusToActiveFilter();
  }

  function markAllAsRead() {
    setNotifications((current) =>
      current.map((item) => ({ ...item, unread: false })),
    );
    handoffFocusToActiveFilter();
  }

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="Notification Center · Prototype"
        title="Trung tâm thông báo"
        description="Lọc và đánh dấu trạng thái ngay trong bản mẫu. Mọi thay đổi được đặt lại khi bạn rời hoặc tải lại trang."
        actions={
          <button
            type="button"
            onClick={markAllAsRead}
            disabled={unreadCount === 0}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-slate-200 transition-colors hover:border-blue-700 hover:bg-blue-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600 disabled:hover:bg-slate-900"
          >
            <CheckCheck aria-hidden="true" className="size-4" />
            Đánh dấu tất cả đã đọc
          </button>
        }
      />

      <DemoNotice className="mt-6" />

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="notification-list-heading" className="min-w-0">
          <SectionHeading
            id="notification-list-heading"
            title="Cập nhật gần đây"
            description="Các mục dưới đây là fixture minh họa, không phản ánh sự kiện thật của workspace."
            action={
              <Badge
                variant={unreadCount > 0 ? "info" : "neutral"}
                dot={unreadCount > 0}
              >
                {unreadCount} chưa đọc · fixture
              </Badge>
            }
          />

          <div className="mb-4 flex flex-wrap gap-2" aria-label="Lọc thông báo">
            {filters.map((item) => (
              <button
                key={item.id}
                ref={filter === item.id ? activeFilterButtonRef : undefined}
                type="button"
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  filter === item.id
                    ? "border-blue-600 bg-blue-950/50 text-blue-200"
                    : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200",
                )}
              >
                {item.label}
                {item.id === "unread" ? ` (${unreadCount})` : ""}
              </button>
            ))}
          </div>

          <p className="sr-only" aria-live="polite">
            Hiện có {unreadCount} thông báo chưa đọc trong bản mẫu.
          </p>

          {visibleNotifications.length > 0 ? (
            <ol className="space-y-3">
              {visibleNotifications.map((notification) => (
                <li key={notification.id}>
                  <Card
                    className={cn(
                      "p-4 sm:p-5",
                      notification.unread &&
                        "border-blue-800/70 bg-blue-950/20",
                    )}
                  >
                    <article className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <IconTile
                        icon={notification.icon}
                        tone={notification.tone}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={notification.variant}
                            dot={notification.unread}
                            size="sm"
                          >
                            {notification.stale
                              ? "Đích hết hiệu lực"
                              : notification.unread
                                ? "Chưa đọc"
                                : "Đã đọc"}
                          </Badge>
                          <time
                            dateTime={notification.dateTime}
                            className="text-xs text-slate-400"
                          >
                            {notification.time}
                          </time>
                        </div>
                        <h3 className="mt-2 text-base font-semibold leading-6 text-white">
                          {notification.title}
                        </h3>
                        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
                          {notification.description}
                        </p>
                      </div>

                      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
                        {notification.unread ? (
                          <button
                            type="button"
                            onClick={() =>
                              markAsRead(notification.id, filter === "unread")
                            }
                            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-300 transition-colors hover:border-blue-700 hover:bg-blue-950/40 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:flex-none"
                          >
                            <Check aria-hidden="true" className="size-3.5" />
                            Đã đọc
                          </button>
                        ) : null}
                        {notification.href ? (
                          <Link
                            href={notification.href}
                            onClick={() => markAsRead(notification.id)}
                            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-300 transition-colors hover:border-blue-700 hover:bg-blue-950/40 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:flex-none"
                          >
                            {notification.action}
                            <ArrowRight aria-hidden="true" className="size-3.5" />
                          </Link>
                        ) : (
                          <button
                            type="button"
                            disabled
                            aria-describedby={`stale-note-${notification.id}`}
                            className="inline-flex min-h-11 flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-slate-800 px-3 text-xs font-semibold text-slate-600 sm:flex-none"
                          >
                            <LockKeyhole aria-hidden="true" className="size-3.5" />
                            {notification.action}
                          </button>
                        )}
                        {!notification.href ? (
                          <span
                            id={`stale-note-${notification.id}`}
                            className="sr-only"
                          >
                            Đích fixture đã hết hiệu lực nên không thể mở.
                          </span>
                        ) : null}
                      </div>
                    </article>
                  </Card>
                </li>
              ))}
            </ol>
          ) : (
            <Card className="flex flex-col items-center px-5 py-10 text-center">
              <IconTile icon={BellOff} tone="slate" className="size-12" />
              <h3 className="mt-4 font-semibold text-white">
                Không có thông báo chưa đọc
              </h3>
              <p className="mt-1 max-w-md text-sm leading-6 text-slate-400">
                Tất cả fixture hiện đã được đánh dấu đã đọc trong lần mở trang
                này. Bạn có thể chuyển sang bộ lọc “Tất cả” để xem lại danh sách.
              </p>
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition-colors hover:border-blue-700 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Xem tất cả
              </button>
            </Card>
          )}
        </section>

        <aside aria-labelledby="notification-rules-heading" className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={LockKeyhole} tone="violet" />
              <div>
                <h2
                  id="notification-rules-heading"
                  className="font-semibold text-white"
                >
                  Mở đích an toàn
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Quyền với tài nguyên phải được kiểm tra lại lúc mở; thông báo
                  không thay thế quyền truy cập.
                </p>
              </div>
            </div>
            <div className="mt-4 border-t border-slate-800 pt-4">
              <PrototypeHint>
                Đích nhạy cảm cần được ẩn khi liên kết bị thu hồi hoặc không còn
                tồn tại.
              </PrototypeHint>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={SlidersHorizontal} tone="slate" />
              <div>
                <h2 className="font-semibold text-white">Tùy chọn nhận tin</h2>
                <p
                  id="notification-preference-note"
                  className="mt-1 text-sm leading-6 text-slate-400"
                >
                  Kênh, loại sự kiện và thời gian lưu chưa được phê duyệt cho bản
                  mẫu này.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled
              aria-describedby="notification-preference-note"
              className="mt-4 inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center rounded-lg border border-slate-800 text-sm font-semibold text-slate-600"
            >
              Mở tùy chọn · chưa khả dụng
            </button>
          </Card>
        </aside>
      </div>
    </WorkspacePage>
  );
}
