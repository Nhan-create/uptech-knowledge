import { Skeleton } from "@/components/ui";
import { WorkspacePage } from "@/components/workspace/WorkspacePrimitives";

export function DocumentRouteLoading() {
  return (
    <WorkspacePage>
      <div aria-busy="true" aria-label="Đang tải tài liệu" className="space-y-5">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    </WorkspacePage>
  );
}
