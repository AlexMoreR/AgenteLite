import { Loader2 } from "lucide-react";

/**
 * Pantalla de "cargando" del CRM.
 *
 * Antes eran barras grises imitando el contenido que venía. Para quien conoce la app eso se
 * entiende, pero una asesora abriendo el CRM a las 8 de la mañana ve una pantalla rota: no dice
 * nada, no se sabe si está trabajando o si se colgó, y la tentación es recargar (que lo hace
 * más lento todavía).
 *
 * Ahora dice en castellano QUÉ está haciendo y cuánto puede tardar. Es la misma espera, pero
 * acompañada — sobre todo ahora que "Mi día" es la primera pantalla que ve todo el mundo al
 * entrar.
 */
export function CrmLoadingState({
  titulo,
  detalle,
}: {
  titulo: string;
  detalle: string;
}) {
  return (
    <section className="flex min-h-[55vh] w-full items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="relative flex size-12 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--primary)]/15" />
          <Loader2 className="size-6 animate-spin text-[var(--primary)]" />
        </span>

        <p className="mt-4 text-[15px] font-semibold text-foreground">{titulo}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{detalle}</p>
      </div>
    </section>
  );
}
