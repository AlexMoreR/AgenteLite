// El bucle del trabajador. Desde el 22-oct-2026 trabaja VARIAS tarjetas a la vez (config.maxParalelo),
// cada una en su propia sesión de Claude Code, su worktree y su rama (etapas.mjs):
//
// - crearPlanificador: llena los cupos libres. Antes de tomar otra mira la CPU y la memoria (si pasan
//   de config.limites no abre otra sesión), si Claude está en pausa por su límite de uso, y qué
//   candidatas chocan con lo que ya corre (choques.mjs: misma zona o módulo del mismo repo, o dos
//   subidas del mismo repo = la cola de subida): esas van en `excluir` a /tomar y esperan en fila.
// - procesar: una etapa de una tarjeta con su latido cada minuto. Si el latido dice que la tarjeta ya
//   venció (409), se cancela lo que esté corriendo (el CRM la pasa a ERROR en el próximo /tomar). Si la
//   etapa falla, avisa /error con el motivo; si Claude llegó a su límite de uso, la suelta SIN error
//   (/soltar) y el planificador pausa.
// - unaVuelta: tomar UNA y hacerla (--una-vez y las pruebas).
import { candidatasQueChocan, huellaDeTarjeta, motivoDeChoque } from "./choques.mjs";
import { ErrorDeEtapa, construir, planear, subir } from "./etapas.mjs";
import { idCorto } from "./git.mjs";
import { crearMedidor, faltanRecursos } from "./recursos.mjs";

const ETAPAS = { planear, construir, subir };

export async function unaVuelta({ crm, config, registro }) {
  const respuesta = await crm.tomar();
  if (respuesta.vencidas?.length) registro.aviso(`el CRM pasó a ERROR por vencidas: ${respuesta.vencidas.join(", ")}`);
  if (!respuesta.tarjeta) return { hizo: null, motivo: respuesta.motivo };
  const { tarjeta, hacer } = respuesta;
  registro.info(`tomé "${tarjeta.titulo}" (${tarjeta.id}, ${tarjeta.repo}) para ${hacer}`);
  const resultado = await procesar({ crm, config, registro }, tarjeta, hacer);
  return { hizo: hacer, tarjetaId: tarjeta.id, ...resultado };
}

export async function procesar({ crm, config, registro }, tarjeta, hacer) {
  const control = new AbortController();
  let vencida = false;
  const latir = async () => {
    try {
      await crm.latido(tarjeta.id);
    } catch (error) {
      registro.aviso(`latido de ${tarjeta.id}: ${error.message}`);
      if (error.status === 409 || error.status === 404) {
        vencida = true;
        control.abort();
      }
    }
  };
  const reloj = setInterval(() => void latir(), Math.max(1, config.tiempos.latidoSegundos) * 1000);
  const contexto = { config, registro, senal: control.signal };
  try {
    const etapa = ETAPAS[hacer];
    if (!etapa) throw new ErrorDeEtapa(`El CRM pidió "${hacer}", que este trabajador no sabe hacer (¿hay que actualizarlo?).`);
    const salida = await etapa(contexto, tarjeta);
    if (vencida) throw new ErrorDeEtapa("La tarjeta venció en el CRM mientras se trabajaba.");
    let respuesta;
    if (hacer === "planear") respuesta = await crm.plan(tarjeta.id, salida.plan);
    else if (hacer === "construir") respuesta = await crm.resultado(tarjeta.id, salida);
    else respuesta = await crm.subida(tarjeta.id, { commit: salida.commit, version: salida.version, linkCommit: salida.linkCommit });
    registro.info(`listo "${tarjeta.titulo}" (${hacer})${respuesta?.estado ? `: quedó ${respuesta.estado}` : ""}`);
    // estado = SUBIENDO: se construyó y sube sola; el que llama la toma enseguida, sin esperar el minuto.
    return { ok: true, estado: respuesta?.estado ?? null };
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    if (vencida) {
      registro.error(`"${tarjeta.titulo}" venció en el CRM: ${motivo}`);
      return { ok: false, motivo, vencida: true };
    }
    if (error?.limiteDeUso) {
      // No es culpa de la tarjeta: vuelve a esperar su turno, sin ERROR.
      registro.aviso(`"${tarjeta.titulo}" (${hacer}): Claude llegó a su límite de uso; la suelto sin error para reintentarla después`);
      await soltar(crm, registro, tarjeta, `Claude llegó a su límite de uso: se reintenta después. ${motivo}`);
      return { ok: false, motivo, limiteDeUso: true };
    }
    registro.error(`"${tarjeta.titulo}" (${hacer}) falló: ${motivo}`);
    try {
      await crm.error(tarjeta.id, motivo, error?.zonas, error?.reversion);
    } catch (otro) {
      registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
    }
    return { ok: false, motivo, zonas: error?.zonas ?? [] };
  } finally {
    clearInterval(reloj);
  }
}

