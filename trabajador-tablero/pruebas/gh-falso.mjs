// Un `gh` FALSO para las pruebas (subida.ciBuscar / ciEsperar): "buscar <commit>" contesta una corrida y
// "esperar <corrida>" termina bien. Anota cada llamada en GH_FALSO_LOG. No habla con GitHub.
// "api repos/<dueño>/<repo>/commits?sha=<rama>…" (nube.comandoGh, 25-oct-2026) contesta los commits de esa rama del
// repo "remoto" de la prueba (GH_FALSO_REMOTO), uno por línea: {"sha":"…","mensaje":"…"}, del más nuevo al más viejo.
// GH_FALSO_MODO (ciDeRama, 26-oct-2026): "pasa" (por defecto) | "falla" (la corrida termina mal y "log" trae el log de un paso
// fallido, como `gh run view --log-failed`) | "sin-corrida" ("buscar" no encuentra ninguna: escribe "null", como el --jq real).
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [accion, valor] = process.argv.slice(2);
if (process.env.GH_FALSO_LOG) fs.appendFileSync(process.env.GH_FALSO_LOG, `${JSON.stringify({ accion, valor })}\n`);
const modo = process.env.GH_FALSO_MODO ?? "pasa";
if (accion === "buscar") console.log(modo === "sin-corrida" ? "null" : "4242");
else if (accion === "esperar") {
  if (modo === "falla") {
    console.error(`corrida ${valor}: completed failure`);
    process.exit(1);
  }
  console.log(`corrida ${valor}: completed success`);
} else if (accion === "log") {
  // "trabajo<TAB>paso<TAB>hora texto": 40 líneas de un paso "Build" que falla (para ver que llegan la que falló y las últimas 30).
  const paso = process.env.GH_FALSO_PASO ?? "Build";
  for (let i = 1; i <= 40; i += 1) console.log(`verificar\t${paso}\t2026-10-26T10:00:${String(i).padStart(2, "0")}.0000000Z ${i === 5 ? "error TS2322: el tipo no calza en la corrida" : `línea ${i} del log`}`);
} else if (accion === "api") {
  const rama = decodeURIComponent(String(valor).match(/[?&]sha=([^&]+)/)?.[1] ?? "");
  let texto;
  try {
    texto = execFileSync("git", ["--git-dir", process.env.GH_FALSO_REMOTO, "log", `refs/heads/${rama}`, "-n", "30", "--format=%H%x1f%B%x1e"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    console.error("gh: Not Found (HTTP 404)");
    process.exit(1);
  }
  for (const registro of texto.split("\x1e")) {
    const [sha, mensaje] = registro.split("\x1f");
    if (sha?.trim()) console.log(JSON.stringify({ sha: sha.trim(), mensaje: String(mensaje ?? "").trim() }));
  }
} else process.exit(2);
