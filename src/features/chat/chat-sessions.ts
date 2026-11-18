import type { ChatTurn, ContextScopeType } from "./chat-engine";

export type ChatSession = Readonly<{
  id: string;
  title: string;
  scope: ContextScopeType;
  turns: readonly ChatTurn[];
}>;

const STORAGE_KEY = "uptech-knowledge:chat-sessions:v1";
const MAX_SESSIONS = 15;
const EMPTY_SESSIONS: readonly ChatSession[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSessions: readonly ChatSession[] = EMPTY_SESSIONS;

function isValidSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.scope === "string" &&
    Array.isArray(candidate.turns)
  );
}

function parseSessions(raw: string | null): readonly ChatSession[] {
  if (!raw) return EMPTY_SESSIONS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_SESSIONS;
    return parsed.filter(isValidSession).slice(0, MAX_SESSIONS);
  } catch {
    return EMPTY_SESSIONS;
  }
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeChatSessions(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener);
    };
  }
  function handleStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY) {
      cachedRaw = undefined;
      emitChange();
    }
  }
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function getChatSessionsSnapshot(): readonly ChatSession[] {
  if (typeof window === "undefined") return EMPTY_SESSIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedSessions = parseSessions(raw);
    }
    return cachedSessions;
  } catch {
    return cachedSessions;
  }
}

export function getChatSessionsServerSnapshot(): readonly ChatSession[] {
  return EMPTY_SESSIONS;
}

export function saveChatSessions(nextSessions: readonly ChatSession[]): void {
  const bounded = nextSessions.slice(0, MAX_SESSIONS);
  cachedSessions = bounded;
  if (typeof window !== "undefined") {
    try {
      const serialized = JSON.stringify(bounded);
      cachedRaw = serialized;
      window.localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      cachedRaw = undefined;
    }
  }
  emitChange();
}

export function upsertChatSession(session: ChatSession): void {
  const current = getChatSessionsSnapshot();
  const others = current.filter((item) => item.id !== session.id);
  saveChatSessions([session, ...others]);
}

export function deleteChatSession(sessionId: string): void {
  const current = getChatSessionsSnapshot();
  saveChatSessions(current.filter((item) => item.id !== sessionId));
}
