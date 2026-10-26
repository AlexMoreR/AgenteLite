// Los MOTORES del Coordinador (23-oct-2026): Claude Code (la suscripción de Alexander) y Codex CLI (la
// sesión de ChatGPT Plus). Por defecto Claude planea y revisa, Codex construye (config.motores).
//
// - motorDe(paso): quién hace planear / construir / revisar AHORA. Si Claude está sobre el umbral de uso
//   (o llegó a su límite) los pasos de Claude pasan a Codex; si Codex llegó a su límite, sus pasos
//   esperan (o pasan a Claude solo con motores.respaldoClaude). null = nadie disponible: espera.
// - leerUsoDeClaude(texto): lo que dice `claude -p /usage`, en números.
// - decidirUso(...): qué avisar por WhatsApp (uno por cada cruce del umbral) y qué guardar.
// - crearVigilanteDeUso(...): cada config.vigilarUsoMinutos lee el uso, avisa y prende/apaga "Claude alto".
// - PAUSA POR USO DE CLAUDE (26-oct-2026): al llegar la sesión o la semana al umbral (80 % por defecto) el Coordinador
//   se pausa (no toma tarjetas, detiene las que corren: bucle.mjs), avisa UNA vez al dueño y retoma solo cuando una
//   lectura nueva baja del umbral. decidirPausaPorUso decide (pura); el estado vive en estado-uso.json.
import { modeloDelPaso } from "./modelos.mjs";
import fs from "node:fs";
import path from "node:path";

import { correr } from "./procesos.mjs";

/** Lo que dice Codex (ChatGPT) cuando se agota el plan: "You've hit your usage limit… try again in 2 hours", 429, quota. */
const LIMITE_DE_CODEX = /usage limit|hit your (?:\w+ )?limit|rate[ _-]?limit|too many requests|try again in|plus plan|pro plan|quota|\b429\b/i;

export function esLimiteDeCodex(texto) {
  return LIMITE_DE_CODEX.test(String(texto ?? ""));
}

const NOMBRE = { claude: "Claude", codex: "Codex" };
export const nombreDelMotor = (motor) => NOMBRE[motor] ?? motor;

/**
 * El estado de los motores, compartido por todas las sesiones del planificador.
 *   motorDe(paso)         "claude" | "codex" | null
 *   pausar(motor)         llegó a su límite: no se usa por pausaLimiteMinutos (Claude) o pausaLimiteCodexMinutos.
 *   ponerClaudeAlto(x)    lo que dijo el vigilante: null (bajo el umbral) o { periodo, porcentaje, reinicio }.
 */
