// El bucle del Coordinador. Desde el 22-oct-2026 trabaja VARIAS tarjetas a la vez (config.maxParalelo),
// cada una en su propia sesión de Claude Code, su worktree y su rama (etapas.mjs):
//
// - crearPlanificador: llena los cupos libres. Antes de tomar otra mira la CPU y la memoria (si pasan
//   de config.limites no abre otra sesión), qué etapas tienen motor (ver abajo), y qué
//   candidatas chocan con lo que ya corre (choques.mjs: misma zona o módulo del mismo repo, o dos
//   subidas del mismo repo = la cola de subida): esas van en `excluir` a /tomar y esperan en fila.
// - procesar: una etapa de una tarjeta con su latido cada minuto. Si el latido dice que la tarjeta ya
//   venció (409), se cancela lo que esté corriendo (el CRM la pasa a ERROR en el próximo /tomar). Si la
//   etapa falla, avisa /error con el motivo; si Claude llegó a su límite de uso, la suelta SIN error
//   (/soltar) y el planificador pausa.
// - unaVuelta: tomar UNA y hacerla (--una-vez y las pruebas).
//
// Motores (23-oct-2026, motores.mjs): el estado de los motores es uno solo para todas las sesiones.
// Si Codex o Claude llegan a su límite, ESE motor se pausa (Codex pausaLimiteCodexMinutos, Claude
// pausaLimiteMinutos) y sus pasos esperan o pasan al otro según config.motores; las candidatas cuyo paso
// no tiene motor van en `excluir`. Cada config.vigilarUsoMinutos se mira el uso de Claude: sobre
// config.umbralClaude todos los pasos van con Codex y sale UN aviso por WhatsApp por cruce.
import { candidatasQueChocan, huellaDeTarjeta, motivoDeChoque } from "./choques.mjs";
import { TOPE_DE_REPARACIONES, decidir, diagnosticar, enUnaLinea, resumenDeEscalada } from "./diagnostico.mjs";
import { ErrorDeEtapa, construir, diagnosticarConClaude, entornoSeguro, limpiarCarpetasDeTrabajo, partirTarea, planear, subir } from "./etapas.mjs";
import { idCorto } from "./git.mjs";
import { modeloDelPaso, nombreDelModelo } from "./modelos.mjs";
import { crearEstadoDeMotores, crearVigilanteDeUso, motorDeLaEtapa, nombreDelMotor } from "./motores.mjs";
import { crearMedidor, faltanRecursos } from "./recursos.mjs";

const ETAPAS = { planear, construir, subir };

// Panel "Coordinador en vivo" (24-oct-2026): cada sesión lleva un `vivo` { etapa, lugar, modelo, motor, inicioEn,
// linkWorkflow } que las etapas actualizan con `contexto.fase(etapa, extra)` ("probando", GitHub Actions…) y el
// latido (latido.mjs) lee con planificador.estado(). Solo informa: nunca decide nada.
const ETAPA_VISIBLE = { planear: "planeando", construir: "construyendo", subir: "subiendo" };

/** El modelo de Claude que usa esta etapa (el mismo que eligen las etapas), o null si no es Claude. */
function modeloDeLaSesion(config, motores, tarjeta, hacer, reparacion) {
  if (hacer === "subir" || motores.motorDe(hacer) !== "claude") return null;
  if (hacer === "construir" && reparacion?.estrategia === "opus") return config.modelos?.planear ?? "opus";
  return modeloDelPaso(config, hacer, tarjeta);
}

// Reparar solo (24-oct-2026). Si una etapa falla, en vez de mandar la tarjeta a ERROR a la primera:
//   1. guarda el error y el log del intento (<carpetaTrabajo>/intentos/<id>/<fecha>-<etapa>.log),
//   2. lo diagnostica (diagnostico.mjs: por reglas; si no se reconoce, una sesión corta de Claude de solo lectura),
//   3. decide: esperar (límite de Claude, PC lleno, carpeta trabada: /soltar, no cuenta), reparar (/reparar, hasta 3),
//      partir (/partir: 2 a 4 partes en orden) o escalar (/error con un resumen de máximo 3 líneas).
// Un CRM que no manda `topeReparaciones` en la tarjeta es uno viejo: se sigue como antes (a la primera falla, /error).

/** La marca que `reparar` deja en la causa cuando cambia de estrategia: "[estrategia: opus]". */
const MARCA_DE_ESTRATEGIA = /\s*\[estrategia: (opus|partir)\]\s*$/;

