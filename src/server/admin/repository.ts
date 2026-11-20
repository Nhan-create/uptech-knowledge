import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { QueryResultRow } from "pg";

import {
  requestTransactionContextFromSession,
  withRequestTransaction,
  type DatabaseClient,
} from "@/server/db/core";
import { getPreviewWorkspaceContext } from "@/server/knowledge/access-context";
import {
  listKnowledgeCards,
  listPersistedChatSessions,
  loadKnowledgeDocumentsAndSpaces,
} from "@/server/knowledge/repository";
import type { AdminApiContext } from "./auth";

export interface AdminDomainRecord {
  readonly domain: string;
  readonly status: string;
  readonly domainKind: string;
  readonly verifiedAt: string | null;
}

export interface AdminWorkspaceOverview {
  readonly workspaceId: string;
  readonly workspaceStatus: string;
  readonly provisioningPolicy: "INVITE_ONLY" | "GOOGLE_GROUP_CONTROLLED" | "DOMAIN_AUTO_PROVISION";
  readonly googleCustomerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly callerRole: "OWNER" | "ADMIN";
  readonly activeMemberCount: number;
  readonly adminMemberCount: number;
  readonly pendingInviteCount: number;
  readonly pendingAccessRequestCount: number;
  readonly activeSessionCount: number;
  readonly spaceCount: number;
  readonly documentCount: number;
  readonly readyDocumentCount: number;
  readonly chunkCount: number;
  readonly storageBytes: number;
  readonly knowledgeCardCount: number;
  readonly aiTurns30d: number;
  readonly domains: readonly AdminDomainRecord[];
}