export function crearEstadoDeMotores(config, { ahora = () => Date.now() } = {}) {
  const pausaHasta = { claude: 0, codex: 0 };
  let claudeAlto = null;
  // Pausa por uso de Claude: lo que midió el vigilante, la pausa en curso y el interruptor/umbral (el CRM los cambia).
  let usoMedido = null;
  let pausaPorUso = null;
  let lecturaFallidaDesde = null;
  const ajustes = { activa: config.pausaPorUsoClaude !== false, umbral: config.umbralClaude };
  // Claude sobre el umbral solo deja de usarse si hay a dónde pasar (respaldoCodex); si no, sigue con Claude
  // y el vigilante solo avisa por WhatsApp.
  const disponible = (motor) =>
    ahora() >= pausaHasta[motor] && !(motor === "claude" && claudeAlto && config.motores.respaldoCodex);
  return {
    motorDe(paso) {
      const elegido = paso === "revisar" ? config.motores.revisar : config.motores[paso];
      if (!elegido) return null;
      if (disponible(elegido)) return elegido;
      if (elegido === "claude") return config.motores.respaldoCodex && disponible("codex") ? "codex" : null;
      // Codex agotado: a Claude solo si se pidió el respaldo (y Claude está disponible).
      return config.motores.respaldoClaude && disponible("claude") ? "claude" : null;
    },
    pausar(motor) {
      const minutos = motor === "codex" ? config.pausaLimiteCodexMinutos : config.tiempos.pausaLimiteMinutos;
      pausaHasta[motor] = ahora() + minutos * 60_000;
      return pausaHasta[motor];
    },
    pausadoHasta: (motor) => (ahora() < pausaHasta[motor] ? pausaHasta[motor] : 0),
    ponerClaudeAlto(valor) {
      claudeAlto = valor;
    },
    claudeAlto: () => claudeAlto,
    /** La última lectura buena del uso: { sesion, semana, leidoEn (ms) } o null. */
    ponerUsoMedido(uso) {
      usoMedido = uso;
    },
    usoMedido: () => usoMedido,
    /** La pausa por uso en curso ({ desde, periodo, porcentaje, reinicio, reinicioMs, avisada }) o null. */
    ponerPausaPorUso(pausa) {
      pausaPorUso = pausa;
    },
    pausaPorUso: () => pausaPorUso,
    /** Desde cuándo (ms) no se puede leer el uso, o null. */
    ponerLecturaFallida(desde) {
      lecturaFallidaDesde = desde;
    },
    /** El interruptor y el umbral de la pausa por uso: { activa, umbral }. */
    ajustesDePausa: () => ({ ...ajustes }),
    /** Lo que dice el CRM en la respuesta del latido: { prendida, umbral }. Lo inválido se ignora. Devuelve true si algo cambió. */
    ajustarPausa(datos) {
      let cambio = false;
      if (typeof datos?.prendida === "boolean" && datos.prendida !== ajustes.activa) {
        ajustes.activa = datos.prendida;
        cambio = true;
      }
      const umbral = Number(datos?.umbral);
      if (Number.isFinite(umbral) && umbral >= 1 && umbral <= 100 && umbral !== ajustes.umbral) {
        ajustes.umbral = umbral;
        cambio = true;
      }
      return cambio;
    },
    /**
     * Para el panel "Coordinador en vivo": { limiteAlcanzado, motor, reiniciaEn (ISO) }. Es el primer motor que
     * está en pausa por su límite de uso (Claude antes que Codex); `reiniciaEn` es cuando termina esa pausa (el
     * momento en que el Coordinador vuelve a intentarlo). Sin límite: { limiteAlcanzado: false }.
     */
    resumenDeUso() {
      const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
      // Pausa por uso de Claude (26-oct-2026): el porcentaje que leyó el vigilante, el estado y la hora de lectura fallida.
      const porcentaje = {
        sesion: usoMedido?.sesion ? { porcentaje: usoMedido.sesion.porcentaje, reinicio: usoMedido.sesion.reinicio || null } : null,
        semana: usoMedido?.semana ? { porcentaje: usoMedido.semana.porcentaje, reinicio: usoMedido.semana.reinicio || null } : null,
        leidoEn: iso(usoMedido?.leidoEn),
        pausado: Boolean(pausaPorUso),
        pausadoDesde: pausaPorUso?.desde ?? null,
        reanudaEn: iso(pausaPorUso?.reinicioMs),
        pausaPorcentaje: pausaPorUso?.porcentaje ?? null,
        umbral: ajustes.umbral,
        lecturaFallidaDesde: iso(lecturaFallidaDesde),
      };
      for (const motor of ["claude", "codex"]) {
        if (ahora() < pausaHasta[motor]) return { limiteAlcanzado: true, motor, reiniciaEn: new Date(pausaHasta[motor]).toISOString(), ...porcentaje };
      }
      return { limiteAlcanzado: false, motor: null, reiniciaEn: null, ...porcentaje };
    },
  };
}

/** Los motores que necesita una etapa (subir no usa ninguno; la revisión no es obligatoria). */
export function motorDeLaEtapa(estado, hacer) {
  if (hacer === "planear") return estado.motorDe("planear");
  if (hacer === "construir") return estado.motorDe("construir");
  return "ninguno";
}

/* ──────────────────────────────────────────────────────── el uso de Claude ── */

