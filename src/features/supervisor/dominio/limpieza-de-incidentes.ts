/**
 * LIMPIEZA DE LAS ALERTAS DEL LIBRO (código puro).
 *
 * Caso real (27-oct-2026): "Prioridades de Alexander" llegó a 14 alertas porque quedaban abiertas las
 * de versiones viejas del libro (274, 277, 279, 288, 292, 295, 311, 317) y varias que decían lo mismo
 * con distinto número de versión (por ejemplo "ráfaga del combo" en la v311 y en la v317).
 *
 * Qué hace, en cada vuelta de cada hora (la llama `aplicarRevalidaciones`, que ya sabe cuál es la
 * versión vigente y cuáles incidentes viejos la revalidación dice que SIGUEN):
 *
 *  1. Cierra como RESUELTA ("Reemplazado: el libro ya está en la versión X") toda alerta del libro
 *     ("INC:libro-vN:…") de una versión anterior a la vigente. Única excepción: la que la revalidación
 *     dice que SIGUE con leads nuevos (un problema real).
 *  2. Junta las alertas abiertas del mismo producto con los mismos problemas, sin mirar los números de
 *     versión: queda la más reciente (con los chats de ejemplo de las otras) y las demás se cierran con
 *     "Unida a <clave>".
 *
 * Las cerradas no avisan ni salen en Prioridades. No toca la base: solo cambia el estado de la alerta
 * (RESUELTA, resueltaEn); el almacén la guarda como cualquier otra y libera su `claveAbierta`.
 *
 * OJO: depende de la revalidación (interruptor `supervisor:revalidacion:<ws>`, prendido por defecto).
 * Si alguien la apaga, esta limpieza no corre y las versiones viejas se quedan abiertas.
 */

import type { Incidente } from "./alertas";
import type { Hallazgo } from "./tipos";
import { esHallazgoDeArreglo, versionDelIncidente } from "./version-del-incidente";

type Aviso = { incidente: Incidente; motivo: "nuevo" | "sube" | "recordatorio" };

const MAX_CHATS_DE_EJEMPLO = 8;

const esDeRevalidacion = (h: Pick<Hallazgo, "clave">) => h.clave.startsWith("REVALIDACION:");

/** La clave de un hallazgo sin el número de versión ("CAMBIO:post-cambio:v317:x" → "CAMBIO:post-cambio:v#:x"). */
export function claveSinVersion(clave: string): string {
  return clave.replace(/(^|:)v\d+(?=:|$)/g, "$1v#");
}

/** Los problemas de una alerta (sin números de versión), o null si no sirve para compararla. */
function firmaDeProblemas(inc: Incidente): string | null {
  const claves = inc.hallazgos.filter((h) => !esDeRevalidacion(h) && !esHallazgoDeArreglo(h)).map((h) => claveSinVersion(h.clave));
  if (!claves.length) return null;
  return `${inc.producto ?? "todos"}|${[...new Set(claves)].sort().join("+")}`;
}

function cerrar(inc: Incidente, motivo: string, ahora: Date): void {
  inc.titulo = `${motivo}: ${inc.titulo}`;
  inc.estado = "RESUELTA";
  inc.severidad = "OBSERVACION";
  inc.resueltaEn = ahora;
  inc.cambiadoEn = ahora;
}

/** Los chats de ejemplo de `otros` pasan a `quien` (mismo problema, sin repetir, con tope). */
function pasarEjemplos(quien: Incidente, otros: Incidente[]): void {
  const hallazgos = quien.hallazgos.map((h) => {
    if (esDeRevalidacion(h) || esHallazgoDeArreglo(h)) return h;
    const firma = claveSinVersion(h.clave);
    const chats = new Set(h.evidencia.chats);
    for (const otro of otros) {
      for (const g of otro.hallazgos) {
        if (claveSinVersion(g.clave) === firma) for (const c of g.evidencia.chats) chats.add(c);
      }
    }
    const lista = [...chats].slice(0, MAX_CHATS_DE_EJEMPLO);
    return lista.length === h.evidencia.chats.length ? h : { ...h, evidencia: { ...h.evidencia, chats: lista } };
  });
  quien.hallazgos = hallazgos;
}

export function limpiarIncidentesDelLibro(input: {
  incidentes: Incidente[];
  avisar: Aviso[];
  versionActual: number;
  ahora: Date;
  /** Claves de los incidentes viejos que la revalidación dice que SIGUEN (no se cierran). */
  siguen: Set<string>;
}): { incidentes: Incidente[]; avisar: Aviso[]; cerradas: Array<{ clave: string; motivo: string }> } {
  const cerradas: Array<{ clave: string; motivo: string }> = [];
  const cerradasClaves = new Set<string>();

  // 1. Versiones anteriores a la vigente.
  for (const inc of input.incidentes) {
    if (inc.estado !== "ABIERTA" || inc.familia === "ATENCION") continue;
    const version = versionDelIncidente(inc.clave);
    if (version === null || version >= input.versionActual || input.siguen.has(inc.clave)) continue;
    const motivo = `Reemplazado: el libro ya está en la versión ${input.versionActual}`;
    cerrar(inc, motivo, input.ahora);
    cerradas.push({ clave: inc.clave, motivo });
    cerradasClaves.add(inc.clave);
  }

  // 2. Las que dicen lo mismo con distinto número: queda la más reciente.
  const grupos = new Map<string, Incidente[]>();
  for (const inc of input.incidentes) {
    if (inc.estado !== "ABIERTA" || inc.familia === "ATENCION") continue;
    const firma = firmaDeProblemas(inc);
    if (firma) grupos.set(firma, [...(grupos.get(firma) ?? []), inc]);
  }
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const ordenado = [...grupo].sort(
      (a, b) => (versionDelIncidente(b.clave) ?? -1) - (versionDelIncidente(a.clave) ?? -1) || b.primeraVezEn.getTime() - a.primeraVezEn.getTime(),
    );
    const [queda, ...otras] = ordenado;
    pasarEjemplos(queda, otras);
    queda.cambiadoEn = input.ahora;
    for (const inc of otras) {
      const motivo = `Unida a ${queda.clave}`;
      cerrar(inc, motivo, input.ahora);
      cerradas.push({ clave: inc.clave, motivo });
      cerradasClaves.add(inc.clave);
    }
  }

  return {
    incidentes: input.incidentes,
    avisar: input.avisar.filter((a) => !cerradasClaves.has(a.incidente.clave)),
    cerradas,
  };
}
