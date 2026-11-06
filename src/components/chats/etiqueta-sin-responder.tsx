"use client";

import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { TAG_BADGE_CLASS } from "@/lib/tag-badge";
import { marcaSinResponder, type ColorSinResponder } from "@/features/chats/domain/sin-responder";

/*
  UN solo reloj para todas las etiquetas "Sin responder" de la lista.

  Un setInterval por fila serian decenas de temporizadores, y volver a dibujar la lista entera cada
  minuto deshace el memo de ConversationListItem. Aca hay un solo intervalo, que solo corre mientras
  haya alguna etiqueta en pantalla, y cada minuto avisa SOLO a esas etiquetas: asi pasan de amarillo
  a rojo sin recargar y el resto de la fila no se vuelve a dibujar.
*/
const MINUTO_MS = 60_000;

let ahora = Date.now();
let intervalo: ReturnType<typeof setInterval> | null = null;
const oyentes = new Set<() => void>();

function tic() {
  ahora = Date.now();
  for (const oyente of oyentes) oyente();
}

// El celular duerme los temporizadores con la pantalla apagada: al volver se pone al dia de una.
function alVolverAlaPantalla() {
  if (document.visibilityState === "visible") tic();
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  if (!intervalo) {
    ahora = Date.now();
    intervalo = setInterval(tic, MINUTO_MS);
    document.addEventListener("visibilitychange", alVolverAlaPantalla);
  }
  return () => {
    oyentes.delete(oyente);
    if (!oyentes.size && intervalo) {
      clearInterval(intervalo);
      intervalo = null;
      document.removeEventListener("visibilitychange", alVolverAlaPantalla);
    }
  };
}

function leerAhora() {
  // Sin nadie suscrito el reloj esta quieto: si quedo viejo, se pone al dia (estable dentro del minuto).
  if (!intervalo && Date.now() - ahora >= MINUTO_MS) ahora = Date.now();
  return ahora;
}

// En el servidor no se dibuja: su hora no es la del navegador y la etiqueta no coincidiria al hidratar.
const sinHoraEnElServidor = () => null;

const COLORES: Record<ColorSinResponder, string> = {
  amarillo: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  rojo: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
};

export function EtiquetaSinResponder({
  desde,
  resuelto,
}: {
  desde: Date | string | null;
  resuelto: boolean;
}) {
  const momento = useSyncExternalStore(suscribir, leerAhora, sinHoraEnElServidor);
  if (momento === null) return null;
  const marca = marcaSinResponder({ desde, resuelto, ahora: momento });
  if (!marca) return null;

  return (
    <Badge
      className={`shrink-0 border-transparent shadow-none ${TAG_BADGE_CLASS} normal-case ${COLORES[marca.color]}`}
      title="El cliente espera respuesta"
    >
      {marca.texto}
    </Badge>
  );
}
