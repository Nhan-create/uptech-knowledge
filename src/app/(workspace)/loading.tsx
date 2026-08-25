import { Skeleton } from "@/components/ui";

export default function WorkspaceLoading() {
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-7 p-4 sm:p-6 lg:p-8" role="status" aria-label="Đang tải nội dung">
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-[26rem] rounded-2xl" />
        <Skeleton className="h-[26rem] rounded-2xl" />
      </div>
      <span className="sr-only">Đang tải không gian làm việc…</span>
    </div>
  );
}