/**
 * Lo que /tomar dice de intentos anteriores, armado como `tarjeta.reparacion` para el prompt de la etapa:
 * { numero, de, causa, categoria, error, estrategia }. null si la tarjeta no viene de una reparación.
 */
export function reparacionDeLaTarjeta(tarjeta) {
  if (tarjeta.reparacion) return tarjeta.reparacion;
  const hechas = Number(tarjeta.reparaciones) || 0;
  if (hechas < 1) return null;
  const ultima = [...(tarjeta.ultimosIntentos ?? [])].reverse().find((intento) => intento.accion === "reparar");
  const causa = String(ultima?.causa ?? "");
  return {
    numero: hechas,
    de: Number(tarjeta.topeReparaciones) || TOPE_DE_REPARACIONES,
    causa: causa.replace(MARCA_DE_ESTRATEGIA, ""),
    categoria: ultima?.categoria ?? "otra",
    error: tarjeta.ultimoError ?? null,
    estrategia: causa.match(MARCA_DE_ESTRATEGIA)?.[1] ?? null,
  };
}

export async function unaVuelta({ crm, config, registro }) {
  const respuesta = await crm.tomar();
  if (respuesta.vencidas?.length) registro.aviso(`el CRM pasó a ERROR por vencidas: ${respuesta.vencidas.join(", ")}`);
  if (!respuesta.tarjeta) return { hizo: null, motivo: respuesta.motivo };
  const { tarjeta, hacer } = respuesta;
  registro.info(`tomé "${tarjeta.titulo}" (${tarjeta.id}, ${tarjeta.repo}) para ${hacer}`);
  const resultado = await procesar({ crm, config, registro }, tarjeta, hacer);
  return { hizo: hacer, tarjetaId: tarjeta.id, ...resultado };
}