export interface AdminMemberRecord {
  readonly membershipId: string;
  readonly userId: string;
  readonly role: "OWNER" | "ADMIN" | "MEMBER";
  readonly status: "ACTIVE" | "PENDING" | "SUSPENDED" | "DEPROVISIONED";
  readonly email: string | null;
  readonly fullName: string | null;
  readonly pictureUrl: string | null;
  readonly hostedDomain: string | null;
  readonly department: string | null;
  readonly orgUnitPath: string | null;
  readonly googleIsAdmin: boolean | null;
  readonly activeSessionCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminInviteRecord {
  readonly id: string;
  readonly email: string;
  readonly role: "ADMIN" | "MEMBER";
  readonly departmentKey: string | null;
  readonly status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  readonly note: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
}

export interface AdminAccessRequestRecord {
  readonly requestRowId: string;
  readonly identityId: string;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly reasonClass: string;
  readonly status: "PENDING" | "FULFILLED" | "CANCELLED";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminDirectoryGroupRecord {
  readonly googleGroupId: string;
  readonly groupName: string;
  readonly memberCount: number;
}

export interface AdminDirectoryOrgUnitRecord {
  readonly googleOrgUnitId: string;
  readonly orgUnitPath: string;
  readonly parentOrgUnitId: string | null;
}

export interface AdminPermissionMappingRecord {
  readonly mappingId: string;
  readonly sourceKind: "ADMIN_GROUP" | "GROUP" | "DEPARTMENT" | "ORG_UNIT";
  readonly sourceValue: string;
  readonly targetRole: "ADMIN" | "MEMBER";
  readonly targetDepartmentKey: "SALES" | "HR" | "IT" | "FINANCE" | null;
  readonly status: "ACTIVE" | "DISABLED";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminConnectorRecord {
  readonly connectorId: string;
  readonly purpose: "DIRECTORY" | "DRIVE";
  readonly status: string;
  readonly providerCustomerId: string | null;
  readonly authorizedScopes: readonly string[];
  readonly hasCredential: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestGenerationStatus: string | null;
  readonly latestGenerationCompletedAt: string | null;
  readonly latestGenerationFreshUntil: string | null;
  readonly syncedUserCount: number;
  readonly syncedGroupCount: number;
}

export interface AdminSyncJobRecord {
  readonly jobId: string;
  readonly connectorId: string;
  readonly jobKind: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface AdminAuditEventRecord {
  readonly eventId: string;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly actorEmail: string | null;
  readonly actorName: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly outcome: "SUCCEEDED" | "DENIED" | "FAILED";
  readonly requestId: string;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: string;
}

export interface AdminSettingsRecord {
  readonly organizationName: string;
  readonly defaultLocale: "vi" | "en";
  readonly retentionDays: number;
  readonly maxUploadMb: number;
  readonly allowMemberUploads: boolean;
  readonly requireVerifiedCardsInChat: boolean;
  readonly auditExportEnabled: boolean;
  readonly updatedAt: string | null;
}

export interface AdminContentGapItem {
  readonly prompt: string;
  readonly scope: string;
  readonly evidenceState: string;
  readonly feedback: string | null;
  readonly askCount: number;
  readonly lastAskedAt: string;
}

export interface AdminTopCitedDocItem {
  readonly documentId: string;
  readonly title: string;
  readonly spaceName: string;
  readonly citationCount: number;
}

export interface AdminKnowledgeAnalyticsRecord {
  readonly turns30d: number;
  readonly groundedTurns30d: number;
  readonly cautionTurns30d: number;
  readonly emptyTurns30d: number;
  readonly positiveFeedback30d: number;
  readonly negativeFeedback30d: number;
  readonly verifiedCardsCount: number;
  readonly draftCardsCount: number;
  readonly contentGaps: readonly AdminContentGapItem[];
  readonly topCitedDocs: readonly AdminTopCitedDocItem[];
}

export interface AdminBillingProfileRecord {
  readonly planCode: "STARTER" | "GROWTH" | "ENTERPRISE";
  readonly billingCycle: "MONTHLY" | "ANNUAL";
  readonly seatLimit: number;
  readonly storageLimitMb: number;
  readonly monthlyAiTurnLimit: number;
  readonly billingContactEmail: string | null;
  readonly companyLegalName: string | null;
  readonly taxId: string | null;
  readonly updatedAt: string | null;
}

export interface AdminShellMetadata {
  readonly organizationName: string;
  readonly primaryDomain: string | null;
  readonly callerRole: "OWNER" | "ADMIN";
  readonly provisioningPolicy: string;
  readonly activeMemberCount: number;
  readonly pendingAccessRequestCount: number;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return new Date().toISOString();
}

function toNullableIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

interface PreviewAdminState {
  provisioningPolicy: "INVITE_ONLY" | "GOOGLE_GROUP_CONTROLLED" | "DOMAIN_AUTO_PROVISION";
  members: Array<Record<string, unknown>>;
  invites: Array<Record<string, unknown>>;
  mappings: Array<Record<string, unknown>>;
  settings: Record<string, unknown>;
  billing: Record<string, unknown>;
  auditEvents: Array<Record<string, unknown>>;
}

const PREVIEW_ADMIN_FILE = resolve(process.cwd(), ".uptech-data", "admin-preview.json");

async function loadPreviewAdminState(workspaceId: string): Promise<PreviewAdminState> {
  const nowIso = new Date().toISOString();
  const defaults: PreviewAdminState = {
    provisioningPolicy: "INVITE_ONLY",
    members: [
      {
        membership_id: "00000000-0000-4000-8000-000000000003",
        user_id: "00000000-0000-4000-8000-000000000002",
        role: "OWNER",
        status: "ACTIVE",
        email: "admin@uptechlab.online",
        full_name: "Quản trị viên Tổ chức (OWNER)",
        picture_url: null,
        hosted_domain: "uptechlab.online",
        department: "Công nghệ & Quản trị Tri thức (IT)",
        org_unit_path: "/Ban Điều Hành",
        google_is_admin: true,
        active_session_count: 1,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ],
    invites: [],
    mappings: [
      {
        mapping_id: "00000000-0000-4000-8000-000000000101",
        source_kind: "DEPARTMENT",
        source_value: "Engineering",
        target_role: "MEMBER",
        target_department_key: "IT",
        status: "ACTIVE",
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        mapping_id: "00000000-0000-4000-8000-000000000102",
        source_kind: "DEPARTMENT",
        source_value: "Human Resources",
        target_role: "MEMBER",
        target_department_key: "HR",
        status: "ACTIVE",
        created_at: nowIso,
        updated_at: nowIso,
      },
    ],
    settings: {
      workspace_id: workspaceId,
      organization_name: "UPTECH Knowledge Enterprise (uptechlab.online)",
      default_locale: "vi",
      retention_days: 365,
      max_upload_mb: 25,
      allow_member_uploads: true,
      require_verified_cards_in_chat: false,
      pii_redaction_enabled: true,
      audit_export_enabled: true,
      updated_at: nowIso,
    },
    billing: {
      workspace_id: workspaceId,
      plan_code: "ENTERPRISE",
      billing_cycle: "ANNUAL",
      seat_limit: 1000,
      storage_limit_mb: 204800,
      monthly_ai_turn_limit: 100000,
      billing_contact_email: "admin@uptechlab.online",
      company_legal_name: "Công ty Cổ phần Công nghệ UPTECH",
      tax_id: "0318000000",
      updated_at: nowIso,
    },
    auditEvents: [
      {
        event_id: "00000000-0000-4000-8000-000000000901",
        actor_kind: "USER",
        actor_id: "00000000-0000-4000-8000-000000000002",
        actor_email: "admin@uptechlab.online",
        actor_name: "Quản trị viên Tổ chức (OWNER)",
        action: "WORKSPACE_BOOTSTRAP_COMPLETED",
        target_type: "WORKSPACE",
        target_id: workspaceId,
        outcome: "SUCCEEDED",
        request_id: "00000000-0000-4000-8000-000000000999",
        metadata: { domain: "uptechlab.online", policy: "INVITE_ONLY" },
        occurred_at: nowIso,
      },
    ],
  };

  try {
    const raw = await readFile(PREVIEW_ADMIN_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<PreviewAdminState>;
    return {
      provisioningPolicy: parsed.provisioningPolicy ?? defaults.provisioningPolicy,
      members: Array.isArray(parsed.members) ? parsed.members : defaults.members,
      invites: Array.isArray(parsed.invites) ? parsed.invites : defaults.invites,
      mappings: Array.isArray(parsed.mappings) ? parsed.mappings : defaults.mappings,
      settings: parsed.settings ? { ...defaults.settings, ...parsed.settings } : defaults.settings,
      billing: parsed.billing ? { ...defaults.billing, ...parsed.billing } : defaults.billing,
      auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : defaults.auditEvents,
    };
  } catch {
    return defaults;
  }
}

async function savePreviewAdminState(state: PreviewAdminState): Promise<void> {
  try {
    await mkdir(resolve(process.cwd(), ".uptech-data"), { recursive: true });
    await writeFile(PREVIEW_ADMIN_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Ignore write failure
  }
}

function createPreviewAdminClient(admin: AdminApiContext): DatabaseClient {
  const previewAccess = getPreviewWorkspaceContext();
  return {
    release() {},
    async query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<{ readonly rows: readonly R[]; readonly rowCount: number | null }> {
      const sql = text.trim();
      const state = await loadPreviewAdminState(admin.workspaceId);
      const nowIso = new Date().toISOString();

      if (sql.includes("admin_get_workspace_overview_v1()")) {
        const [{ spaces, documents }, cards, sessions] = await Promise.all([
          loadKnowledgeDocumentsAndSpaces(previewAccess),
          listKnowledgeCards(previewAccess),
          listPersistedChatSessions(previewAccess),
        ]);
        const readyDocs = documents.filter((d) => d.summary.processing.kind === "ready");
        const chunkCount = documents.reduce((acc, d) => acc + d.chunks.length, 0);
        const storageBytes = documents.reduce((acc, d) => acc + (d.byteSize || 0), 0);
        const aiTurns = sessions.reduce((acc, s) => acc + s.turns.length, 0);
        const activeMembers = state.members.filter((m) => m.status === "ACTIVE");
        const adminMembers = activeMembers.filter(
          (m) => m.role === "OWNER" || m.role === "ADMIN",
        );
        const pendingInvites = state.invites.filter((i) => i.status === "PENDING");

        const row = {
          workspace_id: admin.workspaceId,
          workspace_status: "ACTIVE",
          provisioning_policy: state.provisioningPolicy,
          google_customer_id: "C03uptech01",
          created_at: nowIso,
          updated_at: nowIso,
          caller_role: admin.role,
          active_member_count: activeMembers.length,
          admin_member_count: adminMembers.length,
          pending_invite_count: pendingInvites.length,
          pending_access_request_count: 0,
          active_session_count: 1,
          space_count: spaces.length,
          document_count: documents.length,
          ready_document_count: readyDocs.length,
          chunk_count: chunkCount,
          storage_bytes: storageBytes,
          knowledge_card_count: cards.length,
          ai_turns_30d: aiTurns,
          domains_json: [
            {
              domain: "uptechlab.online",
              status: "VERIFIED",
              domainKind: "PRIMARY",
              verifiedAt: nowIso,
            },
          ],
        };
        return { rows: [row as unknown as R], rowCount: 1 };
      }

      if (sql.includes("admin_get_knowledge_analytics_v1()")) {
        const [{ documents }, cards, sessions] = await Promise.all([
          loadKnowledgeDocumentsAndSpaces(previewAccess),
          listKnowledgeCards(previewAccess),
          listPersistedChatSessions(previewAccess),
        ]);
        const allTurns = sessions.flatMap((s) => s.turns);
        const grounded = allTurns.filter((t) => t.evidenceState === "grounded").length;
        const caution = allTurns.filter((t) => t.evidenceState === "caution").length;
        const empty = allTurns.filter((t) => t.evidenceState === "empty").length;
        const up = allTurns.filter((t) => t.feedback === "up").length;
        const down = allTurns.filter((t) => t.feedback === "down").length;

        const gapTurns = allTurns
          .filter((t) => t.evidenceState === "empty" || t.feedback === "down")
          .slice(0, 8)
          .map((t) => ({
            prompt: t.prompt,
            scope: t.scope,
            evidenceState: t.evidenceState,
            feedback: t.feedback,
            askCount: 1,
            lastAskedAt: nowIso,
          }));

        const citationCounts = new Map<string, number>();
        for (const t of allTurns) {
          for (const c of t.citations) {
            citationCounts.set(c.id, (citationCounts.get(c.id) ?? 0) + 1);
          }
        }
        const topCitedDocs = documents
          .map((d) => ({
            documentId: d.summary.id,
            title: d.summary.name,
            spaceName: d.summary.space.name,
            citationCount: citationCounts.get(d.summary.id) ?? d.chunks.length,
          }))
          .sort((a, b) => b.citationCount - a.citationCount)
          .slice(0, 6);

        const row = {
          turns_30d: allTurns.length,
          grounded_turns_30d: grounded,
          caution_turns_30d: caution,
          empty_turns_30d: empty,
          positive_feedback_30d: up,
          negative_feedback_30d: down,
          verified_cards_count: cards.filter((c) => c.status === "verified").length,
          draft_cards_count: cards.filter((c) => c.status === "draft").length,
          content_gaps_json: gapTurns,
          top_cited_docs_json: topCitedDocs,
        };
        return { rows: [row as unknown as R], rowCount: 1 };
      }

      if (sql.includes("admin_list_members_v1()")) {
        return { rows: state.members as unknown as R[], rowCount: state.members.length };
      }

      if (sql.includes("FROM uptech.workspace_member_invites")) {
        return { rows: state.invites as unknown as R[], rowCount: state.invites.length };
      }

      if (sql.includes("admin_invite_member_v1(")) {
        const email = String(values[0] ?? "").toLowerCase();
        const role = String(values[1] ?? "MEMBER");
        const dept = values[2] ? String(values[2]) : null;
        const note = values[3] ? String(values[3]) : null;
        const id = randomUUID();
        const expiresAt = new Date(Date.now() + 14 * 86400_000).toISOString();
        const inv = {
          id,
          invite_id: id,
          normalized_email: email,
          role,
          department_key: dept,
          status: "PENDING",
          note,
          provisioned_immediately: false,
          created_at: nowIso,
          expires_at: expiresAt,
          accepted_at: null,
        };
        state.invites = [inv, ...state.invites];
        await savePreviewAdminState(state);
        return { rows: [inv as unknown as R], rowCount: 1 };
      }

      if (sql.includes("UPDATE uptech.workspace_member_invites")) {
        const targetId = String(values[1] ?? "");
        const matched = state.invites.find((i) => i.id === targetId);
        if (!matched) return { rows: [], rowCount: 0 };
        matched.status = "REVOKED";
        await savePreviewAdminState(state);
        return { rows: [matched as unknown as R], rowCount: 1 };
      }

      if (sql.includes("admin_update_member_v1(")) {
        const membershipId = String(values[0] ?? "");
        const nextRole = values[1] ? String(values[1]) : null;
        const nextStatus = values[2] ? String(values[2]) : null;
        const member = state.members.find((m) => m.membership_id === membershipId);
        if (member) {
          if (nextRole) member.role = nextRole;
          if (nextStatus) member.status = nextStatus;
          member.updated_at = nowIso;
          await savePreviewAdminState(state);
          return { rows: [member as unknown as R], rowCount: 1 };
        }
        throw Object.assign(new Error("member not found"), { code: "P0002" });
      }

      if (sql.includes("admin_list_access_requests_v1()")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("admin_list_directory_groups_v1()")) {
        const groups = [
          { google_group_id: "grp-admins", group_name: "admins@uptechlab.online", member_count: 2 },
          { google_group_id: "grp-eng", group_name: "engineering@uptechlab.online", member_count: 14 },
          { google_group_id: "grp-hr", group_name: "hr@uptechlab.online", member_count: 5 },
        ];
        return { rows: groups as unknown as R[], rowCount: groups.length };
      }

      if (sql.includes("admin_list_directory_org_units_v1()")) {
        const ous = [
          { google_org_unit_id: "ou-root", org_unit_path: "/", parent_org_unit_id: null },
          { google_org_unit_id: "ou-eng", org_unit_path: "/Khối Công Nghệ", parent_org_unit_id: "ou-root" },
          { google_org_unit_id: "ou-hr", org_unit_path: "/Khối Nhân Sự & Vận Hành", parent_org_unit_id: "ou-root" },
        ];
        return { rows: ous as unknown as R[], rowCount: ous.length };
      }

      if (sql.includes("admin_list_permission_mappings_v1()")) {
        return { rows: state.mappings as unknown as R[], rowCount: state.mappings.length };
      }

      if (sql.includes("admin_upsert_permission_mapping_v1(")) {
        const sourceKind = String(values[0] ?? "DEPARTMENT");
        const sourceValue = String(values[1] ?? "");
        const targetDept = values[2] ? String(values[2]) : null;
        const status = String(values[3] ?? "ACTIVE");
        const mapping = {
          mapping_id: randomUUID(),
          source_kind: sourceKind,
          source_value: sourceValue,
          target_role: sourceKind === "ADMIN_GROUP" ? "ADMIN" : "MEMBER",
          target_department_key: sourceKind === "ADMIN_GROUP" ? null : targetDept,
          status,
          created_at: nowIso,
          updated_at: nowIso,
        };
        state.mappings = [
          mapping,
          ...state.mappings.filter(
            (m) => !(m.source_kind === sourceKind && m.source_value === sourceValue),
          ),
        ];
        await savePreviewAdminState(state);
        return { rows: [mapping as unknown as R], rowCount: 1 };
      }

      if (sql.includes("admin_delete_permission_mapping_v1(")) {
        const id = String(values[0] ?? "");
        state.mappings = state.mappings.filter((m) => m.mapping_id !== id);
        await savePreviewAdminState(state);
        return {
          rows: [{ admin_delete_permission_mapping_v1: true } as unknown as R],
          rowCount: 1,
        };
      }

      if (sql.includes("admin_list_connectors_v1()")) {
        const conn = {
          connector_id: "00000000-0000-4000-8000-000000000501",
          purpose: "DIRECTORY",
          status: "ACTIVE",
          provider_customer_id: "C03uptech01",
          authorized_scopes: [
            "https://www.googleapis.com/auth/admin.directory.user.readonly",
            "https://www.googleapis.com/auth/admin.directory.group.readonly",
            "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
            "https://www.googleapis.com/auth/admin.directory.domain.readonly",
          ],
          has_credential: true,
          created_at: nowIso,
          updated_at: nowIso,
          latest_generation_status: "ACTIVE",
          latest_generation_completed_at: nowIso,
          latest_generation_fresh_until: new Date(Date.now() + 86400_000).toISOString(),
          synced_user_count: state.members.length,
          synced_group_count: 3,
        };
        return { rows: [conn as unknown as R], rowCount: 1 };
      }

      if (sql.includes("admin_list_sync_jobs_v1(")) {
        const job = {
          job_id: "00000000-0000-4000-8000-000000000601",
          connector_id: "00000000-0000-4000-8000-000000000501",
          job_kind: "GOOGLE_DIRECTORY_SYNC",
          status: "SUCCEEDED",
          attempt_count: 1,
          max_attempts: 5,
          last_error_code: null,
          created_at: nowIso,
          completed_at: nowIso,
        };
        return { rows: [job as unknown as R], rowCount: 1 };
      }

      if (sql.includes("admin_list_audit_events_v1(")) {
        return {
          rows: state.auditEvents as unknown as R[],
          rowCount: state.auditEvents.length,
        };
      }

      if (sql.includes("admin_write_audit_event_v1(")) {
        const evt = {
          event_id: randomUUID(),
          actor_kind: "USER",
          actor_id: admin.actorId,
          actor_email: "admin@uptechlab.online",
          actor_name: "Quản trị viên Tổ chức (OWNER)",
          action: String(values[0] ?? "ADMIN_ACTION"),
          target_type: String(values[1] ?? "WORKSPACE"),
          target_id: values[2] ? String(values[2]) : admin.workspaceId,
          outcome: String(values[3] ?? "SUCCEEDED"),
          request_id: String(values[4] ?? admin.requestId),
          metadata:
            typeof values[5] === "string"
              ? (JSON.parse(values[5]) as Record<string, unknown>)
              : {},
          occurred_at: nowIso,
        };
        state.auditEvents = [evt, ...state.auditEvents].slice(0, 100);
        await savePreviewAdminState(state);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("INSERT INTO uptech.workspace_settings")) {
        state.settings = {
          ...state.settings,
          organization_name: String(values[1] ?? state.settings.organization_name),
          default_locale: String(values[2] ?? "vi"),
          retention_days: Number(values[3] ?? 365),
          max_upload_mb: Number(values[4] ?? 25),
          allow_member_uploads: Boolean(values[5]),
          require_verified_cards_in_chat: Boolean(values[6]),
          audit_export_enabled: Boolean(values[7]),
          updated_at: nowIso,
        };
        await savePreviewAdminState(state);
        return { rows: [state.settings as unknown as R], rowCount: 1 };
      }

      if (sql.includes("FROM uptech.workspace_settings")) {
        return { rows: [state.settings as unknown as R], rowCount: 1 };
      }

      if (sql.includes("admin_update_provisioning_policy_v1(")) {
        const pol = String(values[0] ?? "INVITE_ONLY");
        state.provisioningPolicy =
          pol === "GOOGLE_GROUP_CONTROLLED"
            ? "GOOGLE_GROUP_CONTROLLED"
            : pol === "DOMAIN_AUTO_PROVISION"
              ? "DOMAIN_AUTO_PROVISION"
              : "INVITE_ONLY";
        await savePreviewAdminState(state);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("INSERT INTO uptech.workspace_billing_profiles")) {
        state.billing = {
          ...state.billing,
          plan_code: String(values[1] ?? "ENTERPRISE"),
          billing_cycle: String(values[2] ?? "ANNUAL"),
          seat_limit: Number(values[3] ?? 1000),
          storage_limit_mb: Number(values[4] ?? 204800),
          monthly_ai_turn_limit: Number(values[5] ?? 100000),
          billing_contact_email: values[6] ? String(values[6]) : null,
          company_legal_name: values[7] ? String(values[7]) : null,
          tax_id: values[8] ? String(values[8]) : null,
          updated_at: nowIso,
        };
        await savePreviewAdminState(state);
        return { rows: [state.billing as unknown as R], rowCount: 1 };
      }

      if (sql.includes("FROM uptech.workspace_billing_profiles")) {
        return { rows: [state.billing as unknown as R], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  } as unknown as DatabaseClient;
}

async function runAdminTx<T>(
  admin: AdminApiContext,
  work: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  if (admin.isPreviewMode) {
    return work(createPreviewAdminClient(admin));
  }
  return withRequestTransaction(
    requestTransactionContextFromSession(
      admin.session.context,
      admin.session.credentialHash,
    ),
    work,
    admin.pool,
  );
}

function parseOverviewRow(row: Record<string, unknown>): AdminWorkspaceOverview {
  const rawDomains = Array.isArray(row.domains_json) ? row.domains_json : [];
  const domains: AdminDomainRecord[] = rawDomains
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      domain: String(item.domain ?? ""),
      status: String(item.status ?? "VERIFIED"),
      domainKind: String(item.domainKind ?? "PRIMARY"),
      verifiedAt: toNullableIso(item.verifiedAt),
    }))
    .filter((item) => item.domain.length > 0);

  return {
    workspaceId: String(row.workspace_id),
    workspaceStatus: String(row.workspace_status ?? "ACTIVE"),
    provisioningPolicy:
      row.provisioning_policy === "GOOGLE_GROUP_CONTROLLED"
        ? "GOOGLE_GROUP_CONTROLLED"
        : row.provisioning_policy === "DOMAIN_AUTO_PROVISION"
          ? "DOMAIN_AUTO_PROVISION"
          : "INVITE_ONLY",
    googleCustomerId: toNullableString(row.google_customer_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    callerRole: row.caller_role === "OWNER" ? "OWNER" : "ADMIN",
    activeMemberCount: Number(row.active_member_count ?? 0),
    adminMemberCount: Number(row.admin_member_count ?? 0),
    pendingInviteCount: Number(row.pending_invite_count ?? 0),
    pendingAccessRequestCount: Number(row.pending_access_request_count ?? 0),
    activeSessionCount: Number(row.active_session_count ?? 0),
    spaceCount: Number(row.space_count ?? 0),
    documentCount: Number(row.document_count ?? 0),
    readyDocumentCount: Number(row.ready_document_count ?? 0),
    chunkCount: Number(row.chunk_count ?? 0),
    storageBytes: Number(row.storage_bytes ?? 0),
    knowledgeCardCount: Number(row.knowledge_card_count ?? 0),
    aiTurns30d: Number(row.ai_turns_30d ?? 0),
    domains,
  };
}

async function queryOverviewInTx(client: DatabaseClient): Promise<AdminWorkspaceOverview> {
  const res = await client.query<Record<string, unknown>>(
    "SELECT * FROM uptech.admin_get_workspace_overview_v1()",
  );
  if (res.rows.length !== 1) {
    throw Object.assign(new Error("workspace overview not found"), { code: "P0002" });
  }
  return parseOverviewRow(res.rows[0]);
}

function defaultOrgName(domains: readonly AdminDomainRecord[]): string {
  const primary = domains[0]?.domain;
  if (!primary) return "UPTECH Workspace";
  const base = primary.split(".")[0] ?? primary;
  return base.length > 0
    ? `${base.charAt(0).toUpperCase()}${base.slice(1)} (${primary})`
    : primary;
}

export async function getAdminShellMetadata(
  admin: AdminApiContext,
): Promise<AdminShellMetadata> {
  try {
    return await runAdminTx(admin, async (client) => {
      const overview = await queryOverviewInTx(client);
      const settingsRes = await client.query<Record<string, unknown>>(
        `SELECT organization_name
         FROM uptech.workspace_settings
         WHERE workspace_id = $1`,
        [admin.workspaceId],
      );
      const savedOrgName = toNullableString(settingsRes.rows[0]?.organization_name);
      return {
        organizationName: savedOrgName ?? defaultOrgName(overview.domains),
        primaryDomain: overview.domains[0]?.domain ?? null,
        callerRole: overview.callerRole,
        provisioningPolicy: overview.provisioningPolicy,
        activeMemberCount: overview.activeMemberCount,
        pendingAccessRequestCount: overview.pendingAccessRequestCount,
      };
    });
  } catch {
    return {
      organizationName: "UPTECH Workspace",
      primaryDomain: null,
      callerRole: admin.role,
      provisioningPolicy: "INVITE_ONLY",
      activeMemberCount: 0,
      pendingAccessRequestCount: 0,
    };
  }
}

export async function loadAdminUsersBundle(admin: AdminApiContext): Promise<{
  readonly overview: AdminWorkspaceOverview;
  readonly members: readonly AdminMemberRecord[];
  readonly invites: readonly AdminInviteRecord[];
  readonly accessRequests: readonly AdminAccessRequestRecord[];
  readonly groups: readonly AdminDirectoryGroupRecord[];
  readonly orgUnits: readonly AdminDirectoryOrgUnitRecord[];
}> {
  return runAdminTx(admin, async (client) => {
    const overview = await queryOverviewInTx(client);
    const membersRes = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_list_members_v1()",
    );
    const invitesRes = await client.query<Record<string, unknown>>(
      `SELECT id, normalized_email, role, department_key, status, note,
              created_at, expires_at, accepted_at
       FROM uptech.workspace_member_invites
       WHERE workspace_id = $1
       ORDER BY
         CASE status WHEN 'PENDING' THEN 0 WHEN 'ACCEPTED' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 100`,
      [admin.workspaceId],
    );
    const requestsRes = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_list_access_requests_v1()",
    );
    const groupsRes = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_list_directory_groups_v1()",
    );
    const orgUnitsRes = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_list_directory_org_units_v1()",
    );

    const members: AdminMemberRecord[] = membersRes.rows.map((row) => ({
      membershipId: String(row.membership_id),
      userId: String(row.user_id),
      role:
        row.role === "OWNER" ? "OWNER" : row.role === "ADMIN" ? "ADMIN" : "MEMBER",
      status:
        row.status === "ACTIVE"
          ? "ACTIVE"
          : row.status === "SUSPENDED"
            ? "SUSPENDED"
            : row.status === "DEPROVISIONED"
              ? "DEPROVISIONED"
              : "PENDING",
      email: toNullableString(row.email),
      fullName: toNullableString(row.full_name),
      pictureUrl: toNullableString(row.picture_url),
      hostedDomain: toNullableString(row.hosted_domain),
      department: toNullableString(row.department),
      orgUnitPath: toNullableString(row.org_unit_path),
      googleIsAdmin:
        typeof row.google_is_admin === "boolean" ? row.google_is_admin : null,
      activeSessionCount: Number(row.active_session_count ?? 0),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    }));

    const nowMs = Date.now();
    const invites: AdminInviteRecord[] = invitesRes.rows.map((row) => {
      const expiresAt = toIso(row.expires_at);
      const rawStatus = String(row.status);
      const effectiveStatus =
        rawStatus === "PENDING" && Date.parse(expiresAt) <= nowMs
          ? "EXPIRED"
          : rawStatus === "ACCEPTED"
            ? "ACCEPTED"
            : rawStatus === "REVOKED"
              ? "REVOKED"
              : rawStatus === "EXPIRED"
                ? "EXPIRED"
                : "PENDING";
      return {
        id: String(row.id),
        email: String(row.normalized_email),
        role: row.role === "ADMIN" ? "ADMIN" : "MEMBER",
        departmentKey: toNullableString(row.department_key),
        status: effectiveStatus,
        note: toNullableString(row.note),
        createdAt: toIso(row.created_at),
        expiresAt,
        acceptedAt: toNullableIso(row.accepted_at),
      };
    });

    const accessRequests: AdminAccessRequestRecord[] = requestsRes.rows.map((row) => ({
      requestRowId: String(row.request_row_id),
      identityId: String(row.identity_id),
      email: toNullableString(row.email),
      fullName: toNullableString(row.full_name),
      reasonClass: String(row.reason_class),
      status:
        row.status === "FULFILLED"
          ? "FULFILLED"
          : row.status === "CANCELLED"
            ? "CANCELLED"
            : "PENDING",
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    }));

    const groups: AdminDirectoryGroupRecord[] = groupsRes.rows.map((row) => ({
      googleGroupId: String(row.google_group_id),
      groupName: String(row.group_name),
      memberCount: Number(row.member_count ?? 0),
    }));

    const orgUnits: AdminDirectoryOrgUnitRecord[] = orgUnitsRes.rows.map((row) => ({
      googleOrgUnitId: String(row.google_org_unit_id),
      orgUnitPath: String(row.org_unit_path),
      parentOrgUnitId: toNullableString(row.parent_org_unit_id),
    }));

    return { overview, members, invites, accessRequests, groups, orgUnits };
  });
}

export async function inviteWorkspaceMember(
  admin: AdminApiContext,
  input: Readonly<{
    email: string;
    role: "ADMIN" | "MEMBER";
    departmentKey: string | null;
    note: string | null;
  }>,
): Promise<{
  readonly inviteId: string;
  readonly email: string;
  readonly role: "ADMIN" | "MEMBER";
  readonly departmentKey: string | null;
  readonly status: string;
  readonly provisionedImmediately: boolean;
  readonly expiresAt: string;
}> {
  return runAdminTx(admin, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_invite_member_v1($1, $2, $3, $4, $5::uuid)",
      [
        input.email,
        input.role,
        input.departmentKey,
        input.note,
        admin.requestId,
      ],
    );
    const row = res.rows[0];
    return {
      inviteId: String(row.invite_id),
      email: String(row.normalized_email),
      role: row.role === "ADMIN" ? "ADMIN" : "MEMBER",
      departmentKey: toNullableString(row.department_key),
      status: String(row.status),
      provisionedImmediately: row.provisioned_immediately === true,
      expiresAt: toIso(row.expires_at),
    };
  });
}

export async function revokeWorkspaceInvite(
  admin: AdminApiContext,
  inviteId: string,
): Promise<boolean> {
  return runAdminTx(admin, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `UPDATE uptech.workspace_member_invites
       SET status = 'REVOKED', revoked_at = clock_timestamp()
       WHERE workspace_id = $1 AND id = $2::uuid AND status = 'PENDING'
       RETURNING id, normalized_email`,
      [admin.workspaceId, inviteId],
    );
    if (res.rows.length === 0) return false;
    await client.query(
      "SELECT uptech.admin_write_audit_event_v1($1, $2, $3::uuid, $4, $5::uuid, $6::jsonb)",
      [
        "ADMIN_INVITE_REVOKED",
        "WORKSPACE_INVITE",
        inviteId,
        "SUCCEEDED",
        admin.requestId,
        JSON.stringify({ email: String(res.rows[0].normalized_email) }),
      ],
    );
    return true;
  });
}

