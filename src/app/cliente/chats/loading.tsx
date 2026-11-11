import { ListaDesdeGuardado } from "@/components/chats/lista-desde-guardado";
import { scriptDeLaFoto } from "@/components/chats/guardado-local/foto-de-la-bandeja";
import { ALTO_DE_FILA } from "@/components/chats/ventana-de-la-lista";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lo que se ve mientras la pantalla de Chats se arma en el servidor.
 *
 * Sin esto la app se queda EN BLANCO entre 0,3 y 0,9 segundos en escritorio —y varios segundos en
 * el celular con datos—.
 *
 * Desde el 11-11-2026 (Alex: "que la copia guardada sea IDENTICA a la lista final"):
 * - Si hay FOTO de la bandeja (guardado-local/foto-de-la-bandeja.ts), el script de abajo la pone
 *   encima apenas llega este HTML, antes que cualquier otro JavaScript: la bandeja tal como se vio
 *   la ultima vez, con sus pastillas, fijados, asesora, linea, etiquetas, etapa y chulitos. La
 *   bandeja real la quita cuando ya esta armada debajo.
 * - Si no hay foto, las siluetas tienen la MISMA forma que la bandeja real: el buscador, la fila de
 *   pastillas y filas grises de ALTO_DE_FILA, para que al llegar no se corra nada.
 */
const FILAS = 9;

export default function Cargando() {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden" aria-busy="true" aria-label="Cargando tus chats">
      {/* Corre apenas el navegador lee esta linea: la foto sale sin esperar el JavaScript de la pagina. */}
      <script dangerouslySetInnerHTML={{ __html: scriptDeLaFoto() }} />
      <div className="flex min-h-0 w-full flex-col border border-border bg-card md:w-[380px] md:shrink-0">
        {/* Igual que la cabecera de appsidebar: px-3 py-2, el buscador (h-9) y las pastillas (h-7). */}
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="px-0.5 pb-2 pt-0.5">
            <Skeleton className="h-9 w-full rounded-full" />
          </div>
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="size-7 rounded-full" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ListaDesdeGuardado
            fallback={Array.from({ length: FILAS }, (_, indice) => (
              // Mismo alto y mismo relleno que ConversationListItem: al llegar la lista no se mueve.
              <div
                key={indice}
                style={{ height: ALTO_DE_FILA }}
                className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-2 overflow-hidden border-b border-border px-3 py-2.5"
              >
                <div className="flex flex-col items-center gap-1 self-stretch">
                  <Skeleton className="size-12 rounded-full" />
                  <Skeleton className="mt-auto h-5 w-14 rounded-full" />
                </div>
                <div className="flex min-w-0 flex-col gap-2 pt-0.5">
                  <Skeleton className="h-2.5 w-1/3" />
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="ml-auto h-3 w-10" />
                  </div>
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-4 w-1/3 rounded-full" />
                </div>
              </div>
            ))}
          />
        </div>
      </div>
      <div className="hidden min-h-0 flex-1 border-y border-r border-border bg-muted/30 md:block" />
    </div>
  );
}
