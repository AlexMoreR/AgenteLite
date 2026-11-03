import * as React from "react"

import { cn } from "@/lib/utils"

type ColorDeProgreso = "verde" | "amarillo" | "rojo"

const COLOR_DE_RELLENO: Record<ColorDeProgreso, string> = {
  verde: "bg-emerald-500",
  amarillo: "bg-amber-500",
  rojo: "bg-red-500",
}

const enRango = (valor: number) => (Number.isFinite(valor) ? Math.min(100, Math.max(0, valor)) : 0)

/**
 * Barra de avance simple. `value` y `marca` van de 0 a 100 (lo de afuera se recorta). La marca es una raya
 * vertical (por ejemplo, lo esperado a la fecha). Sin `color`, la barra usa el color principal del tema.
 */
function Progress({
  className,
  value,
  marca,
  color,
  ...props
}: Omit<React.ComponentProps<"div">, "color"> & {
  value: number
  marca?: number | null
  color?: ColorDeProgreso | null
}) {
  const avance = enRango(value)
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(avance)}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn("h-full rounded-full transition-all", color ? COLOR_DE_RELLENO[color] : "bg-primary")}
        style={{ width: `${avance}%` }}
      />
      {typeof marca === "number" ? (
        <div
          data-slot="progress-marca"
          aria-hidden
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/60"
          style={{ left: `${enRango(marca)}%` }}
        />
      ) : null}
    </div>
  )
}

export { Progress }
export type { ColorDeProgreso }
