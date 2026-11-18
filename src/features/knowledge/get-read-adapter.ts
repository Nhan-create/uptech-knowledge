import "server-only";

import type { KnowledgeReadAdapter } from "@/features/knowledge/read-adapter";
import { runtimeKnowledgeReadAdapter } from "@/server/knowledge/runtime-read-adapter";

export function getKnowledgeReadAdapter(): KnowledgeReadAdapter {
  return runtimeKnowledgeReadAdapter;
}
