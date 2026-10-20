// Correr un comando del trabajador con tiempo máximo: si se pasa (o se cancela), se mata el proceso
// CON sus hijos (en Windows, taskkill /T; en Linux/Mac, el grupo del proceso). Nunca usa la shell:
// los argumentos van tal cual (sin problemas de comillas) y lo largo (el prompt, el SQL) va por stdin.
import { spawn, spawnSync } from "node:child_process";
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
 * -> { codigo, salida, errores, vencido, cancelado }   (nunca lanza por código distinto de 0)
 * `senal` es un AbortSignal: si se aborta (el latido dijo que se venció), se mata el proceso.
 */
export function correr(comando, { cwd, entrada, timeoutMs = 10 * 60_000, env, senal, maximoSalida = 2_000_000 } = {}) {
  const [programa, ...argumentos] = comando;
  return new Promise((resolver) => {
    let salida = "";
    let errores = "";
    let vencido = false;
    let cancelado = false;
    let hijo;
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
    hijo.stdout.on("data", (dato) => (salida = cortar(salida + dato.toString("utf8"))));
    hijo.stderr.on("data", (dato) => (errores = cortar(errores + dato.toString("utf8"))));
    hijo.stdin.on("error", () => undefined);
    if (entrada !== undefined) hijo.stdin.end(entrada);
    else hijo.stdin.end();

    const reloj = setTimeout(() => {
      vencido = true;
      matarArbol(hijo);
    }, Math.max(1, timeoutMs));
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
      senal?.removeEventListener?.("abort", alAbortar);
      resolver({ codigo, salida, errores: errores + errorExtra, vencido, cancelado });
    };
    hijo.on("error", (error) => terminar(-1, `\n${error.message}`));
    hijo.on("close", (codigo) => terminar(codigo ?? -1));
  });
}

/** Las últimas `n` líneas de un texto (para mostrar en el motivo de un error o en las pruebas). */
export function ultimasLineas(texto, n = 40) {
  const lineas = String(texto ?? "").trimEnd().split(/\r?\n/);
  return lineas.slice(-n).join("\n");
}

/** Cómo se ve un comando en un mensaje. */
export const comoTexto = (comando) => comando.map((parte) => (/\s/.test(parte) ? `"${parte}"` : parte)).join(" ");
