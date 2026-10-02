"use client";

import { EJEMPLO_DE_COTIZACION, normalizarCotizacion } from "@/features/crm/domain/cotizacion-de-gestion";

/**
 * El campo del número de cotización de Gestión, igual en todas las pantallas que marcan Ganado
 * (ver cotizacion-de-gestion.ts).
 *
 * Muestra cómo va a quedar guardado ("Se guarda como COT-00123") para que quien escribe "123"
 * sepa que se entendió, y avisa cuando lo escrito no es un número de cotización.
 */
export function CampoDeCotizacion({
  valor,
  onCambio,
  autoFocus = false,
  onEnter,
}: {
  valor: string;
  onCambio: (valor: string) => void;
  autoFocus?: boolean;
  /** Enter con un número válido: confirma sin ir al botón. */
  onEnter?: () => void;
}) {
  const normalizado = normalizarCotizacion(valor);
  const escribio = valor.trim().length > 0;

  return (
    <div className="space-y-1">
      <label className="block text-[12px] font-medium text-foreground">
        Número de cotización de Gestión
        <input
          autoFocus={autoFocus}
          value={valor}
          onChange={(evento) => onCambio(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === "Enter" && normalizado && onEnter) {
              evento.preventDefault();
              onEnter();
            }
          }}
          placeholder={EJEMPLO_DE_COTIZACION}
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
          // 16px en el celular: por debajo de eso el iPhone hace zoom al tocar el campo.
          className="mt-1 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-[16px] font-normal uppercase tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 md:text-sm"
        />
      </label>
      {escribio ? (
        normalizado ? (
          <p className="text-[11.5px] text-muted-foreground">
            Se guarda como <span className="font-medium tabular-nums text-foreground">{normalizado}</span>
          </p>
        ) : (
          <p className="text-[11.5px] text-rose-600 dark:text-rose-400">
            No es un número de cotización. Debe ser como {EJEMPLO_DE_COTIZACION}.
          </p>
        )
      ) : (
        <p className="text-[11.5px] text-muted-foreground">Sin este número no se puede marcar Ganado.</p>
      )}
    </div>
  );
}
