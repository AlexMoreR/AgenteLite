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

/** Un texto con algo escrito, o `porDefecto` (30-oct-2026: /reparar y /error nunca salen con la causa o el motivo vacíos). */
const conTexto = (valor, porDefecto) => (typeof valor === "string" && valor.trim() ? valor : porDefecto);
const sinCausaDe = (datos) => `El Coordinador no supo la causa (etapa ${datos?.etapa ?? "?"}).`;

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
  /*
    Tope duro (27-oct-2026): AbortSignal.timeout corta el fetch y la lectura del cuerpo, pero si algo no respeta la
    señal (un fetch reemplazado, un socket que se queda a medias) la promesa podría no volver nunca y colgar la vuelta.
    Por eso todo `pedir` (fetch + JSON) corre contra un reloj propio: a los timeoutMs + margen (5 s, o timeoutMs si es menor) falla con status 0.
  */
  function pedir(ruta, cuerpo, metodo = "POST") {
    let reloj;
    const margen = Math.min(5000, timeoutMs);
    const tope = new Promise((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new ErrorDelCrm(`No se pudo hablar con el CRM (no contestó en ${Math.round((timeoutMs + margen) / 1000)} s).`, 0)), timeoutMs + margen);
    });
    return Promise.race([pedirSinTope(ruta, cuerpo, metodo), tope]).finally(() => clearTimeout(reloj));
  }

  async function pedirSinTope(ruta, cuerpo, metodo) {
    let respuesta;
    try {
      respuesta = await miFetch(`${urlCrm}${ruta}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${claveTrabajador}`, ...(metodo === "GET" ? {} : { "Content-Type": "application/json" }) },
        ...(metodo === "GET" ? {} : { body: JSON.stringify(cuerpo ?? {}) }),
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
    /**
     * La falla se repara: vuelve a la fila (PLAN_APROBADO o APROBADO), reparaciones + 1. 409 si ya hizo las 3. { etapa, categoria, causa, error, estrategia?, cuenta? }
     * `cuenta: false` (31-oct-2026, solo con choca_con_main): vuelve a construir desde el main más nuevo SIN sumar reparación
     * (intento que no cuenta); 409 si ya lleva TOPE_DE_CHOQUES_SEGUIDOS choques seguidos. `limpio` deja pasar el false.
     */
    reparar: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/reparar`, limpio({ ...datos, causa: conTexto(datos?.causa, sinCausaDe(datos)) })),
    /** La tarea era muy grande: crea las partes (2 a 4) que salieron de la sesión de partir. { causa, error, partes: [{ titulo, detalle }] } */
    partir: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/partir`, limpio(datos)),
    /** Medir antes de planear: la tarjeta nombra a otras como molde o requisito. { referencias: [id o título] } -> { creadas, esperando, soltada }. Si alguna no está HECHO, PLANEANDO vuelve a la fila ("Esperando a «X»") sin ERROR. */
    depender: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/depender`, limpio(datos)),
    /** Revisión previa (27-oct-2026): lo pedido ya estaba en main. { commit, motivo, nota, etapa } -> la tarjeta pasa a HECHO con la nota "ya estaba hecho (commit X)". */
    yaHecha: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/ya-hecha`, limpio(datos)),
    /** Código limpio (27-oct-2026): main trae errores viejos. { repo, errores } -> { creada } crea UNA tarjeta de limpieza por repo, o le agrega los errores a la abierta. */
    limpieza: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/limpieza`, limpio(datos)),
    /** Las tarjetas en ERROR (las más viejas primero) con lo necesario para recogerlas. -> { tarjetas } */
    errores: () => pedir("/api/trabajador/tablero/errores"),
    /**
     * Las tarjetas POR_REVISAR que solo esperaban la prueba extra o que ya traen el sí del dueño (27-oct-2026). -> { tarjetas: [{ id, titulo,
     * repo, plan, zonaProtegida, rama, base, commit, archivos, esperaPor, aprobadaPorElDueno }], paraRevisarDeNuevo: [...] }. `paraRevisarDeNuevo`
     * (30-oct-2026; un CRM viejo no la manda): las que pasaron, son solo CHATS / BOT_VENTAS y no esperan por gasto en Meta Ads, con `paso`.
     */
    porRevisar: () => pedir("/api/trabajador/tablero/por-revisar"),
    /** Rescata una tarjeta POR_REVISAR tras revisarla con el diff real: { sube: true, confirmacion } -> SUBIENDO; { sube: false, motivo } -> sigue POR_REVISAR con ese motivo. 409 si el CRM ve dinero, Meta Ads o una zona que pide el sí. */
    rescatar: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/rescatar`, limpio(datos)),
    /**
     * Revisar de nuevo (30-oct-2026) una tarjeta POR_REVISAR de CHATS / BOT_VENTAS que el Coordinador volvió a probar él mismo:
     * { subeSolo: true, pruebas: [texto], commit, base } -> SUBIENDO (commit y base: lo que quedó en la rama después del rebase, así
     * subir() no vuelve a compilar); { subeSolo: false, motivo } -> ERROR "construido, no sube: <motivo>". 409 si el CRM ve otra cosa.
     */
    revisarDeNuevo: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/revisar_de_nuevo`, limpio(datos)),
    /** Recoge una tarjeta en ERROR: { decision: "reintentar" | "partir" | "dueno", causa, error, categoria, partes, linea }. 409 si ya se recogió 2 veces. */
    recoger: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/recoger`, limpio(datos)),
    /** Al arrancar el Coordinador: el CRM suelta todo lo que el proceso anterior dejó con candado (PLANEANDO / EN_CURSO). -> { sueltas } */
    arranque: () => pedir("/api/trabajador/tablero/arranque"),
    /** El latido del Coordinador entero (POST /api/trabajador/latido, cada 15 s): el panel "Coordinador en vivo". No es el de una tarjeta. */
    latidoDelCoordinador: (datos) => pedir("/api/trabajador/latido", datos),
    /** El latido de una tarjeta. Construyendo lleva { lugar: "aizen1" | "nube", sesion? }: en la nube el CRM da 180 min (no 90) y guarda el link. */
    latido: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/latido`, limpio(datos)),
    plan: (id, plan) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/plan`, { plan }),
    resultado: (id, resultado) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/resultado`, resultado),
    subida: (id, datos) => pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/subida`, datos),
    /**
     * WhatsApp al dueño desde la línea Admin (POST /api/trabajador/aviso). `tipo` es "limite" (Claude se agotó y todo
     * quedó en pausa) o "necesita" (algo que no se puede hacer solo); el CRM descarta los avisos sin tipo. `tarjetaId`
     * (31-oct-2026, opcional): la tarjeta del aviso "necesita", para que el CRM cierre sola la alerta cuando se responde.
     */
    aviso: (texto, tipo, tarjetaId) => pedir("/api/trabajador/aviso", { texto, ...(tipo ? { tipo } : {}), ...(tarjetaId ? { tarjetaId } : {}) }),
    /** Cerebro (26-oct-2026): las notas NUEVAS que crea aizen1 en la bóveda. -> { notas: [{ id, ruta, contenido, creadoEn }] } */
    notasPorCrear: () => pedir("/api/trabajador/cerebro/notas-por-crear", null, "GET"),
    /** Marca una nota: estado "CREADA" o "ERROR" (con motivo). Repetir la misma marca no falla. */
    marcarNota: (id, estado, motivo) => pedir("/api/trabajador/cerebro/notas-por-crear", { id, estado, ...(motivo ? { motivo } : {}) }),
    /**
     * Escala: la tarjeta queda en ERROR. `motivo` es el resumen de máximo 3 líneas para el dueño; `extra`
     * { categoria, causa, resumen, error, etapa } deja el intento "escalar" con sus detalles técnicos.
     */
    error: (id, motivo, zonaProtegida, reversion, extra) =>
      pedir(`/api/trabajador/tablero/${encodeURIComponent(id)}/error`, {
        motivo: conTexto(motivo, sinCausaDe(extra)),
        ...(zonaProtegida?.length ? { zonaProtegida } : {}),
        ...(reversion ? { reversion } : {}),
        ...limpio(extra),
        ...(extra?.categoria ? { causa: conTexto(extra.causa, sinCausaDe(extra)) } : {}),
      }),
  };
}
