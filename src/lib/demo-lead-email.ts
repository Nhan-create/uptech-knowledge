import "server-only";

import { Resend } from "resend";

import {
  DEMO_COMPANY_SIZE_LABELS,
  DEMO_COUNTRY_LABELS,
  type DemoLead,
} from "@/lib/demo-lead-validation";

export class DemoEmailError extends Error {
  constructor(readonly kind: "configuration" | "delivery") {
    super("Demo email delivery failed");
    this.name = "DemoEmailError";
  }
}

interface EmailConfiguration {
  apiKey: string;
  from: string;
  owner: string;
}

function getEmailConfiguration(): EmailConfiguration {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.DEMO_LEAD_FROM_EMAIL?.trim();
  const owner = process.env.DEMO_LEAD_TO_EMAIL?.trim();

  if (!apiKey || !from || !owner) {
    throw new DemoEmailError("configuration");
  }

  return { apiKey, from, owner };
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function formatLeadName(lead: DemoLead) {
  return `${lead.lastName} ${lead.firstName}`;
}

function emailFrame(preview: string, title: string, content: string) {
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(preview)}</title>
  </head>
  <body style="margin:0;background:#f4f7fb;color:#15233f;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #dce5f1;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px;background:#102b4e;color:#ffffff;">
                <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.8;">UPTECH KNOWLEDGE</div>
                <h1 style="margin:10px 0 0;font-size:25px;line-height:1.3;">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px;font-size:15px;line-height:1.65;">${content}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function detailRow(label: string, value: string) {
  return `<tr>
    <td style="width:170px;padding:9px 12px 9px 0;color:#60708c;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:9px 0;font-weight:600;vertical-align:top;overflow-wrap:anywhere;">${escapeHtml(value)}</td>
  </tr>`;
}

function leadDetailsHtml(lead: DemoLead) {
  const interest = escapeHtml(lead.interest).replace(/\r?\n/gu, "<br />");

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    ${detailRow("Họ và tên", formatLeadName(lead))}
    ${detailRow("Email công việc", lead.workEmail)}
    ${detailRow("Số điện thoại", lead.phone)}
    ${detailRow("Công ty", lead.company)}
    ${detailRow("Quy mô", DEMO_COMPANY_SIZE_LABELS[lead.companySize])}
    ${detailRow("Quốc gia", DEMO_COUNTRY_LABELS[lead.country])}
    <tr>
      <td style="padding:14px 0 6px;color:#60708c;" colspan="2">Nội dung quan tâm</td>
    </tr>
    <tr>
      <td style="padding:14px;background:#f4f7fb;border-radius:10px;overflow-wrap:anywhere;" colspan="2">${interest}</td>
    </tr>
  </table>`;
}

function leadDetailsText(lead: DemoLead) {
  return [
    `Họ và tên: ${formatLeadName(lead)}`,
    `Email công việc: ${lead.workEmail}`,
    `Số điện thoại: ${lead.phone}`,
    `Công ty: ${lead.company}`,
    `Quy mô: ${DEMO_COMPANY_SIZE_LABELS[lead.companySize]}`,
    `Quốc gia: ${DEMO_COUNTRY_LABELS[lead.country]}`,
    "Nội dung quan tâm:",
    lead.interest,
  ].join("\n");
}

function ownerLeadEmail(lead: DemoLead, requestId: string) {
  return {
    subject: "Lead dùng thử mới - UPTECH KNOWLEDGE",
    html: emailFrame(
      "Có một yêu cầu dùng thử mới.",
      "Yêu cầu dùng thử mới",
      `<p style="margin:0 0 20px;">Một khách hàng tiềm năng vừa gửi biểu mẫu dùng thử.</p>
      ${leadDetailsHtml(lead)}
      <p style="margin:22px 0 0;color:#60708c;font-size:13px;">Mã yêu cầu: ${escapeHtml(requestId)}</p>`,
    ),
    text: [
      "Yêu cầu dùng thử mới",
      "",
      leadDetailsText(lead),
      "",
      `Mã yêu cầu: ${requestId}`,
    ].join("\n"),
  };
}

export async function sendNewDemoLead(lead: DemoLead, requestId: string) {
  const configuration = getEmailConfiguration();
  const resend = new Resend(configuration.apiKey);
  const email = ownerLeadEmail(lead, requestId);
  const { data, error } = await resend.emails.send(
    {
      from: configuration.from,
      to: [configuration.owner],
      ...email,
    },
    { idempotencyKey: `demo-lead-create-${requestId}` },
  );

  if (error || !data) {
    throw new DemoEmailError("delivery");
  }
}
