"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { vistaDeHoyAction } from "@/app/actions/tableros-inteligentes-actions";
import type { LineaDeHoy, VistaDeHoy as DatosDeHoy } from "../services/resumen-diario";
import { linkDeLaTarjetaEnPantalla } from "./DialogoDeTablero";

/*
  La vista "Hoy" de Tablero IA (/cliente/tablero-ia?vista=hoy, el link de los WhatsApp del Coordinador):
  tres grupos (listas hoy, con problema hoy, te toca a ti) y UNA línea por tarjeta: el título corto y el
  resumen de una línea de la ficha. Tocar la línea abre la tarjeta, donde quedan el plan, los commits, las
  pruebas y los links. Solo el dueño o el ADMIN. Se refresca cada minuto.
*/

const REFRESCO_MS = 60_000;

const GRUPOS: { clave: "listas" | "conProblema" | "teToca"; titulo: string; vacio: string }[] = [
  { clave: "listas", titulo: "Listas hoy ✅", vacio: "Hoy no ha terminado ninguna." },
  { clave: "conProblema", titulo: "Con problema hoy ⚠️", vacio: "Ninguna con problema." },
  { clave: "teToca", titulo: "Te toca a ti 👆", vacio: "No hay nada esperando tu sí." },
];

function Linea({ linea }: { linea: LineaDeHoy }) {
  return (
    <li>
      <Link
        href={linkDeLaTarjetaEnPantalla(linea.tarjetaId)}
        className="flex flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate text-sm font-medium" title={linea.titulo}>
          {linea.titulo}
        </span>
        {linea.resumen ? <span className="line-clamp-1 text-xs text-muted-foreground">{linea.resumen}</span> : null}
        {linea.tresLineas ? (
          <span className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {linea.tresLineas.hizo ? <span>Qué se hizo: {linea.tresLineas.hizo}</span> : null}
            {linea.tresLineas.ahora ? <span>Qué se ve ahora: {linea.tresLineas.ahora}</span> : null}
            {linea.tresLineas.revisar ? <span>Qué revisar juntos: {linea.tresLineas.revisar}</span> : null}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export function VistaDeHoy() {
  const [datos, setDatos] = useState<DatosDeHoy | null>(null);

  useEffect(() => {
    let vigente = true;
    const leer = (avisar: boolean) =>
      void vistaDeHoyAction().then((respuesta) => {
        if (!vigente) return;
        if (respuesta.ok) setDatos(respuesta.vista);
        else if (avisar) toast.error(respuesta.error);
      });
    leer(true);
    const reloj = setInterval(() => leer(false), REFRESCO_MS);
    return () => {
      vigente = false;
      clearInterval(reloj);
    };
  }, []);

  return (
    <section aria-labelledby="titulo-hoy" className="space-y-4">
      <div>
        <h1 id="titulo-hoy" className="text-lg font-semibold">
          Hoy
        </h1>
        <p className="text-sm text-muted-foreground">Lo que terminó, falló o espera tu sí. Toca una para ver el detalle.</p>
      </div>

      {!datos ? <Loader2 className="mx-auto animate-spin text-muted-foreground" aria-label="Cargando" /> : null}

      {datos
        ? GRUPOS.map(({ clave, titulo, vacio }) => (
            <div key={clave} className="space-y-1.5">
              <h2 className="text-sm font-medium">
                {titulo} <span className="text-muted-foreground tabular-nums">({datos[clave].length})</span>
              </h2>
              {datos[clave].length ? (
                <ul className="space-y-1.5">
                  {datos[clave].map((linea) => (
                    <Linea key={linea.tarjetaId} linea={linea} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{vacio}</p>
              )}
            </div>
          ))
        : null}
    </section>
  );
}