export async function updateWorkspaceMember(
  admin: AdminApiContext,
  input: Readonly<{
    membershipId: string;
    role?: string;
    status?: string;
  }>,
): Promise<{
  readonly membershipId: string;
  readonly role: string;
  readonly status: string;
  readonly updatedAt: string;
}> {
  return runAdminTx(admin, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_update_member_v1($1::uuid, $2, $3, $4::uuid)",
      [
        input.membershipId,
        input.role ?? null,
        input.status ?? null,
        admin.requestId,
      ],
    );
    const row = res.rows[0];
    return {
      membershipId: String(row.membership_id),
      role: String(row.role),
      status: String(row.status),
      updatedAt: toIso(row.updated_at),
    };
  });
}

export async function resolveAccessRequest(
  admin: AdminApiContext,
  input: Readonly<{
    requestRowId: string;
    decision: "APPROVE" | "REJECT";
    role?: "ADMIN" | "MEMBER";
  }>,
): Promise<{
  readonly requestRowId: string;
  readonly status: string;
  readonly membershipCreated: boolean;
}> {
  return runAdminTx(admin, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_resolve_access_request_v1($1::uuid, $2, $3, $4::uuid)",
      [
        input.requestRowId,
        input.decision,
        input.role ?? "MEMBER",
        admin.requestId,
      ],
    );
    const row = res.rows[0];
    return {
      requestRowId: String(row.request_row_id),
      status: String(row.status),
      membershipCreated: row.membership_created === true,
    };
  });
}

