import type { ReactNode } from "react";
import {
  Building2,
  CreditCard,
  Download,
  FileClock,
  LockKeyhole,
  PlugZap,
  Save,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import {
  IconTile,
  PrototypeHint,
} from "@/components/workspace/WorkspacePrimitives";

export type AdminRouteKind =
  | "users"
  | "permissions"
  | "connectors"
  | "billing"
  | "audit-logs"
  | "settings";

const pageCopy: Record<
  AdminRouteKind,
  { eyebrow: string; title: string; description: string }
> = {
  users: {
    eyebrow: "Directory · Read-only prototype",
    title: "Người dùng và nhóm",
    description:
      "Dữ liệu dựng sẵn để kiểm tra cấu trúc danh bạ; không đại diện cho tài khoản hay vai trò thật.",
  },
  permissions: {
    eyebrow: "Authorization · Read-only prototype",
    title: "Mô hình quyền",
    description:
      "Bản đồ các lớp cần được xác định trước khi xây giao diện phân quyền có thể chỉnh sửa.",
  },
  connectors: {
    eyebrow: "Integrations · Read-only prototype",
    title: "Kết nối dữ liệu",
    description:
      "Bản ghi fixture duy nhất minh họa trạng thái kết nối mà không khẳng định khả dụng hay quyền truy cập.",
  },
  billing: {
    eyebrow: "Commercial contract · Unavailable",
    title: "Thanh toán",
    description:
      "Chưa có hợp đồng dữ liệu cho gói, giá, hạn mức, hóa đơn hoặc phương thức thanh toán.",
  },
  "audit-logs": {
    eyebrow: "Audit trail · Read-only prototype",
    title: "Nhật ký kiểm toán",
    description:
      "Sự kiện fixture đã ẩn danh dùng để kiểm tra khả năng đọc và bố cục, không phải lịch sử hoạt động thật.",
  },
  settings: {
    eyebrow: "Workspace configuration · Read-only prototype",
    title: "Thiết lập workspace",
    description:
      "Các trường fixture minh họa cấu trúc thông tin; tên miền, vòng đời và quy tắc quản trị chưa được phê duyệt.",
  },
};

const fixtureUsers = [
  {
    id: "member-a",
    name: "Người dùng mẫu A",
    email: "member-a@example.test",
    role: "Thành viên · fixture",
    state: "Chưa kết nối",
  },
  {
    id: "member-b",
    name: "Người dùng mẫu B",
    email: "member-b@example.test",
    role: "Chủ sở hữu · fixture",
    state: "Chưa kết nối",
  },
];

const fixtureGroups = [
  { id: "operations", name: "Nhóm mẫu · Vận hành", members: "2 fixture" },
  { id: "people", name: "Nhóm mẫu · Nhân sự", members: "1 fixture" },
];

const permissionLayers = [
  {
    title: "Vai trò workspace",
    detail: "Tên vai trò, phạm vi và thứ tự ưu tiên chưa được xác định.",
  },
  {
    title: "Quyền theo tài nguyên",
    detail: "Quy tắc tài liệu, thư mục và kết nối chưa có hợp đồng ACL.",
  },
  {
    title: "Kiểm tra phía máy chủ",
    detail: "Cần chặn dữ liệu và mutation trước khi render UI quản trị.",
  },
  {
    title: "Thu hồi và ghi vết",
    detail: "Cơ chế hết hạn, thu hồi và audit chưa được đặc tả.",
  },
];

const auditEvents = [
  {
    id: "evt-001",
    action: "document.viewed · fixture",
    actor: "actor_[redacted]",
    target: "document_[redacted]",
    time: "2026-08-23 09:12 +07 · fixture",
    outcome: "Kết quả mẫu: allowed",
  },
  {
    id: "evt-002",
    action: "connector.sync_requested · fixture",
    actor: "actor_[redacted]",
    target: "connector_[redacted]",
    time: "2026-08-23 08:44 +07 · fixture",
    outcome: "Kết quả mẫu: queued",
  },
  {
    id: "evt-003",
    action: "permission.denied · fixture",
    actor: "actor_[redacted]",
    target: "resource_[redacted]",
    time: "2026-08-22 16:20 +07 · fixture",
    outcome: "Kết quả mẫu: denied",
  },
];

function DisabledAction({
  children,
  reasonId,
  icon: Icon,
}: {
  children: ReactNode;
  reasonId: string;
  icon: typeof Save;
}) {
  return (
    <button
      type="button"
      disabled
      aria-describedby={reasonId}
      className="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 text-sm font-semibold text-slate-600"
    >
      <Icon aria-hidden="true" className="size-4" />
      {children}
    </button>
  );
}

function ContractNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex items-start gap-3">
        <LockKeyhole
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-slate-400"
        />
        <p className="text-sm leading-6 text-slate-400">{children}</p>
      </div>
    </div>
  );
}