const PORCENTAJE = String.raw`(\d{1,3}(?:[.,]\d+)?)\s*%\s*used`;
const REINICIO = String.raw`(?:\s*[·•|-]\s*resets\s+(.+?))?\s*$`;
const RE_SESION = new RegExp(String.raw`current session\s*:\s*${PORCENTAJE}${REINICIO}`, "im");
const RE_SEMANA = new RegExp(String.raw`current week \(all models\)\s*:\s*${PORCENTAJE}${REINICIO}`, "im");
const RE_SEMANA_OTRA = new RegExp(String.raw`current week[^:\n]*:\s*${PORCENTAJE}${REINICIO}`, "im");

function periodo(texto, ...expresiones) {
  for (const expresion of expresiones) {
    const encontrado = texto.match(expresion);
    if (encontrado) return { porcentaje: Number(encontrado[1].replace(",", ".")), reinicio: (encontrado[2] ?? "").trim() };
  }
  return null;
}

/**
 * Lo que dice `claude -p /usage`:
 *   Current session: 36% used · resets Oct 23, 3:20pm (America/Bogota)
 *   Current week (all models): 6% used · resets Oct 30, 7am (America/Bogota)
 * -> { sesion: { porcentaje: 36, reinicio: "Oct 23, 3:20pm (America/Bogota)" }, semana: {...} }, o null si
 * no dice ninguno de los dos (no se inventan números).
 */
