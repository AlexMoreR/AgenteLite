/*
  eslint-disable react-hooks/set-state-in-effect --
  Un sondeo es exactamente eso: escribir estado desde un efecto. La alternativa seria que el
  servidor empuje el dato -el altavoz ya existe- pero atar este aviso al realtime lo haria
  depender de la misma pieza que puede estar caida, que es justo de lo que avisa.
*/
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlert, X } from "lucide-react";

/**
 * La barrita que avisa, dentro de la app, que una linea de WhatsApp esta caida.
 *
 * El push y el correo sirven cuando uno NO esta mirando la pantalla. Esto es para cuando si:
 * el 28-ago las asesoras estuvieron escribiendo mensajes que no salian, viendo el puntito verde,
 * durante horas. Un aviso a la vista corta eso en el momento.
 *
 * Se apoya en el `status` que deja el monitor cada minuto: no le pregunta al gateway, porque esta
 * consulta la hace CADA pestana abierta y multiplicar el trafico contra WhatsApp por la cantidad
 * de pestanas es justo lo que ahogo al gateway aquella vez.
 */

type CanalCaido = {
  id: string;
  nombre: string;
  telefono: string | null;
  necesitaQr: boolean;
};

const CADA_CUANTO_MS = 60_000;

export function AvisoDeCanalCaido() {
  const [caidos, setCaidos] = useState<CanalCaido[]>([]);
  /*
    Lo que la persona cerro a mano, recordado por CANAL y no como un simple "cerrado".

    Si fuera un booleano, cerrar el aviso de una linea taparia el de otra que se caiga despues, y
    esa segunda caida pasaria desapercibida.
  */
  const [silenciados, setSilenciados] = useState<string[]>([]);

  const revisar = useCallback(async () => {
    try {
      const respuesta = await fetch("/api/cliente/canales/estado", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!respuesta.ok) {
        return;
      }
      const datos = (await respuesta.json()) as { caidos?: CanalCaido[] };
      setCaidos(Array.isArray(datos.caidos) ? datos.caidos : []);
    } catch {
      // Silencioso: si falla la consulta no se inventa una caida. Un aviso falso se paga caro.
    }
  }, []);

  useEffect(() => {
    void revisar();
    const reloj = window.setInterval(() => void revisar(), CADA_CUANTO_MS);
    return () => window.clearInterval(reloj);
  }, [revisar]);

  const visibles = caidos.filter((canal) => !silenciados.includes(canal.id));
  if (visibles.length === 0) {
    return null;
  }

  const primero = visibles[0];
  const necesitaQr = visibles.some((canal) => canal.necesitaQr);
  const texto =
    visibles.length === 1
      ? `${primero.nombre} está desconectado`
      : `${visibles.length} conexiones desconectadas`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-amber-300 bg-amber-50 py-2 pl-3 pr-2 shadow-lg dark:border-amber-500/40 dark:bg-amber-950">
        <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-amber-900 dark:text-amber-100">
            {texto}
          </p>
          <p className="truncate text-[11px] leading-tight text-amber-700 dark:text-amber-300/80">
            {necesitaQr ? "Hay que escanear el QR" : "No entran ni salen mensajes"}
          </p>
        </div>
        <Link
          href="/cliente/conexion"
          className="ml-1 shrink-0 rounded-full bg-amber-600 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-amber-700"
        >
          Revisar
        </Link>
        <button
          type="button"
          onClick={() => setSilenciados((actual) => [...actual, ...visibles.map((canal) => canal.id)])}
          aria-label="Ocultar el aviso"
          className="shrink-0 rounded-full p-1 text-amber-700 transition hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
