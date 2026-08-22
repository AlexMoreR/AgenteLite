"use client";

import type { ReactNode } from "react";


export function ConnectionsTabsShell({
  conexiones,
  llamadas,
  action,
}: {
  conexiones: ReactNode;
  /** La linea de llamadas. Null cuando el servicio no esta configurado o no responde. */
  llamadas?: ReactNode;
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

      {/* Las llamadas van DESPUES de los canales de chat: son la conexion que menos se toca, y
          arriba empujarian hacia abajo lo que la gente viene a mirar todos los dias. */}
      {llamadas ? <div className="px-6 pb-6">{llamadas}</div> : null}
    </div>
  );
}
