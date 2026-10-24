// Correr un comando del trabajador con tiempo máximo: si se pasa (o se cancela), se mata el proceso
// CON sus hijos (en Windows, taskkill /T; en Linux/Mac, el grupo del proceso). Nunca usa la shell:
// los argumentos van tal cual (sin problemas de comillas) y lo largo (el prompt, el SQL) va por stdin.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ES_WINDOWS = process.platform === "win32";

/*
  En Windows, `npm`, `npx` (y a veces `gh` o `claude` instalados con npm) son archivos .cmd, que no
  arrancan sin la shell. Si el programa se encuentra como .exe se corre directo; si solo existe como
  .cmd/.bat, se corre con `cmd.exe /d /s /c` y cada argumento entre comillas.
*/
const resueltos = new Map();
function comoCorrerEnWindows(programa) {
  if (!ES_WINDOWS || path.isAbsolute(programa) || /\.(exe|com)$/i.test(programa)) return null;
  if (/\.(cmd|bat)$/i.test(programa)) return programa;
  if (!resueltos.has(programa)) {
    const donde = spawnSync("where", [programa], { encoding: "utf8", windowsHide: true });
    const lineas = String(donde.stdout ?? "")
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter(Boolean);
    const exe = lineas.find((linea) => /\.(exe|com)$/i.test(linea));
    const cmd = lineas.find((linea) => /\.(cmd|bat)$/i.test(linea));
    resueltos.set(programa, exe || !cmd ? null : cmd);
  }
  return resueltos.get(programa);
}

const entreComillas = (texto) => `"${String(texto).replace(/"/g, '""')}"`;

function matarArbol(hijo) {
  if (!hijo.pid) return;
  try {
    if (ES_WINDOWS) {
      spawnSync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-hijo.pid, "SIGKILL");
    }
  } catch {
    try {
      hijo.kill("SIGKILL");
    } catch {
      // Ya terminó.
    }
  }
}

/**
 * correr(["git", "status"], { cwd, entrada, timeoutMs, env, senal })
 * -> { codigo, salida, errores, vencido, cancelado, atascado, archivoSalida }   (nunca lanza por código distinto de 0)
 * `senal` es un AbortSignal: si se aborta (el latido dijo que se venció), se mata el proceso.
 * `archivoSalida`: ruta donde se guarda la salida COMPLETA a medida que sale (en memoria queda solo el final).
 * `vigilar`: { cadaMs, revisar(pid) }: si `revisar` devuelve verdadero (sesión quieta), se mata el proceso y
 * el resultado trae `atascado: true`.
 */
