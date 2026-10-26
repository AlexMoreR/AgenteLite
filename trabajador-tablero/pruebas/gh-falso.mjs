// Un `gh` FALSO para las pruebas (subida.ciBuscar / ciEsperar): "buscar <commit>" contesta una corrida y
// "esperar <corrida>" termina bien. Anota cada llamada en GH_FALSO_LOG. No habla con GitHub.
// "api repos/<dueño>/<repo>/commits?sha=<rama>…" (nube.comandoGh, 25-oct-2026) contesta los commits de esa rama del
// repo "remoto" de la prueba (GH_FALSO_REMOTO), uno por línea: {"sha":"…","mensaje":"…"}, del más nuevo al más viejo.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [accion, valor] = process.argv.slice(2);
if (process.env.GH_FALSO_LOG) fs.appendFileSync(process.env.GH_FALSO_LOG, `${JSON.stringify({ accion, valor })}\n`);
// ciDeRama (Actions revisa la rama): "buscar-rama" contesta la corrida 7001; "buscar-nada" no encuentra corrida (escribe "null",
// como `--jq .[0].databaseId` con la lista vacía); "esperar-falla" termina con error; "log" trae el log del paso fallido
// ("<job>\t<paso>\t<hora> texto", como `gh run view --log-failed`): el paso lo da el argumento "build" (por defecto) o "pruebas".
if (accion === "buscar") console.log("4242");
else if (accion === "buscar-rama") console.log("7001");
else if (accion === "buscar-nada") console.log("null");
else if (accion === "esperar-falla") {
  console.log(`corrida ${valor}: completed failure`);
  process.exit(1);
} else if (accion === "log") {
  const paso = process.argv[4] === "pruebas" ? "Pruebas" : "Build";
  const lineas = paso === "Build" ? ["> next build", "Type error: Property 'colorFalso' does not exist on type 'Tarjeta'", "ERROR: build fallo en src/falso.ts"] : ["not ok 7 - la prueba falsa", "AssertionError: esperaba 1 y llegó 2"];
  for (const linea of lineas) console.log(`pruebas\t${paso}\t2026-10-26T10:00:00.0000000Z ${linea}`);
} else if (accion === "esperar") console.log(`corrida ${valor}: completed success`);
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
