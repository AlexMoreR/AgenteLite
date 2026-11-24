// LA PAUSA POR SESIÓN DE CLAUDE VENCIDA (24-nov-2026, parte 1 de 4): si la sesión de Claude de aizen1 se vence (el login de
// OAuth no se pudo renovar), cada tarjeta que se toma falla al instante y se gasta un intento tras otro. En vez de eso el
// Coordinador revisa la sesión (`claude auth status`) antes de tomar tarjetas y, mientras esté vencida, no toma ninguna.
// Se arma igual que la pausa por uso (pausa-uso.mjs): este módulo solo decide y guarda el estado; quién deja de tomar
// tarjetas es el planificador (bucle.mjs).
//
// El estado se guarda en carpetaTrabajo/estado-sesion-claude.json: un reinicio del Coordinador sigue en pausa.
import fs from "node:fs";
import path from "node:path";

import { correr } from "./procesos.mjs";

/** Lo más que puede tardar `claude auth status`. */
export const TIEMPO_MAXIMO_MS = 30_000;
/** Con la sesión buena, una revisión de hace menos de esto se reutiliza (no se corre `claude` en cada vuelta). */
export const REUTILIZAR_MS = 60_000;
/** En pausa se vuelve a revisar cada estos minutos (config.sesionClaude.revisarMinutos manda). */
export const REVISAR_MINUTOS_POR_DEFECTO = 3;

// Los textos con los que Claude dice que la sesión se venció o que falta entrar.
const ERRORES_DE_SESION = [/OAuth session expired/i, /could not be refreshed/i, /Failed to authenticate/i, /Not logged in/i, /Please run \/login/i];

/** ¿Este texto (la salida de una llamada a `claude`) dice que la sesión de Claude está vencida? */
export function esErrorDeSesion(texto) {
  const contenido = String(texto ?? "");
  return ERRORES_DE_SESION.some((patron) => patron.test(contenido));
}

/**
 * Lo que dijo `claude auth status` -> true (hay sesión), false (vencida) o null (no se entiende).
 * Primero el JSON (`loggedIn`); si no viene JSON, el texto "Not logged in".
 */
export function leerEstadoDeSesion(texto) {
  const contenido = String(texto ?? "").trim();
  const candidatos = [contenido, contenido.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean);
  for (const candidato of candidatos) {
    try {
      const datos = JSON.parse(candidato);
      if (datos && typeof datos.loggedIn === "boolean") return datos.loggedIn;
    } catch {
      // No es JSON: se mira el texto.
    }
  }
  if (/Not logged in/i.test(contenido)) return false;
  return null;
}

/**
 * La pausa por sesión de Claude vencida.
 *   revisar()             corre `claude auth status` (si toca) y decide entrar o salir de la pausa. Nunca lanza.
 *   vencida()             ¿la sesión está vencida ahora? (no se toman tarjetas).
 *   marcarVencida(motivo) otra parte del Coordinador vio el error de sesión (parte 2): entra en pausa sin esperar la revisión.
 *   resumen()             para el latido y el panel: { vencida, desde, revisadaEn }.
 *   esErrorDeSesion(t)    ¿el texto dice que la sesión se venció?
 * `correrComando` y `ahora` se cambian en las pruebas.
 */