export async function loadAdminPermissionsBundle(admin: AdminApiContext): Promise<{
  readonly overview: AdminWorkspaceOverview;
  readonly mappings: readonly AdminPermissionMappingRecord[];
  readonly groups: readonly AdminDirectoryGroupRecord[];
  readonly orgUnits: readonly AdminDirectoryOrgUnitRecord[];
}> {
  return runAdminTx(admin, async (client) => {
    const overview = await queryOverviewInTx(client);
    const mappingsRes = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_list_permission_mappings_v1()",
    );
    const groupsRes = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_list_directory_groups_v1()",
    );
    const orgUnitsRes = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_list_directory_org_units_v1()",
    );

    const mappings: AdminPermissionMappingRecord[] = mappingsRes.rows.map((row) => ({
      mappingId: String(row.mapping_id),
      sourceKind: row.source_kind as AdminPermissionMappingRecord["sourceKind"],
      sourceValue: String(row.source_value),
      targetRole: row.target_role === "ADMIN" ? "ADMIN" : "MEMBER",
      targetDepartmentKey:
        (toNullableString(row.target_department_key) as AdminPermissionMappingRecord["targetDepartmentKey"]) ??
        null,
      status: row.status === "DISABLED" ? "DISABLED" : "ACTIVE",
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    }));

    const groups: AdminDirectoryGroupRecord[] = groupsRes.rows.map((row) => ({
      googleGroupId: String(row.google_group_id),
      groupName: String(row.group_name),
      memberCount: Number(row.member_count ?? 0),
    }));

    const orgUnits: AdminDirectoryOrgUnitRecord[] = orgUnitsRes.rows.map((row) => ({
      googleOrgUnitId: String(row.google_org_unit_id),
      orgUnitPath: String(row.org_unit_path),
      parentOrgUnitId: toNullableString(row.parent_org_unit_id),
    }));

    return { overview, mappings, groups, orgUnits };
  });
}

