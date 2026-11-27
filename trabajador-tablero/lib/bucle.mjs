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
import { crearAjusteDeCupos, motivoDelSemaforo, semaforoDeLaCarga } from "./ajuste-de-cupos.mjs";
import { anotarIncidente } from "./bitacora.mjs";
import { candidatasQueChocan, huellaDeTarjeta, motivoDeChoque } from "./choques.mjs";
import { crearColaPesada } from "./cola.mjs";
import { debePartirAntes, ordenarCandidatas, partesSinAlcanceNuevo } from "./reparto.mjs";
import {
  CAUSAS_PARA_AVISAR_AL_CTO,
  ESTRATEGIAS_DE_LAS_FALLAS,
  FRASES_DE_LA_CAUSA,
  TOPE_DE_REPARACIONES,
  TOPE_INTENTOS_DE_SUBIDA,
  causaConMarca,
  causaExterna,
  causasDistintas,
  decidir,
  diagnosticar,
  enUnaLinea,
  estrategiaDeLaCausa,
  intentosDeSubida,
  porQueDeLaDecision,
  queCambiaFrenteAlAnterior,
  recortar,
  recortarAviso,
  resumenDeEscalada,
  resumenDeFallaAgotada,
  sinCausa,
  sinMarcaDeEstrategia,
  textoDelAvisoDeReversion,
} from "./diagnostico.mjs";
import {
  ErrorDeEtapa,
  MOTIVO_ENSAYO,
  construir,
  diagnosticarConClaude,
  entornoSeguro,
  hayVigilanciaEnCurso,
  limpiarCarpetasDeTrabajo,
  medirConClaude,
  partirTarea,
  planear,
  revisarArchivosDelRepo,
  revisarDeNuevo,
  sePuedeRevisarDeNuevo,
  subir,
  yaEstaEnMain,
} from "./etapas.mjs";
import { buscarDependenciaEnMain, esRamaDelTrabajador, idCorto, nombreDeRama } from "./git.mjs";
import { MEDIR_POR_DEFECTO, medirTarjeta, referenciasParaDepender, textoDeLaMedida } from "./medir.mjs";
import { anotarAvisoAlCto } from "./notas-boveda.mjs";
import { notaDeYaHecho } from "./revision-previa.mjs";
import { repoDeLaRecomendada, seguirConLaRecomendada } from "./preguntas-abiertas.mjs";
import { modeloDelPaso, nombreDelModelo } from "./modelos.mjs";
import { crearEstadoDeMotores, crearVigilanteDeUso, motorDeLaEtapa, nombreDelMotor, textoDelAvisoDeLimite } from "./motores.mjs";
import { commitsDeLaRama, esOrquestador, esTareaGrande, nombreDelProyecto, preguntaDelCommit, resultadoDelCommit, sesionFijaDe, sinAccesoALaNube, sinAccesoASesionesNuevas } from "./nube.mjs";
import { datosDelLatidoDeConstruir } from "./latido.mjs";
import { crearPausaPorUso } from "./pausa-uso.mjs";
import { ultimasLineas } from "./procesos.mjs";
import { crearMedidor, faltanRecursos, leerCarga } from "./recursos.mjs";
import { crearPausaPorSesion } from "./sesion-claude.mjs";
import { crearGuardiaSinLatido } from "./sin-latido.mjs";

const ETAPAS = { planear, construir, subir };

// Panel "Coordinador en vivo" (24-oct-2026): cada sesión lleva un `vivo` { etapa, lugar, modelo, motor, inicioEn,
// linkWorkflow } que las etapas actualizan con `contexto.fase(etapa, extra)` ("probando", GitHub Actions…) y el
// latido (latido.mjs) lee con planificador.estado(). Solo informa: nunca decide nada.
const ETAPA_VISIBLE = { planear: "planeando", construir: "construyendo", subir: "subiendo" };