export function AdminRouteContent({ kind }: { kind: AdminRouteKind }) {
  const copy = pageCopy[kind];
  const reasonId = `admin-${kind}-action-reason`;

  return (
    <>
      <header className="flex flex-col gap-4 border-b border-slate-800/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-400">
            {copy.eyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {copy.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-400 sm:text-base">
            {copy.description}
          </p>
        </div>
        <Badge variant="neutral">Fixture UI · chỉ đọc</Badge>
      </header>

      <div className="mt-6">{renderRoute(kind, reasonId)}</div>
    </>
  );
}

function renderRoute(kind: AdminRouteKind, reasonId: string) {
  switch (kind) {
    case "users":
      return (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p id={reasonId} className="text-sm leading-6 text-slate-400">
              Chưa có API danh bạ, policy mời thành viên hoặc quyền thực thi.
            </p>
            <DisabledAction reasonId={reasonId} icon={UserPlus}>
              Mời người dùng
            </DisabledAction>
          </div>

          <section aria-labelledby="fixture-users-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="fixture-users-heading" className="font-semibold text-white">
                Người dùng fixture
              </h2>
              <Badge variant="neutral">2 bản ghi fixture</Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {fixtureUsers.map((user) => (
                <Card key={user.id} className="min-w-0 p-4">
                  <div className="flex items-start gap-3">
                    <IconTile icon={Users} tone="blue" />
                    <div className="min-w-0">
                      <h3 className="font-semibold text-white">{user.name}</h3>
                      <p className="mt-1 break-all text-sm text-slate-400">
                        {user.email}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="neutral">{user.role}</Badge>
                        <Badge variant="warning">{user.state}</Badge>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <section aria-labelledby="fixture-groups-heading">
            <h2 id="fixture-groups-heading" className="mb-3 font-semibold text-white">
              Nhóm fixture
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {fixtureGroups.map((group) => (
                <Card key={group.id} className="p-4">
                  <div className="flex items-center gap-3">
                    <IconTile icon={Building2} tone="slate" />
                    <div>
                      <h3 className="font-semibold text-white">{group.name}</h3>
                      <p className="mt-1 text-sm text-slate-400">
                        Thành viên hiển thị: {group.members}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        </div>
      );

    case "permissions":
      return (
        <div className="space-y-5">
          <ContractNote>
            Màn hình không suy luận ACL từ navigation hay tên vai trò. Mọi giá trị
            quyền hiện được ghi là “chưa được xác định”.
          </ContractNote>
          <div className="grid gap-3 sm:grid-cols-2">
            {permissionLayers.map((layer) => (
              <Card key={layer.title} className="p-4">
                <div className="flex items-start gap-3">
                  <IconTile icon={ShieldCheck} tone="violet" />
                  <div>
                    <Badge variant="warning">Chưa được xác định</Badge>
                    <h2 className="mt-3 font-semibold text-white">{layer.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
                      {layer.detail}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p id={reasonId} className="text-sm text-slate-400">
              Chưa có schema quyền hoặc endpoint mutation được phê duyệt.
            </p>
            <DisabledAction reasonId={reasonId} icon={Save}>
              Lưu thay đổi
            </DisabledAction>
          </div>
        </div>
      );

    case "connectors":
      return (
        <Card className="p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <IconTile icon={PlugZap} tone="blue" />
              <div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="neutral">Connector fixture</Badge>
                  <Badge variant="warning">Chưa kết nối</Badge>
                </div>
                <h2 className="mt-3 font-semibold text-white">Google Drive</h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">
                  Phạm vi, cơ chế OAuth, lịch đồng bộ và điều kiện khả dụng chưa
                  được xác định. Tên connector không hàm ý đã cài đặt.
                </p>
              </div>
            </div>
            <DisabledAction reasonId={reasonId} icon={PlugZap}>
              Kết nối
            </DisabledAction>
          </div>
          <p id={reasonId} className="mt-5 border-t border-slate-800 pt-4 text-sm text-slate-400">
            Chưa có OAuth client, scope được duyệt hoặc quyền thực thi.
          </p>
        </Card>
      );

    case "billing":
      return (
        <div className="space-y-5">
          <ContractNote>
            Không hiển thị giá, tiền tệ, gói, hạn mức hay trạng thái thanh toán vì
            repository chưa cung cấp hợp đồng thương mại đáng tin cậy.
          </ContractNote>
          <div className="grid gap-3 sm:grid-cols-2">
            {["Gói và giá", "Hạn mức sử dụng", "Hóa đơn", "Phương thức thanh toán"].map(
              (item) => (
                <Card key={item} className="p-4">
                  <div className="flex items-center gap-3">
                    <IconTile icon={CreditCard} tone="slate" />
                    <div>
                      <h2 className="font-semibold text-white">{item}</h2>
                      <p className="mt-1 text-sm text-slate-400">
                        Không có dữ liệu hợp đồng
                      </p>
                    </div>
                  </div>
                </Card>
              ),
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p id={reasonId} className="text-sm text-slate-400">
              Chưa có provider, policy hoặc quyền quản lý thanh toán.
            </p>
            <DisabledAction reasonId={reasonId} icon={CreditCard}>
              Quản lý thanh toán
            </DisabledAction>
          </div>
        </div>
      );

    case "audit-logs":
      return (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p id={reasonId} className="text-sm leading-6 text-slate-400">
              Export bị tắt vì chưa có API, retention policy hoặc kiểm tra quyền.
            </p>
            <DisabledAction reasonId={reasonId} icon={Download}>
              Xuất nhật ký
            </DisabledAction>
          </div>
          <ol className="space-y-3">
            {auditEvents.map((event) => (
              <li key={event.id}>
                <Card className="p-4">
                  <article className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <IconTile icon={FileClock} tone="amber" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="neutral">{event.id}</Badge>
                        <Badge variant="warning">Fixture đã ẩn danh</Badge>
                      </div>
                      <h2 className="mt-3 break-words font-semibold text-white">
                        {event.action}
                      </h2>
                      <dl className="mt-3 grid gap-2 text-sm text-slate-400 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-slate-400">Actor</dt>
                          <dd className="mt-1 break-all text-slate-300">{event.actor}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-400">Target</dt>
                          <dd className="mt-1 break-all text-slate-300">{event.target}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-400">Thời gian</dt>
                          <dd className="mt-1 text-slate-300">{event.time}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-400">Kết quả</dt>
                          <dd className="mt-1 text-slate-300">{event.outcome}</dd>
                        </div>
                      </dl>
                    </div>
                  </article>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      );

    case "settings":
      return (
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={Settings} tone="blue" />
              <div>
                <Badge variant="neutral">Giá trị fixture · chỉ đọc</Badge>
                <h2 className="mt-3 font-semibold text-white">Nhận diện workspace</h2>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Các giá trị chỉ kiểm tra bố cục; không được lưu hoặc dùng làm cấu
                  hình thật.
                </p>
              </div>
            </div>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                <dt className="text-xs font-medium text-slate-400">
                  Tên hiển thị · fixture
                </dt>
                <dd className="mt-1 text-sm font-semibold text-slate-300">
                  Workspace mẫu
                </dd>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                <dt className="text-xs font-medium text-slate-400">
                  Định danh · fixture
                </dt>
                <dd className="mt-1 break-words text-sm font-semibold text-slate-300">
                  workspace-example
                </dd>
              </div>
            </dl>
          </Card>
          <ContractNote>
            Tên miền, nhận diện thương hiệu, vòng đời dữ liệu và quy tắc xóa
            workspace đều chưa được xác định.
          </ContractNote>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p id={reasonId} className="text-sm text-slate-400">
              Chưa có schema thiết lập, endpoint mutation hoặc quyền thực thi.
            </p>
            <DisabledAction reasonId={reasonId} icon={Save}>
              Lưu thiết lập
            </DisabledAction>
          </div>
          <PrototypeHint>
            Trạng thái “chỉ đọc” là chủ ý của prototype, không phải bằng chứng người
            xem thiếu hoặc có quyền.
          </PrototypeHint>
        </div>
      );
  }
}
