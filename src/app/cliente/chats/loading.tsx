import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingChatsPage() {
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <aside className="flex w-[380px] min-w-0 flex-col gap-4 rounded-3xl border border-border bg-card p-4 shadow-sm">
          <Skeleton className="h-12 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-3 overflow-hidden">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3 rounded" />
                  <Skeleton className="h-3 w-full rounded" />
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b border-border px-4 py-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48 rounded" />
              <Skeleton className="h-3 w-28 rounded" />
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-end gap-3 px-4 py-4">
            <Skeleton className="ml-auto h-24 w-[72%] rounded-[1.5rem]" />
            <Skeleton className="h-20 w-[56%] rounded-[1.5rem]" />
          </div>

          <div className="border-t border-border p-3">
            <Skeleton className="h-12 rounded-2xl" />
          </div>
        </div>
      </div>
    </section>
  );
}
