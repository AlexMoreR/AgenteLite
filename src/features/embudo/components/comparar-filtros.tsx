import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { ORIGENES } from "../dominio/comparar";
import { FAMILIAS } from "../dominio/semanal";

/**
 * Los filtros de "Comparar embudos". Es un formulario GET (sin JavaScript): en el celular van
 * plegados dentro de un <details> para que las dos versiones se vean primero.
 */

export type FiltrosActuales = {
  familia: string;
  versionA: string;
  versionB: string;
  desde: string;
  hasta: string;
  canalId: string;
  origen: string;
};

export type CompararFiltrosProps = {
  actuales: FiltrosActuales;
  versiones: Array<{ version: number; chats: number }>;
  sinVersion: number;
  lineas: Array<{ id: string; nombre: string }>;
  hrefLimpiar: string;
};

function Campo({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {nombre}
      {children}
    </label>
  );
}

export function CompararFiltros({ actuales, versiones, sinVersion, lineas, hrefLimpiar }: CompararFiltrosProps) {
  return (
    <details className="group rounded-xl border border-border bg-card" open>
      <summary className="flex min-h-11 cursor-pointer items-center justify-between px-4 text-sm font-semibold text-foreground md:hidden">
        Filtros
        <span aria-hidden className="text-muted-foreground group-open:rotate-180">
          ▾
        </span>
      </summary>
      <form method="get" className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Campo nombre="Producto">
          <NativeSelect name="familia" defaultValue={actuales.familia} className="w-full">
            {FAMILIAS.map((familia) => (
              <option key={familia.clave} value={familia.clave}>
                {familia.nombre}
              </option>
            ))}
          </NativeSelect>
        </Campo>
        <Campo nombre="Versión de la izquierda">
          <NativeSelect name="a" defaultValue={actuales.versionA} className="w-full">
            <option value="">Automática</option>
            {versiones.map((item) => (
              <option key={item.version} value={String(item.version)}>
                Versión {item.version} ({item.chats} chats)
              </option>
            ))}
            {sinVersion > 0 ? <option value="sin">Sin versión ({sinVersion} chats)</option> : null}
          </NativeSelect>
        </Campo>
        <Campo nombre="Versión de la derecha">
          <NativeSelect name="b" defaultValue={actuales.versionB} className="w-full">
            <option value="">Automática</option>
            {versiones.map((item) => (
              <option key={item.version} value={String(item.version)}>
                Versión {item.version} ({item.chats} chats)
              </option>
            ))}
            {sinVersion > 0 ? <option value="sin">Sin versión ({sinVersion} chats)</option> : null}
          </NativeSelect>
        </Campo>
        <Campo nombre="Línea de WhatsApp">
          <NativeSelect name="linea" defaultValue={actuales.canalId} className="w-full">
            <option value="">Todas</option>
            {lineas.map((linea) => (
              <option key={linea.id} value={linea.id}>
                {linea.nombre}
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
        <Campo nombre="Origen">
          <NativeSelect name="origen" defaultValue={actuales.origen} className="w-full">
            <option value="">Todos</option>
            {ORIGENES.map((origen) => (
              <option key={origen.clave} value={origen.clave}>
                {origen.nombre}
              </option>
            ))}
          </NativeSelect>
        </Campo>
        <div className="flex items-end gap-2">
          <Button type="submit" className="min-h-11 flex-1">
            Comparar
          </Button>
          <Button render={<a href={hrefLimpiar} />} variant="outline" className="min-h-11">
            Limpiar
          </Button>
        </div>
      </form>
    </details>
  );
}