async function soltar(crm, registro, tarjeta, motivo) {
  try {
    await crm.soltar(tarjeta.id, motivo.slice(0, 1000));
    return true;
  } catch (error) {
    registro.error(`no se pudo soltar "${tarjeta.titulo}": ${error.message}`);
    return false;
  }
}

/** Un registro que antepone "[s2 abcd1234]" a cada línea: el log dice qué tarjeta corre en cada sesión. */
function registroDeLaSesion(registro, etiqueta) {
  return {
    info: (mensaje, extra) => registro.info(`[${etiqueta}] ${mensaje}`, extra),
    aviso: (mensaje, extra) => registro.aviso(`[${etiqueta}] ${mensaje}`, extra),
    error: (mensaje, extra) => registro.error(`[${etiqueta}] ${mensaje}`, extra),
    carpeta: registro.carpeta,
  };
}

/**
 * El planificador: varias tarjetas a la vez, hasta config.maxParalelo.
 *   llenar()        toma tarjetas hasta llenar los cupos (o hasta que no haya, choquen o falten recursos).
 *   esperar(ms)     duerme hasta ms, o menos si terminó una sesión (hay un cupo libre).
 *   esperarTodas()  espera que terminen las que corren (al salir).
 */
export function crearPlanificador({ crm, config, registro, medidor = crearMedidor() }) {
  const max = config.maxParalelo;
  /** sesión (1..max) -> { tarjeta, hacer, huella, promesa } */
  const sesiones = new Map();
  let pausaHasta = 0;
  let despertar = null;
  // Terminó una sesión mientras no se esperaba: la próxima espera no duerme.
  let cupoNuevo = false;
  let ultimoAviso = "";

  /** Para no llenar el log: el mismo aviso (fila, recursos, pausa) se escribe una vez. */
  const avisarUnaVez = (clave, mensaje) => {
    if (clave === ultimoAviso) return;
    ultimoAviso = clave;
    if (mensaje) registro.info(mensaje);
  };

  function contarCorriendo() {
    const lista = [...sesiones.entries()]
      .sort(([a], [b]) => a - b)
      .map(([n, s]) => `s${n} "${s.tarjeta.titulo}" (${s.hacer}, ${s.tarjeta.repo})`);
    registro.info(`corriendo ${sesiones.size}/${max} tarjetas al tiempo${lista.length ? `: ${lista.join("; ")}` : ""}`);
  }

  const cupoLibre = () => {
    for (let n = 1; n <= max; n += 1) if (!sesiones.has(n)) return n;
    return null;
  };

  function arrancar(tarjeta, hacer, huella) {
    const n = cupoLibre();
    const suRegistro = registroDeLaSesion(registro, `s${n} ${idCorto(tarjeta.id)}`);
    suRegistro.info(`tomé "${tarjeta.titulo}" (${tarjeta.id}, ${tarjeta.repo}) para ${hacer}`);
    const sesion = { tarjeta, hacer, huella };
    sesiones.set(n, sesion);
    contarCorriendo();
    sesion.promesa = procesar({ crm, config, registro: suRegistro }, tarjeta, hacer)
      .catch((error) => {
        suRegistro.error(`la sesión se cayó: ${error?.message ?? error}`);
        return { ok: false };
      })
      .then((resultado) => {
        if (resultado?.limiteDeUso) {
          pausaHasta = Date.now() + config.tiempos.pausaLimiteMinutos * 60_000;
          registro.aviso(`pausa: Claude llegó a su límite de uso; no abro sesiones nuevas hasta ${new Date(pausaHasta).toISOString()}`);
        }
        if (resultado?.estado === "SUBIENDO") suRegistro.info("construida y sube sola: pasa a la cola de subida");
        return resultado;
      })
      .finally(() => {
        sesiones.delete(n);
        contarCorriendo();
        if (despertar) despertar();
        else cupoNuevo = true;
      });
  }

  async function llenar() {
    while (sesiones.size < max) {
      if (Date.now() < pausaHasta) {
        avisarUnaVez(`pausa-${pausaHasta}`, `en pausa por el límite de uso de Claude hasta ${new Date(pausaHasta).toISOString()}`);
        return;
      }
      // La primera siempre se toma (una CPU ocupada por otra cosa no deja todo quieto).
      if (sesiones.size > 0) {
        const falta = faltanRecursos(medidor.medir(), config.limites);
        if (falta) {
          avisarUnaVez(`recursos-${sesiones.size}`, `no abro otra sesión (${sesiones.size}/${max} corriendo): ${falta}`);
          return;
        }
      }
      const corriendo = [...sesiones.values()].map((s) => s.huella);
      let excluir = [];
      if (corriendo.length) {
        const { candidatas = [] } = await crm.candidatas();
        const chocan = candidatasQueChocan(candidatas, corriendo, config.repos);
        excluir = Object.keys(chocan);
        if (candidatas.length && excluir.length === candidatas.length) {
          const enFila = candidatas.map((c) => `"${c.titulo}" ${chocan[c.id]}`);
          avisarUnaVez(`fila-${excluir.join(",")}-${sesiones.size}`, `esperan en fila: ${enFila.join("; ")}`);
          return;
        }
      }
      const respuesta = await crm.tomar({ maxParalelo: max, excluir });
      if (respuesta.vencidas?.length) registro.aviso(`el CRM pasó a ERROR por vencidas: ${respuesta.vencidas.join(", ")}`);
      if (!respuesta.tarjeta) {
        avisarUnaVez(`sin-${respuesta.motivo}-${sesiones.size}`, null);
        return;
      }
      ultimoAviso = "";
      const { tarjeta, hacer } = respuesta;
      const huella = huellaDeTarjeta(tarjeta, hacer, config.repos[tarjeta.repo]);
      // Entre /candidatas y /tomar pudo aparecer otra que choca: se suelta (sin error) y espera en fila.
      const choque = corriendo.map((otra) => [otra, motivoDeChoque(huella, otra)]).find(([, motivo]) => motivo);
      if (choque) {
        registro.info(`"${tarjeta.titulo}" choca con "${choque[0].titulo}" (${choque[1]}): la suelto y espera en fila`);
        if (await soltar(crm, registro, tarjeta, `Espera en fila: ${choque[1]}.`)) continue;
        return;
      }
      arrancar(tarjeta, hacer, huella);
    }
  }

  return {
    llenar,
    corriendo: () => sesiones.size,
    esperar: (ms) =>
      new Promise((resolver) => {
        if (cupoNuevo) {
          cupoNuevo = false;
          resolver();
          return;
        }
        const listo = () => {
          clearTimeout(reloj);
          despertar = null;
          resolver();
        };
        const reloj = setTimeout(listo, ms);
        despertar = listo;
      }),
    esperarTodas: async () => {
      while (sesiones.size) await Promise.allSettled([...sesiones.values()].map((s) => s.promesa));
    },
    parar: () => medidor.parar(),
  };
}