export async function upsertPermissionMapping(
  admin: AdminApiContext,
  input: Readonly<{
    sourceKind: string;
    sourceValue: string;
    targetDepartmentKey: string | null;
    status?: string;
  }>,
): Promise<AdminPermissionMappingRecord> {
  return runAdminTx(admin, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_upsert_permission_mapping_v1($1, $2, $3, $4, $5::uuid)",
      [
        input.sourceKind,
        input.sourceValue,
        input.targetDepartmentKey,
        input.status ?? "ACTIVE",
        admin.requestId,
      ],
    );
    const row = res.rows[0];
    const nowIso = new Date().toISOString();
    return {
      mappingId: String(row.mapping_id),
      sourceKind: row.source_kind as AdminPermissionMappingRecord["sourceKind"],
      sourceValue: String(row.source_value),
      targetRole: row.target_role === "ADMIN" ? "ADMIN" : "MEMBER",
      targetDepartmentKey:
        (toNullableString(row.target_department_key) as AdminPermissionMappingRecord["targetDepartmentKey"]) ??
        null,
      status: row.status === "DISABLED" ? "DISABLED" : "ACTIVE",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });
}

export async function deletePermissionMapping(
  admin: AdminApiContext,
  mappingId: string,
): Promise<boolean> {
  return runAdminTx(admin, async (client) => {
    const res = await client.query<{ admin_delete_permission_mapping_v1: boolean }>(
      "SELECT uptech.admin_delete_permission_mapping_v1($1::uuid, $2::uuid)",
      [mappingId, admin.requestId],
    );
    return res.rows[0]?.admin_delete_permission_mapping_v1 === true;
  });
}

