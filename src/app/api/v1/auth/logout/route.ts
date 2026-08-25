import { logoutPost } from "@/server/auth/logout-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = logoutPost;
