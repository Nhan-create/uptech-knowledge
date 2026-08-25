import "server-only";

import { fixtureKnowledgeReadAdapter } from "@/features/knowledge/fixtures/fixture-read-adapter";
import type { KnowledgeReadAdapter } from "@/features/knowledge/read-adapter";

export function getKnowledgeReadAdapter(): KnowledgeReadAdapter {
  return fixtureKnowledgeReadAdapter;
}
