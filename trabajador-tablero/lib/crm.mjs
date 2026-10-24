// El cliente HTTP del CRM: lo único que el trabajador habla con el servidor (solo HTTPS saliente).
// POST /api/trabajador/tablero/tomar, /candidatas y /api/trabajador/tablero/<id>/<accion>, con la clave
// en Bearer.
//
// Riesgo (24-oct-2026): no cambia el cliente. `plan` sigue mandando { plan }: el plan trae en sus primeras
// líneas "RIESGO: BAJO|ALTO — motivo" y el CRM lo lee del texto. `resultado` manda el objeto que arma
// construir tal cual, con `archivos` (rutas que de verdad cambió, máx. 300) y `migracionDestructiva`
// (palabras de SQL destructivo, [] si nada) para la última revisión de riesgo. La tarjeta que llega de
// /tomar puede traer `riesgo` y `riesgoMotivo`.

export class ErrorDelCrm extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function crearCrm({ urlCrm, claveTrabajador }, { fetch: miFetch = globalThis.fetch, timeoutMs = 30_000 } = {}) {
  async function pedir(ruta, cuerpo) {
    let respuesta;
    try {
      respuesta = await miFetch(`${urlCrm}${ruta}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${claveTrabajador}`, "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ErrorDelCrm(`No se pudo hablar con el CRM (${error?.message ?? error}).`, 0);
    }
    let datos = null;
    try {
      datos = await respuesta.json();
    } catch {
      // Sin JSON: se usa el código.
    }
    if (!respuesta.ok || datos?.ok === false) {
      throw new ErrorDelCrm(datos?.error ?? `El CRM contestó ${respuesta.status}.`, respuesta.status);
    }
    return datos;
  }

  return {
    /** { maxParalelo, excluir }: cuántas puede tener a la vez y cuáles no quiere ahora (chocan). */
    tomar: (opciones) => pedir("/api/trabajador/tablero/tomar", opciones),
    candidatas: () => pedir("/api/trabajador/tablero/candidatas"),
    soltar: (id, motivo) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/soltar`, { motivo }),
    latido: (id) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/latido`),
    plan: (id, plan) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/plan`, { plan }),
    resultado: (id, resultado) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/resultado`, resultado),
    subida: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/subida`, datos),
    /** WhatsApp al dueño desde la línea Admin (POST /api/trabajador/aviso): el aviso del uso de Claude. */
    aviso: (texto) => pedir("/api/trabajador/aviso", { texto }),
    error: (id, motivo, zonaProtegida, reversion) =>
      pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/error`, {
        motivo,
        ...(zonaProtegida?.length ? { zonaProtegida } : {}),
        ...(reversion ? { reversion } : {}),
      }),
  };
}
