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
// config.umbralClaude todos los pasos van con Codex (sin WhatsApp: solo avisa si todo queda en pausa).
// Escoger y partir (25-oct-2026, reparto.mjs y cola.mjs): de las candidatas que no chocan se toma la más cerca de HECHO,
// la que desbloquea a otras y la más chica (las demás van en `excluir`); una tarea de aizen1 muy grande se parte
// ANTES de construirla; y los pasos pesados (npm ci, lint, tsc, build, pruebas) de todas las sesiones pasan por UNA
// cola en aizen1 (config.colaPesada.maximo, 1 por defecto), así 3 sesiones no compilan a la vez en un i3 de 2 núcleos.
import { agenteDelRepo, anotarLeccion, leccionDe, tresLineasDe } from "./agentes.mjs";
import { candidatasQueChocan, huellaDeTarjeta, motivoDeChoque } from "./choques.mjs";
import { crearColaPesada } from "./cola.mjs";
import { debePartirAntes, ordenarCandidatas, partesSinAlcanceNuevo } from "./reparto.mjs";
import {
  CAUSAS_PARA_AVISAR_AL_CTO,
  TOPE_DE_REPARACIONES,
  causaExterna,
  causasDistintas,
  decidir,
  diagnosticar,
  enUnaLinea,
  estrategiaDeLaCausa,
  queCambiaFrenteAlAnterior,
  recortarAviso,
  resumenDeEscalada,
  sinCausa,
  sinMarcaDeEstrategia,
  textoDelAvisoDeReversion,
} from "./diagnostico.mjs";
import {
  ErrorDeEtapa,
  construir,
  diagnosticarConClaude,
  entornoSeguro,
  hayVigilanciaEnCurso,
  limpiarCarpetasDeTrabajo,
  medirConClaude,
  partirTarea,
  planear,
  revisarDeNuevo,
  sePuedeRevisarDeNuevo,
  subir,
} from "./etapas.mjs";
import { idCorto } from "./git.mjs";
import { MEDIR_POR_DEFECTO, medirTarjeta, referenciasParaDepender, textoDeLaMedida } from "./medir.mjs";
import { anotarAvisoAlCto } from "./notas-boveda.mjs";
import { notaDeYaHecho } from "./revision-previa.mjs";
import { modeloDelPaso, nombreDelModelo } from "./modelos.mjs";
import { crearEstadoDeMotores, crearVigilanteDeUso, motorDeLaEtapa, nombreDelMotor, textoDelAvisoDeLimite } from "./motores.mjs";
import { esTareaGrande, nombreDelProyecto, sesionFijaDe, sinAccesoALaNube } from "./nube.mjs";
import { crearPausaPorUso } from "./pausa-uso.mjs";
import { primeraPreguntaAbierta } from "./preguntas-abiertas.mjs";
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

/**
 * Lo que /tomar dice de intentos anteriores, armado como `tarjeta.reparacion` para el prompt de la etapa:
 * { numero, de, causa, categoria, error, estrategia, queCambia }. null si la tarjeta no viene de una reparación.
 * `queCambia` (30-oct-2026) sale de lo guardado en los intentos: la reparación de ahora frente al intento de antes.
 * (La marca de estrategia "[estrategia: opus]" que deja `reparar` en la causa está en diagnostico.mjs.)
 */