export async function procesar({ crm, config, registro: registroBase, motores = crearEstadoDeMotores(config), medidor = null, otrasSesiones = null, vivo = {} }, tarjeta, hacer) {
  const control = new AbortController();
  // Lo que escribe la sesión se guarda también aquí: es el "log del intento" si falla.
  const bitacora = [];
  const anotar = (nivel) => (mensaje, extra) => {
    bitacora.push(`${new Date().toISOString()} [${nivel}] ${mensaje}${extra === undefined ? "" : ` ${typeof extra === "string" ? extra : JSON.stringify(extra)}`}`);
    registroBase[nivel === "INFO" ? "info" : nivel === "AVISO" ? "aviso" : "error"](mensaje, extra);
  };
  const registro = { info: anotar("INFO"), aviso: anotar("AVISO"), error: anotar("ERROR"), carpeta: registroBase.carpeta, guardarIntento: registroBase.guardarIntento };
  // Una tarjeta que vuelve de una reparación trae lo que falló antes: las etapas lo meten en el prompt.
  const reparacion = reparacionDeLaTarjeta(tarjeta);
  if (reparacion && !tarjeta.reparacion) tarjeta = { ...tarjeta, reparacion };
  const conReparaciones = typeof tarjeta.topeReparaciones === "number";
  let vencida = false;
  // El latido que va en camino: se espera al terminar, para que no llegue al CRM después del resultado.
  let latidoEnVuelo = null;
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
  const reloj = setInterval(() => {
    latidoEnVuelo = latir();
  }, Math.max(1, config.tiempos.latidoSegundos) * 1000);
  const pausar = (motor) => {
    const hasta = motores.pausar(motor);
    registro.aviso(`pausa: ${nombreDelMotor(motor)} llegó a su límite de uso; no lo uso hasta ${new Date(hasta).toISOString()}`);
  };
  Object.assign(vivo, {
    etapa: ETAPA_VISIBLE[hacer] ?? "construyendo",
    lugar: "aizen1",
    modelo: modeloDeLaSesion(config, motores, tarjeta, hacer, reparacion),
    motor: hacer === "subir" ? null : (motores.motorDe(hacer) ?? null),
    inicioEn: vivo.inicioEn ?? Date.now(),
    linkWorkflow: null,
  });
  const fase = (etapa, extra = {}) => Object.assign(vivo, { etapa }, extra);
  const contexto = { config, registro, senal: control.signal, motorDe: motores.motorDe, alLimite: pausar, medidor, otrasSesiones, fase };
  try {
    const etapa = ETAPAS[hacer];
    if (!etapa) throw new ErrorDeEtapa(`El CRM pidió "${hacer}", que este Coordinador no sabe hacer (¿hay que actualizarlo?).`);
    const salida = await etapa(contexto, tarjeta);
    if (vencida) throw new ErrorDeEtapa("La tarjeta venció en el CRM mientras se trabajaba.");
    let respuesta;
    if (hacer === "planear") respuesta = await crm.plan(tarjeta.id, salida.plan);
    else if (hacer === "construir") respuesta = await crm.resultado(tarjeta.id, salida);
    else respuesta = await crm.subida(tarjeta.id, { commit: salida.commit, version: salida.version, linkCommit: salida.linkCommit });
    const conMotor =
      hacer === "planear"
        ? `, motor: ${salida.motor}${salida.modelo ? ` (${nombreDelModelo(salida.modelo)})` : ""}`
        : hacer === "construir" && salida.motor?.construir
          ? `, motor: ${salida.motor.construir}${salida.modelo?.construir ? ` (${nombreDelModelo(salida.modelo.construir)})` : ""}`
          : "";
    registro.info(`listo "${tarjeta.titulo}" (${hacer}${conMotor})${respuesta?.estado ? `: quedó ${respuesta.estado}` : ""}`);
    // estado = SUBIENDO: se construyó y sube sola; el que llama la toma enseguida, sin esperar el minuto.
    return { ok: true, estado: respuesta?.estado ?? null };
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    if (vencida) {
      registro.error(`"${tarjeta.titulo}" venció en el CRM: ${motivo}`);
      return { ok: false, motivo, vencida: true };
    }
    if (error?.limiteDeUso) {
      // No es culpa de la tarjeta: vuelve a esperar su turno, sin ERROR, y ese motor se pausa.
      const quien = error.motor ? `${nombreDelMotor(error.motor)} llegó a su límite de uso` : "Ningún motor disponible";
      registro.aviso(`"${tarjeta.titulo}" (${hacer}): ${quien}; la suelto sin error para reintentarla después`);
      if (error.motor && !motores.pausadoHasta(error.motor)) pausar(error.motor);
      await soltar(
        crm,
        registro,
        tarjeta,
        `${quien}: se reintenta después. ${motivo}`,
        conReparaciones ? { categoria: "limite_claude", causa: enUnaLinea(`${quien}: se reintenta cuando se reinicie su cupo`), error: motivo.slice(0, 6000), etapa: hacer } : undefined,
      );
      return { ok: false, motivo, limiteDeUso: true, motor: error.motor ?? null };
    }
    registro.error(`"${tarjeta.titulo}" (${hacer}) falló: ${motivo}`);
    if (conReparaciones) return manejarFalla({ crm, config, registro, contexto, bitacora }, tarjeta, hacer, error);
    try {
      await crm.error(tarjeta.id, motivo, error?.zonas, error?.reversion);
    } catch (otro) {
      registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
    }
    return { ok: false, motivo, zonas: error?.zonas ?? [] };
  } finally {
    clearInterval(reloj);
    await latidoEnVuelo;
  }
}

async function soltar(crm, registro, tarjeta, motivo, extra) {
  try {
    await crm.soltar(tarjeta.id, motivo.slice(0, 1000), extra);
    return true;
  } catch (error) {
    registro.error(`no se pudo soltar "${tarjeta.titulo}": ${error.message}`);
    return false;
  }
}

/**
 * Una etapa falló y el CRM entiende reparaciones: diagnosticar, decidir y hacerlo (ver el comentario de arriba).
 * Nunca lanza: lo que no se pueda avisar al CRM se anota en el log (la tarjeta venció por latido y el CRM la ve).
 */
