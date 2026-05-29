import { Skeleton } from "@/components/ui/skeleton";

export default function CrmLoading() {
  return (
    <section className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="flex h-[76px] items-center gap-3 rounded-[22px] border border-border bg-card px-4 py-3.5"
          >
            <Skeleton className="size-9 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-2.5 w-28" />
            </div>
            <Skeleton className="h-5 w-8" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-[22px] border border-border bg-card p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-48" />

        <div className="flex flex-col gap-2 pt-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-xl" />
          ))}
        </div>
      </div>
    </section>
  );
}
