// Un `gh` FALSO para las pruebas (subida.ciBuscar / ciEsperar): "buscar <commit>" contesta una corrida y
// "esperar <corrida>" termina bien. Anota cada llamada en GH_FALSO_LOG. No habla con GitHub.
// "api repos/<dueño>/<repo>/commits?sha=<rama>…" (nube.comandoGh, 25-oct-2026) contesta los commits de esa rama del
// repo "remoto" de la prueba (GH_FALSO_REMOTO), uno por línea: {"sha":"…","mensaje":"…"}, del más nuevo al más viejo.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [accion, valor] = process.argv.slice(2);
if (process.env.GH_FALSO_LOG) fs.appendFileSync(process.env.GH_FALSO_LOG, `${JSON.stringify({ accion, valor })}\n`);
if (accion === "buscar") console.log("4242");
else if (accion === "esperar") console.log(`corrida ${valor}: completed success`);
else if (accion === "api") {
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
