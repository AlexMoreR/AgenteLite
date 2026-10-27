import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { FAMILIAS } from "../dominio/semanal";

/** Los filtros de "Embudo por paso": producto y fechas. Formulario GET, sin JavaScript. */

export type FiltrosPorPaso = { familia: string; desde: string; hasta: string };

function Campo({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {nombre}
      {children}
    </label>
  );
}

export function EmbudoPorPasoFiltros({ actuales, hrefLimpiar }: { actuales: FiltrosPorPaso; hrefLimpiar: string }) {
  return (
    <form method="get" className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Campo nombre="Producto">
        <NativeSelect name="familia" defaultValue={actuales.familia} className="w-full">
          {FAMILIAS.map((familia) => (
            <option key={familia.clave} value={familia.clave}>
              {familia.nombre}
            </option>
          ))}
        </NativeSelect>
      </Campo>
      <Campo nombre="Desde">
        <Input type="date" name="desde" defaultValue={actuales.desde} />
      </Campo>
      <Campo nombre="Hasta">
        <Input type="date" name="hasta" defaultValue={actuales.hasta} />
      </Campo>
      <div className="flex items-end gap-2">
        <Button type="submit" className="min-h-11 flex-1">
          Ver
        </Button>
        <Button render={<a href={hrefLimpiar} />} variant="outline" className="min-h-11">
          Limpiar
        </Button>
      </div>
    </form>
  );
}
