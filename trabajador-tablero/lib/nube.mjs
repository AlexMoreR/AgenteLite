// CONSTRUIR EN LA NUBE (25-oct-2026, decisión del dueño): las tareas grandes y las de desborde se construyen en
// una sesión de Claude en una máquina de Anthropic (`claude --cloud`), conectada al repo de GitHub, sin que el
// dueño copie y pegue nada. Acá viven las piezas de esa vía:
//
//   esTareaGrande       la regla de reparto, fija y sin IA (más de 8 archivos, migración, agente nuevo, o ya
//                       falló por tamaño o recursos).
//   lanzarEnNube        corre `claude -p --cloud … --output-format json` (a) y, si pide terminal real, node-pty (b);
//                       lee el link de la sesión (claude.ai/code/session_…). Si ninguna sirve sin que alguien la
//                       toque, lanza un error que dice que se propone GitHub Actions (tarjeta cmvmjh9a504dp2mrpg7cazs8u).
//   esperarResultado    cada minuto mira la RAMA en GitHub (gh api) buscando el commit vacío
//                       "resultado: build=OK|FALLO tests=OK|FALLO segundos=N". NUNCA usa `claude --teleport`.
//
// Lo que se hace con la rama cuando vuelve (verificar, zonas, ensayo, subir) está en etapas.mjs (construirEnNube).
import { archivosDelPlan } from "./choques.mjs";
import { esLimiteDeUso } from "./diagnostico.mjs";
import { ErrorDeEtapa, entornoSeguro } from "./etapas.mjs";
import { urlDelRemoto, webDeGithub } from "./git.mjs";
import { correr, ultimasLineas } from "./procesos.mjs";

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
  return { grande: motivos.length > 0, motivos };
}

/* ───────────────────────────────────────────────────────── lanzar `claude --cloud` ── */

const LINK_DE_SESION = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/;

/** El link de la sesión (claude.ai/code/session_…) que aparece en un texto, o null. */
export const linkDeSesion = (texto) => String(texto ?? "").match(LINK_DE_SESION)?.[0] ?? null;

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

/** (b) La terminal real de Windows (node-pty, instalada solo en trabajador-tablero): escribe la instrucción y lee el link. */
async function lanzarConTerminalReal(contexto, { cwd, prompt, base, timeoutMs, antes }) {
  const { senal, registro } = contexto;
  let pty;
  try {
    pty = await import("node-pty");
  } catch {
    throw new ErrorDeEtapa(mensajeSinTerminal(`${antes}\nnode-pty no está instalado.`), { categoria: "otra" });
  }
  const comando = [...base, "--cloud"];
  const [archivo, argumentos] =
    process.platform === "win32"
      ? ["cmd.exe", ["/d", "/s", "/c", comando.map((parte) => (/\s/.test(parte) ? `"${parte}"` : parte)).join(" ")]]
      : [comando[0], comando.slice(1)];
  registro?.info?.("claude --cloud: lo lanzo con una terminal real (node-pty)");
  return new Promise((resolver, rechazar) => {
    let texto = "";
    let hijo;
    try {
      hijo = (pty.default ?? pty).spawn(archivo, argumentos, { name: "xterm-256color", cols: 200, rows: 50, cwd, env: entornoSeguro() });
    } catch (error) {
      rechazar(new ErrorDeEtapa(mensajeSinTerminal(`${antes}\n${error.message}`), { categoria: "otra" }));
      return;
    }
    let listo = false;
    const terminar = (accion) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      clearTimeout(escribir);
      senal?.removeEventListener?.("abort", cortar);
      try {
        hijo.kill();
      } catch {
        // Ya terminó.
      }
      accion();
    };
    const cortar = () => terminar(() => rechazar(new ErrorDeEtapa("Se canceló el lanzamiento en la nube: la tarjeta venció en el CRM.", { categoria: "coordinador_cortado" })));
    const reloj = setTimeout(
      () => terminar(() => (esLimiteDeUso(texto) ? rechazar(new ErrorDeEtapa(`Claude llegó a su límite de uso al lanzar en la nube: ${ultimasLineas(sinColores(texto), 5)}`, { limiteDeUso: true, motor: "claude" })) : rechazar(new ErrorDeEtapa(mensajeSinTerminal(`${antes}\n${ultimasLineas(sinColores(texto), 15)}`), { categoria: "otra" })))),
      timeoutMs,
    );
    // La instrucción entra como texto pegado (así sus saltos de línea no la mandan a medias) y se manda con Enter.
    const escribir = setTimeout(() => {
      hijo.write(`\u001b[200~${prompt}\u001b[201~`);
      setTimeout(() => hijo.write("\r"), 500);
    }, 4000);
    hijo.onData((dato) => {
      texto += dato;
      const link = linkDeSesion(sinColores(texto));
      if (link) terminar(() => resolver({ link, via: "terminal-real", salida: sinColores(texto) }));
    });
    hijo.onExit(() => terminar(() => rechazar(new ErrorDeEtapa(mensajeSinTerminal(`${antes}\n${ultimasLineas(sinColores(texto), 15)}`), { categoria: "otra" }))));
    if (senal?.aborted) cortar();
    else senal?.addEventListener?.("abort", cortar, { once: true });
  });
}

