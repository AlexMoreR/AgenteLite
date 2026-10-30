// CONSTRUIR EN LA NUBE (25-oct-2026, decisión del dueño): las tareas grandes y las de desborde se construyen en
// una sesión de Claude en una máquina de Anthropic (`claude --cloud`), conectada al repo de GitHub, sin que el
// dueño copie y pegue nada. Acá viven las piezas de esa vía:
//
//   esTareaGrande       la regla de reparto, fija y sin IA (más de 8 archivos, migración, agente nuevo, o ya
//                       falló por tamaño o recursos).
//   lanzarEnNube        lanza `claude --cloud "<descripción>"` en una terminal real (node-pty, sin cmd.exe) y
//                       lee el link de la sesión (claude.ai/code/session_…). Si no se puede lanzar sin que alguien la
//                       toque (o no da el link), lanza un error que dice que se propone GitHub Actions (tarjeta cmvmjh9a504dp2mrpg7cazs8u).
//   esperarResultado    cada minuto mira la RAMA en GitHub (gh api) buscando el commit vacío
//                       "resultado: build=OK|FALLO tests=OK|FALLO segundos=N". NUNCA usa `claude --teleport`.
//
// Lo que se hace con la rama cuando vuelve (verificar, zonas, ensayo, subir) está en etapas.mjs (construirEnNube).
//
// 29-oct-2026 (Gestión: `claude --cloud` sube una copia sin el repo conectado y la sesión no puede subir su rama):
//   lanzarSesionDeLaNube  con repos.<repo>.nube.sesionFija -> le manda la tarea a esa sesión (creada en la web con el repo
//                         seleccionado): `/clear` y la instrucción, con `claude -p … --cloud <id>`. Una tarea a la vez.
//                         Sin sesión fija -> `claude --cloud` como siempre, con --debug-file y el CHEQUEO PREVIO: si la CLI
//                         dice que la app de GitHub no está en el repo (github_preflight_failed), ERROR enseguida.
//                         Si falla (nube_sin_acceso_repo) deja una MARCA por repo (sinAccesoALaNube): durante
//                         nube.sinAccesoMinutos las tarjetas siguientes de ese proyecto no se mandan a la nube.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { archivosDelPlan } from "./choques.mjs";
import { esLimiteDeUso } from "./diagnostico.mjs";
import { ErrorDeEtapa, entornoSeguro } from "./etapas.mjs";
import { urlDelRemoto, webDeGithub } from "./git.mjs";
import { correr, ultimasLineas } from "./procesos.mjs";
import { progresoDelCommit } from "./revisores.mjs";

const MINUTO = 60_000;

/** La tarjeta de GitHub Actions que se propone si `--cloud` no funciona sin terminal real. */
export const TARJETA_DE_GITHUB_ACTIONS = "cmvmjh9a504dp2mrpg7cazs8u";

/* ───────────────────────────────────────────────────────── la regla de reparto ── */

/** Categorías de intentos anteriores que cuentan como "falló por tamaño o recursos" (diagnostico.mjs). */
const CATEGORIAS_DE_TAMANO = ["tiempo_agotado", "pc_sobrecargado", "tarea_muy_grande"];

const LINEA_DE_SECCION = (numero) => new RegExp(`^\\s*(?:#{1,6}\\s*)?\\**\\s*${numero}[.)]\\s+\\S`);

/** El texto de la parte `numero` del plan ("4. Migración…"), con su línea de título; "" si no la tiene. */
export function seccionDelPlan(plan, numero) {
  const lineas = String(plan ?? "").split(/\r?\n/);
  const desde = lineas.findIndex((linea) => LINEA_DE_SECCION(numero).test(linea));
  if (desde < 0) return "";
  let hasta = lineas.length;
  for (let i = desde + 1; i < lineas.length; i += 1) {
    if (LINEA_DE_SECCION(numero + 1).test(lineas[i])) {
      hasta = i;
      break;
    }
  }
  return lineas.slice(desde, hasta).join("\n");
}

