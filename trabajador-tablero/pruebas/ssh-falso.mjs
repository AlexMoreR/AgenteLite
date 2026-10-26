// Un `ssh` FALSO para las pruebas (config ssh.comando): no se conecta a nada. Hace de servidor con dos
// bases ("postgres" y "magilus"; solo "magilus" tiene la tabla guía) y anota cada llamada (destino,
// comando remoto y lo que llegó por stdin) en SSH_FALSO_LOG. Un ensayo con FALLA_PROD falla como psql.
import fs from "node:fs";

const [destino, remoto] = process.argv.slice(2);
let entrada = "";
for await (const pedazo of process.stdin) entrada += pedazo;
if (process.env.SSH_FALSO_LOG) fs.appendFileSync(process.env.SSH_FALSO_LOG, `${JSON.stringify({ destino, remoto, entrada })}\n`);

if (entrada.includes("FROM pg_database")) {
  console.log("postgres\nmagilus");
} else if (entrada.includes("to_regclass")) {
  console.log(remoto.includes("-d magilus") ? "t" : "f");
} else if (remoto.startsWith("docker inspect")) {
  // Vigilancia de después de subir: el contenedor corre (SSH_FALSO_CAIDO = se cayó) y no se reinicia.
  console.log(process.env.SSH_FALSO_CAIDO ? "false 0" : "true 0");
} else if (remoto.startsWith("docker logs")) {
  // La 1.ª lectura es la de antes de subir; SSH_FALSO_ERRORES_NUEVOS (= cuántas líneas tenía este log al empezar la prueba)
  // hace salir un error desde la 2.ª lectura (ya subió).
  const desde = Number(process.env.SSH_FALSO_ERRORES_NUEVOS) || 0;
  const lecturas = fs.existsSync(process.env.SSH_FALSO_LOG ?? "") ? fs.readFileSync(process.env.SSH_FALSO_LOG, "utf8").split("\n").filter(Boolean).slice(desde).filter((l) => l.includes("docker logs")).length : 1;
  if (process.env.SSH_FALSO_ERRORES_VIEJOS) console.log("2026-10-26T09:00:00Z Error: conexión vieja que ya salía antes");
  if (process.env.SSH_FALSO_ERRORES_NUEVOS !== undefined && lecturas >= 2) console.log("2026-10-26T10:00:00Z Error: se rompió algo nuevo");
  console.log("2026-10-26T10:00:00Z GET /api/health 200");
} else if (entrada.includes("FALLA_PROD")) {
  console.error('psql:<stdin>:4: ERROR:  relation "FALLA_PROD" does not exist');
  process.exit(3);
}