async function manejarFalla({ crm, config, registro, contexto, bitacora }, tarjeta, hacer, error) {
  const motivo = error instanceof Error ? error.message : String(error);
  const textoLog = bitacora.join("\n");
  // 1. El error completo y el log, ANTES de diagnosticar.
  const rutaLog = registro.guardarIntento?.({
    tarjetaId: tarjeta.id,
    etapa: hacer,
    texto: [`Tarjeta: ${tarjeta.titulo} (${tarjeta.id})`, `Etapa: ${hacer}`, `Intento: ${tarjeta.intentos ?? "?"}, reparaciones: ${tarjeta.reparaciones ?? 0}`, "", "ERROR:", motivo, "", "LOG DE LA SESIÓN:", textoLog].join("\n"),
  });
  if (rutaLog) registro.info(`guardé el log del intento en ${rutaLog}`);

  // 2. Diagnóstico: por reglas; una causa desconocida la lee una sesión corta de Claude (solo lectura).
  let diagnostico = diagnosticar({ error, etapa: hacer, textoLog, tarjeta, recursos: recursosDe(contexto, config) });
  if (diagnostico.categoria === "otra" && rutaLog && config.reparar?.diagnosticoConClaude && !error?.reversion && !contexto.senal?.aborted) {
    try {
      const causa = await diagnosticarConClaude(contexto, { rutaLog, error: diagnostico.error });
      if (causa) diagnostico = { ...diagnostico, causa };
    } catch (otro) {
      registro.aviso(`no se pudo diagnosticar con Claude (queda la causa por reglas): ${String(otro.message).split("\n")[0]}`);
    }
  }

  // 3. Decidir.
  const estrategiaActual = tarjeta.reparacion?.estrategia;
  const modeloConstruir = estrategiaActual === "opus" ? (config.modelos?.planear ?? "opus") : modeloDelPaso(config, "construir", tarjeta);
  const decision = decidir({ diagnostico, tarjeta, etapa: hacer, config, archivosCambiados: error?.archivosCambiados ?? undefined, reversion: error?.reversion ?? null, modeloConstruir });
  registro.info(`diagnóstico: ${diagnostico.categoria} — ${diagnostico.causa}; decisión: ${decision.accion} (${decision.motivo})`);
  const resultado = { ok: false, motivo, zonas: error?.zonas ?? [], categoria: diagnostico.categoria, accion: decision.accion };
  const intento = { etapa: hacer, categoria: diagnostico.categoria, causa: diagnostico.causa, error: diagnostico.error };

  // 4. Hacerlo.
  if (decision.accion === "esperar") {
    if (decision.arreglo === "sin_claude") await arreglarSinClaude(contexto, tarjeta, diagnostico.categoria, registro);
    await soltar(crm, registro, tarjeta, `${diagnostico.causa} Se reintenta después.`, intento);
    return resultado;
  }
  if (decision.accion === "partir") {
    try {
      const partes = await partirTarea(contexto, tarjeta, { causa: diagnostico.causa, error: diagnostico.error });
      await crm.partir(tarjeta.id, { causa: diagnostico.causa, error: diagnostico.error, partes });
      registro.info(`la tarea se partió en ${partes.length} partes: ${partes.map((parte) => parte.titulo).join(" | ")}`);
      return { ...resultado, partes: partes.length };
    } catch (otro) {
      if (otro?.limiteDeUso) {
        registro.aviso("el límite de uso llegó al partir: se suelta para reintentar después");
        await soltar(crm, registro, tarjeta, `${otro.message}`.slice(0, 500), { ...intento, categoria: "limite_claude", causa: enUnaLinea("Claude llegó al límite de uso al dividir la tarea") });
        return { ...resultado, accion: "esperar", categoria: "limite_claude" };
      }
      registro.aviso(`no se pudo partir (${String(otro.message).split("\n")[0]}): se repara o se escala`);
      // Sigue: reparar si quedan, si no escalar.
      const quedan = (Number(tarjeta.reparaciones) || 0) < (Number(tarjeta.topeReparaciones) || TOPE_DE_REPARACIONES);
      decision.accion = quedan ? "reparar" : "escalar";
      resultado.accion = decision.accion;
    }
  }
  if (decision.accion === "reparar") {
    const causa = decision.estrategia ? `${enUnaLinea(diagnostico.causa, 170)} [estrategia: ${decision.estrategia}]` : diagnostico.causa;
    try {
      const respuesta = await crm.reparar(tarjeta.id, { ...intento, causa, estrategia: decision.estrategia });
      registro.info(`a reparar: la tarjeta vuelve a la fila${respuesta?.reparaciones ? ` (reparación ${respuesta.reparaciones} de ${tarjeta.topeReparaciones})` : ""}`);
      return resultado;
    } catch (otro) {
      if (otro?.status !== 409) {
        registro.error(`no se pudo pedir la reparación al CRM: ${otro.message}`);
        return resultado;
      }
      registro.aviso(`el CRM no deja reparar más (${otro.message}): se escala`);
      resultado.accion = "escalar";
    }
  }
  // Escalar: el resumen de máximo 3 líneas para el dueño; el detalle técnico queda en "Detalles técnicos".
  const resumen = resumenDeEscalada({ tarjeta, intentos: tarjeta.ultimosIntentos, diagnostico });
  try {
    await crm.error(tarjeta.id, resumen, error?.zonas, error?.reversion, { ...intento, resumen });
  } catch (otro) {
    registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
  }
  return { ...resultado, accion: "escalar" };
}

