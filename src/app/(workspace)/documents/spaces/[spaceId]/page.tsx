import type { Metadata } from "next";
import { SpaceScreen } from "@/features/documents/DocumentRouteScreens";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";

export const metadata: Metadata = { title: "Không gian tri thức" };

export default async function DocumentSpacePage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  const outcome = await getKnowledgeReadAdapter().getSpace(spaceId);
  return <SpaceScreen outcome={outcome} />;
}