export function leerUsoDeClaude(texto) {
  const limpio = String(texto ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  const sesion = periodo(limpio, RE_SESION);
  const semana = periodo(limpio, RE_SEMANA, RE_SEMANA_OTRA);
  return sesion || semana ? { sesion, semana } : null;
}

const NOMBRE_DEL_PERIODO = { sesion: "sesión", semana: "semana" };

/** "Oct 23, 3:20pm (America/Bogota)" -> "3:20pm"; si no hay hora, el texto sin la zona. */
export function horaDelReinicio(reinicio) {
  const hora = String(reinicio ?? "").match(/\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/i);
  if (hora) return hora[0].replace(/\s+/g, "");
  return String(reinicio ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim() || "que se reinicie";
}

/** La fecha de hoy en Bogotá (AAAA-MM-DD): la alerta "no pude leer el uso" sale una vez por día. */
export const fechaBogota = (fecha = new Date()) => fecha.toLocaleDateString("sv-SE", { timeZone: "America/Bogota" });

/**
 * Qué hacer con una lectura del uso (pura).
 *   uso: lo de leerUsoDeClaude (null = no se pudo leer)
 *   estado: lo guardado en estado-uso.json { avisado: { sesion, semana }, alertaLectura }
 * -> { alto, avisos, alertaLectura, estado }
 *   alto: los periodos sobre el umbral [{ periodo, porcentaje, reinicio }] (vacío si no se pudo leer)
 *   avisos: los cruces nuevos (uno por periodo y por cruce: cambia solo si bajó del umbral o cambió el periodo,
 *           es decir, el texto del reinicio). Ya no se mandan por WhatsApp; quedan para el registro.
 *   alertaLectura: true la primera vez del día que no se pudo leer el uso de Claude (solo para el registro)
 *   estado: lo que hay que guardar
 */
export function decidirUso(uso, estado, umbral, hoy = fechaBogota()) {
  const avisado = { sesion: estado?.avisado?.sesion ?? null, semana: estado?.avisado?.semana ?? null };
  const nuevo = { avisado: { ...avisado }, alertaLectura: estado?.alertaLectura ?? null };
  if (!uso) {
    const alertaLectura = nuevo.alertaLectura !== hoy;
    nuevo.alertaLectura = hoy;
    return { alto: [], avisos: [], alertaLectura, estado: nuevo };
  }
  const alto = [];
  const avisos = [];
  for (const nombre of ["sesion", "semana"]) {
    const dato = uso[nombre];
    if (!dato) continue;
    if (dato.porcentaje >= umbral) {
      const marca = { periodo: nombre, porcentaje: dato.porcentaje, reinicio: dato.reinicio };
      alto.push(marca);
      if (!avisado[nombre] || avisado[nombre].reinicio !== dato.reinicio) avisos.push(marca);
      nuevo.avisado[nombre] = { reinicio: dato.reinicio, porcentaje: dato.porcentaje };
    } else {
      nuevo.avisado[nombre] = null;
    }
  }
  return { alto, avisos, alertaLectura: false, estado: nuevo };
}

const PASOS = ["planear", "construir", "revisar"];

/** "planear pasa" / "planear y revisar pasan": los pasos que hace Claude según la config (los que pasan a Codex). */
function pasosDeClaude(config, { verbo = "pasa" } = {}) {
  const pasos = PASOS.filter((paso) => (paso === "revisar" ? config.motores.revisar : config.motores[paso]) === "claude");
  if (!pasos.length) return `ningún paso ${verbo}`;
  return `${pasos.join(" y ")} ${verbo}${pasos.length > 1 ? "n" : ""}`;
}

const URL_DEL_CRM = "https://app.aizenbot.com";

/** El link al Coordinador en vivo, en la dirección del CRM de la config. */
export const linkDelCoordinador = (config) => `${String(config?.urlCrm || URL_DEL_CRM).replace(/\/+$/, "")}/cliente/tablero-ia?vista=coordinador`;

/** Máximo de líneas de un WhatsApp al dueño (26-oct-2026: "mensajes que se leen en 5 segundos"). */
export const MAXIMO_LINEAS_DEL_AVISO = 3;

/**
 * El aviso de que Claude se agotó y todo quedó en pausa (26-oct-2026: es de los pocos WhatsApp que quiere el dueño).
 * 3 líneas: qué pasa, cuándo vuelve y el link. `hasta` es el momento (ms) en que se vuelve a usar.
 */
export function textoDelAvisoDeLimite(hasta, config) {
  const hora = new Date(hasta).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit", hour12: true }).replace(/[\u00a0\u202f]/g, " ");
  return [
    "⛔ Claude llegó a su límite de uso: Sistemas quedó en pausa.",
    `Vuelve a trabajar solo a las ${hora}`,
    `Ver: ${linkDelCoordinador(config)}`,
  ]
    .slice(0, MAXIMO_LINEAS_DEL_AVISO)
    .join("\n");
}

/* ───────────────────────────────────────────────────── pausa por uso de Claude (26-oct-2026) ── */

const MESES = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const BOGOTA_UTC = 5; // Bogotá es UTC-5 todo el año (sin horario de verano)
const DIA_MS = 86_400_000;

/**
 * "Oct 23, 3:20pm (America/Bogota)" -> el momento (ms) del reinicio. Sin fecha ("3:20pm") es la próxima vez que da esa hora.
 * Solo se entiende la hora de Bogotá (la del PC del Coordinador); otra zona, o un texto que no se entiende, da null:
 * entonces la pausa no sabe cuándo termina y se levanta solo con una lectura nueva del uso.
 */
export function reinicioEnMs(texto, ahoraMs = Date.now()) {
  const t = String(texto ?? "");
  const hora = t.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i);
  if (!hora) return null;
  const zona = t.match(/\(([^)]+)\)/)?.[1];
  if (zona && !/bogot/i.test(zona)) return null;
  const horas = (Number(hora[1]) % 12) + (hora[3].toLowerCase() === "p" ? 12 : 0);
  const minutos = Number(hora[2] ?? 0);
  if (horas > 23 || minutos > 59) return null;
  const hoy = new Date(ahoraMs - BOGOTA_UTC * 3_600_000); // la fecha de hoy en Bogotá, leída con los getUTC*
  const fecha = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
  const enMs = (anio, mes, dia) => Date.UTC(anio, mes, dia, horas + BOGOTA_UTC, minutos);
  if (!fecha) {
    const hoyAMs = enMs(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
    return hoyAMs > ahoraMs ? hoyAMs : hoyAMs + DIA_MS;
  }
  const mes = MESES[fecha[1].toLowerCase()];
  const dia = Number(fecha[2]);
  const anio = fecha[3] ? Number(fecha[3]) : hoy.getUTCFullYear();
  let ms = enMs(anio, mes, dia);
  // "Jan 2" leído en diciembre es del año que viene; una fecha ya pasada hace más de 2 días, también.
  if (!fecha[3] && ms < ahoraMs - 2 * DIA_MS) ms = enMs(anio + 1, mes, dia);
  return ms;
}

/** "jueves, 29 de octubre, 3:20 p. m." (hora de Bogotá), o null si no es un momento. */
export function fechaYHoraEnBogota(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Date(ms)
    .toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/[\u00a0\u202f]/g, " ");
}

