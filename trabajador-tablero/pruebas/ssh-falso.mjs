// Un `ssh` FALSO para las pruebas (config ssh.comando): no se conecta a nada. Hace de servidor con dos
// bases ("postgres" y "magilus"; solo "magilus" tiene la tabla guía) y anota cada llamada (destino,
// comando remoto y lo que llegó por stdin) en SSH_FALSO_LOG. Un ensayo con FALLA_PROD falla como psql.
import fs from "node:fs";

const [destino, remoto] = process.argv.slice(2);
let entrada = "";
for await (const pedazo of process.stdin) entrada += pedazo;
if (process.env.SSH_FALSO_LOG) fs.appendFileSync(process.env.SSH_FALSO_LOG, `${JSON.stringify({ destino, remoto, entrada })}\n`);

if (remoto.startsWith("logs-falso")) {
  // La vigilancia de 30 min: la 1ª lectura (antes de subir) trae un error viejo conocido; las siguientes, lo mismo y,
  // con SSH_FALSO_ERRORES=1, tres errores NUEVOS. SSH_FALSO_LOGS_FALLA=1: no se puede leer.
  const archivoConteo = `${process.env.SSH_FALSO_LOG ?? "ssh-falso"}.conteo-logs`;
  const llamada = fs.existsSync(archivoConteo) ? Number(fs.readFileSync(archivoConteo, "utf8")) : 0;
  fs.writeFileSync(archivoConteo, String(llamada + 1));
  if (process.env.SSH_FALSO_LOGS_FALLA === "1" && llamada > 0) {
    console.error("ssh: connect to host servidor-falso port 22: Connection refused");
    process.exit(255);
  }
  console.log("2026-10-26T10:00:00Z INFO servidor listo\n2026-10-26T10:00:01Z ERROR error viejo conocido en 12 ms");
  if (process.env.SSH_FALSO_ERRORES === "1" && llamada > 0) {
    console.log("2026-10-26T10:05:00Z ERROR TypeError: no se pudo leer saludo\n2026-10-26T10:05:01Z ERROR Unhandled rejection en el bot\n2026-10-26T10:05:02Z ERROR fallo al guardar el libro");
  }
} else if (remoto.startsWith("estado-falso")) {
  console.log("true 0");
} else if (entrada.includes("FROM pg_database")) {
  console.log("postgres\nmagilus");
} else if (entrada.includes("to_regclass")) {
  console.log(remoto.includes("-d magilus") ? "t" : "f");
} else if (entrada.includes("FALLA_PROD")) {
  console.error('psql:<stdin>:4: ERROR:  relation "FALLA_PROD" does not exist');
  process.exit(3);
}
