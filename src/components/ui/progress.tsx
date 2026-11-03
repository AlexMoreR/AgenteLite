import * as React from "react"

import { cn } from "@/lib/utils"

type ColorDeProgress = "verde" | "amarillo" | "rojo"

const colorDeLaBarra: Record<ColorDeProgress, string> = {
  verde: "bg-emerald-500",
  amarillo: "bg-amber-500",
  rojo: "bg-destructive",
}

const limitar = (valor: number) => (Number.isFinite(valor) ? Math.min(100, Math.max(0, valor)) : 0)

/**
 * Barra de avance simple. `value` y `marca` van de 0 a 100. La marca es una raya fina (por ejemplo, lo esperado
 * a la fecha o el reto). Sin color, la barra es gris.
 */
function Progress({
  className,
  value,
  marca,
  color,
  etiquetaDeMarca,
  ...props
}: Omit<React.ComponentProps<"div">, "color"> & {
  value: number
  marca?: number | null
  color?: ColorDeProgress | null
  etiquetaDeMarca?: string
}) {
  const avance = limitar(value)
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
        className={cn("h-full rounded-full transition-all", color ? colorDeLaBarra[color] : "bg-muted-foreground/40")}
        style={{ width: `${avance}%` }}
      />
      {marca !== null && marca !== undefined ? (
        <div
          data-slot="progress-marca"
          title={etiquetaDeMarca}
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/60"
          style={{ left: `${limitar(marca)}%` }}
        />
      ) : null}
    </div>
  )
}

export { Progress }
export type { ColorDeProgress }
