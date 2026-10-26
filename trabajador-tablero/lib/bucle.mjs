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
// Reparto aizen1 / nube (25-oct-2026, decisión del dueño, reglas fijas sin IA): aizen1 corre como MÁXIMO
// config.maxParalelo (2) tareas a la vez. Al CONSTRUIR, una tarea GRANDE (nube.mjs: esTareaGrande) va SIEMPRE a la
// nube con `claude --cloud`; una chica va a aizen1 si tiene puesto; si aizen1 ya tiene todos sus puestos ocupados, la
// siguiente aprobada también va a la nube (desborde). Planear y subir siguen en aizen1 y esperan su puesto en fila.
// Las tareas de la nube NO ocupan puesto de aizen1 (tope de seguridad aparte: config.nube.maxTareas).
//
// Motores (23-oct-2026, motores.mjs): el estado de los motores es uno solo para todas las sesiones.
// Si Codex o Claude llegan a su límite, ESE motor se pausa (Codex pausaLimiteCodexMinutos, Claude
// pausaLimiteMinutos) y sus pasos esperan o pasan al otro según config.motores; las candidatas cuyo paso
// no tiene motor van en `excluir`. Cada config.vigilarUsoMinutos se mira el uso de Claude: sobre
// config.umbralClaude todos los pasos van con Codex y sale UN aviso por WhatsApp por cruce.
// Escoger y partir (25-oct-2026, reparto.mjs y cola.mjs): de las candidatas que no chocan se toma la más cerca de HECHO,
// la que desbloquea a otras y la más chica (las demás van en `excluir`); una tarea de aizen1 muy grande se parte
// ANTES de construirla; y los pasos pesados (npm ci, lint, tsc, build, pruebas) de todas las sesiones pasan por UNA
// cola en aizen1 (config.colaPesada.maximo, 1 por defecto), así 3 sesiones no compilan a la vez en un i3 de 2 núcleos.
import { candidatasQueChocan, huellaDeTarjeta, motivoDeChoque } from "./choques.mjs";
import { crearColaPesada } from "./cola.mjs";
import { debePartirAntes, ordenarCandidatas, partesSinAlcanceNuevo } from "./reparto.mjs";
import { TOPE_DE_REPARACIONES, decidir, diagnosticar, enUnaLinea, resumenDeEscalada } from "./diagnostico.mjs";
import { ErrorDeEtapa, construir, diagnosticarConClaude, entornoSeguro, limpiarCarpetasDeTrabajo, partirTarea, planear, subir } from "./etapas.mjs";
import { idCorto } from "./git.mjs";
import { modeloDelPaso, nombreDelModelo } from "./modelos.mjs";
import { crearEstadoDeMotores, crearVigilanteDeUso, motorDeLaEtapa, nombreDelMotor } from "./motores.mjs";
import { esTareaGrande } from "./nube.mjs";
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
// "nube" (26-oct-2026): lo que verificó la nube cambió al subir; la reparación se vuelve a construir y verificar en la nube.
const MARCA_DE_ESTRATEGIA = /\s*\[estrategia: (opus|partir|nube)\]\s*$/;

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

/** La hora (Bogotá) en que vuelve el motor, para el WhatsApp: "3:20 p. m.". */
export function horaDeVuelta(hasta) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(hasta));
}

/**
 * WhatsApp al dueño (tipo "limite") SOLO cuando se agotó el uso y no queda otro motor para planear ni construir: todo
 * quedó en pausa. Si el otro motor (Codex) sigue disponible, el trabajo continúa y no hay nada que avisar. El CRM
 * pone el link, calla de noche y no repite el mismo aviso antes de 3 horas. Nunca lanza ni espera la respuesta.
 */
export function avisarLimiteSiTodoQuedoEnPausa(crm, registro, motores, hasta) {
  if (!["planear", "construir"].every((hacer) => motorDeLaEtapa(motores, hacer) === null)) return false;
  const texto = `⚠️ Sistemas en pausa: se agotó el uso de Claude y no queda otro motor.\nVuelve a las ${horaDeVuelta(hasta)} (hora de Bogotá).`;
  Promise.resolve()
    .then(() => crm.aviso(texto, "limite"))
    .catch((error) => registro.aviso(`no salió el aviso del límite por WhatsApp (${error?.status ?? "sin respuesta"}): ${error?.message ?? error}`));
  return true;
}

