// El cliente HTTP del CRM: lo único que el trabajador habla con el servidor (solo HTTPS saliente).
// POST /api/trabajador/tablero/tomar, /candidatas y /api/trabajador/tablero/<id>/<accion>, con la clave
// en Bearer.
//
// Riesgo (24-oct-2026): no cambia el cliente. `plan` sigue mandando { plan }: el plan trae en sus primeras
// líneas "RIESGO: BAJO|ALTO — motivo" y el CRM lo lee del texto. `resultado` manda el objeto que arma
// construir tal cual, con `archivos` (rutas que de verdad cambió, máx. 300) y `migracionDestructiva`
// (palabras de SQL destructivo, [] si nada) para la última revisión de riesgo. La tarjeta que llega de
// /tomar puede traer `riesgo` y `riesgoMotivo`.

/** Un objeto sin los campos vacíos (undefined / null): así un CRM viejo no recibe nada que no conoce. */
const limpio = (datos) => Object.fromEntries(Object.entries(datos ?? {}).filter(([, valor]) => valor !== undefined && valor !== null));

// Reparar solo (24-oct-2026): `reparar`, `partir` y `arranque` son acciones nuevas; `soltar` y `error` aceptan
// campos nuevos (categoria, causa, error, etapa). /tomar trae reparaciones, topeReparaciones, esperasSeguidas,
// esParte, ultimosIntentos y ultimoError. Un CRM que no manda topeReparaciones es uno viejo: el bucle sigue
// como antes (a la primera falla, /error).

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
    /** Devuelve la tarjeta a la fila sin ERROR. `extra` { categoria, causa, error, etapa }: el CRM guarda un intento "esperar" que no cuenta. */
    soltar: (id, motivo, extra) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/soltar`, { motivo, ...limpio(extra) }),
    /** La falla se repara: vuelve a la fila (PLAN_APROBADO o APROBADO), reparaciones + 1. 409 si ya hizo las 3. { etapa, categoria, causa, error, estrategia? } */
    reparar: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/reparar`, limpio(datos)),
    /** La tarea era muy grande: crea las partes (2 a 4) que salieron de la sesión de partir. { causa, error, partes: [{ titulo, detalle }] } */
    partir: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/partir`, limpio(datos)),
    /** Al arrancar el Coordinador: el CRM suelta todo lo que el proceso anterior dejó con candado (PLANEANDO / EN_CURSO). -> { sueltas } */
    arranque: () => pedir("/api/trabajador/tablero/arranque"),
    latido: (id) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/latido`),
    plan: (id, plan) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/plan`, { plan }),
    resultado: (id, resultado) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/resultado`, resultado),
    subida: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/subida`, datos),
    /** WhatsApp al dueño desde la línea Admin (POST /api/trabajador/aviso): el aviso del uso de Claude. */
    aviso: (texto) => pedir("/api/trabajador/aviso", { texto }),
    /**
     * Escala: la tarjeta queda en ERROR. `motivo` es el resumen de máximo 3 líneas para el dueño; `extra`
     * { categoria, causa, resumen, error, etapa } deja el intento "escalar" con sus detalles técnicos.
     */
    error: (id, motivo, zonaProtegida, reversion, extra) =>
      pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/error`, {
        motivo,
        ...(zonaProtegida?.length ? { zonaProtegida } : {}),
        ...(reversion ? { reversion } : {}),
        ...limpio(extra),
      }),
  };
}