/** CPU y memoria de ahora (si hay medidor) para saber si un "se pasó del tiempo" fue por el PC lleno. */
function recursosDe(contexto, config) {
  if (!contexto.medidor) return null;
  try {
    return { ...contexto.medidor.medir(), limites: config.limites };
  } catch {
    return null;
  }
}

/** pc_sobrecargado y carpeta_trabada se arreglan sin una sesión de Claude: cerrar procesos, borrar .next/lock y limpiar la carpeta. */
async function arreglarSinClaude(contexto, tarjeta, categoria, registro) {
  try {
    if (categoria === "carpeta_trabada") {
      await limpiarCarpetasDeTrabajo(contexto, tarjeta);
      registro.info("limpié las carpetas de trabajo de la tarjeta (procesos, .next/lock y el worktree)");
    } else {
      registro.info("el PC está saturado: la tarjeta se suelta y no se toma otra hasta que baje (config.limites.esperaMaximaMinutos)");
    }
  } catch (error) {
    registro.aviso(`no se pudo limpiar del todo: ${error.message}`);
  }
}

/** Un registro que antepone "[s2 abcd1234]" a cada línea: el log dice qué tarjeta corre en cada sesión. */
function registroDeLaSesion(registro, etiqueta) {
  return {
    info: (mensaje, extra) => registro.info(`[${etiqueta}] ${mensaje}`, extra),
    aviso: (mensaje, extra) => registro.aviso(`[${etiqueta}] ${mensaje}`, extra),
    error: (mensaje, extra) => registro.error(`[${etiqueta}] ${mensaje}`, extra),
    carpeta: registro.carpeta,
    guardarIntento: registro.guardarIntento?.bind(registro),
  };
}

/**
 * El planificador: varias tarjetas a la vez, hasta config.maxParalelo.
 *   llenar()        toma tarjetas hasta llenar los cupos (o hasta que no haya, choquen o falten recursos).
 *   esperar(ms)     duerme hasta ms, o menos si terminó una sesión (hay un cupo libre).
 *   esperarTodas()  espera que terminen las que corren (al salir).
 */