/** El periodo con más uso de una lectura: { periodo, porcentaje, reinicio } o null. */
export function periodoMasAlto(uso) {
  let mejor = null;
  for (const nombre of ["sesion", "semana"]) {
    const dato = uso?.[nombre];
    if (dato && Number.isFinite(dato.porcentaje) && (!mejor || dato.porcentaje > mejor.porcentaje)) mejor = { periodo: nombre, porcentaje: dato.porcentaje, reinicio: dato.reinicio ?? "" };
  }
  return mejor;
}

/** Si pasó tanto de la hora de reinicio y todavía no se puede leer el uso, la pausa se levanta sola (no se queda para siempre). */
export const PAUSA_SIN_CONFIRMAR_MINUTOS = 30;
/** Cuántas lecturas seguidas tienen que fallar para decir "no pude leer el uso de Claude". */
export const LECTURAS_FALLIDAS_PARA_AVISAR = 3;

/**
 * Decide la pausa por uso (pura).
 *   uso: la última lectura buena { sesion, semana } (null = todavía no hay)
 *   ajustes: { activa, umbral }   pausa: la pausa en curso o null   lecturaFallida: ya fallaron varias lecturas seguidas
 * -> { accion: "entrar", pausa } | { accion: "salir", motivo } | { accion: null }
 * Entra cuando la sesión o la semana llegan al umbral (y el interruptor está prendido). Sale por una lectura NUEVA bajo el
 * umbral (no solo por la hora de reinicio), al apagar el interruptor, o si pasó la hora de reinicio y ya no se puede leer.
 */
export function decidirPausaPorUso({ uso, ajustes, pausa, ahoraMs = Date.now(), lecturaFallida = false }) {
  const alto = periodoMasAlto(uso);
  const rebasa = Boolean(alto) && alto.porcentaje >= ajustes.umbral;
  if (!pausa) {
    if (!ajustes.activa || !rebasa) return { accion: null };
    // Se reanuda cuando TODOS los periodos que pasaron el umbral se hayan reiniciado: el reinicio más tardío que se entienda.
    const reinicios = ["sesion", "semana"]
      .map((nombre) => uso[nombre])
      .filter((dato) => dato && dato.porcentaje >= ajustes.umbral)
      .map((dato) => reinicioEnMs(dato.reinicio, ahoraMs))
      .filter((ms) => ms !== null);
    return {
      accion: "entrar",
      pausa: {
        desde: new Date(ahoraMs).toISOString(),
        periodo: alto.periodo,
        porcentaje: alto.porcentaje,
        reinicio: alto.reinicio,
        reinicioMs: reinicios.length ? Math.max(...reinicios) : null,
        avisada: false,
      },
    };
  }
  if (!ajustes.activa) return { accion: "salir", motivo: "se apagó la pausa por uso" };
  if (uso && !rebasa) return { accion: "salir", motivo: `el uso bajó a ${alto ? alto.porcentaje : 0} %` };
  if (lecturaFallida && pausa.reinicioMs && ahoraMs > pausa.reinicioMs + PAUSA_SIN_CONFIRMAR_MINUTOS * 60_000) {
    return { accion: "salir", motivo: "pasó la hora de reinicio y no se puede leer el uso para confirmarlo" };
  }
  return { accion: null };
}

/** Los tres textos de WhatsApp de la pausa (tipo "limite"): máximo 3 líneas cada uno. */
export function textoDelAvisoDePausa(pausa, config) {
  const cuando = fechaYHoraEnBogota(pausa.reinicioMs);
  return [
    `Se paró todo: el uso de Claude llegó al ${Math.round(pausa.porcentaje)} %. ${cuando ? `Se reanuda el ${cuando}${cuando.endsWith(".") ? "" : "."}` : "Se reanuda cuando el uso se reinicie."}`,
    `Ver: ${linkDelCoordinador(config)}`,
  ]
    .slice(0, MAXIMO_LINEAS_DEL_AVISO)
    .join("\n");
}