export function crearPausaPorSesion({ config, registro, ahora = () => Date.now(), entorno = undefined, correrComando = correr }) {
  const archivo = path.join(config.carpetaTrabajo, "estado-sesion-claude.json");
  const revisarMs = (Number(config.sesionClaude?.revisarMinutos) > 0 ? Number(config.sesionClaude.revisarMinutos) : REVISAR_MINUTOS_POR_DEFECTO) * 60_000;

  const leerArchivo = () => {
    try {
      const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
      return datos && typeof datos === "object" ? datos : {};
    } catch {
      return {};
    }
  };
  // Lo guardado: { vencida, desde, motivo, revisadaEn }. Se lee al arrancar: un reinicio sigue en pausa.
  const guardado = leerArchivo();
  let estado = {
    vencida: guardado.vencida === true,
    desde: guardado.vencida === true && Number.isFinite(guardado.desde) ? guardado.desde : null,
    motivo: guardado.vencida === true && typeof guardado.motivo === "string" ? guardado.motivo : null,
    revisadaEn: Number.isFinite(guardado.revisadaEn) ? guardado.revisadaEn : null,
  };
  // La última vez que se intentó revisar (buena o no): así un `claude` que no responde no se corre en cada vuelta.
  let intentoEn = 0;
  // El último motivo por el que no se pudo revisar (se anota una vez hasta que cambie o haya una revisión buena).
  let ultimaFalla = "";
  let enCurso = null;

  const guardar = () => {
    try {
      fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
      fs.writeFileSync(archivo, `${JSON.stringify(estado, null, 2)}\n`);
    } catch (error) {
      registro.aviso(`no pude guardar ${archivo}: ${error.message}`);
    }
  };

  const entrar = (motivo) => {
    const momento = ahora();
    if (estado.vencida) return;
    estado = { ...estado, vencida: true, desde: momento, motivo };
    guardar();
    registro.aviso(`PAUSA: la sesión de Claude está vencida (${motivo}); no tomo tarjetas hasta que vuelva`);
  };

  const salir = () => {
    if (!estado.vencida) return;
    estado = { ...estado, vencida: false, desde: null, motivo: null };
    guardar();
    registro.info("la sesión de Claude volvió: sale la pausa y vuelvo a tomar tarjetas");
  };

  const anotarFalla = (motivo) => {
    if (motivo === ultimaFalla) return;
    ultimaFalla = motivo;
    registro.aviso(`no pude revisar la sesión de Claude (${motivo}); no pauso por eso`);
  };

  const revisarAhora = async () => {
    intentoEn = ahora();
    let resultado;
    try {
      // La carpeta de trabajo es el cwd del comando: si todavía no existe, `claude` ni arranca.
      fs.mkdirSync(config.carpetaTrabajo, { recursive: true });
      resultado = await correrComando([...config.comandoClaude, "auth", "status"], {
        cwd: config.carpetaTrabajo,
        entrada: "",
        timeoutMs: TIEMPO_MAXIMO_MS,
        ...(entorno ? { env: entorno } : {}),
      });
    } catch (error) {
      anotarFalla(`no arrancó: ${error?.message ?? error}`);
      return;
    }
    if (resultado?.vencido) {
      anotarFalla(`tardó más de ${TIEMPO_MAXIMO_MS / 1000} s`);
      return;
    }
    const texto = `${resultado?.salida ?? ""}\n${resultado?.errores ?? ""}`;
    const conSesion = leerEstadoDeSesion(texto);
    if (conSesion === null) {
      const primera = texto.trim().split("\n")[0]?.slice(0, 200) || "sin salida";
      anotarFalla(`respuesta que no entiendo, código ${resultado?.codigo ?? "?"}: ${primera}`);
      return;
    }
    ultimaFalla = "";
    estado = { ...estado, revisadaEn: ahora() };
    if (conSesion) {
      if (estado.vencida) salir();
      else guardar();
    } else if (!estado.vencida) entrar("claude auth status: no hay sesión");
    else guardar();
  };

  const api = {
    /** Corre la revisión si toca. Nunca lanza: un `claude` que falla o no responde no pausa, solo se anota. */
    async revisar() {
      const momento = ahora();
      if (estado.vencida) {
        if (intentoEn && momento - intentoEn < revisarMs) return api.vencida();
      } else if (intentoEn && momento - intentoEn < REUTILIZAR_MS) return false;
      enCurso ??= revisarAhora().finally(() => {
        enCurso = null;
      });
      await enCurso;
      return api.vencida();
    },
    vencida: () => estado.vencida,
    marcarVencida(motivo) {
      intentoEn = ahora();
      entrar(String(motivo ?? "error de sesión de Claude").slice(0, 300));
    },
    resumen: () => ({
      vencida: estado.vencida,
      desde: estado.desde ? new Date(estado.desde).toISOString() : null,
      revisadaEn: estado.revisadaEn ? new Date(estado.revisadaEn).toISOString() : null,
    }),
    esErrorDeSesion,
  };
  return api;
}
