"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { NegocioDelAdmin } from "@/lib/negocios-del-admin";

/**
 * Las dos piezas que necesita el admin ahora que el catalogo tiene dueño.
 *
 * `FiltroDeNegocio` va arriba de una lista y cambia la direccion; `CampoDeNegocio` va dentro de un
 * formulario de crear. Viven juntas porque son la misma idea vista de dos lados, y separarlas
 * garantizaba que una dijera "Magilus" y la otra "Magilus SAS".
 */

export function FiltroDeNegocio({
  negocios,
  seleccionado,
}: {
  negocios: NegocioDelAdmin[];
  seleccionado: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-600">Negocio</span>
      <NativeSelect
        className="h-9 w-56"
        value={seleccionado ?? ""}
        aria-label="Filtrar por negocio"
        onChange={(evento) => {
          const siguientes = new URLSearchParams(params.toString());
          if (evento.target.value) {
            siguientes.set("negocio", evento.target.value);
          } else {
            siguientes.delete("negocio");
          }
          const qs = siguientes.toString();
          router.push(qs ? `?${qs}` : "?");
        }}
      >
        <NativeSelectOption value="">Todos</NativeSelectOption>
        {negocios.map((negocio) => (
          <NativeSelectOption key={negocio.id} value={negocio.id}>
            {negocio.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}

/**
 * El negocio al que va a pertenecer lo que se esta creando.
 *
 * Es obligatorio y no tiene opcion vacia a proposito: un producto sin dueño no se puede guardar, y
 * es mejor que el formulario no deje mandarlo a que el servidor conteste un error.
 *
 * Arranca en el negocio que se este mirando con el filtro. Quien filtro por un negocio y toca
 * "Nuevo" casi siempre quiere crearlo ahi.
 */
export function CampoDeNegocio({
  negocios,
  porDefecto,
}: {
  negocios: NegocioDelAdmin[];
  porDefecto: string | null;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">Negocio</span>
      <NativeSelect name="workspaceId" required defaultValue={porDefecto ?? negocios[0]?.id ?? ""}>
        {negocios.map((negocio) => (
          <NativeSelectOption key={negocio.id} value={negocio.id}>
            {negocio.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}
