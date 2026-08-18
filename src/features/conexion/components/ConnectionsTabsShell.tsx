"use client";

import type { ReactNode } from "react";


export function ConnectionsTabsShell({
  conexiones,
  action,
}: {
  conexiones: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="w-full">
      <div className="px-6 pt-6">
        {/* Sin titulo: el encabezado de la app ya dice "Conexion" dos centimetros mas arriba.
            Repetirlo gastaba una franja entera de pantalla en el celular. Queda el boton. */}
        <div className="flex w-full justify-end">{action}</div>
      </div>

      {conexiones}
    </div>
  );
}