export function crearPlanificador({
  crm,
  config,
  registro,
  medidor = crearMedidor(),
  motores = crearEstadoDeMotores(config),
  vigilante = crearVigilanteDeUso({ config, registro, crm, estado: motores, entorno: entornoSeguro() }),
}) {
  const max = config.maxParalelo;
  /** sesión (1..max) -> { tarjeta, hacer, huella, promesa } */
  const sesiones = new Map();
  let despertar = null;
  // Terminó una sesión mientras no se esperaba: la próxima espera no duerme.
  let cupoNuevo = false;
  let ultimoAviso = "";
  let ultimoSinMotor = "";
  // Desde cuándo se espera al PC antes de tomar la primera tarjeta (null = no se espera).
  let esperaPcDesde = null;
  // Para el panel "Coordinador en vivo": por qué no se abre otra sesión (PC lleno) y las que esperan en fila por chocar.
  let pcEspera = null;
  let esperasDeFila = new Map();

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
    const vivo = { inicioEn: Date.now() };
    const sesion = { tarjeta, hacer, huella, vivo };
    sesiones.set(n, sesion);
    contarCorriendo();
    esperaPcDesde = null;
    sesion.promesa = procesar({ crm, config, registro: suRegistro, motores, medidor, otrasSesiones: () => Math.max(0, sesiones.size - 1), vivo }, tarjeta, hacer)
      .catch((error) => {
        suRegistro.error(`la sesión se cayó: ${error?.message ?? error}`);
        return { ok: false };
      })
      .then((resultado) => {
        if (resultado?.estado === "SUBIENDO") suRegistro.info("construida y sube sola: pasa a la cola de subida");
        return resultado;
      })
      .finally(() => {
        sesiones.delete(n);
        if (!sesiones.size) esperasDeFila = new Map();
        contarCorriendo();
        if (despertar) despertar();
        else cupoNuevo = true;
      });
  }

  /** Las etapas que hoy no tienen motor (Codex en pausa sin respaldo, los dos agotados…). */
  function etapasSinMotor() {
    return ["planear", "construir"].filter((hacer) => motorDeLaEtapa(motores, hacer) === null);
  }

  async function llenar() {
    await vigilante?.vigilar();
    pcEspera = null;
    while (sesiones.size < max) {
      const sinMotor = etapasSinMotor();
      if (sinMotor.length) {
        const pausas = ["claude", "codex"]
          .filter((motor) => motores.pausadoHasta(motor))
          .map((motor) => `${nombreDelMotor(motor)} hasta ${new Date(motores.pausadoHasta(motor)).toISOString()}`);
        const clave = `${sinMotor.join(",")}-${pausas.join(",")}`;
        if (clave !== ultimoSinMotor) registro.info(`sin motor para ${sinMotor.join(" ni ")} (en pausa: ${pausas.join(", ") || "ninguno"}): esas esperan`);
        ultimoSinMotor = clave;
      } else ultimoSinMotor = "";
      // Sin sesiones y con el PC lleno (algo más lo está usando): se espera hasta limites.esperaMaximaMinutos
      // antes de tomar la primera, y después se toma igual (una CPU ocupada por otra cosa no deja todo quieto).
      if (sesiones.size === 0) {
        const esperaMs = (config.limites.esperaMaximaMinutos ?? 0) * 60_000;
        const falta = esperaMs > 0 ? faltanRecursos(medidor.medir(), config.limites) : null;
        if (!falta) esperaPcDesde = null;
        else {
          esperaPcDesde ??= Date.now();
          if (Date.now() - esperaPcDesde < esperaMs) {
            pcEspera = falta;
            avisarUnaVez("pc-espera", `espero al PC antes de tomar una tarjeta (${falta}); como mucho ${config.limites.esperaMaximaMinutos} min`);
            return;
          }
          avisarUnaVez("pc-sigue", `el PC sigue lleno (${falta}) pero ya esperé ${config.limites.esperaMaximaMinutos} min: tomo igual`);
        }
      }
      if (sesiones.size > 0) {
        const falta = faltanRecursos(medidor.medir(), config.limites);
        if (falta) {
          pcEspera = falta;
          avisarUnaVez(`recursos-${sesiones.size}`, `no abro otra sesión (${sesiones.size}/${max} corriendo): ${falta}`);
          return;
        }
      }
      const corriendo = [...sesiones.values()].map((s) => s.huella);
      let excluir = [];
      if (corriendo.length || sinMotor.length) {
        const { candidatas = [] } = await crm.candidatas();
        const chocan = corriendo.length ? candidatasQueChocan(candidatas, corriendo, config.repos) : {};
        for (const c of candidatas) if (!chocan[c.id] && sinMotor.includes(c.hacer)) chocan[c.id] = `(sin motor para ${c.hacer})`;
        excluir = Object.keys(chocan);
        esperasDeFila = new Map(Object.entries(chocan).map(([id, motivo]) => [id, String(motivo).replace(/^\(|\)$/g, "")]));
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
    /**
     * Al arrancar: el CRM suelta (sin error) todo lo que el proceso anterior dejó con candado. Un CRM que no
     * conoce /arranque (404) no es problema: lo viejo vence solo.
     */
    async iniciar() {
      try {
        const respuesta = await crm.arranque();
        registro.info(`arranque: el CRM soltó ${respuesta?.sueltas?.length ?? 0} tarjeta(s) que había dejado el proceso anterior`);
        return respuesta?.sueltas ?? [];
      } catch (error) {
        registro.aviso(`arranque: no se pudo soltar lo anterior (${error.message}); lo que quedó vence solo`);
        return [];
      }
    },
    corriendo: () => sesiones.size,
    /**
     * Para el latido del panel "Coordinador en vivo": las tareas en las manos (etapa, dónde, modelo, intento o
     * reparación), si espera que el PC se desocupe, las que esperan en fila por chocar y el uso de los motores.
     */
    estado() {
      const tareas = [...sesiones.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, { tarjeta, vivo }]) => ({
          tarjetaId: tarjeta.id,
          titulo: tarjeta.titulo,
          etapa: vivo.etapa,
          lugar: vivo.lugar,
          modelo: vivo.modelo ?? null,
          motor: vivo.motor ?? null,
          inicioEn: new Date(vivo.inicioEn).toISOString(),
          intento: tarjeta.intentos ?? null,
          reparacion: Number(tarjeta.reparaciones) || 0,
          reparacionDe: Number(tarjeta.topeReparaciones) || null,
          linkWorkflow: vivo.linkWorkflow ?? null,
        }));
      return {
        tareas,
        esperandoPc: Boolean(pcEspera),
        motivoEspera: pcEspera,
        esperas: [...esperasDeFila.entries()].map(([tarjetaId, motivo]) => ({ tarjetaId, motivo })),
        uso: motores.resumenDeUso(),
      };
    },
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
