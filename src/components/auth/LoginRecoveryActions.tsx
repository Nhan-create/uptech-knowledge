"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/preferences";
import { RECOVERY_ACTION_DESCRIPTORS, type RecoveryActionDescriptor, type RecoveryActionId, type RecoveryState } from "@/server/auth/recovery-actions";
import { GoogleLoginSubmitButton } from "./GoogleLoginSubmitButton";
import { buildRecoveryContactHref, getLoginRecoveryFeedback, readBoundedRecoveryJson, resolveRecoveryClipboardText } from "./login-recovery-local";
import { parseLoginRecoveryFetchSuccess, resolveLoginRecoveryTransport, type LoginRecoveryTransport } from "./login-recovery-transport";

export interface LoginRecoveryActionsProps {
  readonly actions: readonly RecoveryActionDescriptor[];
  readonly csrfToken: string | null;
  readonly requestId: string | null;
  readonly state: RecoveryState | null;
  readonly retryAfterSeconds: number | null;
  readonly locale: Locale;
}

type ResolvedAction = Readonly<{ id: RecoveryActionId; label: string; transport: LoginRecoveryTransport }>;
const buttonBase = "inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition-[background-color,box-shadow,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] disabled:cursor-wait disabled:opacity-60";

export function LoginRecoveryActions({ actions, csrfToken, requestId, state, retryAfterSeconds, locale }: LoginRecoveryActionsProps) {
  const resolvedActions = useMemo(() => actions.slice(0, 2).flatMap((descriptor): ResolvedAction[] => {
    const transport = resolveLoginRecoveryTransport({ descriptor, csrfToken, requestId, retryAfterSeconds });
    const canonical = RECOVERY_ACTION_DESCRIPTORS[descriptor.id];
    if (transport === null || canonical === undefined) return [];
    const action = canonical;
    const label = state === null && action.id === "START_NORMAL_LOGIN"
      ? locale === "vi" ? "Tiếp tục với Google Workspace" : "Continue with Google Workspace"
      : action.label[locale];
    return [{ id: action.id, label, transport }];
  }), [actions, csrfToken, locale, requestId, retryAfterSeconds, state]);
  const cooldown = resolvedActions.find(({ transport }) => transport.kind === "NATIVE_FORM" && transport.cooldownSeconds !== null)?.transport;
  const [cooldownSeconds, setCooldownSeconds] = useState(cooldown?.kind === "NATIVE_FORM" ? cooldown.cooldownSeconds ?? 0 : 0);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [manualText, setManualText] = useState<string | null>(null);
  const actionStartedRef = useRef(false);

  useEffect(() => {
    const restoreActions = () => { actionStartedRef.current = false; setPending(false); };
    window.addEventListener("pageshow", restoreActions);
    return () => window.removeEventListener("pageshow", restoreActions);
  }, []);
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => setCooldownSeconds((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  const beginAction = () => {
    if (actionStartedRef.current) return false;
    actionStartedRef.current = true;
    setPending(true);
    setManualText(null);
    setFeedback(getLoginRecoveryFeedback({ locale, kind: "WORKING" }));
    return true;
  };
  const finishAction = (message: string | null, fallback: string | null = null) => {
    actionStartedRef.current = false;
    setPending(false);
    setFeedback(message);
    setManualText(fallback);
  };
  const submitNativeForm = (event: FormEvent<HTMLFormElement>, transport: LoginRecoveryTransport) => {
    if (transport.kind !== "NATIVE_FORM" || (transport.cooldownSeconds !== null && cooldownSeconds > 0) || !beginAction()) event.preventDefault();
  };

  const runFetch = async (action: ResolvedAction) => {
    const { transport } = action;
    if (transport.kind !== "FETCH" || !beginAction()) return;
    try {
      const response = await fetch(transport.path, {
        method: transport.method,
        credentials: transport.credentials,
        cache: transport.cache,
        headers: transport.headers,
      });
      const payload = await readBoundedRecoveryJson(response);
      const result = parseLoginRecoveryFetchSuccess({ actionId: action.id, status: response.status, payload });
      if (result.kind === "NAVIGATE") { window.location.assign(result.destination); return; }
      if (result.kind === "ACCESS_REQUEST_RECEIPT") {
        finishAction(getLoginRecoveryFeedback({ locale, kind: "ACCESS_REQUEST_RECEIPT", requestId: result.requestId }));
        return;
      }
      finishAction(getLoginRecoveryFeedback({ locale, kind: "ACTION_FAILURE", requestId: result.requestId }));
    } catch {
      finishAction(getLoginRecoveryFeedback({ locale, kind: "ACTION_FAILURE" }));
    }
  };

  const runCopy = async (transport: LoginRecoveryTransport) => {
    if (transport.kind !== "COPY" || !beginAction()) return;
    const text = resolveRecoveryClipboardText({ template: transport.template, locale, requestId });
    if (text === null) { finishAction(getLoginRecoveryFeedback({ locale, kind: "ACTION_FAILURE" })); return; }
    try {
      if (typeof navigator.clipboard?.writeText !== "function") throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      finishAction(getLoginRecoveryFeedback({ locale, kind: "CLIPBOARD_SUCCESS" }));
    } catch {
      finishAction(getLoginRecoveryFeedback({ locale, kind: "CLIPBOARD_MANUAL" }), text);
    }
  };

  const revealContactFallback = () => {
    const canonicalRequestId = resolveRecoveryClipboardText({ template: "REQUEST_ID_V1", locale, requestId });
    setManualText(canonicalRequestId === null ? "contact@uptech.vn" : `contact@uptech.vn\n${locale === "vi" ? "Mã yêu cầu" : "Request ID"}: ${canonicalRequestId}`);
    setFeedback(locale === "vi" ? "Nếu ứng dụng email không mở, hãy sao chép thông tin liên hệ bên dưới." : "If your email app does not open, copy the contact details below.");
  };
  const cooldownFeedback = cooldownSeconds > 0 ? getLoginRecoveryFeedback({ locale, kind: "COOLDOWN", cooldownSeconds }) : null;
  const contactHref = buildRecoveryContactHref({ locale, state, requestId });

  return (
    <div className="mt-6 space-y-3">
      {resolvedActions.map((action, index) => {
        const { transport } = action;
        const disabled = pending || (transport.kind === "NATIVE_FORM" && transport.cooldownSeconds !== null && cooldownSeconds > 0);
        const visual = `${buttonBase} ${index === 0 ? "bg-blue-600 [color:#ffffff] shadow-sm hover:bg-blue-700" : "border border-slate-300 bg-white [color:#0f172a] hover:bg-slate-50"}`;
        switch (transport.kind) {
          case "NATIVE_FORM":
            return <form key={action.id} action={transport.action} method="post" onSubmit={(event) => submitNativeForm(event, transport)}>
              {transport.fields.map((field) => <input key={field.name} type="hidden" name={field.name} value={field.value} />)}
              {action.id === "START_NORMAL_LOGIN" || action.id === "START_NORMAL_LOGIN_AFTER_COOLDOWN"
                ? <GoogleLoginSubmitButton label={action.label} loadingLabel={locale === "vi" ? "Đang chuyển đến Google…" : "Redirecting to Google…"} disabled={disabled} busy={pending} withTopMargin={false} />
                : <button type="submit" disabled={disabled} aria-busy={pending} aria-label={action.label} className={visual}>{action.label}</button>}
            </form>;
          case "FETCH":
            return <button key={action.id} type="button" disabled={pending} aria-busy={pending} aria-label={action.label} onClick={() => void runFetch(action)} className={visual}>{action.label}</button>;
          case "LINK":
            return <a key={action.id} href={transport.href} aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault(); }} className={visual}>{action.label}</a>;
          case "COPY":
            return <button key={action.id} type="button" disabled={pending} aria-busy={pending} aria-label={action.label} onClick={() => void runCopy(transport)} className={visual}>{action.label}</button>;
          case "CONTACT":
            return <a key={action.id} href={contactHref} aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault(); else revealContactFallback(); }} className={visual}>{action.label}</a>;
        }
      })}
      <div className="min-h-6 text-sm text-slate-600" aria-live="polite" aria-atomic="true">{feedback ?? cooldownFeedback}</div>
      {manualText === null ? null : <textarea aria-label={locale === "vi" ? "Nội dung để sao chép thủ công" : "Content to copy manually"} readOnly rows={3} value={manualText} className="w-full resize-none rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" />}
    </div>
  );
}
