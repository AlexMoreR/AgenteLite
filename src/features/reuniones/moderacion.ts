/*
  MODERAR EN LA SALA: silenciar a alguien o quitarle la pantalla (lógica pura, se prueba con node).

  El servidor del CRM apaga la pista en LiveKit y le manda un aviso a esa persona; ella puede volver a
  prender el micrófono o compartir de nuevo. Quién puede hacerlo se revisa en moderarEnLaReunionAction
  (los mismos que pueden terminar la reunión): el pase de la sala nunca trae permiso de administrar.
*/

export type QueModerar = "microfono" | "pantalla";

/** El tema del aviso que el servidor le manda a la persona. Solo vale si no lo mandó otro participante. */
export const TEMA_DE_MODERACION = "moderacion";

type PistaDeLivekit = { sid?: string; source?: string | number; muted?: boolean };

// LiveKit puede nombrar el origen con texto o con su número en el enum.
const ORIGENES: Record<QueModerar, string[]> = {
  microfono: ["MICROPHONE", "2"],
  pantalla: ["SCREEN_SHARE", "3", "SCREEN_SHARE_AUDIO", "4"],
};

export function esQueModerar(valor: unknown): valor is QueModerar {
  return valor === "microfono" || valor === "pantalla";
}

/** Las pistas que hay que apagar: las de ese origen que siguen prendidas. */
export function pistasParaApagar(que: QueModerar, pistas: PistaDeLivekit[] | undefined): string[] {
  return (pistas ?? [])
    .filter((pista) => pista.sid && !pista.muted && ORIGENES[que].includes(String(pista.source ?? "").toUpperCase()))
    .map((pista) => pista.sid as string);
}

/** El aviso que ve la persona, o null si el mensaje no se entiende. */
export function textoDelAviso(datos: { que?: unknown; por?: unknown }): string | null {
  const por = typeof datos.por === "string" && datos.por.trim() ? datos.por.trim().slice(0, 60) : "Alguien";
  if (datos.que === "microfono") {
    return `${por} te silenció. Puedes volver a prender el micrófono.`;
  }
  if (datos.que === "pantalla") {
    return `${por} te quitó la pantalla. Puedes volver a compartirla.`;
  }
  return null;
}