/**
 * Lanza la sesión de la nube desde `cwd` (un worktree en la rama ya empujada) con la instrucción `prompt`.
 * (a) `claude -p --cloud --output-format json` con la instrucción por stdin; (b) si no sirve, node-pty.
 * Devuelve { link, via, salida }. Lanza ErrorDeEtapa (límite de uso, o sin forma de lanzarlo sin terminal).
 */
export async function lanzarEnNube(contexto, { cwd, prompt }) {
  const { config, senal, registro } = contexto;
  const base = config.nube.comandoClaude ?? config.comandoClaude;
  const timeoutMs = Math.max(1000, config.nube.lanzarMinutos * MINUTO);
  let antes = "";
  if (config.nube.terminal !== "pty") {
    const resultado = await correr([...base, "-p", "--cloud", "--output-format", "json"], { cwd, entrada: prompt, timeoutMs, senal, env: entornoSeguro() });
    if (resultado.cancelado) throw new ErrorDeEtapa("Se canceló el lanzamiento en la nube: la tarjeta venció en el CRM.", { categoria: "coordinador_cortado" });
    const texto = sinColores(`${resultado.errores}\n${resultado.salida}`);
    const link = linkDeSesion(texto);
    if (link) return { link, via: "sin-terminal", salida: texto };
    if (esLimiteDeUso(texto)) {
      throw new ErrorDeEtapa(`Claude llegó a su límite de uso al lanzar en la nube: ${ultimasLineas(texto, 5)}`, { limiteDeUso: true, motor: "claude" });
    }
    antes = `claude -p --cloud ${resultado.vencido ? "no contestó a tiempo" : `salió con código ${resultado.codigo} sin dar el link de la sesión`}:\n${ultimasLineas(texto, 15)}`;
    if (config.nube.terminal === "sin-terminal") throw new ErrorDeEtapa(mensajeSinTerminal(antes), { categoria: "otra" });
    registro?.aviso?.(`claude -p --cloud no sirvió (${String(antes).split("\n")[0]}): pruebo con una terminal real`);
  }
  return lanzarConTerminalReal(contexto, { cwd, prompt, base, timeoutMs, antes });
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
 * Lee la línea "resultado: build=OK|FALLO tests=OK|FALLO segundos=N" de un mensaje de commit. Lo que sigue (el
 * cuerpo) es el detalle: en un FALLO, las últimas 30 líneas del error. null si no es un commit de resultado.
 */
export function resultadoDelCommit(mensaje) {
  const [primera = "", ...resto] = String(mensaje ?? "").split(/\r?\n/);
  const coincide = primera.trim().match(/^resultado:\s*build=([A-Za-zÓó]+)\s+tests=([A-Za-zÓó]+)(?:\s+segundos=(\d+))?/i);
  if (!coincide) return null;
  const build = coincide[1].toUpperCase();
  const tests = coincide[2].toUpperCase();
  return { build, tests, segundos: coincide[3] === undefined ? null : Number(coincide[3]), paso: build === "OK" && tests === "OK", detalle: resto.join("\n").trim() };
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
 * Espera el commit "resultado:" nuevo (que no estaba en `vistos`) en la rama. Mira cada
 * config.nube.vigilarCadaSegundos; no pasa de config.nube.esperaMinutos ni del reloj de la etapa.
 * Devuelve { build, tests, segundos, paso, detalle, sha, mensaje }.
 */
export async function esperarResultado(contexto, { repo, rama, vistos, reloj, link }) {
  const { config, senal, registro } = contexto;
  const limite = Date.now() + config.nube.esperaMinutos * MINUTO;
  let ultimoFallo = "";
  for (;;) {
    if (senal?.aborted) throw new ErrorDeEtapa("Se canceló la espera de la nube: la tarjeta venció en el CRM.", { categoria: "coordinador_cortado" });
    reloj.resta();
    const { commits, error } = await commitsDeLaRama(contexto, repo, rama);
    if (error) {
      if (error !== ultimoFallo) registro?.aviso?.(`no pude mirar la rama ${rama} en GitHub (sigo esperando): ${String(error).split("\n")[0]}`);
      ultimoFallo = error;
    } else {
      ultimoFallo = "";
      for (const commit of commits) {
        if (vistos.has(commit.sha)) continue;
        const resultado = resultadoDelCommit(commit.mensaje);
        if (resultado) return { ...resultado, sha: commit.sha, mensaje: commit.mensaje };
      }
    }
    if (Date.now() >= limite) {
      throw new ErrorDeEtapa(
        `La sesión de la nube no dejó el commit "resultado:" en la rama ${rama} en ${config.nube.esperaMinutos} min (¿se quedó pensando o hizo una pregunta?).${link ? ` Mírala: ${link}` : ""}`,
        { categoria: "tiempo_agotado" },
      );
    }
    await dormir(Math.min(config.nube.vigilarCadaSegundos * 1000, Math.max(50, limite - Date.now())), senal);
  }
}