export async function loadAdminConnectorsBundle(admin: AdminApiContext): Promise<{
  readonly overview: AdminWorkspaceOverview;
  readonly connectors: readonly AdminConnectorRecord[];
  readonly syncJobs: readonly AdminSyncJobRecord[];
  readonly directoryInfraReady: boolean;
}> {
  const directoryInfraReady = Boolean(
    process.env.UPTECH_GCP_SECRET_MANAGER_PROJECT_ID?.trim() &&
      process.env.UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER?.trim() &&
      process.env.UPTECH_GCP_SECRET_MANAGER_SERVICE_ACCOUNT_EMAIL?.trim(),
  );

  return runAdminTx(admin, async (client) => {
    const overview = await queryOverviewInTx(client);
    const connectorsRes = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_list_connectors_v1()",
    );
    const jobsRes = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_list_sync_jobs_v1(30)",
    );

    const connectors: AdminConnectorRecord[] = connectorsRes.rows.map((row) => ({
      connectorId: String(row.connector_id),
      purpose: row.purpose === "DRIVE" ? "DRIVE" : "DIRECTORY",
      status: String(row.status),
      providerCustomerId: toNullableString(row.provider_customer_id),
      authorizedScopes: Array.isArray(row.authorized_scopes)
        ? row.authorized_scopes.map(String)
        : [],
      hasCredential: row.has_credential === true,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      latestGenerationStatus: toNullableString(row.latest_generation_status),
      latestGenerationCompletedAt: toNullableIso(row.latest_generation_completed_at),
      latestGenerationFreshUntil: toNullableIso(row.latest_generation_fresh_until),
      syncedUserCount: Number(row.synced_user_count ?? 0),
      syncedGroupCount: Number(row.synced_group_count ?? 0),
    }));

    const syncJobs: AdminSyncJobRecord[] = jobsRes.rows.map((row) => ({
      jobId: String(row.job_id),
      connectorId: String(row.connector_id),
      jobKind: String(row.job_kind),
      status: String(row.status),
      attemptCount: Number(row.attempt_count ?? 0),
      maxAttempts: Number(row.max_attempts ?? 0),
      lastErrorCode: toNullableString(row.last_error_code),
      createdAt: toIso(row.created_at),
      completedAt: toNullableIso(row.completed_at),
    }));

    return { overview, connectors, syncJobs, directoryInfraReady };
  });
}

export async function loadAdminAuditEvents(
  admin: AdminApiContext,
  options: Readonly<{ limit?: number; outcome?: string | null; search?: string | null }> = {},
): Promise<{
  readonly overview: AdminWorkspaceOverview;
  readonly events: readonly AdminAuditEventRecord[];
  readonly auditExportEnabled: boolean;
}> {
  return runAdminTx(admin, async (client) => {
    const overview = await queryOverviewInTx(client);
    const eventsRes = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_list_audit_events_v1($1::integer, $2, $3)",
      [options.limit ?? 100, options.outcome ?? null, options.search ?? null],
    );
    const settingsRes = await client.query<Record<string, unknown>>(
      "SELECT audit_export_enabled FROM uptech.workspace_settings WHERE workspace_id = $1",
      [admin.workspaceId],
    );

    const events: AdminAuditEventRecord[] = eventsRes.rows.map((row) => ({
      eventId: String(row.event_id),
      actorKind: String(row.actor_kind),
      actorId: toNullableString(row.actor_id),
      actorEmail: toNullableString(row.actor_email),
      actorName: toNullableString(row.actor_name),
      action: String(row.action),
      targetType: String(row.target_type),
      targetId: toNullableString(row.target_id),
      outcome:
        row.outcome === "DENIED"
          ? "DENIED"
          : row.outcome === "FAILED"
            ? "FAILED"
            : "SUCCEEDED",
      requestId: String(row.request_id),
      metadata:
        typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {},
      occurredAt: toIso(row.occurred_at),
    }));

    const auditExportEnabled =
      settingsRes.rows.length === 0
        ? true
        : settingsRes.rows[0].audit_export_enabled !== false;

    return { overview, events, auditExportEnabled };
  });
}

export async function recordAuditExportEvent(
  admin: AdminApiContext,
  rowCount: number,
): Promise<void> {
  await runAdminTx(admin, async (client) => {
    await client.query(
      "SELECT uptech.admin_write_audit_event_v1($1, $2, $3::uuid, $4, $5::uuid, $6::jsonb)",
      [
        "ADMIN_AUDIT_LOGS_EXPORTED",
        "WORKSPACE",
        admin.workspaceId,
        "SUCCEEDED",
        admin.requestId,
        JSON.stringify({ format: "csv", exported_rows: rowCount }),
      ],
    );
  });
}