export const textoDelAvisoDeVuelta = () => "Volvió a trabajar: el uso de Claude se reinició.";

export function textoDelAvisoDeLecturaFallida(desdeMs, config) {
  const hora = new Date(desdeMs).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit", hour12: true }).replace(/[\u00a0\u202f]/g, " ");
  return [`No pude leer el uso de Claude desde las ${hora}: no sé qué tan cerca está del límite. Sigo trabajando.`, `Ver: ${linkDelCoordinador(config)}`].slice(0, MAXIMO_LINEAS_DEL_AVISO).join("\n");
}

/* ── El estado en disco: <carpetaTrabajo>/estado-uso.json (lo de decidirUso + pausa, lectura, detenidas) ── */

export const rutaDelEstadoDeUso = (carpetaTrabajo) => path.join(carpetaTrabajo, "estado-uso.json");

export function leerEstadoDeUso(carpetaTrabajo) {
  try {
    const dato = JSON.parse(fs.readFileSync(rutaDelEstadoDeUso(carpetaTrabajo), "utf8").replace(/^\ufeff/, ""));
    return dato && typeof dato === "object" && !Array.isArray(dato) ? dato : {};
  } catch {
    return {};
  }
}

/** Mezcla `parche` con lo guardado (los campos que no se nombran se conservan). Nunca lanza. */
export function guardarEstadoDeUso(carpetaTrabajo, parche, registro = null) {
  try {
    fs.mkdirSync(carpetaTrabajo, { recursive: true });
    const ruta = rutaDelEstadoDeUso(carpetaTrabajo);
    fs.writeFileSync(`${ruta}.tmp`, `${JSON.stringify({ ...leerEstadoDeUso(carpetaTrabajo), ...parche }, null, 2)}\n`);
    fs.renameSync(`${ruta}.tmp`, ruta);
  } catch (error) {
    registro?.aviso?.(`no pude guardar ${rutaDelEstadoDeUso(carpetaTrabajo)}: ${error.message}`);
  }
}

/** Leer el uso: [...comandoClaude, "-p", "--model", <leer: Haiku>, "/usage"], sin entrada, 60 s. Devuelve el texto o null. */
async function leerUsoConClaude(config, entorno) {
  const resultado = await correr([...config.comandoClaude, "-p", "--model", modeloDelPaso(config, "leer"), "/usage"], {
    cwd: config.carpetaTrabajo,
    entrada: "",
    timeoutMs: 60_000,
    env: entorno,
  });
  if (resultado.vencido) return { texto: null, motivo: "tardó más de 60 s" };
  if (resultado.codigo !== 0) return { texto: `${resultado.salida}\n${resultado.errores}`, motivo: `salió con código ${resultado.codigo}` };
  return { texto: resultado.salida, motivo: null };
}

/**
 * El vigilante del uso de Claude. vigilar() lo llama el planificador en cada vuelta.
 *   - Lee `claude -p /usage` cada config.vigilarUsoMinutos (5); desde config.usoCercaDelUmbral (70 %), o en pausa, cada
 *     config.vigilarUsoCercaMinutos (2), para no pasarse del umbral sin darse cuenta. Pasada la hora de reinicio de una
 *     pausa lee enseguida.
 *   - Cada vuelta decide la pausa por uso (decidirPausaPorUso) con el último porcentaje y el interruptor/umbral que
 *     tenga `estado`, y manda los WhatsApp (tipo "limite") UNA vez: al pausar, al volver y la primera vez que no puede
 *     leer el uso. Lo enviado queda en estado-uso.json: un Coordinador reiniciado en plena pausa no repite el aviso.
 */