/** El modelo de Claude que usa esta etapa (el mismo que eligen las etapas), o null si no es Claude. */
export function modeloDeLaSesion(config, motores, tarjeta, hacer, reparacion) {
  if (hacer === "subir" || motores.motorDe(hacer) !== "claude") return null;
  // 27-nov-2026: la reparación con estrategia "opus" usa el modelo de `reparar` (Sonnet), ya no fuerza Opus.
  if (hacer === "construir" && reparacion?.estrategia === "opus") return modeloDelPaso(config, "reparar", tarjeta);
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

export async function procesar({ crm, config, registro: registroBase, motores = crearEstadoDeMotores(config), medidor = null, otrasSesiones = null, vivo = {}, lugar = "aizen1", puestoParaVerificar = null, colaPesada = null, etiqueta = "", alSoltarPuesto = null, alLatir = null, pausaSesion = null }, tarjeta, hacer) {
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
  // 1-nov-2026: en el modo orquestador dice lugar "orquestador" y el link de la sesión fija (el CRM le da 24 h).
  const datosDelLatido = () =>
    hacer === "construir" ? datosDelLatidoDeConstruir({ lugar, linkSesion: vivo.linkSesion, orquestador: vivo.orquestador === true ? sesionFijaDe(config.repos[tarjeta.repo]) : null }) : undefined;
  const latir = async () => {
    try {
      await crm.latido(tarjeta.id, datosDelLatido());
      // La hora del último latido que el CRM aceptó (sin-latido.mjs: el reloj de las 2 h corre desde acá).
      alLatir?.();
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
    // 27-nov-2026: en la nube se manda el modelo PEDIDO (construir o reparar) y la marca "pedido": no se sabe si la
    // nube lo dejó forzar con --model, y el commit "resultado:" de la sesión lo confirma después.
    modelo: enNube ? modeloDelPaso(config, reparacion?.estrategia === "opus" ? "reparar" : "construir", tarjeta) : modeloDeLaSesion(config, motores, tarjeta, hacer, reparacion),
    modeloPedido: enNube,
    motor: enNube ? "claude" : hacer === "subir" ? null : (motores.motorDe(hacer) ?? null),
    inicioEn: vivo.inicioEn ?? Date.now(),
    linkWorkflow: null,
    linkSesion: null,
    desdeNube: null,
  });
  const fase = (etapa, extra = {}) => Object.assign(vivo, { etapa }, extra);
  const contexto = { config, registro, senal: control.signal, motorDe: motores.motorDe, alLimite: pausar, medidor, otrasSesiones, fase, puestoParaVerificar, colaPesada, etiqueta, lugar: enNube ? "nube" : "aizen1", alSoltarPuesto, sesionNueva: vivo.sesionNueva === true, orquestador: enNube && vivo.orquestador === true };
  try {
    const etapa = ETAPAS[hacer];
    if (!etapa) throw new ErrorDeEtapa(`El CRM pidió "${hacer}", que este Coordinador no sabe hacer (¿hay que actualizarlo?).`);
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
      // Nunca construir en el repo equivocado (27-nov-2026): si el plan nombra archivos de otro repo, se cambia de repo y se replanea.
      const porRepo = await cambiarDeRepoSiHaceFalta({ crm, config, registro }, tarjeta, { origen: "antes_de_construir", etapa: hacer });
      if (porRepo) return porRepo;
      // La recomendada que el Coordinador eligió para una pregunta abierta es pasar al otro repo: se cambia el repo, no se construye.
      const recomendada = recomendadaDeCambioDeRepo(tarjeta);
      const porRecomendada = recomendada && (await cambiarDeRepoPorElPlan({ crm, config, registro }, tarjeta, { ...recomendada, origen: "plan", etapa: hacer }));
      if (porRecomendada) return porRecomendada;
    }
    const salida = await etapa(contexto, tarjeta);
    if (vencida) throw new ErrorDeEtapa("La tarjeta venció en el CRM mientras se trabajaba.");
    // La sesión descubrió que falta otra tarjeta, o que ya estaba hecho (commit comprobado en main): sin intento ni reparación.
    if (salida.dependeDe?.length) return esperarPorDependencia({ crm, config, registro }, tarjeta, hacer, salida.dependeDe);
    if (salida.yaHecho) return cerrarComoYaHecha({ crm, registro }, tarjeta, hacer, salida.yaHecho);
    // El plan dice que lo pedido vive en el otro repo: /cambiar-repo y nada más (ni el plan ni el aviso «necesita»). Con 404 o 409 sigue como hoy.
    if (hacer === "planear" && salida.otroRepo) {
      const porRepo = await cambiarDeRepoPorElPlan({ crm, config, registro }, tarjeta, { ...salida.otroRepo, origen: "plan", etapa: hacer });
      if (porRepo) return porRepo;
    }
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
    else if (hacer === "planear" && salida.informa) await avisarQueSiguioConLaRecomendada(crm, registro, tarjeta, salida.informa);
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
    if (error?.sinSesion) {
      // 24-nov-2026 (parte 2): la sesión de Claude de aizen1 se venció. No es culpa de la tarjeta: vuelve a la fila SIN ERROR,
      // sin sumar intento ni gastar reparación, y el Coordinador entra en pausa (no toma más hasta que vuelva la sesión). Las
      // tarjetas que ya corren no se cortan: si también chocan con la sesión vencida, caen aquí mismo.
      registro.aviso(`"${tarjeta.titulo}" (${hacer}): la sesión de Claude está vencida; la suelto sin error ni intento`);
      pausaSesion?.marcarVencida(motivo);
      await soltar(crm, registro, tarjeta, MOTIVO_SIN_SESION);
      return { ok: false, motivo, sinSesion: true };
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
    // 24-nov-2026 (parte 3): con un CRM que repara, la subida que se deshizo bien se resuelve sola (arreglo, reintento o Alertas):
    // sin WhatsApp. La que no se pudo deshacer (URGENTE) y la de un CRM viejo avisan como siempre.
    if (error?.reversion) await avisarReversion(crm, registro, tarjeta, motivo, error.reversion, { seResuelveSola: conReparaciones });
    if (conReparaciones) return manejarFalla({ crm, config, registro, contexto, bitacora, pausaSesion }, tarjeta, hacer, error);
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
    await crm.aviso(recortarAviso(texto), "necesita", tarjeta.id);
  } catch (error) {
    registro.aviso(`no salió el aviso de lo que necesita el agente (${error.status ?? "sin respuesta"}): ${error.message}`);
  }
}

/**
 * Subió y hubo que deshacerlo: aviso de tipo "necesita" al dueño (WhatsApp por la línea Admin) con el motivo y los
 * commits. Si el aviso no sale, queda en el registro y la tarjeta sigue su camino.
 * 24-nov-2026 (parte 3): con `seResuelveSola` y la reversión hecha (reversion.ok), NO hay WhatsApp: solo una línea en el registro
 * (la tarjeta pide su arreglo, se reintenta o, a la 3.ª, queda en Alertas). La URGENTE (ok false) avisa siempre.
 */
async function avisarReversion(crm, registro, tarjeta, motivo, reversion, { seResuelveSola = false } = {}) {
  if (seResuelveSola && reversion?.ok === true) {
    const corto = (sha) => String(sha ?? "?").slice(0, 10);
    registro.info(`se deshizo la subida de "${tarjeta.titulo}" (commit ${corto(reversion.commit)}, revert ${corto(reversion.revert)}): sin WhatsApp, el Coordinador la resuelve solo`);
    return;
  }
  // Máximo 3 líneas y 500 caracteres (el CRM rechaza los más largos); el detalle completo queda en el tablero.
  const texto = textoDelAvisoDeReversion(tarjeta.titulo, motivo, reversion);
  try {
    await crm.aviso(texto, "necesita", tarjeta.id);
  } catch (error) {
    registro.aviso(`no salió el aviso de la reversión al dueño (${error.status ?? "sin respuesta"}): ${error.message}`);
  }
}

/**
 * PLAN CON PREGUNTAS ABIERTAS (2-nov-2026, un solo sí de verdad): el plan ya no espera al dueño ni construir frena por
 * preguntas. planear() sigue con la opción recomendada de cada una (preguntas-abiertas.mjs: seguirConLaRecomendada), la deja
 * anotada arriba del plan y devuelve `informa`: UNA línea para el dueño que solo informa. Va por el mismo camino de avisos
 * (POST /api/trabajador/aviso, que solo deja pasar "limite", "necesita" y "cupos"), pero la tarjeta NO queda esperando: no es
 * el `necesita` de NECESITO. Si el aviso no sale, queda en el registro: la nota ya está en la tarjeta.
 */
async function avisarQueSiguioConLaRecomendada(crm, registro, tarjeta, texto) {
  try {
    await crm.aviso(enUnaLinea(texto, 400), "necesita", tarjeta.id);
  } catch (error) {
    registro.aviso(`no salió el aviso de las preguntas resueltas con la opción recomendada (${error.status ?? "sin respuesta"}): ${error.message}`);
  }
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
    if (error?.limiteDeUso || error?.sinSesion) throw error;
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

/** Cuántas tarjetas nombradas se miran en git como mucho (cada una suma un `git fetch` de unos segundos). */
const TOPE_DE_DEPENDENCIAS_EN_GIT = 5;

/**
 * DEPENDE_DE (27-oct-2026): la sesión descubrió que falta algo que otra tarjeta todavía no subió a main. Se pone la flecha de dependencia
 * y la tarjeta vuelve a la fila ("Esperando a «X»") sin ERROR y sin gastar intento ni reparación: planeando vuelve a APROBADO,
 * construyendo a PLAN_APROBADO. Arranca sola cuando la otra queda HECHO. Si el CRM no la deja esperar, se suelta igual sin error.
 *
 * 27-nov-2026 (incidente T-956): si el CRM no la soltó (las nombradas ya están HECHO o FALLIDO), se mira con git si su código está en main:
 *  - todas en main: se suelta sin intento ni reparación, con la nota de que ya está en main y el commit (se vuelve a planear o construir);
 *  - alguna HECHA a mano o FALLIDA sin su código en main: ERROR `depende_de_sin_main` con el motivo, sin reparación ni vuelta a la fila;
 *  - un CRM viejo (sin `tarjetas`), sin repo configurado o cualquier otro caso: como antes, se suelta y se reintenta después.
 */
async function esperarPorDependencia({ crm, config, registro }, tarjeta, hacer, referencias, porQue = null) {
  // 27-nov-2026: cuando la espera viene de una reparación cortada por la misma causa, el porqué viaja a /soltar y /error.
  const conPorQue = porQue ? { porQue } : undefined;
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
  const repo = config?.repos?.[tarjeta.repo];
  const nombradas = (Array.isArray(respuesta?.tarjetas) ? respuesta.tarjetas : []).filter((otra) => otra && typeof otra.id === "string").slice(0, TOPE_DE_DEPENDENCIAS_EN_GIT);
  if (nombradas.length && repo?.ruta) {
    const enMain = [];
    const faltan = [];
    for (const otra of nombradas) {
      const encontrado = await buscarDependenciaEnMain(repo, otra);
      if (encontrado) enMain.push({ otra, encontrado });
      else faltan.push(otra);
    }
    const nombre = (otra) => `«${otra.titulo}» (${otra.idCorto || idCorto(otra.id)})`;
    const sinMain = faltan.find((otra) => otra.hechaAMano === true || otra.estado === "FALLIDO");
    if (sinMain) {
      const como = sinMain.estado === "FALLIDO" ? "FALLIDA" : "HECHA a mano";
      const motivo = `Depende de ${nombre(sinMain)}, que está ${como} pero su código no está en main: no se puede seguir hasta que se suba.`;
      registro.aviso(`"${tarjeta.titulo}": ${motivo} Queda en ERROR (depende_de_sin_main), sin reparación`);
      try {
        await crm.error(tarjeta.id, motivo, undefined, undefined, { etapa: hacer, categoria: "depende_de_sin_main", causa: enUnaLinea(motivo), error: `DEPENDE_DE: ${referencias.join(", ")}`.slice(0, 6000), resumen: motivo, ...conPorQue });
      } catch (error) {
        registro.error(`no se pudo avisar el error al CRM: ${error.message}`);
      }
      return { ok: false, motivo, categoria: "depende_de_sin_main" };
    }
    if (!faltan.length) {
      const notas = enMain.map(({ otra, encontrado }) => `${nombre(otra)} ya está en main, commit ${encontrado.commit.slice(0, 10)}`);
      const nota = `${notas.join("; ")}; se vuelve a ${hacer === "construir" ? "construir" : "planear"} sobre el main nuevo.`;
      registro.info(`"${tarjeta.titulo}": ${nota}`);
      await soltar(crm, registro, tarjeta, nota, conPorQue);
      return { ok: true, estado: respuesta?.estado ?? null, esperando: true };
    }
  }
  // Las tarjetas que nombró ya están HECHO (o no existen): no hay a quién esperar. Se suelta sin error y vuelve a intentarse luego.
  await soltar(crm, registro, tarjeta, `Dependencia (${referencias.join(", ")}): se reintenta después.`, conPorQue);
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

/** Cuántas veces seguidas se mira el repo por la tarjeta: con estos intentos "repo_equivocado" ya hechos, se sigue como hoy. */
const TOPE_DE_REPO_EQUIVOCADO = 2;

/** Cuántos intentos "repo_equivocado" (cambios de repo) ya tiene la tarjeta. */
const vecesConRepoEquivocado = (tarjeta) => (tarjeta.ultimosIntentos ?? []).filter((intento) => intento?.categoria === "repo_equivocado").length;

/** ¿La tarjeta ya pasó TOPE_DE_REPO_EQUIVOCADO veces por un cambio de repo? Entonces se sigue como hoy (sin dar vueltas entre repos). */
const yaPasoPorElTope = (tarjeta) => vecesConRepoEquivocado(tarjeta) >= TOPE_DE_REPO_EQUIVOCADO;

/**
 * NUNCA CONSTRUIR EN EL REPO EQUIVOCADO (27-nov-2026). Mira con git si los archivos que el plan da por existentes están en el repo
 * de la tarjeta (revisarArchivosDelRepo). Si están en el otro repo, /cambiar-repo le cambia el repo; si no están en ninguno, la
 * vuelve a planear (sin repo). En los dos casos: no se construye, no se gasta intento y queda en la bitácora. Devuelve el resultado
 * para procesar (o para la reparación), o null si hay que seguir como hoy: no falta nada, un CRM viejo (404), el tope de
 * cambios (409), el CRM falló o la tarjeta ya pasó por aquí TOPE_DE_REPO_EQUIVOCADO veces.
 */
async function cambiarDeRepoSiHaceFalta(contexto, tarjeta, { origen, etapa }) {
  if (typeof contexto.crm.cambiarRepo !== "function" || yaPasoPorElTope(tarjeta)) return null;
  const revision = await revisarArchivosDelRepo({ tarjeta, plan: tarjeta.plan, config: contexto.config, registro: contexto.registro });
  if (revision.accion === "ninguna") return null;
  const cuales = revision.faltan.slice(0, 5).join(", ") + (revision.faltan.length > 5 ? ` y ${revision.faltan.length - 5} más` : "");
  const causa = enUnaLinea(
    revision.accion === "cambiar_repo"
      ? `El plan nombra archivos que no están en ${tarjeta.repo} y sí en ${revision.repoCorrecto}: ${cuales}`
      : `El plan nombra archivos que no están en ${tarjeta.repo} ni en el otro repo: ${cuales}`,
  );
  const salida = await pedirCambioDeRepo(contexto, tarjeta, {
    repo: revision.repoCorrecto,
    causa,
    lineasDelError: revision.faltan.map((ruta) => `no está en ${tarjeta.repo}: ${ruta}`),
    accion: revision.accion,
    origen,
    etapa,
  });
  return salida && { ...salida, faltan: revision.faltan };
}

/**
 * Lo común a los cambios de repo: llama /cambiar-repo (con `repo`, se lo cambia; sin `repo`, solo la vuelve a planear), lo deja en el
 * registro y en la bitácora (repo_equivocado -> cambio_de_repo) y devuelve el resultado para procesar. null si hay que seguir como
 * hoy: el CRM falló, es un CRM viejo (404) o llegó al tope de cambios (409). `causaParaElCrm` es la causa que guarda el CRM.
 */
async function pedirCambioDeRepo({ crm, config, registro }, tarjeta, { repo = null, causa, causaParaElCrm = causa, lineasDelError, accion, origen, etapa }) {
  const yaVeces = vecesConRepoEquivocado(tarjeta);
  let respuesta;
  try {
    respuesta = await crm.cambiarRepo(tarjeta.id, { ...(repo ? { repo } : {}), causa: causaParaElCrm, origen, etapa });
  } catch (error) {
    registro.aviso(`no se pudo cambiar de repo "${tarjeta.titulo}" (${error.message}): sigue como siempre`);
    return null;
  }
  if (respuesta?.ok === false) {
    registro.aviso(`el CRM no dejó cambiar de repo "${tarjeta.titulo}" (${respuesta.status ?? "?"}: ${respuesta.error ?? "sin motivo"}): sigue como siempre`);
    return null;
  }
  const decidido = repo ? `pasó de ${tarjeta.repo} a ${repo} y se vuelve a planear` : "se vuelve a planear";
  registro.info(`"${tarjeta.titulo}": ${causa}; ${decidido} (sin ${etapa === "planear" ? "mandar el plan" : "construir"} ni gastar intento)`);
  anotarIncidente({
    config,
    registro,
    tarjeta,
    repo: tarjeta.repo,
    queFallo: "repo_equivocado",
    causa,
    lineasDelError,
    comoSeResolvio: "cambio_de_repo",
    clase: "repo",
    queSeIntento: { numero: yaVeces + 1, de: TOPE_DE_REPO_EQUIVOCADO, detalle: `${origen}; ${decidido}` },
  });
  return { ok: true, estado: respuesta?.estado ?? "APROBADO", categoria: "repo_equivocado", accion, repo, repoEquivocado: true, decidido };
}

/**
 * CAMBIO DE REPO DESDE EL PLAN (27-nov-2026, parte 3): el plan dice que lo pedido vive en el otro repo (salida.otroRepo de planear:
 * OTRO_REPO, un NECESITO de "pasar la tarjeta a Gestion", la recomendada de una pregunta abierta o "solo existe en el repo …"), o la
 * decisión del Coordinador al construir es una recomendada de cambio de repo. Llama /cambiar-repo con ese repo: la tarjeta vuelve a
 * APROBADO para planearla allá, sin mandar el plan ni el aviso «necesita» (no se avisa por WhatsApp: queda en la bitácora y en el
 * historial). Devuelve el resultado para procesar, o null si hay que seguir el camino de hoy: un CRM viejo (404), el tope de
 * cambios (409), el CRM falló o la tarjeta ya pasó TOPE_DE_REPO_EQUIVOCADO veces por aquí.
 */
async function cambiarDeRepoPorElPlan(contexto, tarjeta, { repo, motivo, origen = "plan", etapa }) {
  if (typeof contexto.crm.cambiarRepo !== "function" || !repo || repo === tarjeta.repo || yaPasoPorElTope(tarjeta)) return null;
  const causa = enUnaLinea(`Lo pedido vive en el repo ${repo}, no en ${tarjeta.repo}: ${motivo || "lo dice el plan"}`);
  return pedirCambioDeRepo(contexto, tarjeta, { repo, causa, causaParaElCrm: motivo || causa, lineasDelError: [enUnaLinea(motivo || causa)], accion: "cambiar_repo", origen, etapa });
}

/** La decisión del Coordinador al construir: la opción recomendada de una pregunta abierta del plan es pasar al otro repo. */
function recomendadaDeCambioDeRepo(tarjeta) {
  const decision = (seguirConLaRecomendada(tarjeta.plan)?.decisiones ?? []).find((una) => una.repo && repoDeLaRecomendada(una) === una.repo && una.repo !== tarjeta.repo);
  return decision ? { repo: decision.repo, motivo: enUnaLinea(`La opción recomendada del plan es «${decision.opcion}» (pregunta: ${decision.pregunta})`, 300) } : null;
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
      if (error?.limiteDeUso || error?.sinSesion) throw error;
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
    if (error?.limiteDeUso || error?.sinSesion) throw error;
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

/** El motivo con que se suelta una tarjeta cuando la sesión de Claude de aizen1 se venció (24-nov-2026, parte 2). */
const MOTIVO_SIN_SESION = "En pausa: sesión de Claude vencida. Vuelve a la fila sola cuando se entre otra vez (claude auth login).";

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
export async function manejarFalla(args, tarjeta, hacer, error) {
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
  // Bitácora de incidentes (24-nov-2026): el ensayo de migraciones falló antes de subir. Solo anota: no cambia la decisión.
  if (esElEnsayoQueFallo(error)) anotarElEnsayoQueFallo(args, tarjeta, error, salida);
  return salida;
}

/** ¿El error es el del ensayo de migraciones antes de subir? */
const esElEnsayoQueFallo = (error) => error?.categoria === "migracion" && String(error?.message ?? "").startsWith(MOTIVO_ENSAYO);

/** Lo que se decidió con un ensayo de migraciones que falló, en palabras sencillas (para la bitácora). */
const DECISION_DEL_ENSAYO = {
  reparar: "la tarjeta vuelve a la fila para repararla",
  partir: "la tarea se partió en partes más chicas",
  escalar: "pasó al dueño con un resumen de la falla (ERROR)",
  esperar: "se soltó y se reintenta después",
};

/** Anota en la bitácora un ensayo de migraciones que falló. Nunca lanza. */
function anotarElEnsayoQueFallo({ config, registro }, tarjeta, error, salida) {
  try {
    // Las líneas del error son el detalle técnico (lo que dijo psql o PGlite), sin la frase de arriba.
    const lineasDelError = String(error.message)
      .split(/\r?\n/)
      .slice(1)
      .map((linea) => linea.replace(/^Detalle técnico:\s*/, "").trim())
      .filter(Boolean);
    anotarIncidente({
      config,
      registro,
      tarjeta,
      repo: tarjeta.repo,
      queFallo: "ensayo",
      causa: MOTIVO_ENSAYO,
      lineasDelError,
      comoSeResolvio: DECISION_DEL_ENSAYO[salida?.accion] ?? `decisión: ${salida?.accion ?? "sin decisión"}`,
      clase: "codigo",
      queSeIntento: { numero: (Number(tarjeta.reparaciones) || 0) + 1, de: Number(tarjeta.topeReparaciones) || TOPE_DE_REPARACIONES, detalle: "ensayo de migraciones antes de subir" },
      // La causa del ensayo ya es una frase fija (MOTIVO_ENSAYO): queda esa; qué cambia y por qué es distinto salen de la decisión.
      porQue: salida?.porQue ? { ...salida.porQue, causa: MOTIVO_ENSAYO } : null,
    });
  } catch (otro) {
    registro.aviso(`bitácora: no se pudo anotar el ensayo que falló (${String(otro?.message ?? otro).split("\n")[0]})`);
  }
}

/**
 * LAS FALLAS REPETIDAS EN LA BITÁCORA (25-nov-2026, parte 2 de «las 4 fallas repetidas»): la nube sin señal, Claude sin cambiar
 * nada y las pruebas que fallan quedan anotadas con anotarIncidente (la reversión falsa se anota en resolverLaSubidaDeshecha).
 * La categoría del diagnóstico -> la clave de QUE_FALLO de bitacora.mjs.
 */
const FALLAS_REPETIDAS = { nube_sin_resultado: "nube_sin_senal", no_cambio_nada: "no_cambio_nada", fallan_pruebas: "fallan_pruebas" };

/** La clase de cada falla repetida (para la regla genérica de la bitácora). */
const CLASE_DE_LA_FALLA = { nube_sin_senal: "nube", no_cambio_nada: "sin_cambios", fallan_pruebas: "codigo" };

/** Cómo se resolvió, para la bitácora: una clave de COMO_SE_RESOLVIO o la frase de la decisión. */
function comoSeResolvioLaFalla(salida) {
  if (salida?.accion === "ya_en_main") return "ya_en_main";
  // 27-nov-2026: la misma causa de dependencia (se espera a la otra tarjeta) y el corte por misma causa.
  if (salida?.accion === "esperar_dependencia") return salida.enError || salida.categoria === "depende_de_sin_main" ? "pasó a ERROR (depende_de_sin_main): no hay a quién esperar o su código no está en main" : "esperar_dependencia";
  if (salida?.accion === "escalar" && salida.mismaCausa) return "pasó al dueño (ERROR) sin otra reparación igual";
  if (salida?.accion === "reparar" && (salida.estrategia === "sesion_nueva" || salida.estrategia === "plan_nuevo")) return salida.estrategia;
  if (salida?.accion === "reparar" && salida.estrategia) return `${DECISION_DEL_ENSAYO.reparar} (estrategia ${salida.estrategia})`;
  return DECISION_DEL_ENSAYO[salida?.accion] ?? `decisión: ${salida?.accion ?? "sin decisión"}`;
}

/** Las categorías de código: su regla genérica en la bitácora es la de la clase "codigo". */
const CATEGORIAS_DE_CODIGO = ["no_compila", "fallan_pruebas", "lint", "migracion"];

/**
 * Qué falló, para la bitácora: el corte por misma causa (y la espera a la dependencia) es "misma_causa"; una falla repetida, su
 * clave de QUE_FALLO; cualquier otra reparación, la categoría. null si esta falla no se anota aquí.
 * 27-nov-2026 (parte 3 de «si una reparación falla por el mismo motivo, no repetir igual»): se anotan TODAS las reparaciones (no
 * solo las de las fallas repetidas) y el corte por misma causa, cada una con su porqué.
 */
function queFalloParaLaBitacora(diagnostico, salida) {
  if (salida?.mismaCausa || salida?.accion === "esperar_dependencia") return "misma_causa";
  const repetida = FALLAS_REPETIDAS[diagnostico?.categoria];
  if (repetida) return repetida;
  return salida?.accion === "reparar" ? (diagnostico?.categoria ?? "otra") : null;
}

/** Anota en la bitácora una falla ya decidida y hecha (ver queFalloParaLaBitacora). Solo anota: no cambia la decisión. Nunca lanza. */
function anotarLaFallaRepetida({ config, registro }, tarjeta, error, diagnostico, salida) {
  const queFallo = queFalloParaLaBitacora(diagnostico, salida);
  // La subida deshecha (y su reversión falsa) ya se anota en resolverLaSubidaDeshecha; la causa externa no es de la tarea.
  // El repo equivocado ya quedó anotado en cambiarDeRepoSiHaceFalta. El ensayo de migraciones que falló lo anota manejarFalla
  // (anotarElEnsayoQueFallo, con su porqué): una sola entrada por falla, porque la clave es la fecha al minuto y la tarjeta.
  if (!queFallo || error?.reversion?.ok === true || salida?.causaExterna || salida?.repoEquivocado || esElEnsayoQueFallo(error)) return;
  try {
    const hechas = Number(tarjeta.reparaciones) || 0;
    const tope = Number(tarjeta.topeReparaciones) || TOPE_DE_REPARACIONES;
    const antes = tarjeta.reparacion?.estrategia ?? estrategiaDeLaCausa([...(tarjeta.ultimosIntentos ?? [])].reverse().find((intento) => intento?.accion === "reparar")?.causa);
    anotarIncidente({
      config,
      registro,
      tarjeta,
      repo: tarjeta.repo,
      queFallo,
      causa: diagnostico.causa,
      lineasDelError: String(diagnostico.error ?? "").split(/\r?\n/),
      comoSeResolvio: comoSeResolvioLaFalla(salida),
      clase: CLASE_DE_LA_FALLA[queFallo] ?? (queFallo === "misma_causa" ? "misma_causa" : CATEGORIAS_DE_CODIGO.includes(diagnostico.categoria) ? "codigo" : "desconocida"),
      porQue: salida?.porQue ?? null,
      queSeIntento: { numero: hechas + 1, de: tope, detalle: `${diagnostico.categoria}${antes ? `, con la estrategia ${antes}` : ""}; ${salida?.decidido ?? `decisión: ${salida?.accion ?? "?"}`}` },
    });
  } catch (otro) {
    registro.aviso(`bitácora: no se pudo anotar la falla (${String(otro?.message ?? otro).split("\n")[0]})`);
  }
}

/** Repara la falla (repararSinAnotar) y, si es una de las fallas repetidas, la anota en la bitácora. */
async function repararLaFalla(args, tarjeta, hacer, error, nota) {
  const salida = await repararSinAnotar(args, tarjeta, hacer, error, nota);
  anotarLaFallaRepetida(args, tarjeta, error, nota.diagnostico, salida);
  return salida;
}

async function repararSinAnotar({ crm, config, registro, contexto, bitacora, pausaSesion = null }, tarjeta, hacer, error, nota) {
  // Una subida que se deshizo trae su causa en sencillo (deshacerSubida, 23-nov-2026): el motivo y la causa empiezan con ella.
  const sencilla = typeof error?.reversion?.sencilla === "string" ? error.reversion.sencilla.trim() : "";
  const mensaje = error instanceof Error ? error.message : String(error);
  const motivo = sencilla && !mensaje.startsWith(sencilla) ? `${sencilla}\n${mensaje}` : mensaje;
  const textoLog = bitacora.join("\n");
  // 1. El error completo y el log, ANTES de diagnosticar. 25-nov-2026 (parte 4): si el comando que falló dejó su salida
  // completa (las pruebas), va al final del log: así sus últimas 30 líneas son las de la falla.
  const salidaDelComando = typeof error?.salida === "string" ? error.salida.trim() : "";
  const textoGuardado = [
    `Tarjeta: ${tarjeta.titulo} (${tarjeta.id})`,
    `Etapa: ${hacer}`,
    `Intento: ${tarjeta.intentos ?? "?"}, reparaciones: ${tarjeta.reparaciones ?? 0}`,
    "",
    "ERROR:",
    motivo,
    "",
    "LOG DE LA SESIÓN:",
    textoLog,
    ...(salidaDelComando ? ["", "SALIDA DEL COMANDO QUE FALLÓ:", salidaDelComando] : []),
  ].join("\n");
  const rutaLog = registro.guardarIntento?.({ tarjetaId: tarjeta.id, etapa: hacer, texto: textoGuardado });
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
  const causaDelIntento = enUnaLinea(diagnostico.causa) || sinCausa(hacer, tarjeta.intentos);
  const intento = { etapa: hacer, categoria: diagnostico.categoria, causa: sencilla ? enUnaLinea(`${sencilla} ${causaDelIntento}`) : causaDelIntento, error: diagnostico.error };
  // Lo que llega a la tarjeta (soltar, escalar) dice primero la causa en sencillo.
  const causaParaLaTarjeta = sencilla ? `${sencilla} ${diagnostico.causa ?? ""}`.trim() : diagnostico.causa;

  // 2a. No cambió nada (25-nov-2026, parte 3 de «las 4 fallas repetidas»): antes de reparar, ¿ya está en main? Si el commit está
  // (comprobado con git), la tarjeta pasa a HECHO con la nota "ya estaba hecho (commit X)" y el motivo; si no, decidir() la repara
  // con la estrategia plan_nuevo (se vuelve a planear con el main de hoy).
  if (diagnostico.categoria === "no_cambio_nada" && !error?.reversion) {
    const yaHecho = await yaEstaEnMain(contexto, tarjeta);
    if (yaHecho) {
      const cerrada = await cerrarComoYaHecha({ crm, registro }, tarjeta, hacer, yaHecho);
      const decidido = `ya estaba en main (commit ${yaHecho.commit.slice(0, 10)})`;
      return { ...cerrada, motivo, zonas: error?.zonas ?? [], categoria: diagnostico.categoria, accion: cerrada.yaHecha ? "ya_en_main" : "esperar", commit: yaHecho.commit, decidido };
    }
    // 27-nov-2026 («nunca construir en el repo equivocado»): desde la primera vez que no cambió nada, ¿el plan es de otro repo? Si
    // sí, se cambia de repo (o se vuelve a planear) en vez de gastar la reparación plan_nuevo u opus.
    const porRepo = await cambiarDeRepoSiHaceFalta({ crm, config, registro }, tarjeta, { origen: "no_cambio_nada", etapa: hacer });
    if (porRepo) return { ...porRepo, motivo, zonas: error?.zonas ?? [] };
  }

  // 2b. Tres causas distintas sin resolverlo: UNA fila en el registro del Coordinador para el CTO (nunca al dueño ni por WhatsApp).
  avisarAlCtoSiHaceFalta({ config, registro }, tarjeta, diagnostico);

  // 2b'. Subida deshecha (24-nov-2026, parte 3): producción ya volvió a la versión anterior. Se pide el arreglo, se reintenta o, a
  // la 3.ª, queda en Alertas. La URGENTE (reversion.ok false) sigue el camino de siempre.
  if (error?.reversion?.ok === true) {
    return resolverLaSubidaDeshecha({ crm, config, registro }, tarjeta, hacer, error, { diagnostico, intento, motivo, causaParaLaTarjeta });
  }

  // 2c. Causa externa (31-oct-2026): la falla no es de la tarea. Se pide la tarjeta que la arregla y esta espera a esa, sin
  // reparar, sin ERROR y sin gastar intento. Si el CRM falla o no la suelta, sigue el camino de siempre (nunca peor que hoy).
  const externa = causaExterna(diagnostico, { reversion: error?.reversion ?? null, repo: tarjeta.repo, tarjeta });
  if (externa) {
    try {
      const respuesta = await crm.causaExterna(tarjeta.id, { tipo: externa.tipo, titulo: externa.titulo, detalle: externa.detalle, referencia: externa.referencia, repo: tarjeta.repo, ...intento });
      if (respuesta?.soltada) {
        const esperando = respuesta.esperando ?? `Esperando a «${externa.titulo}»`;
        registro.info(`causa externa (${externa.tipo}): ${respuesta.creada ? "creé" : "reusé"} «${externa.titulo}»; "${tarjeta.titulo}": ${esperando}, sin reparar ni gastar intento`);
        return { ok: false, motivo, zonas: error?.zonas ?? [], categoria: diagnostico.categoria, accion: "esperar", causaExterna: externa.tipo, esperando };
      }
      registro.aviso(`causa externa (${externa.tipo}): el CRM no dejó esperando a "${tarjeta.titulo}": sigue el camino de siempre`);
    } catch (otro) {
      registro.aviso(`causa externa (${externa.tipo}): no se pudo pedir la tarjeta de la causa (${otro.message}): sigue el camino de siempre`);
    }
  }

  // 3. Decidir.
  const estrategiaActual = tarjeta.reparacion?.estrategia;
  const modeloConstruir = modeloDelPaso(config, estrategiaActual === "opus" ? "reparar" : "construir", tarjeta);
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
  // 27-nov-2026 (parte 3 de «si una reparación falla por el mismo motivo, no repetir igual»): la causa en una frase, qué cambia en
  // el intento siguiente y por qué es distinto del anterior. Va al CRM (historial de la tarjeta) y a la bitácora de incidentes.
  // Se recalcula después si la decisión cambia (el CRM no deja reparar más, no se pudo partir).
  const porQueDe = () => porQueDeLaDecision(decision, diagnostico, tarjeta.ultimosIntentos);
  const resultado = {
    ok: false,
    motivo,
    zonas: error?.zonas ?? [],
    categoria: diagnostico.categoria,
    accion: decision.accion,
    estrategia: decision.estrategia,
    decidido: decision.motivo,
    ...(decision.mismaCausa ? { mismaCausa: true } : {}),
    porQue: porQueDe(),
  };
  registro.info(`POR QUÉ: causa ${resultado.porQue.causa} | qué cambia: ${resultado.porQue.queCambia} | por qué es distinto: ${resultado.porQue.porQueEsDistinto}`);
  // La causa nunca va vacía al CRM (30-oct-2026): si no se supo, se dice en qué etapa e intento (`intento`, arriba).

  // 4. Hacerlo.
  // 31-oct-2026: choca con main -> se reconstruye desde el main más nuevo sin gastar reparación (cuenta: false). /reparar
  // la devuelve a construir y guarda un intento que no cuenta; si el CRM ya no deja (su tope de choques seguidos), se escala.
  if (decision.arreglo === "reconstruir") {
    const causa = error?.verificarEnNube ? `${enUnaLinea(intento.causa, 160)} [estrategia: nube]` : intento.causa;
    try {
      await crm.reparar(tarjeta.id, { ...intento, causa, cuenta: false, porQue: resultado.porQue });
      registro.info("choca con main: la tarjeta vuelve a construir desde el main más nuevo (no gasta reparación)");
      return resultado;
    } catch (otro) {
      if (otro?.status !== 409) {
        registro.error(`no se pudo pedir la reconstrucción al CRM: ${otro.message}`);
        return resultado;
      }
      registro.aviso(`el CRM no deja reconstruir más (${otro.message}): se escala`);
      decision.accion = "escalar";
      resultado.accion = "escalar";
      resultado.porQue = porQueDe();
    }
  }
  if (decision.accion === "esperar") {
    if (decision.arreglo === "sin_claude") await arreglarSinClaude(contexto, tarjeta, diagnostico.categoria, registro);
    await soltar(crm, registro, tarjeta, `${causaParaLaTarjeta} Se reintenta después.`, { ...intento, porQue: resultado.porQue });
    return resultado;
  }
  // 27-nov-2026: la misma causa que el intento anterior, de dependencia o de main: no se repara igual. Se espera a la tarjeta que
  // nombra la tarjeta o la causa (el camino de DEPENDE_DE); si no hay a quién esperar, queda en ERROR con el motivo.
  if (decision.accion === "esperar_dependencia") {
    return esperarPorLaCausa({ crm, config, registro }, tarjeta, hacer, error, { diagnostico, intento, causaParaLaTarjeta, resultado });
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
      // La sesión de Claude se venció al dividir: se suelta sin ERROR ni reparación y el Coordinador entra en pausa.
      if (otro?.sinSesion) {
        registro.aviso("la sesión de Claude se venció al partir: se suelta sin error ni intento");
        pausaSesion?.marcarVencida(otro.message);
        await soltar(crm, registro, tarjeta, MOTIVO_SIN_SESION);
        return { ...resultado, accion: "esperar", categoria: "sin_sesion", sinSesion: true };
      }
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
      resultado.porQue = porQueDe();
    }
  }
  if (decision.accion === "reparar") {
    // 160 + la marca (19) + lo que agrega el CRM (" (estrategia: opus)", 19) caben en sus 200 letras: la marca no se corta.
    // 25-nov-2026: con el link de la sesión de la nube en la causa, el link no se corta (causaConMarca).
    const causa = decision.estrategia ? causaConMarca(intento.causa, decision.estrategia) : intento.causa;
    // Antes de reparar, la causa y qué cambia frente al intento anterior (el siguiente intento los recibe en su prompt).
    const queCambia = decision.queCambia ?? queCambiaFrenteAlAnterior(diagnostico, tarjeta.ultimosIntentos, decision.estrategia);
    registro.info(`CAUSA: ${intento.causa} | QUÉ CAMBIA: ${queCambia}`);
    // 25-nov-2026 (parte 4): las pruebas que fallaron. El intento siguiente recibe la ruta del log completo y sus últimas 30
    // líneas (antes solo veía la primera línea que falló, en la causa).
    const errorParaElSiguiente = diagnostico.categoria === "fallan_pruebas" ? conElLogCompleto(intento.error, rutaLog, textoGuardado) : intento.error;
    try {
      const respuesta = await crm.reparar(tarjeta.id, { ...intento, causa, error: errorParaElSiguiente, estrategia: decision.estrategia, porQue: resultado.porQue });
      registro.info(`a reparar: la tarjeta vuelve a la fila${respuesta?.reparaciones ? ` (reparación ${respuesta.reparaciones} de ${tarjeta.topeReparaciones})` : ""}`);
      return resultado;
    } catch (otro) {
      if (otro?.status !== 409) {
        registro.error(`no se pudo pedir la reparación al CRM: ${otro.message}`);
        return resultado;
      }
      registro.aviso(`el CRM no deja reparar más (${otro.message}): se escala`);
      decision.accion = "escalar";
      resultado.accion = "escalar";
      resultado.porQue = porQueDe();
      // Una falla repetida que el CRM ya no deja reparar llegó a su tope: también es la alerta única.
      if (ESTRATEGIAS_DE_LAS_FALLAS[diagnostico.categoria]) decision.agotado = true;
    }
  }
  // 25-nov-2026 (parte 4): una falla repetida tras 3 intentos distintos escala UNA vez con `agotado`: el CRM deja una sola
  // alerta en /cliente/alertas, solo en la página (sin WhatsApp). Los intentos de antes no avisaron nada.
  if (decision.agotado && ESTRATEGIAS_DE_LAS_FALLAS[diagnostico.categoria]) {
    const resumen = resumenDeFallaAgotada({ tarjeta, intentos: tarjeta.ultimosIntentos, diagnostico });
    try {
      await crm.error(tarjeta.id, resumen, error?.zonas, error?.reversion, { ...intento, resumen, agotado: true, porQue: resultado.porQue });
      registro.info(`${diagnostico.categoria} tras ${Number(tarjeta.reparaciones) || 0} intentos distintos: "${tarjeta.titulo}" queda en ERROR, una sola alerta solo en la página`);
    } catch (otro) {
      registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
    }
    return { ...resultado, accion: "escalar", agotado: true };
  }
  // Escalar: el resumen de máximo 3 líneas para el dueño; el detalle técnico queda en "Detalles técnicos".
  // 29-oct-2026: la revisión que no pasó trae sus 2 líneas para el dueño (por qué se paró / qué decisión necesita): van tal cual.
  const resumen =
    diagnostico.categoria === "revision_no_paso" && Array.isArray(error?.paraElDueno) && error.paraElDueno.length === 2
      ? error.paraElDueno.join("\n")
      : resumenDeEscalada({ tarjeta, intentos: tarjeta.ultimosIntentos, diagnostico: { ...diagnostico, causa: causaParaLaTarjeta }, decision });
  try {
    await crm.error(tarjeta.id, resumen, error?.zonas, error?.reversion, { ...intento, resumen, porQue: resultado.porQue });
  } catch (otro) {
    registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
  }
  return { ...resultado, accion: "escalar" };
}

/** Los «títulos» y los ids de tarjeta (cm…) que nombra la causa, sin la propia tarjeta (máximo 5). */
export function referenciasDeLaCausa(causa, tarjeta = null) {
  const texto = String(causa ?? "");
  const ids = (texto.match(/\bcm[a-z0-9]{20,28}\b/g) ?? []).filter((id) => id !== tarjeta?.id);
  const titulos = [...texto.matchAll(/[«"“]([^«»"“”\n]{4,120})[»"”]/g)].map((coincidencia) => coincidencia[1].trim()).filter((titulo) => titulo !== String(tarjeta?.titulo ?? "").trim());
  return [...new Set([...ids, ...titulos])].slice(0, 5);
}

/**
 * esperar_dependencia (27-nov-2026): la falla se repitió con la misma causa y es de dependencia o de main. Las referencias salen de
 * la tarjeta (referenciasParaDepender: su título, detalle y plan) y de la causa (los «títulos» o ids que nombra):
 *  - con referencias: esperarPorDependencia, el camino de DEPENDE_DE (flecha y espera; ya en main se suelta; FALLIDA o hecha a mano
 *    sin su código en main queda en ERROR `depende_de_sin_main`);
 *  - sin nadie a quién esperar: ERROR `depende_de_sin_main` con el motivo, sin reparar.
 * Nunca llama /reparar. Nunca lanza.
 */
async function esperarPorLaCausa({ crm, config, registro }, tarjeta, hacer, error, { diagnostico, intento, causaParaLaTarjeta, resultado }) {
  const referencias = [...new Set([...referenciasParaDepender(tarjeta), ...referenciasDeLaCausa(diagnostico.causa, tarjeta)])].slice(0, 5);
  if (referencias.length) {
    registro.info(`"${tarjeta.titulo}": misma causa que el intento anterior y es de dependencia: espera a ${referencias.join(", ")}, sin reparar`);
    const espera = await esperarPorDependencia({ crm, config, registro }, tarjeta, hacer, referencias, resultado.porQue);
    return { ...resultado, ...espera, motivo: espera.motivo ?? resultado.motivo, categoria: espera.categoria ?? resultado.categoria, accion: "esperar_dependencia", referencias };
  }
  const causa = enUnaLinea(causaParaLaTarjeta || diagnostico.causa, 220);
  const resumen = [
    `Qué falló: ${causa.replace(/\.?$/, ".")}`,
    "Qué se probó: falló dos veces seguidas por la misma causa, que es de una dependencia o de main; no se repara igual y no se sabe a qué tarjeta esperar.",
    "Qué necesita de ti: subir a main la tarjeta de la que depende (o decir cuál es) y tocar Reintentar.",
  ].join("\n");
  registro.aviso(`"${tarjeta.titulo}": misma causa de dependencia y no nombra a quién esperar: queda en ERROR (depende_de_sin_main), sin reparar`);
  try {
    await crm.error(tarjeta.id, resumen, error?.zonas, undefined, { ...intento, categoria: "depende_de_sin_main", causa, resumen, porQue: resultado.porQue });
  } catch (otro) {
    registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
  }
  return { ...resultado, ok: false, categoria: "depende_de_sin_main", accion: "esperar_dependencia", enError: true, referencias: [] };
}

/** Lo que el CRM guarda del error de un intento (MAXIMO_ERROR_DEL_INTENTO de reglas-trabajador.ts). */
const LARGO_DEL_ERROR_DEL_INTENTO = 6000;

/**
 * El error para el intento siguiente de unas pruebas que fallaron (25-nov-2026, parte 4): primero la ruta del log completo que
 * guardó registro.guardarIntento y sus últimas 30 líneas, después el error de siempre. Cabe en las 6000 letras del CRM.
 */
export function conElLogCompleto(errorDelIntento, rutaLog, textoDelLog) {
  const cola = ultimasLineas(String(textoDelLog ?? ""), 30);
  const encabezado = [
    rutaLog ? `Log completo del intento anterior (en aizen1): ${rutaLog}` : "",
    cola ? `Últimas 30 líneas del log:\n${cola}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (!encabezado) return errorDelIntento;
  return recortar(`${encabezado}${errorDelIntento ? `\n\nError:\n${errorDelIntento}` : ""}`, LARGO_DEL_ERROR_DEL_INTENTO);
}

/**
 * SUBIDA DESHECHA QUE SE RESUELVE SOLA (24-nov-2026, parte 3 de «si una subida falla, diagnosticar, arreglar y reintentar solo»).
 * La subida ya se deshizo (reversion.ok: producción volvió a la versión anterior) y trae su causa en sencillo (deshacerSubida).
 *   - arreglo_de_subida (código o arranque): /causa-externa tipo "subida" crea «Arreglo de subida: …» y esta espera a esa.
 *   - esperar (pasajera): /soltar con categoria subida_revertida, sin arreglo: se reintenta en la vuelta siguiente.
 *   - la 3.ª subida deshecha (lo cuenta el Coordinador o el CRM responde `agotado`): /error con 3 líneas y categoria
 *     subida_revertida, que queda solo en Alertas (sin WhatsApp).
 * Si el CRM falla o no suelta la tarjeta: el WhatsApp de antes y /error de siempre (nunca peor que hoy). Nunca lanza.
 */
export async function resolverLaSubidaDeshecha({ crm, config, registro }, tarjeta, hacer, error, datos) {
  // Bitácora de incidentes (24-nov-2026): primero se decide y se hace (arreglo, reintento o Alertas); después se anota. Si la
  // bitácora falla, lo de la tarjeta ya pasó igual.
  const como = {};
  const salida = await decidirLaSubidaDeshecha({ crm, registro }, tarjeta, hacer, error, datos, como);
  try {
    const reversion = error.reversion;
    anotarIncidente({
      config,
      registro,
      tarjeta,
      repo: tarjeta.repo,
      commit: reversion.commit ? String(reversion.commit).slice(0, 10) : null,
      // La 1.ª línea de la vigilancia empieza con "Revertida:" (deshacerSubida); la del despliegue, no.
      // 25-nov-2026: la reversión falsa se anota como tal (no es que no arrancara): se vuelve a subir el mismo commit.
      queFallo: reversion.clase === "falsa" ? "reversion_falsa" : /^Revertida:/.test(String(error?.message ?? "")) ? "vigilancia" : "no_arranco",
      causa: datos.causaParaLaTarjeta || datos.diagnostico?.causa,
      lineasDelError: Array.isArray(reversion.lineas) ? reversion.lineas : [],
      comoSeResolvio: como.valor ?? "no registrado",
      clase: reversion.clase ?? "desconocida",
      queSeIntento: { numero: intentosDeSubida(tarjeta.ultimosIntentos) + 1, de: TOPE_INTENTOS_DE_SUBIDA, detalle: reversion.clase === "falsa" ? "subida; la reversión falsa no suma al tope" : "subida a producción" },
    });
  } catch (otro) {
    registro.aviso(`bitácora: no se pudo anotar la subida deshecha (${String(otro?.message ?? otro).split("\n")[0]})`);
  }
  return salida;
}

/** Lo de siempre con la subida deshecha (ver arriba). `como.valor` queda con lo que se decidió, para la bitácora. */
async function decidirLaSubidaDeshecha({ crm, registro }, tarjeta, hacer, error, { diagnostico, intento, motivo, causaParaLaTarjeta }, como) {
  const reversion = error.reversion;
  const sencilla = enUnaLinea(typeof reversion.sencilla === "string" && reversion.sencilla.trim() ? reversion.sencilla : FRASES_DE_LA_CAUSA.desconocida, 200);
  const decision = decidir({ diagnostico, tarjeta, etapa: hacer, reversion });
  const resultado = { ok: false, motivo, zonas: error?.zonas ?? [], categoria: diagnostico.categoria, accion: decision.accion };
  const deSubida = { ...intento, categoria: "subida_revertida" };
  const subidas = intentosDeSubida(tarjeta.ultimosIntentos) + 1;
  registro.info(`subida deshecha (${reversion.clase ?? "sin clase"}): ${sencilla} — decisión: ${decision.accion} (${decision.motivo})`);

  // Lo de siempre cuando el CRM no responde: el WhatsApp de la reversión y /error con el resumen (como antes de la parte 3).
  const comoAntes = async (porQue) => {
    como.valor = "pasó a ERROR por el camino de siempre (aviso y resumen al dueño)";
    registro.aviso(`subida deshecha: ${porQue}; sigue el camino de siempre (aviso y ERROR)`);
    await avisarReversion(crm, registro, tarjeta, motivo, reversion);
    const resumen = resumenDeEscalada({ tarjeta, intentos: tarjeta.ultimosIntentos, diagnostico: { ...diagnostico, causa: causaParaLaTarjeta }, decision });
    try {
      await crm.error(tarjeta.id, resumen, error?.zonas, reversion, { ...intento, resumen });
    } catch (otro) {
      registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
    }
    return { ...resultado, accion: "escalar" };
  };

  // La 3.ª (o el CRM dijo `agotado`): queda en ERROR con 3 líneas, solo en Alertas.
  const agotar = async (veces) => {
    como.valor = "alertas";
    const resumen = [
      enUnaLinea(`Qué se intentó: se subió «${tarjeta.titulo}» ${veces} veces y cada vez se deshizo; producción volvió a la versión anterior.`, 240),
      enUnaLinea(`Causa: ${sencilla}`, 240),
      enUnaLinea("Qué decisión se necesita: mirar la causa (Detalles técnicos) y decir si se arregla a mano, se cambia lo pedido o se cierra; después tocar Reintentar.", 240),
    ].join("\n");
    try {
      await crm.error(tarjeta.id, resumen, error?.zonas, reversion, { ...deSubida, resumen });
      registro.info(`subida deshecha ${veces} de ${TOPE_INTENTOS_DE_SUBIDA}: "${tarjeta.titulo}" queda en ERROR, solo en Alertas (sin WhatsApp)`);
    } catch (otro) {
      registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
    }
    return { ...resultado, accion: "escalar" };
  };

  // 25-nov-2026: reversión falsa (se deshizo antes de que el servidor bajara la versión). Se suelta SIN la categoría
  // subida_revertida: no suma al TOPE_INTENTOS_DE_SUBIDA ni cuenta como intento. En la vuelta siguiente subir() ve el commit
  // deshecho en main (revertQueLoDeshace), deshace el revert y sube el mismo commit.
  if (reversion.clase === "falsa") {
    const nota = enUnaLinea(`${sencilla} Se vuelve a subir el mismo commit en la vuelta siguiente (no suma al tope de subidas).`, 200);
    if (await soltar(crm, registro, tarjeta, nota, { ...intento, causa: nota })) {
      como.valor = "resubir";
      registro.info(`reversión falsa: "${tarjeta.titulo}" se vuelve a subir con el mismo commit en la vuelta siguiente`);
      return { ...resultado, accion: "esperar" };
    }
    return comoAntes("el CRM no dejó soltar la tarjeta");
  }

  if (decision.accion === "escalar") {
    // La 3.ª subida deshecha va a Alertas; una tarjeta de causa escala como siempre.
    return decision.agotado ? agotar(subidas) : comoAntes(decision.motivo);
  }

  if (decision.accion === "arreglo_de_subida") {
    const externa = causaExterna(diagnostico, { reversion, repo: tarjeta.repo, tarjeta });
    if (externa?.tipo !== "subida") return comoAntes("no se pudo armar la tarjeta del arreglo");
    // Cabe en las 200 letras de la causa del intento: la frase sencilla y el título, recortados, y la frase final entera.
    const nota = `${enUnaLinea(sencilla, 75)} Se creó el arreglo «${enUnaLinea(externa.titulo, 70)}» y después se reintenta esta.`;
    try {
      const respuesta = await crm.causaExterna(tarjeta.id, {
        tipo: "subida",
        titulo: externa.titulo,
        detalle: externa.detalle,
        lineas: externa.lineas,
        reversion: { ok: true, commit: reversion.commit, revert: reversion.revert },
        repo: tarjeta.repo,
        ...deSubida,
        causa: nota,
      });
      if (respuesta?.agotado) return agotar(Number(respuesta.subidas) || TOPE_INTENTOS_DE_SUBIDA);
      if (respuesta?.soltada) {
        como.valor = "arreglo";
        registro.info(`${nota} (${respuesta.creada ? "creé" : "reusé"} la tarjeta; "${tarjeta.titulo}": ${respuesta.esperando ?? "esperando"})`);
        return { ...resultado, accion: "esperar", causaExterna: "subida", esperando: respuesta.esperando ?? `Esperando a «${externa.titulo}»` };
      }
      return comoAntes("el CRM no dejó esperando la tarjeta al arreglo");
    } catch (otro) {
      return comoAntes(`no se pudo pedir el arreglo al CRM (${otro.message})`);
    }
  }

  // Pasajera: se suelta (SUBIENDO sigue en SUBIENDO) y se reintenta en la vuelta siguiente, sin crear arreglo.
  const nota = enUnaLinea(`${sencilla} Se reintenta en la vuelta siguiente, sin crear arreglo (subida ${subidas} de ${TOPE_INTENTOS_DE_SUBIDA}).`, 200);
  if (await soltar(crm, registro, tarjeta, nota, { ...deSubida, causa: nota })) {
    como.valor = "reintento";
    registro.info(`subida deshecha por una falla pasajera: "${tarjeta.titulo}" se reintenta en la vuelta siguiente`);
    return { ...resultado, accion: "esperar" };
  }
  return comoAntes("el CRM no dejó soltar la tarjeta");
}

/**
 * AVISO AL CTO (31-oct-2026): si la tarjeta ya junta CAUSAS_PARA_AVISAR_AL_CTO causas distintas (sus intentos sin las esperas más la
 * falla de ahora), queda UNA fila fechada en el registro del Coordinador de la bóveda. No usa crm.aviso: al dueño no se le escribe.
 * Sin `boveda.ruta` solo queda en el log. Nunca lanza.
 */
function avisarAlCtoSiHaceFalta({ config, registro }, tarjeta, diagnostico) {
  const causas = causasDistintas(tarjeta.ultimosIntentos, diagnostico);
  if (causas.length < CAUSAS_PARA_AVISAR_AL_CTO) return;
  const textos = causas.map((causa) => `${causa.categoria} (${enUnaLinea(causa.causa, 80)})`);
  const boveda = config.boveda?.ruta ?? null;
  if (!boveda) {
    registro.aviso(`AVISO AL CTO: "${tarjeta.titulo}" — causas: ${textos.join(", ")} (sin boveda.ruta: solo queda en el log)`);
    return;
  }
  try {
    const { accion } = anotarAvisoAlCto(boveda, { tarjeta, causas: textos });
    if (accion === "agregada") registro.info(`AVISO AL CTO: "${tarjeta.titulo}" juntó ${causas.length} causas distintas; quedó en el registro del Coordinador`);
  } catch (error) {
    registro.aviso(`AVISO AL CTO: no se pudo escribir en el registro del Coordinador (${error?.message ?? error}): "${tarjeta.titulo}" — causas: ${textos.join(", ")}`);
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
 * ¿Se toman tarjetas en esta vuelta? (31-oct-2026, causa del 30-oct a las 11:50 p. m.: esperando la versión nueva la fila
 * quedaba quieta 30 a 45 min). Sin versión nueva pendiente, sí y de todo. Con versión pendiente, solo para planear y solo
 * mientras quede una tarea larga (sin puesto o en la nube); sin tareas largas, nada: se actualiza.
 */
export function queTomarEsperandoVersion({ pendiente, tareasLargas }) {
  if (!pendiente) return { tomar: true, soloPlanear: false };
  return tareasLargas > 0 ? { tomar: true, soloPlanear: true } : { tomar: false, soloPlanear: false };
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
  // Lo que hace cada sesión (procesar); las pruebas del reparto lo cambian por uno falso que no corre etapas.
  procesarTarjeta = procesar,
  // El reloj (las pruebas de la alarma de cupos sin usar lo adelantan).
  ahora = () => Date.now(),
  // 24-nov-2026: la pausa por sesión de Claude vencida (sesion-claude.mjs): con la sesión vencida no se toma ninguna tarjeta.
  pausaSesion = crearPausaPorSesion({ config, registro, ahora, entorno: entornoSeguro() }),
  // La memoria y el disco de aizen1 en GB (recursos.mjs: leerCarga), para el semáforo; las pruebas la cambian.
  leerCargaDelPc = leerCarga,
  // El ajuste automático del cupo de la nube (ajuste-de-cupos.mjs); undefined = el de la configuración.
  ajusteCupos: ajusteDado = undefined,
  // Las tarjetas sin señal más de 30 min (sin-latido.mjs); undefined = la del archivo de la carpeta de trabajo.
  sinLatido: sinLatidoDado = undefined,
}) {
  const max = config.maxParalelo;
  // 31-oct-2026 (parte 4): durante 3 días el cupo de la nube de un proyecto baja solo en 1 si con varias a la vez chocan más.
  const ajusteCupos = ajusteDado ?? crearAjusteDeCupos({ config, registro, ahora, nombreDe: (clave) => nombreDelProyecto(config.repos[clave]) });
  /** El cupo de la nube que vale ahora para el proyecto (el configurado, o el que bajó el ajuste). null = sin tope propio. */
  const cupoNubeDe = (clave) => ajusteCupos.cupo(clave);
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
  /**
   * La pregunta que dejó la sesión de la nube en la rama de la tarjeta (commit vacío "pregunta: …"), o null. Solo se mira al
   * construir (planear no tiene rama). Lanza si no se pudo leer GitHub: la guardia espera a la próxima revisión.
   */
  const preguntaDeLaRama = async (entrada, id) => {
    if (entrada.etapa !== "construir") return null;
    const repo = config.repos[entrada.repo];
    const rama = entrada.rama ?? nombreDeRama({ id, titulo: entrada.titulo ?? "" });
    if (!repo || !esRamaDelTrabajador(rama)) return null;
    const { commits, error } = await commitsDeLaRama({ config }, repo, rama);
    // Una rama que no existe (404) no tiene ninguna pregunta; cualquier otro fallo (sin red, gh sin sesión) no deja saberlo.
    if (error) {
      if (/\b404\b|not found/i.test(error)) return null;
      throw new Error(error.split("\n")[0]);
    }
    // Del más nuevo al más viejo: lo último que dejó la sesión manda (un "resultado:" después de una pregunta ya la contestó).
    for (const commit of commits) {
      if (resultadoDelCommit(commit.mensaje)) return null;
      const pregunta = preguntaDelCommit(commit.mensaje);
      if (pregunta) return pregunta;
    }
    return null;
  };
  // 18-nov-2026: lo que este Coordinador tomó y la hora de su última señal; una que nadie trabaja hace más de 30 min se suelta sola
  // (la revisión corre cada 15 min y no usa Claude).
  const sinLatido =
    sinLatidoDado ??
    crearGuardiaSinLatido({ crm, config, registro, ahora, vivas: () => [...sesiones.values(), ...enNube.values()].map((sesion) => sesion.tarjeta.id), preguntaDeLaTarjeta: preguntaDeLaRama });
  // Lo que vuelve de la nube se verifica en aizen1 (npm ci, build…): no más a la vez que puestos tiene aizen1.
  const puestosDeVerificacion = crearSemaforo(Math.max(1, max));
  // La cola de pasos pesados de aizen1 (cola.mjs): una sola para todas las sesiones (0 = sin cola, como antes).
  const colaPesada = colaDada !== undefined ? colaDada : (config.colaPesada?.maximo ?? 0) > 0 ? crearColaPesada({ maximo: config.colaPesada.maximo }) : null;
  let despertar = null;
  // Terminó una sesión mientras no se esperaba: la próxima espera no duerme.
  let cupoNuevo = false;
  let ultimoAviso = "";
  // Si ya se anotó "En pausa: sesión de Claude vencida" en esta pausa (una sola línea por pausa).
  let pausaSesionAvisada = false;
  let ultimoSinMotor = "";
  // La hora de vuelta de la pausa de la que ya se avisó al dueño por WhatsApp (0 = ninguna): un aviso por pausa.
  let limiteAvisadoHasta = 0;
  // Desde cuándo se espera al PC antes de tomar la primera tarjeta (null = no se espera).
  let esperaPcDesde = null;
  // Para el panel "Coordinador en vivo": por qué no se abre otra sesión (PC lleno) y las que esperan en fila por chocar.
  let pcEspera = null;
  // id de la tarjeta que espera -> { motivo, contra }: `contra` es el id de la tarjeta con la que choca (null si espera por otra razón).
  let esperasDeFila = new Map();
  // Alarma de cupos sin usar (31-oct-2026): las últimas candidatas que dio el CRM, desde cuándo hay tarjetas en fila con
  // puestos libres (null = no pasa) y si ya se avisó en este episodio. `cuposVistos` es lo último medido, para el latido.
  let ultimasCandidatas = [];
  let cuposSinUsarDesde = null;
  let cuposSinUsarAvisado = false;
  let cuposVistos = { cupos: 0, enFila: 0, corriendo: 0 };

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

  /**
   * MODO ORQUESTADOR (1-nov-2026, repos.<repo>.nube.orquestador con sesión fija): construir se entrega a la sesión del proyecto
   * apenas se aprueba, y ella organiza. Esas tarjetas no miran choques, ni el máximo por agente, ni los puestos de la nube,
   * ni si la sesión fija está ocupada; tampoco cuentan para el tope de la nube ni el del agente. DEPENDE_DE: las sigue frenando.
   */
  const vaAlOrquestador = (tarjeta, hacer) => hacer === "construir" && esOrquestador(config.repos[tarjeta?.repo]);
  /** Las que la sesión del proyecto organiza ahora (siguen tomadas en el CRM). */
  const orquestando = () => [...enNube.values()].filter((s) => s.vivo.orquestador === true);

  /** Cuántas tarjetas de este agente (proyecto) corren ahora, en aizen1 y en la nube (las del orquestador no cuentan). */
  const corriendoDelAgente = (clave) => [...sesiones.values(), ...enNube.values()].filter((s) => s.tarjeta.repo === clave && s.vivo.orquestador !== true).length;

  // 31-oct-2026: una sesión que solo espera (vigilancia de 30 min, subir con su deploy y sus pruebas, las pruebas de GitHub
  // Actions al construir) suelta su puesto con alSoltarPuesto(motivo): sigue en `sesiones` / `enNube` y tomada en el CRM,
  // pero no cuenta en los puestos ocupados ni en los de su proyecto.
  const ocupa = (sesion) => !sesion.vivo.sinPuesto;
  /** Las sesiones de aizen1 que ocupan puesto (todas menos las que soltaron el suyo). */
  const ocupadas = () => [...sesiones.values()].filter(ocupa);
  /** Las de la nube que ocupan puesto (las del orquestador no: las organiza la sesión del proyecto). */
  const ocupadasEnNube = () => [...enNube.values()].filter((sesion) => ocupa(sesion) && sesion.vivo.orquestador !== true);
  /** Las que soltaron su puesto (en aizen1 y en la nube): siguen tomadas en el CRM. */
  const sinPuesto = () => [...sesiones.values(), ...enNube.values()].filter((sesion) => !ocupa(sesion));
  /** ¿El proyecto tiene puesto de aizen1 libre? Con repos.<repo>.cuposAizen1 cada proyecto tiene los suyos y no le quita al otro. */
  const repoConPuesto = (clave) => {
    const cupos = config.repos[clave]?.cuposAizen1;
    return !cupos || ocupadas().filter((s) => s.tarjeta.repo === clave).length < cupos;
  };
  /** ¿El proyecto tiene puesto de la nube libre? repos.<repo>.cuposNube (1 por defecto; null = solo el tope de nube.maxTareas). */
  const repoConPuestoEnNube = (clave) => {
    const cupos = cupoNubeDe(clave);
    return !cupos || ocupadasEnNube().filter((s) => s.tarjeta.repo === clave).length < cupos;
  };
  /** Las tarjetas del proyecto que construyen en la nube ahora (con puesto o sin él). */
  const construyendoEnNube = (clave) => [...enNube.values()].filter((s) => s.tarjeta.repo === clave && s.hacer === "construir");

  /**
   * EL SEMÁFORO DE AIZEN1 (31-oct-2026, la misma regla que CargaVista.semaforo del CRM): con amarillo (o rojo) no se abre una
   * 2.ª ni una 3.ª tarea del mismo proyecto en la nube; la 1.ª sí. -> el motivo ("CPU 75 %") o null si está verde.
   */
  function semaforoNoVerde() {
    let medida = null;
    let carga = null;
    try {
      medida = medidor.medir();
    } catch {
      medida = null;
    }
    try {
      carga = leerCargaDelPc(config.carpetaTrabajo);
    } catch {
      carga = null;
    }
    const datos = { cpu: medida?.cpu ?? null, memoriaPorciento: medida?.memoria ?? null, discoLibreGb: carga?.discoLibreGb ?? null, esperandoPc: Boolean(pcEspera) };
    const luz = semaforoDeLaCarga(datos);
    return luz === "amarillo" || luz === "rojo" ? `${luz}: ${motivoDelSemaforo(datos)}` : null;
  }
  /** Se mide una vez por vuelta de llenar (y solo si hace falta): `estadoDeCupos.semaforo()`. */
  const semaforoPerezoso = () => {
    let medido;
    return () => (medido === undefined ? (medido = semaforoNoVerde()) : medido);
  };
  /** ¿Esta construcción del proyecto sería la 2.ª o más en la nube con aizen1 en amarillo? -> el motivo o null. */
  const frenoDelSemaforo = (tarjeta, hacer, { semaforo }) => (hacer === "construir" && construyendoEnNube(tarjeta.repo).length > 0 && semaforo ? semaforo() : null);

  function contarCorriendo() {
    const lista = [
      ...[...sesiones.entries()].sort(([a], [b]) => a - b).map(([n, s]) => `s${n} "${s.tarjeta.titulo}" (${s.hacer}, ${s.tarjeta.repo}${nombreDeAgente(s.tarjeta)})`),
      ...[...enNube.values()].map((s) => `nube "${s.tarjeta.titulo}" (${s.hacer}, ${s.tarjeta.repo}${nombreDeAgente(s.tarjeta)})`),
    ];
    const sueltas = sinPuesto();
    const motivos = [...new Set(sueltas.map((s) => s.vivo.sinPuesto))].join("/");
    registro.info(`corriendo ${ocupadas().length}/${max} tarjetas al tiempo en aizen1${sueltas.length ? ` (+${sueltas.length} sin puesto (${motivos}))` : ""}${enNube.size ? ` y ${enNube.size} en la nube` : ""}${lista.length ? `: ${lista.join("; ")}` : ""}`);
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
  function dondeCorre(tarjeta, hacer, { aizenOk, nubeUsable, nubeLibre, colaEnFila = 0, semaforo = null }) {
    // Modo orquestador: a la sesión del proyecto, sin mirar puestos ni si está ocupada (solo que la nube sirva y tenga acceso).
    if (vaAlOrquestador(tarjeta, hacer)) {
      return nubeUsable && !sinAccesoALaNube(tarjeta.repo) ? { donde: "nube", motivo: `la organiza la sesión de ${nombreDelProyecto(config.repos[tarjeta.repo])} (modo orquestador)`, orquestador: true } : null;
    }
    const aizenParaEsta = aizenOk && repoConPuesto(tarjeta.repo) && !(hacer === "construir" && colaEnFila > 0);
    // 29-oct-2026: un proyecto marcado "la nube no tiene acceso al repo" (nube.mjs: sinAccesoALaNube) no se manda a la nube
    // hasta que venza la marca: sus tarjetas esperan en la fila sin gastar uso.
    // Con SESIÓN FIJA (repos.<repo>.nube.sesionFija) va una tarea a la vez: mientras otra del proyecto construye ahí, espera.
    // 31-oct-2026: además del tope de todo el Coordinador (nubeLibre), el del proyecto (repos.<repo>.cuposNube). Parte 4: con la
    // sesión fija ocupada, la 2.ª y la 3.ª abren sesiones nuevas (si la nube tiene acceso); con aizen1 en amarillo no se abre
    // una 2.ª del mismo proyecto.
    const nubeParaEsta =
      nubeLibre &&
      repoConPuestoEnNube(tarjeta.repo) &&
      !(hacer === "construir" && (sinAccesoALaNube(tarjeta.repo) || (sesionFijaOcupada(tarjeta.repo) && !puedeAbrirSesionNueva(tarjeta.repo)))) &&
      !frenoDelSemaforo(tarjeta, hacer, { semaforo });
    // Todo el desarrollo en la nube (26-oct-2026, decisión del dueño): construir NUNCA va a aizen1; si la nube no está
    // libre (o está apagada), la tarjeta espera en la fila.
    // Un proyecto con construirEn "aizen1" no va a la nube (29-oct-2026, decisión del dueño para Gestión).
    if (hacer === "construir" && config.repos[tarjeta.repo]?.construirEn === "aizen1") return aizenParaEsta ? { donde: "aizen1", motivo: "este proyecto se construye en aizen1" } : null;
    if (hacer === "construir" && nubeConfig.todoEnLaNube) return nubeUsable && nubeParaEsta ? { donde: "nube", motivo: "todo el desarrollo se construye en la nube" } : null;
    if (hacer !== "construir" || !nubeUsable) return aizenParaEsta ? { donde: "aizen1", motivo: null } : null;
    const { grande, motivos } = esTareaGrande(tarjeta, { repo: config.repos[tarjeta.repo], maxArchivosChica: nubeConfig.maxArchivosChica });
    if (grande) return nubeParaEsta ? { donde: "nube", motivo: `es grande: ${motivos.join("; ")}` } : null;
    if (aizenParaEsta) return { donde: "aizen1", motivo: null };
    const porque = !aizenOk ? `aizen1 no tiene puesto libre (${ocupadas().length}/${max})` : !repoConPuesto(tarjeta.repo) ? `${tarjeta.repo} ya usa sus puestos de aizen1` : `la cola de pasos pesados de aizen1 tiene ${colaEnFila} en fila`;
    return nubeParaEsta ? { donde: "nube", motivo: `desborde: ${porque}` } : null;
  }

  /** ¿El proyecto tiene sesión fija y ya hay una tarjeta suya construyendo EN ELLA (no en una sesión nueva)? */
  const sesionFijaOcupada = (clave) => Boolean(sesionFijaDe(config.repos[clave])) && construyendoEnNube(clave).some((s) => !s.vivo.sesionNueva);
  /** ¿Se puede abrir una sesión nueva de la nube para el proyecto? No, si la nube no tuvo acceso al repo hace poco. */
  const puedeAbrirSesionNueva = (clave) => !sinAccesoASesionesNuevas(clave);

  /**
   * Por qué una candidata no tiene dónde correr ahora, con su tipo (27-nov-2026): `nube` si lo que falta es un puesto o una
   * sesión de la nube (también el freno del semáforo y el orquestador con la nube apagada), `aizen1` si falta un puesto de
   * aizen1 o turno en la cola de pasos pesados. El latido manda el tipo para que el CRM explique por qué hay menos trabajando.
   */
  function esperaConTipo(hacer, { aizenOk, nubeUsable, colaEnFila = 0, semaforo = null }, tarjeta = null) {
    const nube = (motivo) => ({ motivo, tipo: "nube" });
    const aizen1 = (motivo) => ({ motivo, tipo: "aizen1" });
    if (tarjeta && !nubeUsable && vaAlOrquestador(tarjeta, hacer)) return nube(`espera: la nube está apagada o Claude en pausa; se entrega a la sesión de ${nombreDelProyecto(config.repos[tarjeta.repo])} cuando vuelva`);
    const marca = hacer === "construir" && nubeUsable && tarjeta ? sinAccesoALaNube(tarjeta.repo) : null;
    if (marca) {
      const hora = new Date(marca.hasta).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" });
      return nube(`espera: la nube no tiene acceso al repo de "${tarjeta.repo}" (no se manda a la nube hasta las ${hora})`);
    }
    if (hacer === "construir" && nubeUsable && tarjeta && sesionFijaOcupada(tarjeta.repo) && (!puedeAbrirSesionNueva(tarjeta.repo) || !repoConPuestoEnNube(tarjeta.repo))) {
      const ocupada = `espera: la sesión de ${nombreDelProyecto(config.repos[tarjeta.repo])} está ocupada`;
      return nube(puedeAbrirSesionNueva(tarjeta.repo) ? `${ocupada} (y ${tarjeta.repo} ya usa su(s) ${cupoNubeDe(tarjeta.repo)} puesto(s) de la nube)` : `${ocupada} y la nube no tiene acceso al repo para abrir otra`);
    }
    if (hacer === "construir" && aizenOk && colaEnFila > 0 && !nubeUsable) return aizen1(`espera: la cola de pasos pesados de aizen1 tiene ${colaEnFila} en fila`);
    if (hacer === "construir" && nubeUsable && tarjeta && config.repos[tarjeta.repo]?.construirEn !== "aizen1" && !repoConPuestoEnNube(tarjeta.repo)) {
      return nube(`espera: ${tarjeta.repo} ya usa su(s) ${cupoNubeDe(tarjeta.repo)} puesto(s) de la nube`);
    }
    const freno = hacer === "construir" && nubeUsable && tarjeta ? frenoDelSemaforo(tarjeta, hacer, { semaforo }) : null;
    if (freno) return nube(`espera: aizen1 está en ${freno}; no se abre otra de ${tarjeta.repo} en la nube`);
    if (tarjeta && aizenOk && !repoConPuesto(tarjeta.repo) && !(hacer === "construir" && nubeUsable)) return aizen1(`espera: ${tarjeta.repo} ya usa sus ${config.repos[tarjeta.repo].cuposAizen1} puesto(s) de aizen1`);
    return hacer === "construir" && nubeUsable ? nube("espera un puesto en la nube") : aizen1("espera un puesto en aizen1");
  }

  /** Por qué una candidata no tiene dónde correr ahora (para el log y el panel "esperan en fila"): el mismo texto de siempre. */
  const motivoDeEspera = (hacer, estadoDeCupos, tarjeta = null) => esperaConTipo(hacer, estadoDeCupos, tarjeta).motivo;

  /** Cuántos pasos pesados esperan turno en aizen1 (0 sin cola). */
  const colaEnFila = () => colaPesada?.estado().esperando ?? 0;

  // Las que vigilan siguen en `sesiones` con su número: el puesto nuevo toma el primer número libre (puede pasar de max).
  const cupoLibre = () => {
    for (let n = 1; ; n += 1) if (!sesiones.has(n)) return n;
  };

  function arrancar(tarjeta, hacer, huella, { donde = "aizen1", motivo = null, orquestador = false } = {}) {
    const nube = donde === "nube";
    const n = nube ? null : cupoLibre();
    const suRegistro = registroDeLaSesion(registro, nube ? `nube ${idCorto(tarjeta.id)}` : `s${n} ${idCorto(tarjeta.id)}`);
    suRegistro.info(`tomé "${tarjeta.titulo}" (${tarjeta.id}, ${tarjeta.repo}${nombreDeAgente(tarjeta)}) para ${hacer}${nube ? ` — se construye en la nube (${motivo})` : ""}`);
    const vivo = { inicioEn: Date.now(), ...(nube && orquestador ? { orquestador: true } : {}) };
    // 31-oct-2026 (parte 4): las otras del proyecto que ya construyen en la nube. Con la sesión fija ocupada, esta abre una
    // sesión nueva; y el ajuste de cupos anota si corre sola o acompañada.
    const companeras = nube && hacer === "construir" ? construyendoEnNube(tarjeta.repo) : [];
    // En el modo orquestador nunca se abre una sesión nueva ni cuenta para el ajuste de cupos: va a la sesión fija.
    if (nube && hacer === "construir" && !vivo.orquestador) {
      if (sesionFijaOcupada(tarjeta.repo)) vivo.sesionNueva = true;
      ajusteCupos.empezo(tarjeta.id, tarjeta.repo, companeras.length > 0, companeras.map((s) => s.tarjeta.id));
    }
    const sesion = { tarjeta, hacer, huella, vivo };
    if (nube) enNube.set(tarjeta.id, sesion);
    else sesiones.set(n, sesion);
    contarCorriendo();
    if (!nube) esperaPcDesde = null;
    sinLatido.tomada(tarjeta, hacer);
    sesion.promesa = procesarTarjeta(
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
        // La vigilancia de 30 min, subir y las pruebas que solo esperan sueltan el puesto: otra tarjeta trabaja mientras tanto.
        alSoltarPuesto: (motivo = "sin puesto") => {
          const yaSuelto = Boolean(vivo.sinPuesto);
          if (vivo.sinPuesto === motivo) return;
          vivo.sinPuesto = motivo;
          contarCorriendo();
          if (yaSuelto) return;
          if (despertar) despertar();
          else cupoNuevo = true;
        },
        alLatir: () => sinLatido.latio(tarjeta.id),
        // 24-nov-2026 (parte 2): si la tarjeta falla porque la sesión de Claude se venció, el Coordinador entra en pausa.
        pausaSesion,
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
        ajusteCupos.termino(tarjeta.id, resultado, hacer);
        sinLatido.termino(tarjeta.id, { ok: resultado?.ok === true });
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

  /**
   * Cuántos puestos hay de verdad (31-oct-2026): en aizen1, el menor entre maxParalelo y la suma de cuposAizen1 (un proyecto
   * sin cuposAizen1 cuenta maxParalelo); más, si la nube se puede usar, el menor entre nube.maxTareas y la suma de cuposNube
   * (null = nube.maxTareas). Las que soltaron su puesto no cuentan.
   */
  function cuposDisponibles() {
    const repos = Object.values(config.repos ?? {});
    const sumaAizen = repos.reduce((total, repo) => total + (repo?.cuposAizen1 ?? max), 0);
    let cupos = Math.min(max, repos.length ? sumaAizen : max);
    if (nubeUtilizable()) {
      const sumaNube = repos.reduce((total, repo) => total + (cupoNubeDe(repo?.clave) ?? nubeConfig.maxTareas), 0);
      cupos += Math.min(nubeConfig.maxTareas, repos.length ? sumaNube : nubeConfig.maxTareas);
    }
    return cupos;
  }

  /** "T-392" espera un puesto en la nube: el motivo de una tarjeta en fila, con lo que dice esperasDeFila (motivoDeEspera). */
  function motivoEnFila(tarjeta) {
    const motivo = esperasDeFila.get(tarjeta.id)?.motivo ?? "";
    const titulo = `"${String(tarjeta.titulo ?? tarjeta.id).slice(0, 60)}"`;
    if (!motivo) return `${titulo} sin motivo a la vista`;
    return /^espera\b/.test(motivo) ? `${titulo} ${motivo}` : `${titulo} espera (${motivo})`;
  }

  /** El WhatsApp de la alarma: como mucho 3 líneas. */
  function textoDeCuposSinUsar(enFila, corriendo, cupos, minutos) {
    const muestra = enFila.slice(0, 3).map(motivoEnFila).join("; ");
    const mas = enFila.length > 3 ? ` y ${enFila.length - 3} más` : "";
    return [`⚠️ Cupos sin usar: ${enFila.length} en fila y ${corriendo} de ${cupos} corriendo hace ${minutos} min.`, `${muestra}${mas}.`].join("\n");
  }

  /**
   * ALARMA DE CUPOS SIN USAR (31-oct-2026): hay tarjetas en la fila y corren menos que los puestos disponibles. No cuenta con
   * la pausa por uso, con una etapa sin motor ni con el PC en rojo. Si dura 10 min o más, UN WhatsApp por episodio a Emanuel
   * (crm.aviso(texto, "cupos")); si el CRM lo calla o falla, se reintenta en la próxima vuelta. Nunca tumba al planificador.
   */
  async function revisarCuposSinUsar() {
    try {
      const enManos = new Set([...sesiones.values(), ...enNube.values()].map((s) => s.tarjeta.id));
      const enFila = ultimasCandidatas.filter((c) => c && !enManos.has(c.id));
      const corriendo = ocupadas().length + ocupadasEnNube().length;
      const cupos = cuposDisponibles();
      cuposVistos = { cupos, enFila: enFila.length, corriendo };
      const pasa = enFila.length > 0 && corriendo < cupos && !pausaUso.pausado() && !pausaSesion.vencida() && etapasSinMotor().length === 0 && !pcEspera;
      if (!pasa) {
        cuposSinUsarDesde = null;
        cuposSinUsarAvisado = false;
        return;
      }
      cuposSinUsarDesde ??= ahora();
      const minutos = Math.floor((ahora() - cuposSinUsarDesde) / 60_000);
      if (cuposSinUsarAvisado || minutos < 10) return;
      const respuesta = await crm.aviso(textoDeCuposSinUsar(enFila, corriendo, cupos, minutos), "cupos");
      if (!respuesta?.silenciado) cuposSinUsarAvisado = true;
    } catch (error) {
      registro.aviso(`no salió el aviso de cupos sin usar (${error?.status ?? "sin respuesta"}): ${error?.message ?? error}`);
    }
  }

  /**
   * El WhatsApp a Emanuel cuando el ajuste bajó el cupo de un proyecto (crm.aviso(texto, "cupos")): UNA vez por bajada; si el
   * CRM lo calla o falla, se reintenta en la próxima vuelta. Nunca tumba al planificador.
   */
  async function avisarAjusteDeCupos() {
    for (const { clave, texto } of ajusteCupos.pendientes()) {
      try {
        const respuesta = await crm.aviso(texto, "cupos");
        if (!respuesta?.silenciado) ajusteCupos.avisado(clave);
      } catch (error) {
        registro.aviso(`no salió el aviso de la bajada del cupo de ${clave} (${error?.status ?? "sin respuesta"}): ${error?.message ?? error}`);
      }
    }
  }

  async function llenar(opciones = {}) {
    try {
      await llenarCupos(opciones);
    } finally {
      await avisarAjusteDeCupos();
      await revisarCuposSinUsar();
    }
  }

  /**
   * soloPlanear (31-oct-2026, causa del 30-oct a las 11:50 p. m.): mientras el Coordinador espera para pasar a su versión
   * nueva, solo toma tarjetas para PLANEAR (unos minutos), y trabajador.mjs lo pide solo mientras quede alguna tarea larga
   * (sin puesto o en la nube). Construir y subir esperan a la versión nueva.
   */
  async function llenarCupos({ soloPlanear = false } = {}) {
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
    // 24-nov-2026: con la sesión de Claude vencida cada tarjeta fallaría al instante y gastaría un intento: no se toma ninguna.
    // El aviso sale UNA vez por pausa; el latido sigue saliendo (va aparte) y la revisión saca la pausa sola cuando vuelve.
    if (await pausaSesion.revisar()) {
      if (!pausaSesionAvisada) registro.aviso("En pausa: sesión de Claude vencida");
      pausaSesionAvisada = true;
      return;
    }
    pausaSesionAvisada = false;
    // Las que se soltaron en esta pasada porque no tenían dónde correr: no se vuelven a tomar hasta la próxima.
    const descartadas = new Map();
    for (;;) {
      const nubeUsable = nubeUtilizable();
      const nubeLibre = nubeUsable && ocupadasEnNube().length < nubeConfig.maxTareas;
      // Con un proyecto en modo orquestador, sus tarjetas de construir se toman aunque no quede ningún puesto.
      const conOrquestador = nubeUsable && Object.values(config.repos).some(esOrquestador);
      if (ocupadas().length >= max && !nubeLibre && !conOrquestador) return;
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
      let aizenOk = ocupadas().length < max;
      if (aizenOk && ocupadas().length === 0) {
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
      if (aizenOk && ocupadas().length > 0) {
        const falta = faltanRecursos(medidor.medir(), config.limites);
        if (falta) {
          pcEspera = falta;
          avisarUnaVez(`recursos-${ocupadas().length}`, `no abro otra sesión (${ocupadas().length}/${max} corriendo): ${falta}`);
          aizenOk = false;
        }
      }
      if (!aizenOk && !nubeLibre && !conOrquestador) return;
      const estadoDeCupos = { aizenOk, nubeUsable, nubeLibre, colaEnFila: colaEnFila(), semaforo: semaforoPerezoso() };
      // Las del orquestador no hacen chocar a nadie: la sesión del proyecto resuelve los choques con main.
      const corriendo = [...sesiones.values(), ...enNube.values()].filter((s) => s.vivo.orquestador !== true).map((s) => s.huella);
      let excluir = [...descartadas.keys()];
      let elegidaParaOrquestador = false;
      // Siempre se miran las candidatas (25-oct-2026): también para ESCOGER cuál conviene (ordenarCandidatas).
      {
        const { candidatas = [] } = await crm.candidatas();
        ultimasCandidatas = candidatas;
        const contraQuien = {};
        const paraChoques = candidatas.filter((c) => !vaAlOrquestador(c, c.hacer));
        const chocan = corriendo.length ? candidatasQueChocan(paraChoques, corriendo, config.repos, contraQuien) : {};
        // 27-nov-2026: el tipo de cada espera (choque, nube, aizen1, agente, version, motor) para el latido.
        const tipoDe = Object.fromEntries(Object.keys(chocan).map((id) => [id, "choque"]));
        for (const c of candidatas) if (!chocan[c.id] && sinMotor.includes(c.hacer)) [chocan[c.id], tipoDe[c.id]] = [`(sin motor para ${c.hacer})`, "motor"];
        if (soloPlanear) for (const c of candidatas) if (!chocan[c.id] && c.hacer !== "planear") [chocan[c.id], tipoDe[c.id]] = [`(espera la versión nueva del Coordinador para ${c.hacer})`, "version"];
        // La cola de cada proyecto: un agente no pasa de su `maxEnParalelo` (sesiones de aizen1 y de la nube juntas).
        for (const c of candidatas) {
          if (chocan[c.id] || vaAlOrquestador(c, c.hacer)) continue;
          const agente = agenteDe(c);
          if (!agente) continue;
          const trabajando = corriendoDelAgente(c.repo);
          if (trabajando >= agente.maxEnParalelo) {
            chocan[c.id] = `(el ${agente.nombre} ya tiene ${trabajando} tarjeta${trabajando === 1 ? "" : "s"} trabajando (su máximo es ${agente.maxEnParalelo}))`;
            tipoDe[c.id] = "agente";
          }
        }
        // Sin dónde correr ahora: planear y subir esperan un puesto de aizen1; una grande espera un puesto de la nube.
        for (const c of candidatas) {
          if (chocan[c.id]) continue;
          const espera = descartadas.get(c.id) ?? (dondeCorre(c, c.hacer, estadoDeCupos) ? null : esperaConTipo(c.hacer, estadoDeCupos, c));
          if (espera) [chocan[c.id], tipoDe[c.id]] = [`(${espera.motivo})`, espera.tipo];
        }
        excluir = [...new Set([...Object.keys(chocan), ...descartadas.keys()])];
        esperasDeFila = new Map(Object.entries(chocan).map(([id, motivo]) => [id, { motivo: String(motivo).replace(/^\(|\)$/g, ""), tipo: tipoDe[id], contra: tipoDe[id] === "choque" ? (contraQuien[id] ?? null) : null }]));
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
        elegidaParaOrquestador = Boolean(elegida) && vaAlOrquestador(elegida, elegida.hacer);
      }
      // El CRM cuenta las de aizen1 y las de la nube juntas: el tope que se le da es la suma.
      // Las que soltaron su puesto (subiendo, vigilando, esperando pruebas) siguen tomadas en el CRM: se suman al tope.
      // Las del orquestador no ocupan puesto: se suman al tope (más 1 si la elegida es para él, aunque no quede ningún puesto).
      const respuesta = await crm.tomar({ maxParalelo: max + sinPuesto().length + (nubeConfig.activa ? nubeConfig.maxTareas : 0) + orquestando().length + (elegidaParaOrquestador ? 1 : 0), excluir });
      if (respuesta.vencidas?.length) registro.aviso(`el CRM pasó a ERROR por vencidas: ${respuesta.vencidas.join(", ")}`);
      if (!respuesta.tarjeta) {
        avisarUnaVez(`sin-${respuesta.motivo}-${sesiones.size}`, null);
        return;
      }
      ultimoAviso = "";
      const { tarjeta, hacer } = respuesta;
      // Entre /candidatas y /tomar pudo cambiar la etapa: esperando la versión nueva solo se planea.
      if (soloPlanear && hacer !== "planear") {
        registro.info(`"${tarjeta.titulo}" es para ${hacer} y espero la versión nueva del Coordinador: la suelto`);
        await soltar(crm, registro, tarjeta, `Espera en fila: el Coordinador pasa a su versión nueva antes de ${hacer}.`);
        return;
      }
      const huella = huellaDeTarjeta(tarjeta, hacer, config.repos[tarjeta.repo]);
      // Entre /candidatas y /tomar pudo aparecer otra que choca: se suelta (sin error) y espera en fila.
      const choque = vaAlOrquestador(tarjeta, hacer) ? null : corriendo.map((otra) => [otra, motivoDeChoque(huella, otra)]).find(([, motivo]) => motivo);
      if (choque) {
        registro.info(`"${tarjeta.titulo}" choca con "${choque[0].titulo}" (${choque[1]}): la suelto y espera en fila`);
        if (await soltar(crm, registro, tarjeta, `Espera en fila: ${choque[1]}.`)) continue;
        return;
      }
      // La regla de reparto con la tarjeta completa (trae sus intentos: "ya falló por tamaño o recursos").
      const lugar = dondeCorre(tarjeta, hacer, estadoDeCupos);
      if (!lugar) {
        registro.info(`"${tarjeta.titulo}" no tiene dónde correr ahora (${hacer}): la suelto y espera en fila`);
        const espera = esperaConTipo(hacer, estadoDeCupos, tarjeta);
        descartadas.set(tarjeta.id, espera);
        if (await soltar(crm, registro, tarjeta, `Espera en fila: no hay dónde construirla ahora (${espera.motivo}).`)) continue;
        return;
      }
      arrancar(tarjeta, hacer, huella, lugar);
    }
  }

  /**
   * Las tarjetas que este Coordinador tomó y nadie trabaja hace más de 30 min (se mira cada 15): se sueltan (1.ª vez), pasan a
   * ERROR con aviso (2.ª) o a ERROR con su pregunta. `forzar` salta la espera de 15 min. Nunca lanza.
   */
  async function revisarSinLatido(opciones = {}) {
    try {
      return await sinLatido.revisar(opciones);
    } catch (error) {
      registro.aviso(`sin señal: no pude revisar (${error?.message ?? error})`);
      return { sueltas: [], errores: [], preguntas: [] };
    }
  }

  return {
    llenar,
    /**
     * Al arrancar: el CRM suelta (sin error) todo lo que el proceso anterior dejó con candado. Un CRM que no
     * conoce /arranque (404) no es problema: lo viejo vence solo.
     * 18-nov-2026: tras /arranque se retoma lo demás que el proceso anterior dejó tomado (SUBIENDO no vence sola) sin esperar los
     * 30 min y sin contar como intento: al arrancar no hay ninguna sesión viva, y la culpa fue del apagón o de la actualización.
     */
    async iniciar() {
      let sueltas = [];
      try {
        const respuesta = await crm.arranque();
        sueltas = respuesta?.sueltas ?? [];
        registro.info(`arranque: el CRM soltó ${sueltas.length} tarjeta(s) que había dejado el proceso anterior`);
      } catch (error) {
        registro.aviso(`arranque: no se pudo soltar lo anterior (${error.message}); lo que quedó vence solo`);
      }
      try {
        sinLatido.arranco(sueltas);
        const retomadas = await sinLatido.retomarAlArrancar(sueltas);
        if (retomadas.length) registro.info(`arranque: retomé ${retomadas.length} tarjeta(s) que habían quedado a medias`);
      } catch (error) {
        registro.aviso(`arranque: no pude retomar lo que quedó a medias (${error?.message ?? error})`);
      }
      return sueltas;
    },
    revisarSinLatido,
    corriendo: () => sesiones.size + enNube.size,
    /** Las tareas largas que corren: sin puesto (subiendo, vigilando, esperando pruebas) o en la nube. */
    tareasLargas: () => [...sesiones.values()].filter((sesion) => !ocupa(sesion)).length + enNube.size,
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
          modeloPedido: vivo.modeloPedido === true,
          motor: vivo.motor ?? null,
          inicioEn: new Date(vivo.inicioEn).toISOString(),
          intento: tarjeta.intentos ?? null,
          reparacion: Number(tarjeta.reparaciones) || 0,
          reparacionDe: Number(tarjeta.topeReparaciones) || null,
          linkWorkflow: vivo.linkWorkflow ?? null,
          linkSesion: vivo.linkSesion ?? null,
          desdeNube: vivo.desdeNube ?? null,
          // 31-oct-2026: soltó su puesto (subiendo, vigilando, esperando pruebas) o null.
          sinPuesto: vivo.sinPuesto ?? null,
          // 29-oct-2026: la revisión de los 4 (vuelta y estado de cada revisor), solo mientras la etapa es "revisando".
          revision: vivo.etapa === "revisando" ? (vivo.revision ?? null) : null,
        }));
      return {
        tareas,
        esperandoPc: Boolean(pcEspera),
        motivoEspera: pcEspera,
        // 27-nov-2026: cada espera con su tipo (choque, nube, aizen1, agente, version, motor) y, si choca, `contra` (si no, null).
        esperas: [...esperasDeFila.entries()].map(([tarjetaId, espera]) => ({ tarjetaId, motivo: espera.motivo, tipo: espera.tipo ?? null, contra: espera.contra ?? null })),
        uso: motores.resumenDeUso(),
        pausaUso: pausaUso.resumen(),
        // 24-nov-2026: la sesión de Claude: { vencida, desde, revisadaEn }.
        sesionClaude: pausaSesion.resumen(),
        // 31-oct-2026: los puestos disponibles, cuántas esperan en fila y cuántas ocupan puesto (los máximos del día salen de acá).
        // 27-nov-2026: `cupos` va como objeto { cupos, enFila, corriendo }; `enFila` y `corriendo` siguen también sueltos.
        cupos: { ...cuposVistos },
        enFila: cuposVistos.enFila,
        corriendo: cuposVistos.corriendo,
        // 31-oct-2026 (parte 4): el ajuste automático del cupo de la nube (prendido o terminado, días que quedan, cupo de cada proyecto).
        ajusteCupos: ajusteCupos.resumen(),
      };
    },
    /** Pausa por uso de Claude: ¿está pausado? (el trabajo de noche y el recogedor tampoco corren) y los ajustes del panel. */
    pausadoPorUso: () => pausaUso.pausado(),
    ajustarPausaUso: (ajustes) => pausaUso.ajustes(ajustes),
    /** Pausa por sesión de Claude vencida: ¿está vencida? y el objeto entero (marcarVencida, esErrorDeSesion) para la parte 2. */
    pausadoPorSesion: () => pausaSesion.vencida(),
    pausaSesion,
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