export async function loadAdminSettingsBundle(admin: AdminApiContext): Promise<{
  readonly overview: AdminWorkspaceOverview;
  readonly settings: AdminSettingsRecord;
}> {
  return runAdminTx(admin, async (client) => {
    const overview = await queryOverviewInTx(client);
    const settingsRes = await client.query<Record<string, unknown>>(
      `SELECT organization_name, default_locale, retention_days, max_upload_mb,
              allow_member_uploads, require_verified_cards_in_chat,
              audit_export_enabled, updated_at
       FROM uptech.workspace_settings
       WHERE workspace_id = $1`,
      [admin.workspaceId],
    );

    const row = settingsRes.rows[0];
    const settings: AdminSettingsRecord = row
      ? {
          organizationName: String(row.organization_name),
          defaultLocale: row.default_locale === "en" ? "en" : "vi",
          retentionDays: Number(row.retention_days),
          maxUploadMb: Number(row.max_upload_mb),
          allowMemberUploads: row.allow_member_uploads === true,
          requireVerifiedCardsInChat: row.require_verified_cards_in_chat === true,
          auditExportEnabled: row.audit_export_enabled === true,
          updatedAt: toNullableIso(row.updated_at),
        }
      : {
          organizationName: defaultOrgName(overview.domains),
          defaultLocale: "vi",
          retentionDays: 365,
          maxUploadMb: 25,
          allowMemberUploads: true,
          requireVerifiedCardsInChat: false,
          auditExportEnabled: true,
          updatedAt: null,
        };

    return { overview, settings };
  });
}

export async function saveAdminSettings(
  admin: AdminApiContext,
  input: Readonly<{
    organizationName: string;
    defaultLocale: "vi" | "en";
    retentionDays: number;
    maxUploadMb: number;
    allowMemberUploads: boolean;
    requireVerifiedCardsInChat: boolean;
    auditExportEnabled: boolean;
    provisioningPolicy?: "INVITE_ONLY" | "GOOGLE_GROUP_CONTROLLED";
  }>,
): Promise<{
  readonly overview: AdminWorkspaceOverview;
  readonly settings: AdminSettingsRecord;
}> {
  return runAdminTx(admin, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `INSERT INTO uptech.workspace_settings (
         workspace_id, organization_name, default_locale, retention_days,
         max_upload_mb, allow_member_uploads, require_verified_cards_in_chat,
         audit_export_enabled, updated_by_user_id, created_at, updated_at
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid, clock_timestamp(), clock_timestamp()
       )
       ON CONFLICT (workspace_id)
       DO UPDATE SET
         organization_name = EXCLUDED.organization_name,
         default_locale = EXCLUDED.default_locale,
         retention_days = EXCLUDED.retention_days,
         max_upload_mb = EXCLUDED.max_upload_mb,
         allow_member_uploads = EXCLUDED.allow_member_uploads,
         require_verified_cards_in_chat = EXCLUDED.require_verified_cards_in_chat,
         audit_export_enabled = EXCLUDED.audit_export_enabled,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = clock_timestamp()
       RETURNING organization_name, default_locale, retention_days, max_upload_mb,
                 allow_member_uploads, require_verified_cards_in_chat,
                 audit_export_enabled, updated_at`,
      [
        admin.workspaceId,
        input.organizationName.trim(),
        input.defaultLocale,
        input.retentionDays,
        input.maxUploadMb,
        input.allowMemberUploads,
        input.requireVerifiedCardsInChat,
        input.auditExportEnabled,
        admin.actorId,
      ],
    );

    await client.query(
      "SELECT uptech.admin_write_audit_event_v1($1, $2, $3::uuid, $4, $5::uuid, $6::jsonb)",
      [
        "ADMIN_WORKSPACE_SETTINGS_UPDATED",
        "WORKSPACE_SETTINGS",
        admin.workspaceId,
        "SUCCEEDED",
        admin.requestId,
        JSON.stringify({
          organization_name: input.organizationName.trim(),
          default_locale: input.defaultLocale,
          retention_days: input.retentionDays,
          max_upload_mb: input.maxUploadMb,
          allow_member_uploads: input.allowMemberUploads,
          require_verified_cards_in_chat: input.requireVerifiedCardsInChat,
          audit_export_enabled: input.auditExportEnabled,
        }),
      ],
    );

    if (input.provisioningPolicy) {
      const currentOverview = await queryOverviewInTx(client);
      if (currentOverview.provisioningPolicy !== input.provisioningPolicy) {
        await client.query(
          "SELECT uptech.admin_update_provisioning_policy_v1($1, $2::uuid)",
          [input.provisioningPolicy, admin.requestId],
        );
      }
    }

    const overview = await queryOverviewInTx(client);
    const row = res.rows[0];
    return {
      overview,
      settings: {
        organizationName: String(row.organization_name),
        defaultLocale: row.default_locale === "en" ? "en" : "vi",
        retentionDays: Number(row.retention_days),
        maxUploadMb: Number(row.max_upload_mb),
        allowMemberUploads: row.allow_member_uploads === true,
        requireVerifiedCardsInChat: row.require_verified_cards_in_chat === true,
        auditExportEnabled: row.audit_export_enabled === true,
        updatedAt: toNullableIso(row.updated_at),
      },
    };
  });
}

const PLAN_DEFAULTS: Record<
  AdminBillingProfileRecord["planCode"],
  { seatLimit: number; storageLimitMb: number; monthlyAiTurnLimit: number }
> = {
  STARTER: { seatLimit: 25, storageLimitMb: 5120, monthlyAiTurnLimit: 2000 },
  GROWTH: { seatLimit: 100, storageLimitMb: 25600, monthlyAiTurnLimit: 15000 },
  ENTERPRISE: { seatLimit: 1000, storageLimitMb: 204800, monthlyAiTurnLimit: 100000 },
};

async function queryKnowledgeAnalyticsInTx(
  client: DatabaseClient,
): Promise<AdminKnowledgeAnalyticsRecord> {
  try {
    const res = await client.query<Record<string, unknown>>(
      "SELECT * FROM uptech.admin_get_knowledge_analytics_v1()",
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error("no analytics row");
    }
    const rawGaps = Array.isArray(row.content_gaps_json) ? row.content_gaps_json : [];
    const rawDocs = Array.isArray(row.top_cited_docs_json) ? row.top_cited_docs_json : [];

    return {
      turns30d: Number(row.turns_30d ?? 0),
      groundedTurns30d: Number(row.grounded_turns_30d ?? 0),
      cautionTurns30d: Number(row.caution_turns_30d ?? 0),
      emptyTurns30d: Number(row.empty_turns_30d ?? 0),
      positiveFeedback30d: Number(row.positive_feedback_30d ?? 0),
      negativeFeedback30d: Number(row.negative_feedback_30d ?? 0),
      verifiedCardsCount: Number(row.verified_cards_count ?? 0),
      draftCardsCount: Number(row.draft_cards_count ?? 0),
      contentGaps: rawGaps
        .filter((g): g is Record<string, unknown> => typeof g === "object" && g !== null)
        .map((g) => ({
          prompt: String(g.prompt ?? ""),
          scope: String(g.scope ?? "workspace"),
          evidenceState: String(g.evidenceState ?? "empty"),
          feedback: typeof g.feedback === "string" ? g.feedback : null,
          askCount: Number(g.askCount ?? 1),
          lastAskedAt: toIso(g.lastAskedAt),
        })),
      topCitedDocs: rawDocs
        .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
        .map((d) => ({
          documentId: String(d.documentId ?? ""),
          title: String(d.title ?? ""),
          spaceName: String(d.spaceName ?? ""),
          citationCount: Number(d.citationCount ?? 0),
        })),
    };
  } catch {
    return {
      turns30d: 0,
      groundedTurns30d: 0,
      cautionTurns30d: 0,
      emptyTurns30d: 0,
      positiveFeedback30d: 0,
      negativeFeedback30d: 0,
      verifiedCardsCount: 0,
      draftCardsCount: 0,
      contentGaps: [],
      topCitedDocs: [],
    };
  }
}

