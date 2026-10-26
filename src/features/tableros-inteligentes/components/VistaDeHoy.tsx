"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { vistaDeHoyAction } from "@/app/actions/tableros-inteligentes-actions";
import type { LineaDeHoy, VistaDeHoy as DatosDeHoy } from "../services/resumen-diario";
import { linkDeLaTarjetaEnPantalla } from "./DialogoDeTablero";

/*
  Vista "Hoy" del inicio de Tablero IA (?vista=hoy, el link de los WhatsApp cortos): tres grupos, listas hoy,
  con problema hoy y te toca a ti, con una línea por tarjeta (título corto + resumen de una línea). Tocar la
  tarjeta abre su ficha, que es donde quedan el plan, los commits, las pruebas y los links. Se refresca cada minuto.
*/

const REFRESCO_MS = 60_000;

const GRUPOS: { clave: "listas" | "conProblema" | "teToca"; titulo: string; vacio: string }[] = [
  { clave: "listas", titulo: "Listas hoy ✅", vacio: "Hoy no terminó ninguna." },
  { clave: "conProblema", titulo: "Con problema hoy ⚠️", vacio: "Ninguna falló hoy." },
  { clave: "teToca", titulo: "Te toca a ti 👆", vacio: "No hay nada esperando tu sí." },
];

function Linea({ linea }: { linea: LineaDeHoy }) {
  return (
    <li>
      <Link
        href={linkDeLaTarjetaEnPantalla(linea.id)}
        className="flex min-h-11 flex-col justify-center rounded-lg border px-3 py-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-sm font-medium">{linea.titulo}</span>
        {linea.resumen ? <span className="line-clamp-1 text-xs text-muted-foreground">{linea.resumen}</span> : null}
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
    <section aria-labelledby="titulo-vista-hoy" className="space-y-4">
      <div>
        <h1 id="titulo-vista-hoy" className="text-lg font-semibold">
          Hoy
        </h1>
        <p className="text-sm text-muted-foreground">Lo que terminó, falló o espera tu sí. Toca una tarjeta para ver el detalle.</p>
      </div>
      {!datos ? <Loader2 className="mx-auto animate-spin text-muted-foreground" aria-label="Cargando" /> : null}
      {datos
        ? GRUPOS.map((grupo) => (
            <div key={grupo.clave} className="space-y-1.5">
              <h2 className="text-sm font-semibold">
                {grupo.titulo} <span className="font-normal text-muted-foreground">({datos[grupo.clave].length})</span>
              </h2>
              {datos[grupo.clave].length ? (
                <ul className="space-y-1.5">
                  {datos[grupo.clave].map((linea) => (
                    <Linea key={linea.id} linea={linea} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{grupo.vacio}</p>
              )}
            </div>
          ))
        : null}
    </section>
  );
}
