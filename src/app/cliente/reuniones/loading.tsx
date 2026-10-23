import { Skeleton } from "@/components/ui/skeleton";

export default function ReunionesLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>
      {Array.from({ length: 5 }, (_, indice) => (
        <Skeleton key={indice} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