export async function procesar({ crm, config, registro: registroBase, motores = crearEstadoDeMotores(config), medidor = null, otrasSesiones = null, vivo = {}, lugar = "aizen1", puestoParaVerificar = null, colaPesada = null, etiqueta = "" }, tarjeta, hacer) {
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
  // Construyendo, el latido le dice al CRM dónde (aizen1 o nube) y el link de la sesión: en la nube el tope es de 180 min.
  const datosDelLatido = () => (hacer === "construir" ? { lugar: lugar === "nube" ? "nube" : "aizen1", ...(vivo.linkSesion ? { sesion: vivo.linkSesion } : {}) } : undefined);
  const latir = async () => {
    try {
      await crm.latido(tarjeta.id, datosDelLatido());
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
    avisarLimiteSiTodoQuedoEnPausa(crm, registro, motores, hasta);
  };
  const enNube = lugar === "nube" && hacer === "construir";
  Object.assign(vivo, {
    etapa: ETAPA_VISIBLE[hacer] ?? "construyendo",
    lugar: enNube ? "nube" : "aizen1",
    modelo: enNube ? null : modeloDeLaSesion(config, motores, tarjeta, hacer, reparacion),
    motor: enNube ? "claude" : hacer === "subir" ? null : (motores.motorDe(hacer) ?? null),
    inicioEn: vivo.inicioEn ?? Date.now(),
    linkWorkflow: null,
    linkSesion: null,
  });
  const fase = (etapa, extra = {}) => Object.assign(vivo, { etapa }, extra);
  const contexto = { config, registro, senal: control.signal, motorDe: motores.motorDe, alLimite: pausar, medidor, otrasSesiones, fase, puestoParaVerificar, colaPesada, etiqueta, lugar: enNube ? "nube" : "aizen1" };
  try {
    const etapa = ETAPAS[hacer];
    if (!etapa) throw new ErrorDeEtapa(`El CRM pidió "${hacer}", que este Coordinador no sabe hacer (¿hay que actualizarlo?).`);
    if (hacer === "construir" && !enNube && conReparaciones) {
      const partida = await partirAntesDeConstruir({ crm, config, registro, contexto }, tarjeta);
      if (partida) return { ok: true, estado: "EN_CURSO", partes: partida };
    }
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
    if (error?.esperaDeCola) {
      // Esperó demasiado turno en la cola de pasos pesados antes de empezar (etapas.mjs: conTurno): vuelve a la fila del
      // tablero sin ERROR ni contar el intento, ANTES de que venza el candado del CRM (que sí la pasaría a ERROR).
      registro.aviso(`"${tarjeta.titulo}" (${hacer}): ${motivo}`);
      await soltar(crm, registro, tarjeta, `Espera en fila: ${motivo}`);
      return { ok: false, motivo, esperaDeCola: true };
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

/**
 * PARTIR ANTES de construir (25-oct-2026, reparto.mjs: debePartirAntes): una tarea de aizen1 con un plan muy grande se
 * parte en 2 a 4 partes chicas, en orden, en vez de gastar 90 min y caerse por tiempo o por choque con main. Las partes
 * las crea el CRM (/partir) en PLAN_APROBADO, heredando la aprobación de la madre: eso vale SOLO si no agregan alcance
 * (partesSinAlcanceNuevo); si agregan, o si partir falla, se construye la tarea entera como siempre.
 * Devuelve cuántas partes quedaron, o 0 si no se partió. El límite de uso de Claude se deja subir (la tarjeta se suelta).
 */
async function partirAntesDeConstruir({ crm, config, registro, contexto }, tarjeta) {
  const repo = config.repos[tarjeta.repo];
  const decision = debePartirAntes(tarjeta, { partir: config.partir, carpetaMigraciones: repo?.carpetaMigraciones ?? undefined, sinChoque: repo?.sinChoque });
  if (!decision.partir) return 0;
  registro.info(`tarea grande (${decision.motivo}): la parto en partes chicas antes de construir`);
  const causa = enUnaLinea(`Tarea grande: ${decision.motivo}. Se partió antes de construir para que no se caiga por tiempo ni choque con main.`);
  let partes;
  try {
    partes = await partirTarea(contexto, tarjeta, { causa, error: "" });
  } catch (error) {
    if (error?.limiteDeUso) throw error;
    registro.aviso(`no se pudo partir antes de construir (${String(error?.message ?? error).split("\n")[0]}): se construye entera`);
    return 0;
  }
  const alcance = partesSinAlcanceNuevo(tarjeta.plan, partes, { sinChoque: repo?.sinChoque });
  if (!alcance.ok) {
    registro.aviso(`las partes tocan módulos que el plan aprobado no nombra (${alcance.fuera.join(", ")}): no heredan la aprobación; se construye entera`);
    return 0;
  }
  try {
    await crm.partir(tarjeta.id, { causa, error: "", partes, categoria: "tarea_muy_grande", etapa: "construir" });
  } catch (error) {
    registro.aviso(`el CRM no dejó partir (${error.message}): se construye entera`);
    return 0;
  }
  registro.info(`la tarea se partió en ${partes.length} partes (antes de construir): ${partes.map((parte) => parte.titulo).join(" | ")}`);
  return partes.length;
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
  // Lo que verificó la nube ya no es lo que se subiría: la reparación va a la NUBE (nunca a compilar en aizen1).
  if (error?.verificarEnNube && decision.accion === "reparar") decision.estrategia = "nube";
  registro.info(`diagnóstico: ${diagnostico.categoria} — ${diagnostico.causa}; decisión: ${decision.accion} (${decision.motivo})${decision.estrategia === "nube" ? "; se verifica otra vez en la nube" : ""}`);
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
      // Las partes heredan la aprobación de la madre: solo si no agregan alcance (25-oct-2026).
      const repo = config.repos[tarjeta.repo];
      const alcance = partesSinAlcanceNuevo(tarjeta.plan, partes, { sinChoque: repo?.sinChoque });
      if (!alcance.ok) throw new Error(`las partes tocan módulos que el plan aprobado no nombra (${alcance.fuera.join(", ")})`);
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
 * Un semáforo de `maximo` puestos: `tomar(senal)` espera su turno y devuelve la función que lo libera (una sola vez).
 * Si la señal se aborta esperando, rechaza. Lo usan las verificaciones de lo que vuelve de la nube.
 */
export function crearSemaforo(maximo) {
  let usados = 0;
  const cola = [];
  const entregar = () => {
    while (cola.length && usados < maximo) {
      usados += 1;
      cola.shift().entregar();
    }
  };
  return {
    tomar(senal) {
      return new Promise((resolver, rechazar) => {
        let liberada = false;
        const liberar = () => {
          if (liberada) return;
          liberada = true;
          usados -= 1;
          entregar();
        };
        const entrada = {
          entregar: () => {
            senal?.removeEventListener?.("abort", cancelar);
            resolver(liberar);
          },
        };
        function cancelar() {
          const indice = cola.indexOf(entrada);
          if (indice >= 0) cola.splice(indice, 1);
          rechazar(new Error("Se canceló la espera de un puesto para verificar: la tarjeta venció en el CRM."));
        }
        if (senal?.aborted) {
          cancelar();
          return;
        }
        cola.push(entrada);
        senal?.addEventListener?.("abort", cancelar, { once: true });
        entregar();
      });
    },
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
  medidor = crearMedidor({ muestras: Math.max(1, Math.round(((config.limites?.cpuPromedioMinutos ?? 3) * 60) / 5)) }),
  motores = crearEstadoDeMotores(config),
  vigilante = crearVigilanteDeUso({ config, registro, estado: motores, entorno: entornoSeguro() }),
  // La cola de pasos pesados se puede dar hecha (las pruebas la llenan a mano); undefined = la de la configuración.
  colaPesada: colaDada = undefined,
}) {
  const max = config.maxParalelo;
  const nubeConfig = config.nube ?? { activa: false, maxTareas: 0, maxArchivosChica: 8 };
  /** sesión de aizen1 (1..max) -> { tarjeta, hacer, huella, promesa } */
  const sesiones = new Map();
  /** Las que se construyen en la nube (no ocupan puesto de aizen1): id de la tarjeta -> { tarjeta, hacer, huella, promesa } */
  const enNube = new Map();
  // Lo que vuelve de la nube se verifica en aizen1 (npm ci, build…): no más a la vez que puestos tiene aizen1.
  const puestosDeVerificacion = crearSemaforo(Math.max(1, max));
  // La cola de pasos pesados de aizen1 (cola.mjs): una sola para todas las sesiones (0 = sin cola, como antes).
  const colaPesada = colaDada !== undefined ? colaDada : (config.colaPesada?.maximo ?? 0) > 0 ? crearColaPesada({ maximo: config.colaPesada.maximo }) : null;
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
    const lista = [
      ...[...sesiones.entries()].sort(([a], [b]) => a - b).map(([n, s]) => `s${n} "${s.tarjeta.titulo}" (${s.hacer}, ${s.tarjeta.repo})`),
      ...[...enNube.values()].map((s) => `nube "${s.tarjeta.titulo}" (${s.hacer}, ${s.tarjeta.repo})`),
    ];
    registro.info(`corriendo ${sesiones.size}/${max} tarjetas al tiempo en aizen1${enNube.size ? ` y ${enNube.size} en la nube` : ""}${lista.length ? `: ${lista.join("; ")}` : ""}`);
  }

  /** ¿Se puede construir en la nube? Prendida en la configuración y con Claude como motor de construir (y no en pausa por su límite). */
  const nubeUtilizable = () => nubeConfig.activa && motorDeLaEtapa(motores, "construir") === "claude";

  /**
   * LA REGLA DE REPARTO (fija, sin IA). A dónde iría `tarjeta` en esta etapa, según lo que hay libre:
   *   { donde: "aizen1" | "nube", motivo } o null (no hay dónde ahora: espera en fila).
   * Planear y subir siempre van a aizen1. Al CONSTRUIR: GRANDE -> nube; chica -> aizen1 si hay puesto (y el PC aguanta),
   * si no, DESBORDE -> nube.
   * COLA EN FILA (26-oct-2026): construir en aizen1 empieza con npm ci y el lint de main, que van ÚLTIMOS en la cola de
   * pasos pesados (prioridad "preparar"). Si la cola ya tiene trabajo esperando, una tarjeta nueva NO se toma para
   * construir en aizen1: espera en la fila del tablero sin candado (el tope de 90 min del CRM corre desde que se toma).
   */
  function dondeCorre(tarjeta, hacer, { aizenOk, nubeUsable, nubeLibre, colaEnFila = 0 }) {
    const aizenParaEsta = aizenOk && !(hacer === "construir" && colaEnFila > 0);
    if (hacer !== "construir" || !nubeUsable) return aizenParaEsta ? { donde: "aizen1", motivo: null } : null;
    const { grande, motivos } = esTareaGrande(tarjeta, { repo: config.repos[tarjeta.repo], maxArchivosChica: nubeConfig.maxArchivosChica });
    if (grande) return nubeLibre ? { donde: "nube", motivo: `es grande: ${motivos.join("; ")}` } : null;
    if (aizenParaEsta) return { donde: "aizen1", motivo: null };
    const porque = aizenOk ? `la cola de pasos pesados de aizen1 tiene ${colaEnFila} en fila` : `aizen1 no tiene puesto libre (${sesiones.size}/${max})`;
    return nubeLibre ? { donde: "nube", motivo: `desborde: ${porque}` } : null;
  }

  /** Por qué una candidata no tiene dónde correr ahora (para el log y el panel "esperan en fila"). */
  function motivoDeEspera(hacer, { aizenOk, nubeUsable, colaEnFila = 0 }) {
    if (hacer === "construir" && aizenOk && colaEnFila > 0 && !nubeUsable) return `espera: la cola de pasos pesados de aizen1 tiene ${colaEnFila} en fila`;
    return hacer === "construir" && nubeUsable ? "espera un puesto en la nube" : "espera un puesto en aizen1";
  }

  /** Cuántos pasos pesados esperan turno en aizen1 (0 sin cola). */
  const colaEnFila = () => colaPesada?.estado().esperando ?? 0;

  const cupoLibre = () => {
    for (let n = 1; n <= max; n += 1) if (!sesiones.has(n)) return n;
    return null;
  };

  function arrancar(tarjeta, hacer, huella, { donde = "aizen1", motivo = null } = {}) {
    const nube = donde === "nube";
    const n = nube ? null : cupoLibre();
    const suRegistro = registroDeLaSesion(registro, nube ? `nube ${idCorto(tarjeta.id)}` : `s${n} ${idCorto(tarjeta.id)}`);
    suRegistro.info(`tomé "${tarjeta.titulo}" (${tarjeta.id}, ${tarjeta.repo}) para ${hacer}${nube ? ` — se construye en la nube (${motivo})` : ""}`);
    const vivo = { inicioEn: Date.now() };
    const sesion = { tarjeta, hacer, huella, vivo };
    if (nube) enNube.set(tarjeta.id, sesion);
    else sesiones.set(n, sesion);
    contarCorriendo();
    if (!nube) esperaPcDesde = null;
    sesion.promesa = procesar(
      {
        crm,
        config,
        registro: suRegistro,
        motores,
        medidor,
        otrasSesiones: () => Math.max(0, sesiones.size - (nube ? 0 : 1)),
        vivo,
        lugar: donde,
        puestoParaVerificar: (senal) => puestosDeVerificacion.tomar(senal),
        colaPesada,
        etiqueta: nube ? `nube ${idCorto(tarjeta.id)}` : `s${n} ${idCorto(tarjeta.id)}`,
      },
      tarjeta,
      hacer,
    )
      .catch((error) => {
        suRegistro.error(`la sesión se cayó: ${error?.message ?? error}`);
        return { ok: false };
      })
      .then((resultado) => {
        if (resultado?.estado === "SUBIENDO") suRegistro.info("construida y sube sola: pasa a la cola de subida");
        return resultado;
      })
      .finally(() => {
        if (nube) enNube.delete(tarjeta.id);
        else sesiones.delete(n);
        if (!sesiones.size && !enNube.size) esperasDeFila = new Map();
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
    // Las que se soltaron en esta pasada porque no tenían dónde correr: no se vuelven a tomar hasta la próxima.
    const descartadas = new Map();
    for (;;) {
      const nubeUsable = nubeUtilizable();
      const nubeLibre = nubeUsable && enNube.size < nubeConfig.maxTareas;
      if (sesiones.size >= max && !nubeLibre) return;
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
      // ¿Aizen1 puede abrir otra sesión? Tiene puesto y el PC aguanta. Si no, solo la nube puede tomar tareas de construir.
      let aizenOk = sesiones.size < max;
      if (aizenOk && sesiones.size === 0) {
        const esperaMs = (config.limites.esperaMaximaMinutos ?? 0) * 60_000;
        const falta = esperaMs > 0 ? faltanRecursos(medidor.medir(), config.limites) : null;
        if (!falta) esperaPcDesde = null;
        else {
          esperaPcDesde ??= Date.now();
          if (Date.now() - esperaPcDesde < esperaMs) {
            pcEspera = falta;
            avisarUnaVez("pc-espera", `espero al PC antes de tomar una tarjeta (${falta}); como mucho ${config.limites.esperaMaximaMinutos} min`);
            aizenOk = false;
          } else avisarUnaVez("pc-sigue", `el PC sigue lleno (${falta}) pero ya esperé ${config.limites.esperaMaximaMinutos} min: tomo igual`);
        }
      }
      if (aizenOk && sesiones.size > 0) {
        const falta = faltanRecursos(medidor.medir(), config.limites);
        if (falta) {
          pcEspera = falta;
          avisarUnaVez(`recursos-${sesiones.size}`, `no abro otra sesión (${sesiones.size}/${max} corriendo): ${falta}`);
          aizenOk = false;
        }
      }
      if (!aizenOk && !nubeLibre) return;
      const estadoDeCupos = { aizenOk, nubeUsable, nubeLibre, colaEnFila: colaEnFila() };
      const corriendo = [...sesiones.values(), ...enNube.values()].map((s) => s.huella);
      let excluir = [...descartadas.keys()];
      // Siempre se miran las candidatas (25-oct-2026): también para ESCOGER cuál conviene (ordenarCandidatas).
      {
        const { candidatas = [] } = await crm.candidatas();
        const chocan = corriendo.length ? candidatasQueChocan(candidatas, corriendo, config.repos) : {};
        for (const c of candidatas) if (!chocan[c.id] && sinMotor.includes(c.hacer)) chocan[c.id] = `(sin motor para ${c.hacer})`;
        // Sin dónde correr ahora: planear y subir esperan un puesto de aizen1; una grande espera un puesto de la nube.
        for (const c of candidatas) {
          if (chocan[c.id]) continue;
          if (descartadas.has(c.id)) chocan[c.id] = `(${descartadas.get(c.id)})`;
          else if (!dondeCorre(c, c.hacer, estadoDeCupos)) chocan[c.id] = `(${motivoDeEspera(c.hacer, estadoDeCupos)})`;
        }
        excluir = [...new Set([...Object.keys(chocan), ...descartadas.keys()])];
        esperasDeFila = new Map(Object.entries(chocan).map(([id, motivo]) => [id, String(motivo).replace(/^\(|\)$/g, "")]));
        if (candidatas.length && candidatas.every((c) => excluir.includes(c.id))) {
          const enFila = candidatas.map((c) => `"${c.titulo}" ${chocan[c.id] ?? "(sin dónde correr ahora)"}`);
          avisarUnaVez(`fila-${excluir.join(",")}-${sesiones.size}-${enNube.size}`, `esperan en fila: ${enFila.join("; ")}`);
          return;
        }
        // ESCOGER: de las que sí se pueden tomar, la mejor (subir > construir > planear, la que desbloquea, la más chica);
        // las demás también van en `excluir` para que /tomar dé justo esa.
        const libres = candidatas.filter((c) => !excluir.includes(c.id));
        const elegida = ordenarCandidatas(libres)[0];
        if (elegida && libres.length > 1) excluir = [...excluir, ...libres.filter((c) => c.id !== elegida.id).map((c) => c.id)];
      }
      // El CRM cuenta las de aizen1 y las de la nube juntas: el tope que se le da es la suma.
      const respuesta = await crm.tomar({ maxParalelo: max + (nubeConfig.activa ? nubeConfig.maxTareas : 0), excluir });
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
      // La regla de reparto con la tarjeta completa (trae sus intentos: "ya falló por tamaño o recursos").
      const lugar = dondeCorre(tarjeta, hacer, estadoDeCupos);
      if (!lugar) {
        registro.info(`"${tarjeta.titulo}" no tiene dónde correr ahora (${hacer}): la suelto y espera en fila`);
        const espera = motivoDeEspera(hacer, estadoDeCupos);
        descartadas.set(tarjeta.id, espera);
        if (await soltar(crm, registro, tarjeta, `Espera en fila: no hay dónde construirla ahora (${espera}).`)) continue;
        return;
      }
      arrancar(tarjeta, hacer, huella, lugar);
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
    corriendo: () => sesiones.size + enNube.size,
    /** ¿Alguna tarjeta está subiendo a main ahora? (el trabajo de noche del manual no empieza mientras tanto). */
    subiendo: () => [...sesiones.values(), ...enNube.values()].some((sesion) => sesion.hacer === "subir"),
    /** Cuántas hay en aizen1 y cuántas en la nube (la nube no ocupa puestos de aizen1). */
    cupos: () => ({ aizen1: sesiones.size, nube: enNube.size }),
    /**
     * Para el latido del panel "Coordinador en vivo": las tareas en las manos (etapa, dónde, modelo, intento o
     * reparación), si espera que el PC se desocupe, las que esperan en fila por chocar y el uso de los motores.
     */
    estado() {
      const tareas = [...[...sesiones.entries()].sort(([a], [b]) => a - b).map(([, sesion]) => sesion), ...enNube.values()]
        .map(({ tarjeta, vivo }) => ({
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
          linkSesion: vivo.linkSesion ?? null,
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
      while (sesiones.size || enNube.size) await Promise.allSettled([...sesiones.values(), ...enNube.values()].map((s) => s.promesa));
    },
    parar: () => medidor.parar(),
  };
}
