import { Skeleton } from "@/components/ui/skeleton";

export default function TablerosInteligentesLoading() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }, (_, indice) => (
          <Skeleton key={indice} className="h-7 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <Skeleton className="min-h-0 flex-1 rounded-xl" />
    </div>
  );
}