export function reparacionDeLaTarjeta(tarjeta) {
  if (tarjeta.reparacion) return tarjeta.reparacion;
  const hechas = Number(tarjeta.reparaciones) || 0;
  if (hechas < 1) return null;
  const intentos = tarjeta.ultimosIntentos ?? [];
  const indice = intentos.findLastIndex((intento) => intento?.accion === "reparar");
  const ultima = indice >= 0 ? intentos[indice] : null;
  const causa = String(ultima?.causa ?? "");
  const estrategia = estrategiaDeLaCausa(causa);
  const categoria = ultima?.categoria ?? "otra";
  const sinMarca = sinMarcaDeEstrategia(causa);
  return {
    numero: hechas,
    de: Number(tarjeta.topeReparaciones) || TOPE_DE_REPARACIONES,
    causa: sinMarca,
    categoria,
    error: tarjeta.ultimoError ?? null,
    estrategia,
    queCambia: queCambiaFrenteAlAnterior({ categoria, causa: sinMarca }, indice >= 0 ? intentos.slice(0, indice) : [], estrategia),
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

export async function procesar({ crm, config, registro: registroBase, motores = crearEstadoDeMotores(config), medidor = null, otrasSesiones = null, vivo = {}, lugar = "aizen1", puestoParaVerificar = null, colaPesada = null, etiqueta = "" }, tarjeta, hacer) {
  const control = new AbortController();
  // Pausa por uso de Claude (pausa-uso.mjs): el planificador pide detener esta sesión con `vivo.detenerPorPausa()`.
  let pausadaPorUso = false;
  vivo.detenerPorPausa = () => {
    pausadaPorUso = true;
    control.abort();
  };
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
    // Un plan con preguntas abiertas no se construye (29-oct-2026), salvo que el dueño lo haya aprobado tal cual.
    if (hacer === "construir" && conReparaciones) await frenarPlanConPreguntas({ crm, registro }, tarjeta);
    // Partir antes de construir: en aizen1 por tamaño o por partes del sistema; en la nube solo por partes del sistema
    // (el tamaño ya lo decidió esTareaGrande al mandarla allá).
    if (hacer === "construir" && conReparaciones) {
      const partida = await partirAntesDeConstruir({ crm, config, registro, contexto }, tarjeta, { soloPorPartes: enNube });
      if (partida) return { ok: true, estado: "EN_CURSO", partes: partida };
    }
    // Medir ANTES de planear (26-oct-2026): dependencias sin terminar y tarjetas muy grandes no abren la sesión de plan.
    if (hacer === "planear" && conReparaciones) {
      const previa = await medirAntesDePlanear({ crm, config, registro, contexto }, tarjeta);
      if (previa) return previa;
    }
    // Revisión previa al construir (27-oct-2026): con el plan aprobado en la mano, las dependencias que nombra se miran otra vez.
    if (hacer === "construir" && conReparaciones) {
      const previa = await esperarDependenciasAntesDeConstruir({ crm, config, registro }, tarjeta);
      if (previa) return previa;
    }
    const salida = await etapa(contexto, tarjeta);
    if (vencida) throw new ErrorDeEtapa("La tarjeta venció en el CRM mientras se trabajaba.");
    // La sesión descubrió que falta otra tarjeta, o que ya estaba hecho (commit comprobado en main): sin intento ni reparación.
    if (salida.dependeDe?.length) return esperarPorDependencia({ crm, registro }, tarjeta, hacer, salida.dependeDe);
    if (salida.yaHecho) return cerrarComoYaHecha({ crm, registro }, tarjeta, hacer, salida.yaHecho);
    let respuesta;
    if (hacer === "planear") respuesta = await crm.plan(tarjeta.id, salida.plan);
    else if (hacer === "construir") {
      // "NECESITO:" al construir: la tarjeta queda en "Por revisar" (paso: false) con el motivo; no se reintenta.
      const { necesita: _necesita, erroresViejos, ...paraElCrm } = salida;
      void _necesita;
      respuesta = await crm.resultado(tarjeta.id, paraElCrm);
      if (erroresViejos?.length) await pedirLimpieza({ crm, registro }, tarjeta, erroresViejos);
    } else {
      // Las 3 líneas con que el agente cerró construir ("Qué se hizo / Qué se ve ahora / Qué revisar juntos") viajan con la subida.
      const tres = tresLineasDe(tarjeta.resultado?.resumen);
      respuesta = await crm.subida(tarjeta.id, {
        commit: salida.commit,
        version: salida.version,
        linkCommit: salida.linkCommit,
        ...(salida.vigilancia ? { vigilancia: salida.vigilancia } : {}),
        ...(tres ? { resumenTres: tres } : {}),
      });
    }
    if (salida.necesita) await avisarQueNecesita(crm, registro, config, tarjeta, hacer, salida.necesita);
    // Subió después de fallar: queda escrito cómo se arregló (si salió bien a la primera no se anota nada).
    if (hacer === "subir" && reparacion) {
      const veces = reparacion.numero;
      anotarLaLeccion(config, registro, tarjeta, {
        resultado: "bien",
        etapa: "subir",
        diagnostico: { categoria: reparacion.categoria, causa: reparacion.causa || "falló antes de subir" },
        arreglo: `Subió después de ${veces} ${veces === 1 ? "reparación" : "reparaciones"}${reparacion.estrategia ? ` (estrategia ${reparacion.estrategia})` : ""}.`,
      });
    }
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
    if (pausadaPorUso) {
      // Se detuvo con orden porque el uso de Claude llegó al umbral: vuelve a la fila SIN ERROR y sin gastar intento.
      // Si construía en aizen1, construir() ya guardó lo escrito (intentos/<id>/trabajo.patch) y se reaplica al retomar.
      const guardado = hacer === "construir" && !enNube ? " Lo que ya se escribió queda guardado y se reaplica al retomarla." : "";
      registro.aviso(`"${tarjeta.titulo}" (${hacer}): pausa por uso de Claude; la suelto sin error ni intento`);
      await soltar(
        crm,
        registro,
        tarjeta,
        `Pausado por uso de Claude: se retoma cuando se reinicie el uso.${guardado}`,
        conReparaciones ? { categoria: "limite_claude", causa: enUnaLinea("Pausado por uso de Claude: se retoma cuando se reinicie el uso"), error: motivo.slice(0, 6000), etapa: hacer } : undefined,
      );
      return { ok: false, motivo, pausadaPorUso: true };
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
    if (error?.reversion) await avisarReversion(crm, registro, tarjeta, motivo, error.reversion);
    if (conReparaciones) return manejarFalla({ crm, config, registro, contexto, bitacora }, tarjeta, hacer, error);
    // Un CRM viejo (sin reparaciones): igual queda escrita la lección de la falla.
    anotarLaLeccion(config, registro, tarjeta, {
      resultado: "fallo",
      etapa: hacer,
      diagnostico: diagnosticar({ error, etapa: hacer, textoLog: bitacora.join("\n"), tarjeta }),
      arreglo: "Pasó al dueño (ERROR).",
    });
    try {
      // Nunca un motivo vacío (30-oct-2026): si la etapa no dijo nada, se dice en qué etapa e intento pasó.
      await crm.error(tarjeta.id, motivo.trim() ? motivo : sinCausa(hacer, tarjeta.intentos), error?.zonas, error?.reversion);
    } catch (otro) {
      registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
    }
    return { ok: false, motivo, zonas: error?.zonas ?? [] };
  } finally {
    clearInterval(reloj);
    await latidoEnVuelo;
  }
}

/** El agente del proyecto de la tarjeta, con su archivo de lecciones en la carpeta de trabajo de aizen1; null si el repo no está en la configuración. */
function agenteDeLaTarjeta(config, tarjeta) {
  const repo = config.repos?.[tarjeta.repo];
  return repo ? agenteDelRepo(repo, undefined, config.carpetaTrabajo) : null;
}

/** Anota la lección de lo que pasó con la tarjeta en el archivo de su agente. Nunca lanza: si no se puede, queda en el registro. */
function anotarLaLeccion(config, registro, tarjeta, { resultado, etapa, diagnostico, arreglo }) {
  try {
    const agente = agenteDeLaTarjeta(config, tarjeta);
    if (!agente) return;
    const estado = anotarLeccion(agente, leccionDe({ tarjeta, resultado, diagnostico, etapa, arreglo }), { registro });
    if (estado === "agregada") registro.info(`lección anotada para el ${agente.nombre} (${diagnostico?.categoria ?? "otra"})`);
  } catch (error) {
    registro.aviso(`no se pudo anotar la lección: ${error?.message ?? error}`);
  }
}

/**
 * El agente escribió "NECESITO: <clave|acceso|decisión> …": UN aviso de tipo "necesita" al dueño (WhatsApp por la línea Admin, el
 * camino que ya existe) y la tarjeta se queda esperando (construir -> Por revisar, planear -> Plan listo). No se reintenta ni se
 * escribe a ningún cliente. Si el aviso no sale, queda en el registro: la tarjeta ya está visible en el tablero con el motivo.
 */
async function avisarQueNecesita(crm, registro, config, tarjeta, hacer, necesita) {
  const agente = agenteDeLaTarjeta(config, tarjeta);
  const quien = agente?.nombre ?? "El agente";
  const donde = hacer === "planear" ? "El plan quedó listo esperando tu sí." : "La tarjeta quedó en «Por revisar» esperando tu respuesta.";
  const texto = `${quien} necesita ${{ clave: "una clave", acceso: "un acceso", decisión: "una decisión" }[necesita.tipo] ?? necesita.tipo} para "${tarjeta.titulo}": ${enUnaLinea(necesita.detalle, 400)} ${donde}`;
  try {
    await crm.aviso(recortarAviso(texto), "necesita");
  } catch (error) {
    registro.aviso(`no salió el aviso de lo que necesita el agente (${error.status ?? "sin respuesta"}): ${error.message}`);
  }
}

/**
 * Subió y hubo que deshacerlo: aviso de tipo "necesita" al dueño (WhatsApp por la línea Admin) con el motivo y los
 * commits. Si el aviso no sale, queda en el registro y la tarjeta sigue su camino.
 */
async function avisarReversion(crm, registro, tarjeta, motivo, reversion) {
  // Máximo 3 líneas y 500 caracteres (el CRM rechaza los más largos); el detalle completo queda en el tablero.
  const texto = textoDelAvisoDeReversion(tarjeta.titulo, motivo, reversion);
  try {
    await crm.aviso(texto, "necesita");
  } catch (error) {
    registro.aviso(`no salió el aviso de la reversión al dueño (${error.status ?? "sin respuesta"}): ${error.message}`);
  }
}

/**
 * PLAN CON PREGUNTAS ABIERTAS (29-oct-2026, preguntas-abiertas.mjs): no se construye un plan que dice "hay que confirmar",
 * "queda pendiente:"… o trae la sección "PREGUNTAS ABIERTAS:" con algo, si se aprobó solo (la tarjeta ykpl83z3 gastó 8 h en la
 * nube parada en esa misma duda). Va UN aviso "necesita" al dueño y se lanza el error plan_con_preguntas: decidir() lo escala
 * directo (ERROR), sin reparaciones. Si el dueño aprobó el plan tal cual (planAprobadoPorElDueno, lo dice /tomar), se construye.
 */
async function frenarPlanConPreguntas({ crm, registro }, tarjeta) {
  if (tarjeta.planAprobadoPorElDueno === true) return;
  const pregunta = primeraPreguntaAbierta(tarjeta.plan);
  if (!pregunta) return;
  registro.aviso(`el plan tiene preguntas abiertas y se aprobó solo: no lo construyo (${pregunta})`);
  try {
    await crm.aviso(recortarAviso(`"${enUnaLinea(tarjeta.titulo, 120)}" no se construye: el plan tiene preguntas abiertas.\n${enUnaLinea(pregunta, 250)}\nRespóndela en la tarjeta y apruébala de nuevo (o aprueba el plan tal cual).`), "necesita");
  } catch (error) {
    registro.aviso(`no salió el aviso del plan con preguntas (${error.status ?? "sin respuesta"}): ${error.message}`);
  }
  throw new ErrorDeEtapa(`El plan tiene preguntas abiertas: ${pregunta}`, { categoria: "plan_con_preguntas" });
}

/**
 * PARTIR ANTES de construir (25-oct-2026, reparto.mjs: debePartirAntes): una tarea de aizen1 con un plan muy grande se
 * parte en 2 a 4 partes chicas, en orden, en vez de gastar 90 min y caerse por tiempo o por choque con main. Las partes
 * las crea el CRM (/partir) en PLAN_APROBADO, heredando la aprobación de la madre: eso vale SOLO si no agregan alcance
 * (partesSinAlcanceNuevo); si agregan, o si partir falla, se construye la tarea entera como siempre.
 * Devuelve cuántas partes quedaron, o 0 si no se partió. El límite de uso de Claude se deja subir (la tarjeta se suelta).
 */
async function partirAntesDeConstruir({ crm, config, registro, contexto }, tarjeta, { soloPorPartes = false } = {}) {
  const repo = config.repos[tarjeta.repo];
  const otrosRepos = Object.keys(config.repos ?? {}).filter((clave) => clave !== tarjeta.repo);
  const decision = debePartirAntes(tarjeta, { partir: config.partir, carpetaMigraciones: repo?.carpetaMigraciones ?? undefined, sinChoque: repo?.sinChoque, otrosRepos, soloPorPartes });
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

/**
 * DEPENDE_DE (27-oct-2026): la sesión descubrió que falta algo que otra tarjeta todavía no subió a main. Se pone la flecha de dependencia
 * y la tarjeta vuelve a la fila ("Esperando a «X»") sin ERROR y sin gastar intento ni reparación: planeando vuelve a APROBADO,
 * construyendo a PLAN_APROBADO. Arranca sola cuando la otra queda HECHO. Si el CRM no la deja esperar, se suelta igual sin error.
 */
async function esperarPorDependencia({ crm, registro }, tarjeta, hacer, referencias) {
  let respuesta = null;
  try {
    respuesta = await crm.depender(tarjeta.id, { referencias, etapa: hacer });
  } catch (error) {
    registro.aviso(`no se pudo poner la dependencia de "${tarjeta.titulo}" (${error.message}): la suelto sin error ni intento`);
  }
  if (respuesta?.soltada) {
    registro.info(`"${tarjeta.titulo}": ${respuesta.esperando ?? "espera a otra tarjeta"}; la dejo en la fila sin gastar intento`);
    return { ok: true, estado: respuesta.estado ?? (hacer === "construir" ? "PLAN_APROBADO" : "APROBADO"), esperando: respuesta.esperando ?? true };
  }
  // Las tarjetas que nombró ya están HECHO (o no existen): no hay a quién esperar. Se suelta sin error y vuelve a intentarse luego.
  await soltar(crm, registro, tarjeta, `Dependencia (${referencias.join(", ")}): se reintenta después.`);
  return { ok: true, estado: respuesta?.estado ?? null, esperando: true };
}

/**
 * YA_ESTA_HECHO (27-oct-2026): el commit ya está comprobado en main (etapas.mjs). La tarjeta pasa a HECHO con la nota
 * "ya estaba hecho (commit X)", sin pedirle nada al dueño. Si el CRM no lo acepta, se anota y la tarjeta sigue como si no se hubiera dicho.
 */
async function cerrarComoYaHecha({ crm, registro }, tarjeta, hacer, yaHecho) {
  const nota = `${notaDeYaHecho(yaHecho.commit)}${yaHecho.motivo ? `: ${yaHecho.motivo}` : ""}`;
  try {
    const respuesta = await crm.yaHecha(tarjeta.id, { commit: yaHecho.commit, motivo: yaHecho.motivo, nota, etapa: hacer });
    registro.info(`"${tarjeta.titulo}": ${nota}; pasó a HECHO`);
    return { ok: true, estado: respuesta?.estado ?? "HECHO", yaHecha: true };
  } catch (error) {
    registro.aviso(`el CRM no dejó cerrar "${tarjeta.titulo}" como ya hecha (${error.message}): la suelto sin error`);
    await soltar(crm, registro, tarjeta, `Ya estaba hecho (commit ${yaHecho.commit}) pero el CRM no lo cerró: ${error.message}`.slice(0, 500));
    return { ok: true, estado: null, yaHecha: false };
  }
}

/**
 * Código limpio (27-oct-2026): main ya traía errores. La tarea no se culpa; se pide UNA sola tarjeta de limpieza por repo (el CRM busca
 * una abierta y le agrega los errores nuevos). Nunca frena a la tarea.
 */
async function pedirLimpieza({ crm, registro }, tarjeta, errores) {
  try {
    const respuesta = await crm.limpieza(tarjeta.id, { repo: tarjeta.repo, errores });
    registro.info(`main de ${tarjeta.repo} trae ${errores.length} error(es) viejo(s): ${respuesta?.creada ? "creé la tarjeta de limpieza" : "se los agregué a la tarjeta de limpieza abierta"}`);
  } catch (error) {
    registro.aviso(`no se pudo pedir la tarjeta de limpieza (${error.message}): la tarea sigue su camino`);
  }
}

/** Antes de construir: si el título, el detalle o el plan nombran una tarjeta que no está HECHO, la tarjeta espera (no se abre la sesión). */
async function esperarDependenciasAntesDeConstruir({ crm, config, registro }, tarjeta) {
  if (!{ ...MEDIR_POR_DEFECTO, ...(config.medir ?? {}) }.activo) return null;
  const referencias = referenciasParaDepender(tarjeta);
  if (!referencias.length) return null;
  try {
    const respuesta = await crm.depender(tarjeta.id, { referencias, etapa: "construir" });
    if (respuesta?.soltada) {
      registro.info(`"${tarjeta.titulo}": ${respuesta.esperando ?? "espera a otra tarjeta"}; no la construyo todavía`);
      return { ok: true, estado: respuesta.estado ?? "PLAN_APROBADO", esperando: respuesta.esperando ?? true };
    }
  } catch (error) {
    registro.aviso(`no se pudo mirar las dependencias de "${tarjeta.titulo}" antes de construir (${error.message}): se construye como siempre`);
  }
  return null;
}

/**
 * MEDIR ANTES DE PLANEAR (26-oct-2026, medir.mjs). Devuelve un resultado si NO hay que planear ahora, o null si hay que planear:
 *  1. Dependencias: si el texto nombra otra tarjeta como molde o requisito, pone la flecha (/depender). Si esa tarjeta no está
 *     HECHO, esta vuelve a la fila ("Esperando a «X»"), sin ERROR y sin contar intento, y no se abre ninguna sesión de plan.
 *  2. Tamaño: grande -> se parte en 2 a 4 hijas pequeñas, en orden, ANTES de planear (/partir desde PLANEANDO: las hijas
 *     quedan aprobadas, por planear, sin plan copiado). Dudosa -> una consulta corta con Haiku. Chica -> a planear.
 * Todo lo que falle aquí (un CRM viejo, una sesión sin respuesta) deja planear como siempre: medir solo ayuda, nunca frena.
 * El límite de uso de Claude se deja subir (la tarjeta se suelta).
 */
export async function medirAntesDePlanear({ crm, config, registro, contexto, partir = partirTarea, medirHaiku = medirConClaude }, tarjeta) {
  const ajustes = { ...MEDIR_POR_DEFECTO, ...(config.medir ?? {}) };
  if (!ajustes.activo) return null;
  const referencias = referenciasParaDepender(tarjeta);
  if (referencias.length) {
    try {
      const respuesta = await crm.depender(tarjeta.id, { referencias });
      if (respuesta?.creadas?.length) registro.info(`"${tarjeta.titulo}" depende de ${respuesta.creadas.length} tarjeta(s) que nombra en su texto: puse la flecha de dependencia`);
      if (respuesta?.soltada) {
        registro.info(`"${tarjeta.titulo}": ${respuesta.esperando ?? "espera a otra tarjeta"}; no la planeo todavía`);
        return { ok: true, estado: respuesta.estado ?? "APROBADO", esperando: respuesta.esperando ?? true };
      }
    } catch (error) {
      registro.aviso(`no se pudo mirar las dependencias de "${tarjeta.titulo}" (${error.message}): se planea como siempre`);
    }
  }
  const medida = medirTarjeta(tarjeta, ajustes);
  let tamano = medida.tamano;
  registro.info(`medí "${tarjeta.titulo}": ${textoDeLaMedida(medida)}`);
  if (tamano === "dudosa" && ajustes.consultaHaiku) {
    try {
      tamano = (await medirHaiku(contexto, tarjeta)) ?? "chica";
      registro.info(`consulta corta con Haiku: ${tamano}`);
    } catch (error) {
      if (error?.limiteDeUso) throw error;
      registro.aviso(`no se pudo consultar el tamaño (${String(error?.message ?? error).split("\n")[0]}): se planea como siempre`);
      tamano = "chica";
    }
  }
  if (tamano !== "grande") return null;
  const causa = enUnaLinea(`Tarea grande: ${medida.motivos.join(", ") || "lo decidió la consulta corta"}. Se partió ANTES de planear para que no se corte a los ${config.tiempos?.planMinutos ?? 19} min.`);
  let partes;
  try {
    partes = await partir(contexto, tarjeta, { causa, error: "" });
  } catch (error) {
    if (error?.limiteDeUso) throw error;
    registro.aviso(`no se pudo partir antes de planear (${String(error?.message ?? error).split("\n")[0]}): se planea entera`);
    return null;
  }
  try {
    await crm.partir(tarjeta.id, { causa, error: "", partes, categoria: "tarea_muy_grande", etapa: "planear" });
  } catch (error) {
    registro.aviso(`el CRM no dejó partir antes de planear (${error.message}): se planea entera`);
    return null;
  }
  registro.info(`la tarea se partió en ${partes.length} partes (antes de planear): ${partes.map((parte) => parte.titulo).join(" | ")}`);
  return { ok: true, estado: "PLANEANDO", partes: partes.length };
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
async function manejarFalla(args, tarjeta, hacer, error) {
  const nota = {};
  const salida = await repararLaFalla(args, tarjeta, hacer, error, nota);
  // Queda escrita la lección cuando la tarjeta se repara, se parte o pasa al dueño (ERROR). Cuando solo espera, o se acabó el
  // cupo de Claude, no se anota: no es culpa del proyecto.
  if (nota.diagnostico && ["reparar", "partir", "escalar"].includes(salida.accion) && salida.categoria !== "limite_claude") {
    const hechas = Number(tarjeta.reparaciones) || 0;
    const tope = Number(tarjeta.topeReparaciones) || TOPE_DE_REPARACIONES;
    const arreglo =
      salida.accion === "reparar"
        ? `La tarjeta vuelve a la fila para repararla (reparación ${hechas + 1} de ${tope}).`
        : salida.accion === "partir"
          ? "La tarea se partió en partes más chicas."
          : "Pasó al dueño con un resumen de la falla (ERROR).";
    anotarLaLeccion(args.config, args.registro, tarjeta, { resultado: "fallo", etapa: hacer, diagnostico: nota.diagnostico, arreglo });
  }
  return salida;
}

async function repararLaFalla({ crm, config, registro, contexto, bitacora }, tarjeta, hacer, error, nota) {
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

  nota.diagnostico = diagnostico;

  // 2b. Tres causas distintas sin resolverse: una línea para el CTO en el registro del Coordinador (al dueño no se le escribe).
  avisarAlCtoSiHaceFalta({ config, registro }, tarjeta, diagnostico);

  // 2c. La causa no es de la tarjeta: se pide la tarjeta que la arregla y esta espera, sin reparación, ERROR ni intento.
  const externa = causaExterna(diagnostico, { reversion: error?.reversion ?? null, repo: tarjeta.repo, tarjeta });
  if (externa) {
    const espera = await esperarPorCausaExterna({ crm, registro }, tarjeta, hacer, diagnostico, externa);
    if (espera) return { ok: false, motivo, zonas: error?.zonas ?? [], categoria: diagnostico.categoria, accion: "esperar", causaExterna: externa.tipo, esperando: espera.esperando };
  }

  // 3. Decidir.
  const estrategiaActual = tarjeta.reparacion?.estrategia;
  const modeloConstruir = estrategiaActual === "opus" ? (config.modelos?.planear ?? "opus") : modeloDelPaso(config, "construir", tarjeta);
  // Lo que verificó la nube ya no es lo que se subiría: decidir() manda la reparación a la NUBE (nunca a compilar en aizen1).
  const decision = decidir({
    diagnostico,
    tarjeta,
    etapa: hacer,
    config,
    archivosCambiados: error?.archivosCambiados ?? undefined,
    reversion: error?.reversion ?? null,
    modeloConstruir,
    verificarEnNube: Boolean(error?.verificarEnNube),
  });
  registro.info(`diagnóstico: ${diagnostico.categoria} — ${diagnostico.causa}; decisión: ${decision.accion} (${decision.motivo})${decision.estrategia === "nube" ? "; se verifica otra vez en la nube" : ""}`);
  const resultado = { ok: false, motivo, zonas: error?.zonas ?? [], categoria: diagnostico.categoria, accion: decision.accion };
  // La causa nunca va vacía al CRM (30-oct-2026): si no se supo, se dice en qué etapa e intento.
  const intento = { etapa: hacer, categoria: diagnostico.categoria, causa: enUnaLinea(diagnostico.causa) || sinCausa(hacer, tarjeta.intentos), error: diagnostico.error };

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
    // 160 + la marca (19) + lo que agrega el CRM (" (estrategia: opus)", 19) caben en sus 200 letras: la marca no se corta.
    const causa = decision.estrategia ? `${enUnaLinea(intento.causa, 160)} [estrategia: ${decision.estrategia}]` : intento.causa;
    // Antes de reparar, la causa y qué cambia frente al intento anterior (el siguiente intento los recibe en su prompt).
    const queCambia = decision.queCambia ?? queCambiaFrenteAlAnterior(diagnostico, tarjeta.ultimosIntentos, decision.estrategia);
    registro.info(`CAUSA: ${intento.causa} | QUÉ CAMBIA: ${queCambia}`);
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
  // 29-oct-2026: la revisión que no pasó trae sus 2 líneas para el dueño (por qué se paró / qué decisión necesita): van tal cual.
  const resumen =
    diagnostico.categoria === "revision_no_paso" && Array.isArray(error?.paraElDueno) && error.paraElDueno.length === 2
      ? error.paraElDueno.join("\n")
      : resumenDeEscalada({ tarjeta, intentos: tarjeta.ultimosIntentos, diagnostico, decision });
  try {
    await crm.error(tarjeta.id, resumen, error?.zonas, error?.reversion, { ...intento, resumen });
  } catch (otro) {
    registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
  }
  return { ...resultado, accion: "escalar" };
}

/**
 * CAUSA EXTERNA (30-oct-2026): pide al CRM la tarjeta que arregla la causa (o reusa la abierta con el mismo título) y deja esta
 * "Esperando a «X»" con la flecha de dependencia: vuelve sola cuando la otra llega a HECHO. Devuelve { esperando } si quedó esperando,
 * o null si el CRM falló o no la soltó (entonces sigue el camino de siempre: nunca queda peor que antes).
 */
async function esperarPorCausaExterna({ crm, registro }, tarjeta, hacer, diagnostico, externa) {
  let respuesta;
  try {
    respuesta = await crm.causaExterna(tarjeta.id, {
      tipo: externa.tipo,
      titulo: externa.titulo,
      detalle: externa.detalle,
      referencia: externa.referencia,
      repo: tarjeta.repo,
      etapa: hacer,
      categoria: diagnostico.categoria,
      causa: enUnaLinea(diagnostico.causa) || sinCausa(hacer, tarjeta.intentos),
    });
  } catch (error) {
    registro.aviso(`no se pudo pedir la tarjeta de la causa externa (${externa.tipo}: ${error.message}): sigue el camino de siempre`);
    return null;
  }
  if (!respuesta?.soltada) {
    registro.aviso(`el CRM no dejó esperando a "${tarjeta.titulo}" por la causa externa (${externa.tipo}): sigue el camino de siempre`);
    return null;
  }
  const esperando = respuesta.esperando ?? `Esperando a «${externa.titulo}»`;
  registro.info(
    `causa externa (${externa.tipo}): ${externa.referencia ? "espera a la tarjeta con la que choca" : respuesta.creada ? `creé la tarjeta «${externa.titulo}»` : `reusé la tarjeta abierta «${externa.titulo}»`}; "${tarjeta.titulo}": ${esperando}, sin gastar intento`,
  );
  return { esperando };
}

/** Tres causas distintas sin resolverse: la fila "AVISO AL CTO" en el registro del Coordinador. Nunca lanza ni escribe al dueño. */
function avisarAlCtoSiHaceFalta({ config, registro }, tarjeta, diagnostico) {
  const causas = causasDistintas(tarjeta.ultimosIntentos, diagnostico);
  if (causas.length < CAUSAS_PARA_AVISAR_AL_CTO) return;
  const lista = causas.map((causa) => `${causa.categoria}: ${causa.causa}`);
  const boveda = config.boveda?.ruta ?? null;
  if (!boveda) {
    registro.aviso(`AVISO AL CTO: «${tarjeta.titulo}» — causas: ${lista.join(", ")} (sin bóveda configurada: solo queda en el log)`);
    return;
  }
  try {
    const hecho = anotarAvisoAlCto(boveda, { tarjeta, causas: lista });
    if (hecho.accion === "agregada") registro.aviso(`AVISO AL CTO anotado en el registro del Coordinador: «${tarjeta.titulo}» — ${causas.length} causas distintas`);
  } catch (error) {
    registro.aviso(`no se pudo anotar el AVISO AL CTO en la bóveda (${error?.message ?? error}): «${tarjeta.titulo}» — causas: ${lista.join(", ")}`);
  }
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
 * REVISAR DE NUEVO lo que quedó en Por revisar (30-oct-2026): en cada vuelta toma a lo sumo UNA tarjeta de la lista
 * `paraRevisarDeNuevo` del CRM (POR_REVISAR que pasó, rama tablero/... y zonas solo CHATS / BOT_VENTAS) y llama a
 * revisarDeNuevo (etapas.mjs). Va de a una (el bucle no la lanza otra vez mientras corre) y no arranca mientras otra
 * subida está en su vigilancia de 30 min. Una falla del PC, de la red o del Coordinador deja la tarjeta como estaba: se
 * reintenta en la vuelta siguiente, después de las que todavía no se intentaron. Si el CRM dice 409 (por ejemplo, el
 * plan toca dinero), no se vuelve a pedir en este arranque. `revisar` y `hayVigilancia` se inyectan para probar.
 * revisar() -> { hizo, tarjetaId?, accion?: "subir" | "error" | "reintentar" | "esperar", motivo? }
 */
export function crearRevisorDeNuevo({ crm, config, registro, colaPesada = null, revisar = revisarDeNuevo, hayVigilancia = hayVigilanciaEnCurso, ahora = () => Date.now() }) {
  // id -> cuándo se intentó por última vez sin terminar (falla del entorno): las nuevas van primero.
  const intentadas = new Map();
  // Las que el CRM rechazó (409): no se repiten hasta que el Coordinador se reinicie.
  const rechazadas = new Set();
  return {
    async revisar() {
      if (hayVigilancia()) return { hizo: false, motivo: "otra subida está en su vigilancia de 30 min" };
      const respuesta = await crm.porRevisar();
      const candidatas = (respuesta?.paraRevisarDeNuevo ?? []).filter(
        (tarjeta) => sePuedeRevisarDeNuevo(tarjeta) && config.repos?.[tarjeta.repo] && !rechazadas.has(tarjeta.id),
      );
      if (!candidatas.length) return { hizo: false, motivo: "ninguna tarjeta para revisar de nuevo" };
      const tarjeta = [...candidatas].sort((a, b) => (intentadas.get(a.id) ?? 0) - (intentadas.get(b.id) ?? 0))[0];
      registro.info(`revisar de nuevo: "${tarjeta.titulo}" (${tarjeta.id}, ${tarjeta.zonaProtegida.join(", ")}): rebase, build, pruebas y envíos`);
      const contexto = { config, registro, crm, colaPesada, lugar: "aizen1", etiqueta: `[revisar ${idCorto(tarjeta.id)}]` };
      try {
        const salida = await revisar(contexto, tarjeta);
        intentadas.delete(tarjeta.id);
        return { hizo: true, tarjetaId: tarjeta.id, accion: salida.accion, motivo: salida.motivo ?? null };
      } catch (error) {
        const motivo = enUnaLinea(String(error?.message ?? error), 300);
        if (error?.status === 409) {
          rechazadas.add(tarjeta.id);
          registro.aviso(`revisar de nuevo: el CRM no dejó mover "${tarjeta.titulo}" (${motivo}); sigue en Por revisar`);
          return { hizo: true, tarjetaId: tarjeta.id, accion: "esperar", motivo };
        }
        intentadas.set(tarjeta.id, ahora());
        registro.aviso(`revisar de nuevo: "${tarjeta.titulo}" sigue en Por revisar y se reintenta en la vuelta siguiente: ${motivo}`);
        return { hizo: true, tarjetaId: tarjeta.id, accion: "reintentar", motivo };
      }
    },
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
  pausaUso = crearPausaPorUso({ config, registro }),
  vigilante = crearVigilanteDeUso({ config, registro, estado: motores, entorno: entornoSeguro(), pausa: pausaUso }),
  // La cola de pasos pesados se puede dar hecha (las pruebas la llenan a mano); undefined = la de la configuración.
  colaPesada: colaDada = undefined,
}) {
  const max = config.maxParalelo;
  const nubeConfig = config.nube ?? { activa: false, maxTareas: 0, maxArchivosChica: 8 };
  /** El agente del proyecto de una tarjeta (agentes.mjs); un proyecto que no esté en la configuración da null. */
  const agenteDe = (tarjeta) => {
    const repo = config.repos[tarjeta.repo];
    // Sin tope propio, el del agente es todo lo que cabe (aizen1 + nube): no frena nada, como antes.
    return repo ? agenteDelRepo(repo, max + (nubeConfig.activa ? nubeConfig.maxTareas : 0)) : null;
  };
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
  // La hora de vuelta de la pausa de la que ya se avisó al dueño por WhatsApp (0 = ninguna): un aviso por pausa.
  let limiteAvisadoHasta = 0;
  // Desde cuándo se espera al PC antes de tomar la primera tarjeta (null = no se espera).
  let esperaPcDesde = null;
  // Para el panel "Coordinador en vivo": por qué no se abre otra sesión (PC lleno) y las que esperan en fila por chocar.
  let pcEspera = null;
  // id de la tarjeta que espera -> { motivo, contra }: `contra` es el id de la tarjeta con la que choca (null si espera por otra razón).
  let esperasDeFila = new Map();

  /**
   * Bloqueos por choque que se sueltan solos (27-oct-2026): una espera que choca con una tarjeta que YA NO corre (terminó en HECHO,
   * FALLIDO o ERROR) se borra. Se llama en cada ciclo, también con el Coordinador lleno, y cuando termina una sesión.
   */
  function soltarEsperasTerminadas() {
    const corriendoIds = new Set([...sesiones.values(), ...enNube.values()].map((s) => s.tarjeta.id));
    for (const [id, espera] of esperasDeFila) if (espera.contra && !corriendoIds.has(espera.contra)) esperasDeFila.delete(id);
    if (!corriendoIds.size) esperasDeFila = new Map();
  }

  /** Para no llenar el log: el mismo aviso (fila, recursos, pausa) se escribe una vez. */
  const avisarUnaVez = (clave, mensaje) => {
    if (clave === ultimoAviso) return;
    ultimoAviso = clave;
    if (mensaje) registro.info(mensaje);
  };

  const nombreDeAgente = (tarjeta) => {
    const agente = agenteDe(tarjeta);
    return agente ? `, ${agente.nombre}` : "";
  };

  /** Cuántas tarjetas de este agente (proyecto) corren ahora, en aizen1 y en la nube. */
  const corriendoDelAgente = (clave) => [...sesiones.values(), ...enNube.values()].filter((s) => s.tarjeta.repo === clave).length;

  function contarCorriendo() {
    const lista = [
      ...[...sesiones.entries()].sort(([a], [b]) => a - b).map(([n, s]) => `s${n} "${s.tarjeta.titulo}" (${s.hacer}, ${s.tarjeta.repo}${nombreDeAgente(s.tarjeta)})`),
      ...[...enNube.values()].map((s) => `nube "${s.tarjeta.titulo}" (${s.hacer}, ${s.tarjeta.repo}${nombreDeAgente(s.tarjeta)})`),
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
    // 29-oct-2026: un proyecto marcado "la nube no tiene acceso al repo" (nube.mjs: sinAccesoALaNube) no se manda a la nube
    // hasta que venza la marca: sus tarjetas esperan en la fila sin gastar uso.
    // Con SESIÓN FIJA (repos.<repo>.nube.sesionFija) va una tarea a la vez: mientras otra del proyecto construye ahí, espera.
    const nubeParaEsta = nubeLibre && !(hacer === "construir" && (sinAccesoALaNube(tarjeta.repo) || sesionFijaOcupada(tarjeta.repo)));
    // Todo el desarrollo en la nube (26-oct-2026, decisión del dueño): construir NUNCA va a aizen1; si la nube no está
    // libre (o está apagada), la tarjeta espera en la fila.
    // Un proyecto con construirEn "aizen1" no va a la nube (29-oct-2026, decisión del dueño para Gestión).
    if (hacer === "construir" && config.repos[tarjeta.repo]?.construirEn === "aizen1") return aizenParaEsta ? { donde: "aizen1", motivo: "este proyecto se construye en aizen1" } : null;
    if (hacer === "construir" && nubeConfig.todoEnLaNube) return nubeUsable && nubeParaEsta ? { donde: "nube", motivo: "todo el desarrollo se construye en la nube" } : null;
    if (hacer !== "construir" || !nubeUsable) return aizenParaEsta ? { donde: "aizen1", motivo: null } : null;
    const { grande, motivos } = esTareaGrande(tarjeta, { repo: config.repos[tarjeta.repo], maxArchivosChica: nubeConfig.maxArchivosChica });
    if (grande) return nubeParaEsta ? { donde: "nube", motivo: `es grande: ${motivos.join("; ")}` } : null;
    if (aizenParaEsta) return { donde: "aizen1", motivo: null };
    const porque = aizenOk ? `la cola de pasos pesados de aizen1 tiene ${colaEnFila} en fila` : `aizen1 no tiene puesto libre (${sesiones.size}/${max})`;
    return nubeParaEsta ? { donde: "nube", motivo: `desborde: ${porque}` } : null;
  }

  /** ¿El proyecto tiene sesión fija y ya hay una tarjeta suya construyendo en la nube (en esa sesión)? */
  const sesionFijaOcupada = (clave) => Boolean(sesionFijaDe(config.repos[clave])) && [...enNube.values()].some((s) => s.tarjeta.repo === clave && s.hacer === "construir");

  /** Por qué una candidata no tiene dónde correr ahora (para el log y el panel "esperan en fila"). */
  function motivoDeEspera(hacer, { aizenOk, nubeUsable, colaEnFila = 0 }, tarjeta = null) {
    const marca = hacer === "construir" && nubeUsable && tarjeta ? sinAccesoALaNube(tarjeta.repo) : null;
    if (marca) {
      const hora = new Date(marca.hasta).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" });
      return `espera: la nube no tiene acceso al repo de "${tarjeta.repo}" (no se manda a la nube hasta las ${hora})`;
    }
    if (hacer === "construir" && nubeUsable && tarjeta && sesionFijaOcupada(tarjeta.repo)) return `espera: la sesión de ${nombreDelProyecto(config.repos[tarjeta.repo])} está ocupada`;
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
    suRegistro.info(`tomé "${tarjeta.titulo}" (${tarjeta.id}, ${tarjeta.repo}${nombreDeAgente(tarjeta)}) para ${hacer}${nube ? ` — se construye en la nube (${motivo})` : ""}`);
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
        soltarEsperasTerminadas();
        contarCorriendo();
        if (despertar) despertar();
        else cupoNuevo = true;
      });
  }

  /** Las etapas que hoy no tienen motor (Codex en pausa sin respaldo, los dos agotados…). */
  function etapasSinMotor() {
    return ["planear", "construir"].filter((hacer) => motorDeLaEtapa(motores, hacer) === null);
  }

  /**
   * Claude se agotó y no queda otro motor para planear ni construir: todo quedó en pausa. Es uno de los pocos
   * WhatsApp que quiere el dueño (26-oct-2026): lo manda UNA vez por pausa, con la hora de vuelta. Si el CRM lo
   * calla (9 p. m. a 7 a. m.) o falla, se reintenta en la próxima vuelta; nunca tumba al planificador.
   */
  async function avisarLimiteSiTodoQuedoEnPausa(sinMotor) {
    const hasta = motores.pausadoHasta("claude");
    if (!hasta || sinMotor.length < 2 || hasta === limiteAvisadoHasta) return;
    try {
      const respuesta = await crm.aviso(textoDelAvisoDeLimite(hasta, config), "limite");
      if (!respuesta?.silenciado) limiteAvisadoHasta = hasta;
    } catch (error) {
      registro.aviso(`no salió el aviso del límite de Claude (${error.status ?? "sin respuesta"}): ${error.message}`);
    }
  }

  /**
   * Los WhatsApp de la pausa por uso (pausa-uso.mjs): al entrar en pausa, al volver y la primera vez que no se puede leer el uso.
   * Cada uno sale UNA vez (lo que ya salió queda en estado-uso.json); si el CRM lo calla (9 p. m. a 7 a. m.) o falla, se
   * reintenta en la próxima vuelta. Nunca tumba al planificador.
   */
  async function avisarPausaPorUso() {
    for (const { clave, texto } of pausaUso.pendientes()) {
      try {
        const respuesta = await crm.aviso(texto, "limite");
        if (!respuesta?.silenciado) pausaUso.avisado(clave);
      } catch (error) {
        registro.aviso(`no salió el aviso de la pausa por uso (${error.status ?? "sin respuesta"}): ${error.message}`);
      }
    }
  }

  /** Detiene con orden lo que corre, menos subir (no usa Claude y cortarlo a medias es más peligroso que dejarlo acabar). */
  function detenerPorPausa() {
    for (const sesion of [...sesiones.values(), ...enNube.values()]) {
      if (sesion.hacer === "subir" || sesion.vivo.pausaPedida) continue;
      sesion.vivo.pausaPedida = true;
      registro.info(`pausa por uso: detengo "${sesion.tarjeta.titulo}" (${sesion.hacer})`);
      sesion.vivo.detenerPorPausa?.();
    }
  }

  async function llenar() {
    soltarEsperasTerminadas();
    await vigilante?.vigilar();
    await avisarPausaPorUso();
    pcEspera = null;
    if (pausaUso.pausado()) {
      avisarUnaVez("pausa-uso", "Pausado por uso de Claude: no tomo tarjetas hasta que el uso baje del umbral");
      detenerPorPausa();
      return;
    }
    if (ultimoAviso === "pausa-uso") ultimoAviso = "";
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
        await avisarLimiteSiTodoQuedoEnPausa(sinMotor);
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
        const contraQuien = {};
        const chocan = corriendo.length ? candidatasQueChocan(candidatas, corriendo, config.repos, contraQuien) : {};
        for (const c of candidatas) if (!chocan[c.id] && sinMotor.includes(c.hacer)) chocan[c.id] = `(sin motor para ${c.hacer})`;
        // La cola de cada proyecto: un agente no pasa de su `maxEnParalelo` (sesiones de aizen1 y de la nube juntas).
        for (const c of candidatas) {
          if (chocan[c.id]) continue;
          const agente = agenteDe(c);
          if (!agente) continue;
          const trabajando = corriendoDelAgente(c.repo);
          if (trabajando >= agente.maxEnParalelo) {
            chocan[c.id] = `(el ${agente.nombre} ya tiene ${trabajando} tarjeta${trabajando === 1 ? "" : "s"} trabajando (su máximo es ${agente.maxEnParalelo}))`;
          }
        }
        // Sin dónde correr ahora: planear y subir esperan un puesto de aizen1; una grande espera un puesto de la nube.
        for (const c of candidatas) {
          if (chocan[c.id]) continue;
          if (descartadas.has(c.id)) chocan[c.id] = `(${descartadas.get(c.id)})`;
          else if (!dondeCorre(c, c.hacer, estadoDeCupos)) chocan[c.id] = `(${motivoDeEspera(c.hacer, estadoDeCupos, c)})`;
        }
        excluir = [...new Set([...Object.keys(chocan), ...descartadas.keys()])];
        esperasDeFila = new Map(Object.entries(chocan).map(([id, motivo]) => [id, { motivo: String(motivo).replace(/^\(|\)$/g, ""), contra: contraQuien[id] ?? null }]));
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
        const espera = motivoDeEspera(hacer, estadoDeCupos, tarjeta);
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
    /** La cola de pasos pesados de aizen1 (o null): revisar de nuevo compila en la misma fila que las sesiones. */
    colaPesada: () => colaPesada,
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
          agente: agenteDe(tarjeta)?.nombre ?? null,
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
          // 29-oct-2026: la revisión de los 4 (vuelta y estado de cada revisor), solo mientras la etapa es "revisando".
          revision: vivo.etapa === "revisando" ? (vivo.revision ?? null) : null,
        }));
      return {
        tareas,
        esperandoPc: Boolean(pcEspera),
        motivoEspera: pcEspera,
        esperas: [...esperasDeFila.entries()].map(([tarjetaId, espera]) => ({ tarjetaId, motivo: espera.motivo, ...(espera.contra ? { contra: espera.contra } : {}) })),
        uso: motores.resumenDeUso(),
        pausaUso: pausaUso.resumen(),
      };
    },
    /** Pausa por uso de Claude: ¿está pausado? (el trabajo de noche y el recogedor tampoco corren) y los ajustes del panel. */
    pausadoPorUso: () => pausaUso.pausado(),
    ajustarPausaUso: (ajustes) => pausaUso.ajustes(ajustes),
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