export async function loadAdminBillingBundle(admin: AdminApiContext): Promise<{
  readonly overview: AdminWorkspaceOverview;
  readonly billing: AdminBillingProfileRecord;
  readonly analytics: AdminKnowledgeAnalyticsRecord;
}> {
  return runAdminTx(admin, async (client) => {
    const overview = await queryOverviewInTx(client);
    const billingRes = await client.query<Record<string, unknown>>(
      `SELECT plan_code, billing_cycle, seat_limit, storage_limit_mb,
              monthly_ai_turn_limit, billing_contact_email,
              company_legal_name, tax_id, updated_at
       FROM uptech.workspace_billing_profiles
       WHERE workspace_id = $1`,
      [admin.workspaceId],
    );
    const analytics = await queryKnowledgeAnalyticsInTx(client);

    const row = billingRes.rows[0];
    const billing: AdminBillingProfileRecord = row
      ? {
          planCode:
            row.plan_code === "ENTERPRISE"
              ? "ENTERPRISE"
              : row.plan_code === "GROWTH"
                ? "GROWTH"
                : "STARTER",
          billingCycle: row.billing_cycle === "ANNUAL" ? "ANNUAL" : "MONTHLY",
          seatLimit: Number(row.seat_limit),
          storageLimitMb: Number(row.storage_limit_mb),
          monthlyAiTurnLimit: Number(row.monthly_ai_turn_limit),
          billingContactEmail: toNullableString(row.billing_contact_email),
          companyLegalName: toNullableString(row.company_legal_name),
          taxId: toNullableString(row.tax_id),
          updatedAt: toNullableIso(row.updated_at),
        }
      : {
          planCode: "STARTER",
          billingCycle: "MONTHLY",
          ...PLAN_DEFAULTS.STARTER,
          billingContactEmail: null,
          companyLegalName: null,
          taxId: null,
          updatedAt: null,
        };

    return { overview, billing, analytics };
  });
}

export async function saveAdminBillingProfile(
  admin: AdminApiContext,
  input: Readonly<{
    planCode: "STARTER" | "GROWTH" | "ENTERPRISE";
    billingCycle: "MONTHLY" | "ANNUAL";
    billingContactEmail: string | null;
    companyLegalName: string | null;
    taxId: string | null;
  }>,
): Promise<{
  readonly overview: AdminWorkspaceOverview;
  readonly billing: AdminBillingProfileRecord;
}> {
  const quotas = PLAN_DEFAULTS[input.planCode];

  return runAdminTx(admin, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `INSERT INTO uptech.workspace_billing_profiles (
         workspace_id, plan_code, billing_cycle, seat_limit, storage_limit_mb,
         monthly_ai_turn_limit, billing_contact_email, company_legal_name, tax_id,
         updated_by_user_id, created_at, updated_at
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid, clock_timestamp(), clock_timestamp()
       )
       ON CONFLICT (workspace_id)
       DO UPDATE SET
         plan_code = EXCLUDED.plan_code,
         billing_cycle = EXCLUDED.billing_cycle,
         seat_limit = EXCLUDED.seat_limit,
         storage_limit_mb = EXCLUDED.storage_limit_mb,
         monthly_ai_turn_limit = EXCLUDED.monthly_ai_turn_limit,
         billing_contact_email = EXCLUDED.billing_contact_email,
         company_legal_name = EXCLUDED.company_legal_name,
         tax_id = EXCLUDED.tax_id,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = clock_timestamp()
       RETURNING plan_code, billing_cycle, seat_limit, storage_limit_mb,
                 monthly_ai_turn_limit, billing_contact_email,
                 company_legal_name, tax_id, updated_at`,
      [
        admin.workspaceId,
        input.planCode,
        input.billingCycle,
        quotas.seatLimit,
        quotas.storageLimitMb,
        quotas.monthlyAiTurnLimit,
        input.billingContactEmail,
        input.companyLegalName,
        input.taxId,
        admin.actorId,
      ],
    );

    await client.query(
      "SELECT uptech.admin_write_audit_event_v1($1, $2, $3::uuid, $4, $5::uuid, $6::jsonb)",
      [
        "ADMIN_BILLING_PROFILE_UPDATED",
        "WORKSPACE_BILLING",
        admin.workspaceId,
        "SUCCEEDED",
        admin.requestId,
        JSON.stringify({
          plan_code: input.planCode,
          billing_cycle: input.billingCycle,
          has_billing_contact: Boolean(input.billingContactEmail),
          has_tax_id: Boolean(input.taxId),
        }),
      ],
    );

    const overview = await queryOverviewInTx(client);
    const row = res.rows[0];
    return {
      overview,
      billing: {
        planCode:
          row.plan_code === "ENTERPRISE"
            ? "ENTERPRISE"
            : row.plan_code === "GROWTH"
              ? "GROWTH"
              : "STARTER",
        billingCycle: row.billing_cycle === "ANNUAL" ? "ANNUAL" : "MONTHLY",
        seatLimit: Number(row.seat_limit),
        storageLimitMb: Number(row.storage_limit_mb),
        monthlyAiTurnLimit: Number(row.monthly_ai_turn_limit),
        billingContactEmail: toNullableString(row.billing_contact_email),
        companyLegalName: toNullableString(row.company_legal_name),
        taxId: toNullableString(row.tax_id),
        updatedAt: toNullableIso(row.updated_at),
      },
    };
  });
}

export async function sendWorkspaceInviteEmailIfConfigured(input: Readonly<{
  toEmail: string;
  role: "ADMIN" | "MEMBER";
  organizationDomain: string | null;
  loginUrl: string;
  note: string | null;
}>): Promise<"sent" | "skipped"> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail =
    process.env.DEMO_LEAD_FROM_EMAIL?.trim() ||
    (process.env.RESEND_EMAIL_DOMAIN?.trim()
      ? `no-reply@${process.env.RESEND_EMAIL_DOMAIN.trim()}`
      : "");
  if (!apiKey || !fromEmail) {
    return "skipped";
  }

  try {
    const roleLabel = input.role === "ADMIN" ? "Quản trị viên (ADMIN)" : "Thành viên (MEMBER)";
    const orgLabel = input.organizationDomain ?? "UPTECH Knowledge";
    const noteBlock = input.note ? `<p><strong>Ghi chú từ quản trị viên:</strong> ${input.note.replace(/[<>&]/g, "")}</p>` : "";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [input.toEmail],
        subject: `Lời mời tham gia UPTECH Knowledge — ${orgLabel}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
          <h2>Bạn được mời tham gia không gian tri thức ${orgLabel}</h2>
          <p>Quản trị viên tổ chức đã cấp lời mời cho email <strong>${input.toEmail}</strong> với vai trò <strong>${roleLabel}</strong>.</p>
          ${noteBlock}
          <p><a href="${input.loginUrl}" style="display:inline-block;padding:10px 18px;background:#1b44ff;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Đăng nhập bằng Google Workspace</a></p>
          <p style="font-size:12px;color:#64748b">Vui lòng đăng nhập bằng đúng tài khoản Google Workspace của công ty.</p>
        </div>`,
      }),
    });
    return response.ok ? "sent" : "skipped";
  } catch {
    return "skipped";
  }
}