export function crearVigilanteDeUso({ config, registro, estado, entorno, leer = leerUsoConClaude, ahora = () => Date.now(), crm = null }) {
  const carpeta = config.carpetaTrabajo;
  let proxima = 0;
  let altoAntes = "";
  let forzadoParaElReinicio = null;
  let ultimoFalloDeAviso = "";

  const guardarEstado = (parche) => guardarEstadoDeUso(carpeta, parche, registro);
  // Si el Coordinador se reinició en plena pausa (o con la lectura rota), sigue igual. Con la vigilancia apagada
  // (vigilarUsoMinutos 0) nadie podría levantar la pausa: no se restaura.
  const previo = leerEstadoDeUso(carpeta);
  if (config.vigilarUsoMinutos && previo.pausa && typeof previo.pausa === "object") estado.ponerPausaPorUso?.(previo.pausa);
  let lectura = previo.lectura && typeof previo.lectura === "object" ? { fallos: Number(previo.lectura.fallos) || 0, desde: previo.lectura.desde ?? null, avisada: previo.lectura.avisada === true } : { fallos: 0, desde: null, avisada: false };
  if (lectura.desde && lectura.fallos >= LECTURAS_FALLIDAS_PARA_AVISAR) estado.ponerLecturaFallida?.(Date.parse(lectura.desde));

  /** Un WhatsApp de tipo "limite". true = salió; false = lo calló el CRM (9 p. m. a 7 a. m.) o falló: se reintenta en la próxima vuelta. */
  async function mandar(texto) {
    if (!crm) return false;
    try {
      const respuesta = await crm.aviso(texto, "limite");
      ultimoFalloDeAviso = "";
      return !respuesta?.silenciado;
    } catch (error) {
      const mensaje = `${error.status ?? "sin respuesta"}: ${error.message}`;
      if (mensaje !== ultimoFalloDeAviso) registro.aviso(`no salió el aviso del uso de Claude (${mensaje}); se reintenta`);
      ultimoFalloDeAviso = mensaje;
      return false;
    }
  }

  async function mirar() {
    const { texto, motivo } = await leer(config, entorno);
    const uso = leerUsoDeClaude(texto);
    if (!uso) registro.aviso(`no pude leer el uso de Claude (${motivo ?? "la respuesta no dice el porcentaje"}): lo trato como bajo el umbral`);
    const guardado = leerEstadoDeUso(carpeta);
    const decision = decidirUso(uso, guardado, config.umbralClaude);
    // 26-oct-2026: el umbral de "Claude alto" no avisa por WhatsApp. Lo que sí avisa (una vez) es la pausa por uso y que no
    // se puede leer el uso (más abajo); el estado de decidirUso se mezcla con lo demás que hay en estado-uso.json.
    guardarEstado(decision.estado);

    if (uso) {
      estado.ponerUsoMedido?.({ ...uso, leidoEn: ahora() });
      lectura = { fallos: 0, desde: null, avisada: false };
      estado.ponerLecturaFallida?.(null);
    } else {
      lectura = { fallos: lectura.fallos + 1, desde: lectura.desde ?? new Date(ahora()).toISOString(), avisada: lectura.avisada };
      if (lectura.fallos >= LECTURAS_FALLIDAS_PARA_AVISAR) estado.ponerLecturaFallida?.(Date.parse(lectura.desde));
    }
    guardarEstado({ lectura });

    const alto = decision.alto.sort((a, b) => b.porcentaje - a.porcentaje)[0] ?? null;
    estado.ponerClaudeAlto(alto);
    const clave = alto ? `${alto.periodo}-${alto.reinicio}` : "";
    if (clave !== altoAntes) {
      if (alto) {
        registro.aviso(
          config.motores.respaldoCodex
            ? `Claude al ${alto.porcentaje} % (${NOMBRE_DEL_PERIODO[alto.periodo]}): ${pasosDeClaude(config)} a Codex hasta ${horaDelReinicio(alto.reinicio)}`
            : `Claude al ${alto.porcentaje} % (${NOMBRE_DEL_PERIODO[alto.periodo]}): sigo con Claude (sin respaldo a Codex); se reinicia ${horaDelReinicio(alto.reinicio)}`,
        );
      } else if (altoAntes) {
        registro.info(`Claude volvió bajo el ${config.umbralClaude} %: ${pasosDeClaude(config, { verbo: "vuelve" })} a Claude`);
      }
      altoAntes = clave;
    }
    if (uso) {
      const partes = ["sesion", "semana"].filter((p) => uso[p]).map((p) => `${NOMBRE_DEL_PERIODO[p]} ${uso[p].porcentaje} %`);
      registro.info(`uso de Claude: ${partes.join(", ")}`);
    }
    return decision;
  }

  /** Entra o sale de la pausa por uso y manda lo que falte avisar. Cada vuelta, con o sin lectura nueva. */
  async function evaluarPausa() {
    const ajustes = estado.ajustesDePausa();
    const pausa = estado.pausaPorUso();
    const decision = decidirPausaPorUso({ uso: estado.usoMedido(), ajustes, pausa, ahoraMs: ahora(), lecturaFallida: lectura.fallos >= LECTURAS_FALLIDAS_PARA_AVISAR });
    if (decision.accion === "entrar") {
      estado.ponerPausaPorUso(decision.pausa);
      guardarEstado({ pausa: decision.pausa, pendienteVuelta: false });
      const hasta = fechaYHoraEnBogota(decision.pausa.reinicioMs);
      registro.aviso(`PAUSADO POR USO DE CLAUDE: ${NOMBRE_DEL_PERIODO[decision.pausa.periodo]} al ${decision.pausa.porcentaje} % (umbral ${ajustes.umbral} %); no tomo tarjetas y detengo las que corren${hasta ? `; se reanuda el ${hasta}` : ""}`);
    } else if (decision.accion === "salir") {
      // Solo se avisa que volvió si antes se avisó que se paró (una pausa que nadie supo no necesita su "volvió").
      guardarEstado({ pausa: null, pendienteVuelta: pausa?.avisada === true });
      estado.ponerPausaPorUso(null);
      registro.info(`SALGO DE LA PAUSA POR USO DE CLAUDE: ${decision.motivo}; vuelvo a tomar tarjetas (primero las que quedaron detenidas)`);
    }
    // Los WhatsApp: uno por pausa, uno al volver y uno por cada racha de lecturas fallidas.
    const actual = estado.pausaPorUso();
    if (actual && !actual.avisada && (await mandar(textoDelAvisoDePausa(actual, config)))) {
      actual.avisada = true;
      guardarEstado({ pausa: actual });
    } else if (!actual && leerEstadoDeUso(carpeta).pendienteVuelta && (await mandar(textoDelAvisoDeVuelta()))) {
      guardarEstado({ pendienteVuelta: false });
    }
    if (lectura.fallos >= LECTURAS_FALLIDAS_PARA_AVISAR && !lectura.avisada && (await mandar(textoDelAvisoDeLecturaFallida(Date.parse(lectura.desde), config)))) {
      lectura = { ...lectura, avisada: true };
      guardarEstado({ lectura });
    }
  }

  return {
    async vigilar() {
      if (!config.vigilarUsoMinutos) return null;
      let decision = null;
      const pausa = estado.pausaPorUso();
      // Pasó la hora de reinicio de la pausa y todavía no hay una lectura de después: se lee enseguida (una vez).
      if (pausa?.reinicioMs && ahora() >= pausa.reinicioMs && (estado.usoMedido()?.leidoEn ?? 0) < pausa.reinicioMs && forzadoParaElReinicio !== pausa.reinicioMs) {
        forzadoParaElReinicio = pausa.reinicioMs;
        proxima = 0;
      }
      if (ahora() >= proxima) {
        proxima = ahora() + config.vigilarUsoMinutos * 60_000;
        try {
          decision = await mirar();
          const cerca = estado.pausaPorUso() || (periodoMasAlto(estado.usoMedido())?.porcentaje ?? 0) >= config.usoCercaDelUmbral;
          if (cerca) proxima = ahora() + Math.min(config.vigilarUsoMinutos, config.vigilarUsoCercaMinutos) * 60_000;
        } catch (error) {
          registro.aviso(`la vigilancia del uso de Claude falló: ${error.message}`);
        }
      }
      try {
        await evaluarPausa();
      } catch (error) {
        registro.aviso(`la pausa por uso de Claude falló: ${error.message}`);
      }
      return decision;
    },
  };
}
