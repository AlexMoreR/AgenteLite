import { Skeleton } from "@/components/ui/skeleton";

/** La primera carga lee 30 días de leads y Gestión: puede tardar decenas de segundos. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Skeleton className="h-6 w-48" />
      <p className="text-sm text-muted-foreground">Leyendo 30 días de leads, cotizaciones y ventas. La primera vez puede tardar un poco.</p>
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