/** ¿El plan trae migración? Lo dice la parte 4 ("sí" / "no") o la parte 5 nombra la carpeta de migraciones. */
export function trabajaConMigracion(plan, repo) {
  const carpeta = String(repo?.carpetaMigraciones ?? "prisma/migrations").replace(/\/+$/, "");
  if (archivosDelPlan(plan).some((archivo) => archivo === carpeta || archivo.startsWith(`${carpeta}/`))) return true;
  const cuerpo = seccionDelPlan(plan, 4)
    .replace(/[*_`#>]/g, " ")
    .replace(/s[ií]\s*(?:o|\/|\|)\s*no/gi, " ");
  const respuesta = cuerpo.match(/(?<![\p{L}\p{N}])(s[ií]|no)(?![\p{L}\p{N}])/iu);
  return Boolean(respuesta && /^s/i.test(respuesta[1]));
}

/** ¿La tarea crea un agente nuevo? Se mira el título y la parte 1 del plan ("Qué se cambia"). */
export function creaUnAgenteNuevo(tarjeta) {
  const texto = `${tarjeta?.titulo ?? ""}\n${seccionDelPlan(tarjeta?.plan, 1)}`;
  return /(?<![\p{L}\p{N}])(?:agente\s+nuevo|nuevo\s+agente|crea(?:r|n|s)?\s+(?:un\s+)?agente)(?![\p{L}\p{N}])/iu.test(texto);
}

/**
 * La REGLA DE REPARTO (fija, sin IA): GRANDE = el plan nombra más de `maxArchivosChica` archivos, trae migración,
 * crea un agente nuevo, o la tarjeta ya falló por tamaño o recursos. -> { grande, motivos }.
 */
export function esTareaGrande(tarjeta, { repo = null, maxArchivosChica = 8 } = {}) {
  const motivos = [];
  const plan = String(tarjeta?.plan ?? "");
  const archivos = archivosDelPlan(plan);
  if (archivos.length > maxArchivosChica) motivos.push(`el plan nombra ${archivos.length} archivos (más de ${maxArchivosChica})`);
  if (trabajaConMigracion(plan, repo)) motivos.push("trae migración");
  if (creaUnAgenteNuevo(tarjeta)) motivos.push("crea un agente nuevo");
  const categorias = [...(tarjeta?.ultimosIntentos ?? []).map((intento) => intento?.categoria), tarjeta?.reparacion?.categoria];
  const previa = categorias.find((categoria) => CATEGORIAS_DE_TAMANO.includes(categoria));
  if (previa) motivos.push(`ya falló por tamaño o recursos (${previa})`);
  // Lo que verificó la nube cambió al subir (confiarEnResultado): se verifica otra vez en la nube, no en aizen1.
  const ultimaReparacion = [...(tarjeta?.ultimosIntentos ?? [])].reverse().find((intento) => intento?.accion === "reparar");
  if (tarjeta?.reparacion?.estrategia === "nube" || /\[estrategia: nube\]\s*$/.test(String(ultimaReparacion?.causa ?? ""))) {
    motivos.push("lo que verificó la nube cambió al subir: se verifica otra vez en la nube");
  }
  return { grande: motivos.length > 0, motivos };
}

/* ───────────────────────────────────────────────────────── lanzar `claude --cloud` ── */

/** `claude --cloud` rechazó la opción --model (una versión que no la acepta con la nube). */
const NO_ACEPTA_MODELO = /(?:unknown|unrecognized|unexpected) (?:option|argument)[^\n]*--model|--model[^\n]*(?:not supported|cannot be used|incompatible)/i;

const LINK_DE_SESION = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/;

/** El link de la sesión (claude.ai/code/session_…) que aparece en un texto, o null. */
export const linkDeSesion = (texto) => String(texto ?? "").match(LINK_DE_SESION)?.[0] ?? null;

/* ── la pregunta "¿Confías en esta carpeta?" (26-oct-2026, tarjeta e8qucrhq) ──
 * En un worktree nuevo, la terminal real de `claude --cloud` se queda en "Quick safety check: Is this a project you
 * created or one you trust? ❯ No, exit / Yes, I trust this folder" (en la versión 2.1 la opción marcada es "No, exit" y
 * no hay números: Enter a ciegas SALE). La CLI no trae una opción documentada para marcar una carpeta como confiable
 * (`claude --help`: solo -p se salta la pregunta, y --cloud no deja -p), y ~/.claude.json no se edita a mano. Así que
 * se contesta en la terminal: flecha abajo hasta que la marca (❯) quede en "Yes/Sí", y ahí Enter. SOLO si la carpeta
 * está dentro de config.carpetaTrabajo (los worktrees que crea el Coordinador); fuera de ahí no se toca y falla claro.
 */
const PREGUNTA_DE_CONFIANZA = /trust this folder|Do you trust the files|one you trust\?|conf[ií]as en (?:esta carpeta|los archivos)|conf[ií]o en esta carpeta/i;
const OPCION_SI = /^(?:\d+[.)]\s*)?(?:Yes|S[ií])\b/i;
/** Máximo de teclas que se mandan a la pregunta (2 opciones; incluye las que la CLI pierde al arrancar). */
const MAX_TECLAS_DE_CONFIANZA = 10;
/** Si la pantalla no respondió a una tecla en este tiempo, la CLI la perdió (todavía arrancaba): se manda otra vez. */
const TECLA_PERDIDA_MS = 2000;
const FLECHA_ABAJO = "\u001b[B";

/**
 * La pantalla como texto: los saltos del cursor (ESC[nC) son espacios y cada ESC[fila;colH un salto de línea (la CLI
 * dibuja así: "Yes,\u001b[1CI\u001b[1Ctrust"); después se quitan los colores.
 */
export const textoDePantalla = (texto) =>
  sinColores(
    String(texto ?? "")
      .replace(/\u001b\[(\d*)C/g, (_, n) => " ".repeat(Math.max(1, Number(n) || 1)))
      .replace(/\u001b\[\d*(?:;\d*)?[Hf]/g, "\n")
      // Las secuencias con parámetros privados (ESC[>0q, ESC[<u…) también: su ">" no es la marca de la opción.
      .replace(/\u001b\[[0-9;?<=>]*[ -/]*[@-~]/g, ""),
  );

/** ¿La pantalla muestra la pregunta de confianza? -> { marcadaSi } (la marca ❯ / › / > está en "Yes/Sí"), o null. */
export function preguntaDeConfianza(pantalla) {
  const texto = textoDePantalla(pantalla);
  const donde = texto.search(PREGUNTA_DE_CONFIANZA);
  if (donde < 0) return null;
  const desde = texto.slice(donde);
  // La marca de la opción elegida: ❯ (o ›); ">" solo si no hay ninguna de esas (terminales sin Unicode).
  const flecha = Math.max(desde.lastIndexOf("❯"), desde.lastIndexOf("›"));
  const marca = flecha >= 0 ? flecha : desde.lastIndexOf(">");
  if (marca < 0) return { marcadaSi: false };
  return { marcadaSi: OPCION_SI.test(desde.slice(marca + 1).trim()) };
}

/** ¿`carpeta` está dentro de `raiz` (o es ella)? Sin mayúsculas en Windows. */
export function estaDentroDe(carpeta, raiz) {
  if (!carpeta || !raiz) return false;
  const normal = (ruta) => {
    const resuelta = path.resolve(ruta);
    return process.platform === "win32" ? resuelta.toLowerCase() : resuelta;
  };
  const relativa = path.relative(normal(raiz), normal(carpeta));
  return relativa === "" || (!relativa.startsWith("..") && !path.isAbsolute(relativa));
}

const sinColores = (texto) => String(texto ?? "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");

function mensajeSinTerminal(detalle) {
  return [
    "No se pudo lanzar `claude --cloud` sin que alguien toque la terminal (ni `claude -p --cloud` ni una terminal real con node-pty).",
    `Se propone GitHub Actions (tarjeta ${TARJETA_DE_GITHUB_ACTIONS}). Para probar la terminal real: npm install node-pty --prefix trabajador-tablero.`,
    detalle ? `Detalle técnico:\n${ultimasLineas(detalle, 15)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Con la terminal real la instrucción va en la línea de comandos: Windows no deja pasar de ~32.767 caracteres. */
export const MAX_DESCRIPCION = 24_000;

/**
 * La descripción para `claude --cloud "<descripción>"`. Si no cabe en la línea de comandos, se recorta SOLO el
 * plan (y después el contexto de la tarjeta) por el medio; el saludo con la rama, las lecciones y las prohibiciones
 * quedan enteras.
 */
export function descripcionParaLaNube(prompt, max = MAX_DESCRIPCION) {
  const texto = String(prompt ?? "");
  if (texto.length <= max) return texto;
  const bloques = texto.split("\n\n");
  const recortar = (bloque, cabe) => {
    if (bloque.length <= cabe) return bloque;
    const aviso = "\n[… recortado para que quepa en la línea de comandos: el plan completo está en la tarjeta del CRM …]\n";
    const mitad = Math.max(0, Math.floor((cabe - aviso.length) / 2));
    return `${bloque.slice(0, mitad)}${aviso}${bloque.slice(bloque.length - mitad)}`;
  };
  const sobra = () => bloques.join("\n\n").length - max;
  for (const esElBloque of [(b) => b.startsWith("PLAN APROBADO:"), (b, i) => i === 1]) {
    const i = bloques.findIndex(esElBloque);
    if (i >= 0 && sobra() > 0) bloques[i] = recortar(bloques[i], Math.max(400, bloques[i].length - sobra()));
  }
  const final = bloques.join("\n\n");
  return final.length <= max ? final : recortar(final, max);
}

/**
 * La ruta del ejecutable para la terminal real (sin cmd.exe). En Windows, un nombre suelto ("claude") se busca con
 * `where` y se prefiere el .exe (C:\Users\…\.local\bin\claude.exe). Una ruta o el de otro sistema quedan igual.
 */
export function rutaDelEjecutable(nombre) {
  if (process.platform !== "win32" || /[\\/]/.test(nombre)) return nombre;
  try {
    const rutas = execFileSync("where", [nombre], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter(Boolean);
    return rutas.find((ruta) => /\.exe$/i.test(ruta)) ?? rutas[0] ?? nombre;
  } catch {
    return nombre;
  }
}

/**
 * (b) La terminal real (node-pty, instalada solo en trabajador-tablero): `claude --cloud "<descripción>" [--model m]`
 * con los argumentos en un array (sin cmd.exe, así la descripción multilínea con comillas y acentos llega entera
 * como argumento posicional justo después de --cloud). Lee el link de la sesión y cierra la terminal apenas lo tiene
 * (Claude se queda esperando y no debe colgar al Coordinador). -> { link, via, salida, modeloForzado }.
 */
async function lanzarConTerminalReal(contexto, { cwd, prompt, base, modelo, timeoutMs, antes, depuracion = null }) {
  const { registro } = contexto;
  let pty;
  try {
    pty = await import("node-pty");
  } catch {
    throw new ErrorDeEtapa(mensajeSinTerminal(`${antes}\nnode-pty no está instalado.`), { categoria: "otra" });
  }
  const descripcion = descripcionParaLaNube(prompt);
  if (descripcion.length < String(prompt ?? "").length) registro?.aviso?.(`claude --cloud: la instrucción tenía ${String(prompt).length} caracteres; la recorté a ${descripcion.length} (el plan, por el medio)`);
  const archivo = rutaDelEjecutable(base[0]);
  // La pregunta de confianza solo se acepta en las carpetas del Coordinador (sus worktrees en carpetaTrabajo).
  const confiar = estaDentroDe(cwd, contexto.config?.carpetaTrabajo);
  const lanzar = (conModelo) => {
    registro?.info?.(`claude --cloud: lo lanzo con una terminal real (node-pty, ${archivo})`);
    return unaTerminal(contexto, pty, archivo, [...base.slice(1), "--cloud", descripcion, ...(conModelo ? ["--model", modelo] : []), ...(depuracion ? ["--debug-file", depuracion] : [])], {
      cwd,
      timeoutMs,
      antes,
      confiar,
      depuracion,
    });
  };
  const primero = await lanzar(Boolean(modelo));
  if (primero.sinRepo) return { ...primero, modeloForzado: Boolean(modelo) };
  if (primero.link) return { ...primero, modeloForzado: Boolean(modelo) };
  if (modelo && NO_ACEPTA_MODELO.test(primero.salida)) {
    registro?.aviso?.("claude --cloud no deja elegir modelo con --model: lo lanzo sin él (el modelo va pedido en el prompt)");
    const segundo = await lanzar(false);
    if (segundo.link || segundo.sinRepo) return { ...segundo, modeloForzado: false };
    throw segundo.error;
  }
  throw primero.error;
}

/* ── el CHEQUEO PREVIO de `claude --cloud` (29-oct-2026) ──
 * La CLI 2.1 mira si la app de GitHub de Claude está en el repo. Si dice que no, NO conecta el repo: sube una copia local
 * sin remoto ("[teleportToRemote] Bundling (reason: github_preflight_failed)") y la sesión no puede hacer push (el proxy da
 * 403). Pasó con AlexMoreR/Gestion aunque la app sí tiene acceso. Eso solo se ve en el log de --debug-file.
 */
const SIN_REPO_EN_LA_NUBE = /GitHub app is not installed[^\n]*|Bundling \(reason: github_preflight_failed\)[^\n]*|github_preflight_failed[^\n]*/i;

/** La línea del log de la CLI que dice que la sesión va sin el repo conectado, o null. */
export function lineaSinRepo(texto) {
  return String(texto ?? "").match(SIN_REPO_EN_LA_NUBE)?.[0]?.trim() ?? null;
}

/** El archivo de --debug-file de un lanzamiento: al lado del worktree (fuera de él: nunca entra en la copia que se sube). */
export const archivoDeDepuracion = (cwd) => `${cwd}.debug-nube.log`;

const leerSiHay = (archivo) => {
  try {
    return fs.readFileSync(archivo, "utf8");
  } catch {
    return "";
  }
};

const borrarSiHay = (archivo) => {
  try {
    fs.rmSync(archivo, { force: true });
  } catch {
    // Windows a veces lo tiene abierto: queda y se pisa en el próximo lanzamiento.
  }
};

/**
 * Suelta el hilo que lee la salida de la terminal en Windows. node-pty solo lo suelta en kill(): si Claude sale solo
 * (o kill() quedó en cola), el hilo queda vivo y el proceso del Coordinador (o de las pruebas) nunca termina.
 */
function soltarHilo(hijo) {
  try {
    hijo._agent?._conoutSocketWorker?.dispose?.();
  } catch {
    // Otra versión de node-pty: no hay más que soltar.
  }
}

/**
 * Cierra la terminal real. En Windows, node-pty deja `kill()` en cola hasta que llega el primer dato: si Claude no
 * escribió nada, kill() no mata nada y la terminal (y su hilo) quedan abiertos para siempre. En ese caso se mata el
 * árbol con taskkill y se suelta el hilo de la salida.
 */
function cerrarTerminal(hijo, recibioDatos) {
  if (process.platform === "win32" && !recibioDatos) {
    try {
      execFileSync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // Ya terminó.
    }
    soltarHilo(hijo);
    return;
  }
  try {
    hijo.kill();
  } catch {
    // Ya terminó.
  }
}

/** Una terminal real: { link, via, salida } si salió el link, o { error, salida } si no. Rechaza solo al cancelar. */
function unaTerminal(contexto, pty, archivo, argumentos, { cwd, timeoutMs, antes, confiar = false, depuracion = null }) {
  const { senal, registro } = contexto;
  return new Promise((resolver, rechazar) => {
    let texto = "";
    let hijo;
    const fallo = (detalle) => resolver({ error: new ErrorDeEtapa(mensajeSinTerminal(`${antes}\n${detalle}`), { categoria: "otra" }), salida: sinColores(texto) });
    try {
      hijo = (pty.default ?? pty).spawn(archivo, argumentos, { name: "xterm-256color", cols: 200, rows: 50, cwd, env: entornoSeguro() });
    } catch (error) {
      fallo(error.message);
      return;
    }
    let listo = false;
    const terminar = (accion) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      clearInterval(vigiaDeConfianza);
      clearInterval(vigiaDelChequeo);
      senal?.removeEventListener?.("abort", cortar);
      // Si ya salió no se mata (node-pty en Windows se queja con "AttachConsole failed").
      if (!salio) cerrarTerminal(hijo, texto.length > 0);
      accion();
    };
    let salio = false;
    const cortar = () => terminar(() => rechazar(new ErrorDeEtapa("Se canceló el lanzamiento en la nube: la tarjeta venció en el CRM.", { categoria: "coordinador_cortado" })));
    const ganar = (link) => terminar(() => resolver({ link, via: "terminal-real", salida: sinColores(texto) }));
    const sinLink = (porque) => {
      const link = linkDeSesion(sinColores(texto));
      if (link) return ganar(link);
      const sinRepo = depuracion ? lineaSinRepo(leerSiHay(depuracion)) : null;
      if (sinRepo) return terminar(() => resolver({ sinRepo, link: null, via: "terminal-real", salida: sinColores(texto) }));
      return terminar(() =>
        esLimiteDeUso(sinColores(texto))
          ? resolver({ error: new ErrorDeEtapa(`Claude llegó a su límite de uso al lanzar en la nube: ${ultimasLineas(sinColores(texto), 5)}`, { limiteDeUso: true, motor: "claude" }), salida: sinColores(texto) })
          : fallo(`${porque}\n${ultimasLineas(sinColores(texto), 15)}`),
      );
    };
    const reloj = setTimeout(() => sinLink(`la terminal real no dio el link en ${Math.round(timeoutMs / 1000)} s`), timeoutMs);
    // El chequeo previo (29-oct-2026): si el log de --debug-file dice que el repo no se conecta, se cierra la terminal YA
    // (antes del link, si se alcanza: así ni se crea la sesión sin repo).
    const vigiaDelChequeo = setInterval(() => {
      if (listo || !depuracion) return;
      const linea = lineaSinRepo(leerSiHay(depuracion));
      if (linea) terminar(() => resolver({ sinRepo: linea, link: linkDeSesion(sinColores(texto)), via: "terminal-real", salida: sinColores(texto) }));
    }, 300);
    // La pregunta "¿Confías en esta carpeta?": se contesta con la pantalla quieta (400 ms sin datos) y, después de cada
    // tecla, solo cuando la pantalla ya respondió (al arrancar la CLI tarda en leer teclas: mandarlas a ciegas da la
    // vuelta a las opciones y termina en "No, exit"). Si no respondió en TECLA_PERDIDA_MS, la tecla se perdió: otra vez.
    let ultimoDato = 0;
    let largoAlTocar = -1;
    let tocadoEn = 0;
    let teclas = 0;
    let confianzaResuelta = false;
    const vigiaDeConfianza = setInterval(() => {
      if (listo || confianzaResuelta || Date.now() - ultimoDato < 400) return;
      if (largoAlTocar >= 0 && texto.length === largoAlTocar && Date.now() - tocadoEn < TECLA_PERDIDA_MS) return;
      const pregunta = preguntaDeConfianza(texto);
      if (!pregunta) return;
      if (!confiar) {
        confianzaResuelta = true;
        terminar(() =>
          // La explicación va al final: el mensaje se queda con las últimas líneas del detalle.
          fallo(`${ultimasLineas(textoDePantalla(texto).replace(/\n\s*\n+/g, "\n"), 8)}\nLa terminal real se quedó en la pregunta "¿Confías en esta carpeta?" y ${cwd} no está dentro de la carpeta de trabajo del Coordinador: no la acepto sola.`),
        );
        return;
      }
      if (teclas >= MAX_TECLAS_DE_CONFIANZA) {
        confianzaResuelta = true;
        registro?.aviso?.(`claude --cloud: no pude marcar "Sí, confío en esta carpeta" con ${teclas} teclas; sigo esperando el link`);
        return;
      }
      largoAlTocar = texto.length;
      tocadoEn = Date.now();
      teclas += 1;
      try {
        if (pregunta.marcadaSi) {
          confianzaResuelta = true;
          hijo.write("\r");
          registro?.info?.(`claude --cloud: acepté la pregunta "¿Confías en esta carpeta?" (${cwd}, dentro de la carpeta de trabajo)`);
        } else hijo.write(FLECHA_ABAJO);
      } catch {
        // La terminal ya se cerró: lo dice onExit.
      }
    }, 150);
    hijo.onData((dato) => {
      texto += dato;
      ultimoDato = Date.now();
      // El link puede llegar partido en dos pedazos: vale cuando ya viene algo después (o al salir / vencer).
      const limpio = sinColores(texto);
      const link = linkDeSesion(limpio);
      if (link && limpio.indexOf(link) + link.length < limpio.length) ganar(link);
    });
    hijo.onExit(({ exitCode } = {}) => {
      salio = true;
      if (process.platform === "win32") setTimeout(() => soltarHilo(hijo), 500);
      sinLink(`claude --cloud salió con código ${exitCode ?? "?"} sin dar el link de la sesión`);
    });
    if (senal?.aborted) cortar();
    else senal?.addEventListener?.("abort", cortar, { once: true });
  });
}

/**
 * Lanza la sesión de la nube desde `cwd` (un worktree en la rama ya empujada) con la instrucción `prompt`.
 * `claude -p --cloud` NO sirve: la CLI lo rechaza ("--cloud cannot be combined with --print … interactive only").
 * Por eso "auto" y "pty" van directo a la terminal real (node-pty). "sin-terminal" deja el intento con -p (por si
 * una versión futura lo acepta; las pruebas lo usan con un claude falso).
 * Devuelve { link, via, salida, modeloForzado }. Lanza ErrorDeEtapa (límite de uso, o sin forma de lanzarlo).
 */
export async function lanzarEnNube(contexto, { cwd, prompt, modelo = null, repo = null }) {
  const { config } = contexto;
  // El chequeo previo (29-oct-2026): la CLI escribe su log en este archivo y se mira si conectó el repo.
  const depuracion = config.nube.chequeoPrevio === false ? null : archivoDeDepuracion(cwd);
  if (depuracion) borrarSiHay(depuracion);
  try {
    const lanzado = await lanzarConLaCli(contexto, { cwd, prompt, modelo, depuracion });
    if (!depuracion) return lanzado;
    let linea = lanzado.sinRepo ?? lineaSinRepo(leerSiHay(depuracion));
    // El link puede llegar antes de que la CLI termine de escribir su log: se mira un momento más.
    for (let i = 0; !linea && lanzado.link && i < 5 && fs.existsSync(depuracion); i += 1) {
      await new Promise((resolver) => setTimeout(resolver, 200));
      linea = lineaSinRepo(leerSiHay(depuracion));
    }
    if (!linea) return lanzado;
    throw errorSinAccesoAlRepo(repo, {
      detalle: `\`claude --cloud\` no conectó el repo (su log dice: "${linea}"): subió una copia sin remoto y esa sesión no podría subir la rama.`,
      link: lanzado.link,
      extra: lanzado.link ? "Esa sesión quedó creada SIN el repo: no hará nada útil; ciérrala en claude.ai si sigue abierta." : "Se cortó antes de crear la sesión.",
    });
  } finally {
    if (depuracion) borrarSiHay(depuracion);
  }
}

/** `claude --cloud` (terminal real o -p). -> { link, via, salida, modeloForzado, sinRepo? }. */
async function lanzarConLaCli(contexto, { cwd, prompt, modelo = null, depuracion = null }) {
  const { config, senal, registro } = contexto;
  const base = config.nube.comandoClaude ?? config.comandoClaude;
  const timeoutMs = Math.max(1000, config.nube.lanzarMinutos * MINUTO);
  if (config.nube.terminal !== "sin-terminal") {
    return lanzarConTerminalReal(contexto, { cwd, prompt, base, modelo, timeoutMs, depuracion, antes: "claude -p --cloud no se intenta: la CLI no deja --cloud con --print." });
  }
  // El modelo va explícito con --model (la misma regla fija que en aizen1). Si esta versión de `--cloud` no lo
  // acepta, se lanza sin él (el prompt ya trae el modelo pedido) y la tarjeta lo dice (modeloForzado: false).
  let aceptaModelo = Boolean(modelo);
  const lanzar = (conModelo) =>
    correr([...base, "-p", "--cloud", ...(conModelo ? ["--model", modelo] : []), "--output-format", "json", ...(depuracion ? ["--debug-file", depuracion] : [])], {
      cwd,
      entrada: prompt,
      timeoutMs,
      senal,
      env: entornoSeguro(),
    });
  let resultado = await lanzar(Boolean(modelo));
  const salidaDelIntento = () => `${resultado.errores}\n${resultado.salida}`;
  if (modelo && !resultado.cancelado && !linkDeSesion(salidaDelIntento()) && NO_ACEPTA_MODELO.test(salidaDelIntento())) {
    registro?.aviso?.("claude --cloud no deja elegir modelo con --model: lo lanzo sin él (el modelo va pedido en el prompt)");
    resultado = await lanzar(false);
    aceptaModelo = false;
  }
  if (resultado.cancelado) throw new ErrorDeEtapa("Se canceló el lanzamiento en la nube: la tarjeta venció en el CRM.", { categoria: "coordinador_cortado" });
  const texto = sinColores(`${resultado.errores}\n${resultado.salida}`);
  const link = linkDeSesion(texto);
  if (link) return { link, via: "sin-terminal", salida: texto, modeloForzado: aceptaModelo };
  // Sin link pero con el log diciendo que no conectó el repo: es eso (no "sin terminal").
  const sinRepo = depuracion ? lineaSinRepo(leerSiHay(depuracion)) : null;
  if (sinRepo) return { link: null, via: "sin-terminal", salida: texto, modeloForzado: aceptaModelo, sinRepo };
  if (esLimiteDeUso(texto)) {
    throw new ErrorDeEtapa(`Claude llegó a su límite de uso al lanzar en la nube: ${ultimasLineas(texto, 5)}`, { limiteDeUso: true, motor: "claude" });
  }
  const antes = `claude -p --cloud ${resultado.vencido ? "no contestó a tiempo" : `salió con código ${resultado.codigo} sin dar el link de la sesión`}:\n${ultimasLineas(texto, 15)}`;
  throw new ErrorDeEtapa(mensajeSinTerminal(antes), { categoria: "otra" });
}

/* ───────────────────────────────────────────────────────── sin acceso al repo: la marca por proyecto ── */

/** clave del proyecto -> { hasta, motivo }: mientras dure, ese proyecto no se manda a la nube. Vive en memoria. */
const SIN_ACCESO = new Map();

/** Marca el proyecto `clave` sin acceso a la nube por `minutos` (0 = no marca). */
export function marcarSinAcceso(clave, motivo, minutos, ahora = Date.now()) {
  if (!clave || !(Number(minutos) > 0)) return;
  SIN_ACCESO.set(clave, { hasta: ahora + Number(minutos) * MINUTO, motivo: String(motivo ?? "").split(/\r?\n/)[0] });
}

/** ¿El proyecto `clave` está marcado sin acceso a la nube ahora? -> { hasta, motivo } o null (la marca vencida se borra). */
export function sinAccesoALaNube(clave, ahora = Date.now()) {
  const marca = SIN_ACCESO.get(clave);
  if (!marca) return null;
  if (marca.hasta <= ahora) {
    SIN_ACCESO.delete(clave);
    return null;
  }
  return marca;
}

/** Borra la marca de un proyecto (o todas, sin clave). Para las pruebas y para cuando el dueño lo arregla y reinicia. */
export function olvidarSinAcceso(clave = null) {
  if (clave) SIN_ACCESO.delete(clave);
  else SIN_ACCESO.clear();
}

/** El ErrorDeEtapa nube_sin_acceso_repo: "La nube no tiene acceso al repo …" + el detalle y el link (si hay). */
export function errorSinAccesoAlRepo(repo, { detalle, link = null, extra = "" }) {
  const nombre = repo?.github ?? repo?.clave ?? "el repo";
  return new ErrorDeEtapa(
    [`La nube no tiene acceso al repo ${nombre}: ${detalle}`, extra, link ? `Sesión de la nube: ${link}` : ""].filter(Boolean).join("\n"),
    { categoria: "nube_sin_acceso_repo" },
  );
}

/* ───────────────────────────────────────────────────────── la SESIÓN FIJA del proyecto ── */

/*
 * 29-oct-2026 (decisión del dueño): un proyecto puede tener una sesión de la nube FIJA (repos.<repo>.nube.sesionFija), creada
 * a mano en claude.ai/code con el repo seleccionado (así sí puede subir su rama). Construir en la nube no crea otra: le manda
 * la instrucción a esa con `claude -p "<instrucción>" --cloud <session_id> --output-format json` (si estaba apagada, el mensaje
 * la despierta; lo que corría cuando se apagó no se recupera). Antes de cada tarea le manda `/clear` por la misma vía. Una sola
 * tarea a la vez por sesión fija (bucle.mjs: las demás del proyecto esperan en la fila).
 */

/** El id de la sesión fija de un proyecto ("session_…"), o null. */
export const sesionFijaDe = (repo) => repo?.nube?.sesionFija ?? null;

/** Cómo se llama el proyecto para el dueño: el nombre de su agente sin "Agente" ("Gestión"), o su clave. */
export function nombreDelProyecto(repo) {
  const nombre = String(repo?.agente?.nombre ?? "").replace(/^agente\s+/i, "").trim();
  return nombre || repo?.clave || "el proyecto";
}

/** El link de la sesión que contesta `claude -p … --cloud <id> --output-format json` ({ ok, session_id, url }), o null. */
export function linkDeLaSesionFija(datos, id) {
  const url = typeof datos?.url === "string" ? datos.url : "";
  if (/^https:\/\/claude\.ai\/code\//.test(url)) return url;
  const sesion = typeof datos?.session_id === "string" && /^session_[A-Za-z0-9_-]+$/.test(datos.session_id) ? datos.session_id : id;
  return `https://claude.ai/code/${sesion}`;
}

/** El último objeto JSON de la salida de la CLI (la respuesta de --output-format json), o null. */
function jsonDeLaSalida(texto) {
  const lineas = String(texto ?? "").trim().split(/\r?\n/).reverse();
  for (const linea of [String(texto ?? "").trim(), ...lineas]) {
    try {
      const datos = JSON.parse(linea);
      if (datos && typeof datos === "object") return datos;
    } catch {
      // No es JSON: la siguiente.
    }
  }
  return null;
}

/** El ErrorDeEtapa "la sesión fija de <proyecto> no responde" (nube_sin_acceso_repo: no se repara sola). */
function errorSesionFija(repo, detalle) {
  const github = repo?.github ?? repo?.clave ?? "el repo";
  return new ErrorDeEtapa(
    `La sesión fija de ${nombreDelProyecto(repo)} no responde (la nube no tiene acceso al repo ${github}): ${detalle}\nSesión fija: https://claude.ai/code/${sesionFijaDe(repo)}`,
    { categoria: "nube_sin_acceso_repo" },
  );
}

/** Un mensaje a la sesión fija. -> { ok, link, texto } o lanza ErrorDeEtapa (cancelada, límite de uso, no responde). */
async function mensajeASesionFija(contexto, repo, mensaje, { cwd }) {
  const { config, senal } = contexto;
  const base = config.nube.comandoClaude ?? config.comandoClaude;
  const id = sesionFijaDe(repo);
  const timeoutMs = Math.max(1000, config.nube.lanzarMinutos * MINUTO);
  const resultado = await correr([...base, "-p", mensaje, "--cloud", id, "--output-format", "json"], { cwd, timeoutMs, senal, env: entornoSeguro() });
  if (resultado.cancelado) throw new ErrorDeEtapa("Se canceló el lanzamiento en la nube: la tarjeta venció en el CRM.", { categoria: "coordinador_cortado" });
  const texto = sinColores(`${resultado.salida}\n${resultado.errores}`);
  const datos = jsonDeLaSalida(resultado.salida);
  if (resultado.codigo === 0 && datos && datos.ok !== false && !datos.is_error) return { link: linkDeLaSesionFija(datos, id), texto };
  if (esLimiteDeUso(texto)) throw new ErrorDeEtapa(`Claude llegó a su límite de uso al escribirle a la sesión fija: ${ultimasLineas(texto, 5)}`, { limiteDeUso: true, motor: "claude" });
  const porQue = resultado.vencido ? `no contestó en ${config.nube.lanzarMinutos} min` : `salió con código ${resultado.codigo}${datos?.ok === false ? " (ok: false)" : ""}`;
  throw errorSesionFija(repo, `\`claude -p … --cloud ${id}\` ${porQue}. ${ultimasLineas(texto, 8).replace(/\s+/g, " ").trim()}`.trim());
}

/**
 * Manda una tarea a la sesión fija del proyecto: primero `/clear` (contexto limpio), después la instrucción.
 * -> { link, via: "sesion-fija", salida, modeloForzado: false } (el modelo de la sesión lo fija quien la creó; el prompt lo pide).
 */
export async function mandarASesionFija(contexto, { repo, cwd, prompt }) {
  const { registro } = contexto;
  const id = sesionFijaDe(repo);
  registro?.info?.(`nube por sesión fija: ${id} (${nombreDelProyecto(repo)}): /clear y la tarea`);
  await mensajeASesionFija(contexto, repo, "/clear", { cwd });
  const descripcion = descripcionParaLaNube(prompt);
  if (descripcion.length < String(prompt ?? "").length) registro?.aviso?.(`sesión fija: la instrucción tenía ${String(prompt).length} caracteres; la recorté a ${descripcion.length} (el plan, por el medio)`);
  const { link, texto } = await mensajeASesionFija(contexto, repo, descripcion, { cwd });
  return { link, via: "sesion-fija", salida: texto, modeloForzado: false };
}

/**
 * Lanza la sesión de la nube de una tarjeta: a la sesión fija del proyecto si la tiene; si no, `claude --cloud` con el chequeo
 * previo. Si la nube no tiene acceso al repo (nube_sin_acceso_repo), marca el proyecto por config.nube.sinAccesoMinutos.
 */
export async function lanzarSesionDeLaNube(contexto, { repo, cwd, prompt, modelo = null }) {
  try {
    if (sesionFijaDe(repo)) return await mandarASesionFija(contexto, { repo, cwd, prompt });
    return await lanzarEnNube(contexto, { cwd, prompt, modelo, repo });
  } catch (error) {
    if (error?.categoria === "nube_sin_acceso_repo") {
      const minutos = contexto.config.nube.sinAccesoMinutos ?? 60;
      marcarSinAcceso(repo?.clave, error.message, minutos);
      contexto.registro?.aviso?.(`${String(error.message).split(/\r?\n/)[0]} — no mando tarjetas de "${repo?.clave}" a la nube en ${minutos} min`);
    }
    throw error;
  }
}

/* ───────────────────────────────────────────────────────── vigilar la rama en GitHub ── */

/** "dueño/repo" en GitHub: el que dice la configuración o el del remoto. */
export async function repoDeGithub(repo) {
  if (repo.github) return repo.github;
  const web = webDeGithub(await urlDelRemoto(repo));
  const coincide = web?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/);
  if (!coincide) throw new ErrorDeEtapa(`No sé cuál es el repo de GitHub de "${repo.clave}": pon repos.${repo.clave}.github ("dueño/repo") en config.local.json.`);
  return coincide[1];
}

/** Los commits de la rama en GitHub, del más nuevo al más viejo: { commits: [{ sha, mensaje }], error }. */
export async function commitsDeLaRama(contexto, repo, rama) {
  const { config, senal } = contexto;
  const github = await repoDeGithub(repo);
  const comando = [...config.nube.comandoGh, "api", `repos/${github}/commits?sha=${encodeURIComponent(rama)}&per_page=30`, "--jq", ".[] | {sha: .sha, mensaje: .commit.message}"];
  const resultado = await correr(comando, { cwd: repo.ruta, timeoutMs: 60_000, senal });
  if (resultado.cancelado) throw new ErrorDeEtapa("Se canceló la espera de la nube: la tarjeta venció en el CRM.", { categoria: "coordinador_cortado" });
  if (resultado.codigo !== 0) return { commits: [], error: ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 5) || `gh salió con código ${resultado.codigo}` };
  const commits = [];
  for (const linea of resultado.salida.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    try {
      const dato = JSON.parse(linea);
      if (typeof dato?.sha === "string") commits.push({ sha: dato.sha, mensaje: String(dato.mensaje ?? "") });
    } catch {
      // Una línea que no es JSON no es un commit.
    }
  }
  return { commits, error: null };
}

/**
 * Lee la línea "resultado: build=OK|FALLO tests=OK|FALLO segundos=N [revision=OK|FALLO revisor=<x> motivo=<…>]" de un
 * mensaje de commit. Lo que sigue (el cuerpo) es el detalle: en un FALLO, las últimas 30 líneas del error; con la
 * revisión, una línea por revisor. null si no es un commit de resultado.
 * La revisión (29-oct-2026, revisores.mjs) es opcional: una sesión vieja sin `revision=` sigue valiendo como antes (sin
 * los campos). Con ella: { revision: "OK"|"FALLO", revisor, motivoRevision }.
 */
export function resultadoDelCommit(mensaje) {
  const [primera = "", ...resto] = String(mensaje ?? "").split(/\r?\n/);
  const coincide = primera.trim().match(/^resultado:\s*build=([A-Za-zÓó]+)\s+tests=([A-Za-zÓó]+)(?:\s+segundos=(\d+))?/i);
  if (!coincide) return null;
  const build = coincide[1].toUpperCase();
  const tests = coincide[2].toUpperCase();
  const resultado = { build, tests, segundos: coincide[3] === undefined ? null : Number(coincide[3]), paso: build === "OK" && tests === "OK", detalle: resto.join("\n").trim() };
  const revision = primera.match(/\brevisi[oó]n=([A-Za-z]+)/i);
  if (!revision) return resultado;
  const estado = revision[1].toUpperCase() === "OK" ? "OK" : "FALLO";
  const revisor = primera.match(/\brevisor=["'<]?([^\s"'>]+)/i)?.[1] ?? null;
  const motivo = primera.match(/\bmotivo=(.+)$/i)?.[1]?.trim().replace(/^["'<]|["'>]$/g, "").trim() || null;
  return { ...resultado, revision: estado, revisor: estado === "FALLO" ? revisor : null, motivoRevision: estado === "FALLO" ? motivo : null };
}

const dormir = (ms, senal) =>
  new Promise((resolver) => {
    const alAbortar = () => {
      clearTimeout(reloj);
      resolver();
    };
    const reloj = setTimeout(() => {
      senal?.removeEventListener?.("abort", alAbortar);
      resolver();
    }, ms);
    senal?.addEventListener?.("abort", alAbortar, { once: true });
  });

/**
 * La pregunta de un commit vacío "pregunta: <la pregunta en una línea>" (29-oct-2026): la sesión de la nube no pregunta en
 * el chat (nadie la lee), deja este commit y termina. null si el commit no es una pregunta (o viene vacía).
 */
export function preguntaDelCommit(mensaje) {
  const primera = String(mensaje ?? "").split(/\r?\n/)[0].trim();
  const coincide = primera.match(/^pregunta:\s*(.+)$/i);
  return coincide ? coincide[1].trim() || null : null;
}

/** ¿Es el commit vacío "inicio: …" que la sesión de la nube deja en sus primeros minutos (la señal de que arrancó)? */
export const esCommitDeInicio = (mensaje) => /^inicio:/i.test(String(mensaje ?? "").split(/\r?\n/)[0].trim());

/**
 * Espera el commit "resultado:" nuevo (que no estaba en `vistos`) en la rama. Mira cada
 * config.nube.vigilarCadaSegundos; no pasa de config.nube.esperaMinutos ni del reloj de la etapa.
 * 29-oct-2026 (4 sesiones de 2 h paradas en una pregunta, sin un commit): ahora también corta antes:
 *   - un commit "pregunta: …" -> error enseguida (nube_pregunta, con la pregunta y el link: no se repara solo);
 *   - ni "inicio:" ni ningún commit nuevo en config.nube.sinSenalMinutos -> error (nube_sin_resultado, con el link);
 *   - un commit "revision: R<n> …" (el progreso de los 4 revisores) va al panel con contexto.fase("revisando") y es señal;
 *   - con señal pero sin "resultado:" al vencer la espera larga -> nube_sin_resultado (antes tiempo_agotado, que se reparaba solo).
 * Devuelve { build, tests, segundos, paso, detalle, sha, mensaje }.
 */
export async function esperarResultado(contexto, { repo, rama, vistos, reloj, link }) {
  const { config, senal, registro } = contexto;
  const inicio = Date.now();
  const limite = inicio + config.nube.esperaMinutos * MINUTO;
  const sinSenalMinutos = config.nube.sinSenalMinutos ?? config.nube.esperaMinutos;
  const limiteSinSenal = inicio + sinSenalMinutos * MINUTO;
  const mirala = link ? ` Mírala: ${link}` : "";
  let ultimoFallo = "";
  let huboSenal = false;
  let progresoVisto = null;
  for (;;) {
    if (senal?.aborted) throw new ErrorDeEtapa("Se canceló la espera de la nube: la tarjeta venció en el CRM.", { categoria: "coordinador_cortado" });
    reloj.resta();
    const { commits, error } = await commitsDeLaRama(contexto, repo, rama);
    if (error) {
      if (error !== ultimoFallo) registro?.aviso?.(`no pude mirar la rama ${rama} en GitHub (sigo esperando): ${String(error).split("\n")[0]}`);
      ultimoFallo = error;
    } else {
      ultimoFallo = "";
      // Del más nuevo al más viejo: lo último que dejó la sesión manda (un "resultado:" después de una pregunta vale).
      for (const commit of commits) {
        if (vistos.has(commit.sha)) continue;
        if (!huboSenal) registro?.info?.(`la nube dio señal en la rama ${rama}: ${String(commit.mensaje).split(/\r?\n/)[0].slice(0, 120)}`);
        huboSenal = true;
        const resultado = resultadoDelCommit(commit.mensaje);
        if (resultado) return { ...resultado, sha: commit.sha, mensaje: commit.mensaje };
        const pregunta = preguntaDelCommit(commit.mensaje);
        if (pregunta) {
          throw new ErrorDeEtapa(`La sesión de la nube hizo una pregunta y paró: ${pregunta}.${mirala}`, { categoria: "nube_pregunta" });
        }
        // 29-oct-2026: el progreso de la revisión de los 4 ("revision: R1 seguridad=OK …"): el más nuevo va al panel (latido).
        // Como cualquier commit nuevo, también cuenta como señal para el corte sin señal.
        const progreso = progresoDelCommit(commit.mensaje);
        if (progreso) {
          if (progresoVisto !== commit.sha) {
            progresoVisto = commit.sha;
            contexto.fase?.("revisando", { lugar: "nube", revision: progreso });
            registro?.info?.(`la nube revisa (R${progreso.vuelta}): ${Object.entries(progreso.revisores).map(([clave, estado]) => `${clave}=${estado}`).join(" ")}`);
          }
          break;
        }
      }
    }
    if (!huboSenal && !error && Date.now() >= limiteSinSenal) {
      throw new ErrorDeEtapa(`La sesión de la nube no dio señal (ni el commit "inicio:" ni ningún otro) en la rama ${rama} en ${sinSenalMinutos} min: se cortó la espera.${mirala}`, {
        categoria: "nube_sin_resultado",
      });
    }
    if (Date.now() >= limite) {
      throw new ErrorDeEtapa(
        `La sesión de la nube no dejó el commit "resultado:" en la rama ${rama} en ${config.nube.esperaMinutos} min (¿se quedó pensando o hizo una pregunta?).${mirala}`,
        { categoria: "nube_sin_resultado" },
      );
    }
    const proximo = huboSenal ? limite : Math.min(limite, limiteSinSenal);
    await dormir(Math.min(config.nube.vigilarCadaSegundos * 1000, Math.max(50, proximo - Date.now())), senal);
  }
}