export function correr(comando, { cwd, entrada, timeoutMs = 10 * 60_000, env, senal, maximoSalida = 2_000_000, archivoSalida, vigilar } = {}) {
  const [programa, ...argumentos] = comando;
  return new Promise((resolver) => {
    let salida = "";
    let errores = "";
    let vencido = false;
    let cancelado = false;
    let atascado = false;
    let hijo;
    // La salida COMPLETA va a un archivo a medida que sale (lección del 24-oct: el log solo guardó el principio
    // y se perdió la prueba que falló). `salida` en memoria conserva solo el final.
    const guardar = (dato) => {
      if (!archivoSalida) return;
      try {
        fs.appendFileSync(archivoSalida, dato);
      } catch {
        // Un disco lleno no tumba el comando.
      }
    };
    if (archivoSalida) {
      try {
        fs.mkdirSync(path.dirname(archivoSalida), { recursive: true });
        fs.writeFileSync(archivoSalida, "");
      } catch {
        // Sin archivo: sigue solo con lo que hay en memoria.
      }
    }
    const conCmd = comoCorrerEnWindows(programa);
    const opciones = {
      cwd,
      env: env ?? process.env,
      shell: false,
      windowsHide: true,
      detached: !ES_WINDOWS,
      stdio: ["pipe", "pipe", "pipe"],
    };
    try {
      hijo = conCmd
        ? spawn("cmd.exe", ["/d", "/s", "/c", `"${[conCmd, ...argumentos].map(entreComillas).join(" ")}"`], {
            ...opciones,
            windowsVerbatimArguments: true,
          })
        : spawn(programa, argumentos, opciones);
    } catch (error) {
      resolver({ codigo: -1, salida: "", errores: String(error?.message ?? error), vencido: false, cancelado: false });
      return;
    }
    const cortar = (texto) => (texto.length > maximoSalida ? texto.slice(-maximoSalida) : texto);
    hijo.stdout.on("data", (dato) => {
      guardar(dato);
      salida = cortar(salida + dato.toString("utf8"));
    });
    hijo.stderr.on("data", (dato) => {
      guardar(dato);
      errores = cortar(errores + dato.toString("utf8"));
    });
    hijo.stdin.on("error", () => undefined);
    if (entrada !== undefined) hijo.stdin.end(entrada);
    else hijo.stdin.end();

    const reloj = setTimeout(() => {
      vencido = true;
      matarArbol(hijo);
    }, Math.max(1, timeoutMs));
    // Vigilante de sesión quieta: cada `cadaMs` pregunta a `revisar(hijo.pid)`; si dice que está atascada, la corta.
    let vigia = null;
    if (vigilar?.revisar) {
      let revisando = false;
      vigia = setInterval(async () => {
        if (revisando || terminado) return;
        revisando = true;
        try {
          if (await vigilar.revisar(hijo.pid)) {
            atascado = true;
            matarArbol(hijo);
          }
        } catch {
          // Si no se puede medir, no se corta nada.
        } finally {
          revisando = false;
        }
      }, Math.max(1, vigilar.cadaMs ?? 60_000));
      vigia.unref?.();
    }
    const alAbortar = () => {
      cancelado = true;
      matarArbol(hijo);
    };
    if (senal) {
      if (senal.aborted) alAbortar();
      else senal.addEventListener("abort", alAbortar, { once: true });
    }
    let terminado = false;
    const terminar = (codigo, errorExtra = "") => {
      if (terminado) return;
      terminado = true;
      clearTimeout(reloj);
      if (vigia) clearInterval(vigia);
      senal?.removeEventListener?.("abort", alAbortar);
      resolver({ codigo, salida, errores: errores + errorExtra, vencido, cancelado, atascado, archivoSalida: archivoSalida ?? null });
    };
    hijo.on("error", (error) => terminar(-1, `\n${error.message}`));
    hijo.on("close", (codigo) => terminar(codigo ?? -1));
  });
}

/** Una ruta para comparar: minúsculas en Windows, barras iguales y sin barra final. */
const normalizar = (ruta) => {
  const limpia = String(ruta ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  return ES_WINDOWS ? limpia.toLowerCase() : limpia;
};

/**
 * De una lista de procesos [{ pid, ppid, comando }] los que están DENTRO de `carpeta` (su línea de comando
 * nombra la carpeta: node ...\wt\<id>-construir\node_modules\.bin\next, un servidor de pruebas, etc.), sin los
 * `excluir` (el propio Coordinador y sus padres). Pura: se prueba sin procesos de verdad.
 */
export function procesosEnCarpeta(lista, carpeta, excluir = []) {
  const raiz = normalizar(carpeta);
  if (!raiz) return [];
  const prohibidos = new Set(excluir.map(Number));
  return (lista ?? []).filter((proceso) => {
    if (!proceso || prohibidos.has(Number(proceso.pid))) return false;
    const comando = normalizar(proceso.comando);
    return comando.includes(`${raiz}/`) || comando.endsWith(raiz) || comando.includes(`${raiz} `) || comando.includes(`"${raiz}"`);
  });
}

/** Los procesos del sistema: [{ pid, ppid, comando }] (Windows: Get-CimInstance; Linux/Mac: ps). [] si no se pudo leer. */
async function listarProcesos() {
  if (ES_WINDOWS) {
    const resultado = await correr(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"],
      { timeoutMs: 30_000 },
    );
    try {
      const datos = JSON.parse(resultado.salida.trim() || "[]");
      return (Array.isArray(datos) ? datos : [datos]).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, comando: p.CommandLine ?? "" }));
    } catch {
      return [];
    }
  }
  const resultado = await correr(["ps", "-eo", "pid=,ppid=,args="], { timeoutMs: 15_000 });
  return resultado.salida
    .split(/\r?\n/)
    .map((linea) => linea.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, comando]) => ({ pid: Number(pid), ppid: Number(ppid), comando }));
}

