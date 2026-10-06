import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lo que se ve mientras la pantalla de Chats se arma en el servidor.
 *
 * Sin esto la app se queda EN BLANCO entre 0,3 y 0,9 segundos en escritorio —y varios segundos en
 * el celular con datos—. Antes era un aviso "Cargando tus chats"; ahora son las siluetas de la
 * bandeja (pastillas y filas), como en WhatsApp: la pantalla ya tiene su forma y lo que llega solo
 * se rellena (plan "Chats instantaneo", fase 1).
 */
const FILAS = 9;

export default function Cargando() {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden" aria-busy="true" aria-label="Cargando tus chats">
      <div className="flex min-h-0 w-full flex-col border border-border bg-card md:w-[380px] md:shrink-0">
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="ml-auto size-7 rounded-full" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {Array.from({ length: FILAS }, (_, indice) => (
            <div key={indice} className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-2 px-3 py-3">
              <div className="flex justify-center">
                <Skeleton className="size-12 rounded-full" />
              </div>
              <div className="flex min-w-0 flex-col gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="ml-auto h-3 w-10" />
                </div>
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hidden min-h-0 flex-1 border-y border-r border-border bg-muted/30 md:block" />
    </div>
  );
}
