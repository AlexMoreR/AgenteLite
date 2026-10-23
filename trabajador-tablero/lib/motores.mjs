// Los MOTORES del trabajador (23-oct-2026): Claude Code (la suscripción de Alexander) y Codex CLI (la
// sesión de ChatGPT Plus). Por defecto Claude planea y revisa, Codex construye (config.motores).
//
// - motorDe(paso): quién hace planear / construir / revisar AHORA. Si Claude está sobre el umbral de uso
//   (o llegó a su límite) los pasos de Claude pasan a Codex; si Codex llegó a su límite, sus pasos
//   esperan (o pasan a Claude solo con motores.respaldoClaude). null = nadie disponible: espera.
// - leerUsoDeClaude(texto): lo que dice `claude -p /usage`, en números.
// - decidirUso(...): qué avisar por WhatsApp (uno por cada cruce del umbral) y qué guardar.
// - crearVigilanteDeUso(...): cada config.vigilarUsoMinutos lee el uso, avisa y prende/apaga "Claude alto".
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
  const disponible = (motor) => ahora() >= pausaHasta[motor] && !(motor === "claude" && claudeAlto);
  return {
    motorDe(paso) {
      const elegido = paso === "revisar" ? config.motores.revisar : config.motores[paso];
      if (!elegido) return null;
      if (disponible(elegido)) return elegido;
      if (elegido === "claude") return disponible("codex") ? "codex" : null;
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
 *   avisos: los cruces nuevos para el WhatsApp (uno por periodo y por cruce: se vuelve a avisar solo si
 *           bajó del umbral o cambió el periodo, es decir, el texto del reinicio)
 *   alertaLectura: true si hay que mandar "no pude leer el uso de Claude" (una vez por día)
 *   estado: lo que hay que guardar (se guarda solo si el aviso salió: ver crearVigilanteDeUso)
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

export function textoDelAviso(avisos, config) {
  const lineas = avisos.map((a) => `• ${NOMBRE_DEL_PERIODO[a.periodo]}: ${a.porcentaje} % usado, se reinicia ${a.reinicio || "(sin hora)"}`);
  return [
    `⚠️ Trabajador del Tablero IA: el plan de Claude pasó el ${config.umbralClaude} %.`,
    ...lineas,
    `Mientras esté arriba, ${pasosDeClaude(config)} a Codex.`,
  ]
    .join("\n")
    .slice(0, 500);
}

/** Leer el uso: [...comandoClaude, "-p", "/usage"], sin entrada, 60 s. Devuelve el texto o null. */
async function leerUsoConClaude(config, entorno) {
  const resultado = await correr([...config.comandoClaude, "-p", "/usage"], {
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
 * El vigilante del uso de Claude. vigilar() lo llama el planificador en cada vuelta; solo mira cada
 * config.vigilarUsoMinutos. Guarda en carpetaTrabajo/estado-uso.json a quién ya avisó.
 */
export function crearVigilanteDeUso({ config, registro, crm, estado, entorno, leer = leerUsoConClaude, ahora = () => Date.now() }) {
  const archivo = path.join(config.carpetaTrabajo, "estado-uso.json");
  let proxima = 0;
  let altoAntes = "";

  const leerEstado = () => {
    try {
      return JSON.parse(fs.readFileSync(archivo, "utf8"));
    } catch {
      return {};
    }
  };
  const guardarEstado = (valor) => {
    try {
      fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
      fs.writeFileSync(archivo, `${JSON.stringify(valor, null, 2)}\n`);
    } catch (error) {
      registro.aviso(`no pude guardar ${archivo}: ${error.message}`);
    }
  };
  const avisar = async (texto) => {
    try {
      await crm.aviso(texto);
      return true;
    } catch (error) {
      registro.aviso(`no salió el aviso por WhatsApp (${error.status ?? "sin respuesta"}): ${error.message}`);
      return false;
    }
  };

  async function mirar() {
    const { texto, motivo } = await leer(config, entorno);
    const uso = leerUsoDeClaude(texto);
    if (!uso) registro.aviso(`no pude leer el uso de Claude (${motivo ?? "la respuesta no dice el porcentaje"}): lo trato como bajo el umbral`);
    const guardado = leerEstado();
    const decision = decidirUso(uso, guardado, config.umbralClaude);
    const aGuardar = { ...decision.estado };

    if (decision.alertaLectura && !(await avisar("⚠️ Trabajador del Tablero IA: no pude leer el uso de Claude (claude -p /usage). Sigo como si estuviera bajo el umbral."))) {
      aGuardar.alertaLectura = guardado.alertaLectura ?? null;
    }
    if (decision.avisos.length && !(await avisar(textoDelAviso(decision.avisos, config)))) {
      // No salió: se deja como estaba para volver a intentar en la próxima mirada.
      for (const aviso of decision.avisos) aGuardar.avisado[aviso.periodo] = guardado.avisado?.[aviso.periodo] ?? null;
    }
    guardarEstado(aGuardar);

    const alto = decision.alto.sort((a, b) => b.porcentaje - a.porcentaje)[0] ?? null;
    estado.ponerClaudeAlto(alto);
    const clave = alto ? `${alto.periodo}-${alto.reinicio}` : "";
    if (clave !== altoAntes) {
      if (alto) {
        registro.aviso(
          `Claude al ${alto.porcentaje} % (${NOMBRE_DEL_PERIODO[alto.periodo]}): ${pasosDeClaude(config)} a Codex hasta ${horaDelReinicio(alto.reinicio)}`,
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

  return {
    async vigilar() {
      if (!config.vigilarUsoMinutos || ahora() < proxima) return null;
      proxima = ahora() + config.vigilarUsoMinutos * 60_000;
      try {
        return await mirar();
      } catch (error) {
        registro.aviso(`la vigilancia del uso de Claude falló: ${error.message}`);
        return null;
      }
    },
  };
}