/**
 * Cierra (con sus hijos) todo proceso que una sesión dejó corriendo dentro de `carpeta` (un `next build`
 * colgado, un servidor de desarrollo...). Nunca cierra al propio Coordinador ni a sus padres. Devuelve cuántos
 * cerró; nunca lanza (limpiar no puede tumbar la tarjeta).
 */
export async function cerrarProcesosEn(carpeta, { listar = listarProcesos, matar = (pid) => matarArbol({ pid, kill: () => process.kill(pid, "SIGKILL") }) } = {}) {
  try {
    const lista = await listar();
    // El propio Coordinador y toda su cadena de padres (la terminal, la tarea programada...): nunca.
    const padres = new Set();
    for (let pid = process.pid; pid && !padres.has(pid); pid = Number(lista.find((p) => Number(p.pid) === pid)?.ppid) || 0) padres.add(pid);
    const objetivo = procesosEnCarpeta(lista, carpeta, [...padres]);
    for (const proceso of objetivo) matar(Number(proceso.pid));
    return objetivo.length;
  } catch {
    return 0;
  }
}

/** Las últimas `n` líneas de un texto (para mostrar en el motivo de un error o en las pruebas). */
export function ultimasLineas(texto, n = 40) {
  const lineas = String(texto ?? "").trimEnd().split(/\r?\n/);
  return lineas.slice(-n).join("\n");
}

/** Una línea que cuenta una falla de pruebas, compilación o ejecución. */
const LINEA_DE_FALLA = /\bnot ok\b|\bFAIL(?:ED|URE)?\b|\bERR!|\berror\b|\bError:|AssertionError|✖|✗|\bfailed\b|\bfallaron?\b|Unhandled|\bTypeError\b|\bReferenceError\b/i;

/**
 * Las líneas de un texto que cuentan una falla ("not ok", "error", "FAIL"...), cada una con `contexto` líneas
 * de alrededor, en orden y sin repetir. Se queda con lo ÚLTIMO si hay más de `maximo` líneas. Lección del
 * 24-oct-2026: el log solo guardó el principio ("ok ok ok") y se perdió la prueba que falló.
 */
export function lineasQueFallaron(texto, { contexto = 1, maximo = 60 } = {}) {
  const lineas = String(texto ?? "").split(/\r?\n/);
  const elegidas = new Set();
  lineas.forEach((linea, indice) => {
    if (!LINEA_DE_FALLA.test(linea)) return;
    for (let i = Math.max(0, indice - contexto); i <= Math.min(lineas.length - 1, indice + contexto); i += 1) elegidas.add(i);
  });
  const indices = [...elegidas].sort((a, b) => a - b).slice(-maximo);
  const partes = [];
  let anterior = -2;
  for (const i of indices) {
    if (i !== anterior + 1 && partes.length) partes.push("…");
    partes.push(lineas[i]);
    anterior = i;
  }
  return partes.join("\n");
}

/**
 * El detalle de un comando que falló: las líneas que fallaron, las últimas `ultimas` líneas y dónde quedó la
 * salida completa. Las que fallaron van primero (el error se recorta por el final, no por el principio).
 */
export function detalleDeFalla({ salida, errores, archivoSalida } = {}, { ultimas = 60, maximoFallas = 2500 } = {}) {
  const todo = `${errores ?? ""}\n${salida ?? ""}`;
  const fallas = lineasQueFallaron(todo);
  const cola = ultimasLineas(todo, ultimas);
  return [
    fallas ? `Líneas que fallaron:\n${fallas.length > maximoFallas ? `…${fallas.slice(-maximoFallas)}` : fallas}` : "",
    `Últimas ${ultimas} líneas:\n${cola}`,
    archivoSalida ? `Salida completa: ${archivoSalida}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Cómo se ve un comando en un mensaje. */
export const comoTexto = (comando) => comando.map((parte) => (/\s/.test(parte) ? `"${parte}"` : parte)).join(" ");
