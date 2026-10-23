// Pruebas de docker/respaldo/respaldo.sh (respaldo nocturno de la base a Google Drive), sin base y
// sin internet: pg_dump, pg_restore, rclone y curl son de mentira y anotan cada llamada.
// Correr: npm run test:respaldo
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const RAIZ = process.cwd();
const SCRIPT = path.join(RAIZ, "docker", "respaldo", "respaldo.sh");
const AVISO_A = "avisos@ejemplo.invalid";
const SMTP_PASS = "clave-smtp-de-mentira-9431";
const CARPETA = "drive:Respaldos/AizenCRM";

// Git Bash entiende C:/... pero no siempre C:\..., asi que los paths que van al script usan "/".
const aPosix = (p) => p.replace(/\\/g, "/");

// Busca un `sh`: primero el del PATH; en Windows, el de Git si no esta en el PATH.
function buscarSh() {
  const candidatos = ["sh"];
  if (process.platform === "win32") {
    candidatos.push("C:\\Program Files\\Git\\usr\\bin\\sh.exe", "C:\\Program Files\\Git\\bin\\sh.exe");
  }
  for (const c of candidatos) {
    const r = spawnSync(c, ["-c", "exit 0"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return c;
  }
  console.error(
    "No se encontro `sh`. En Windows instale Git for Windows (trae sh.exe) o agregue sh al PATH.",
  );
  process.exit(1);
}
const SH = buscarSh();

// Herramientas de mentira. Cada una anota en $REGISTRO una linea: nombre<TAB>arg1<TAB>arg2...
const anotar = `{ printf '%s' "$(basename "$0")"; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >>"$REGISTRO"`;
const FALSOS = {
  pg_dump: `#!/bin/sh
${anotar}
printf 'PGOPTIONS\\t%s\\n' "\${PGOPTIONS:-}" >>"$REGISTRO"
if [ -n "\${FALLA_PG_DUMP:-}" ]; then echo "pg_dump: error de mentira" >&2; exit 1; fi
archivo=""
for a in "$@"; do case "$a" in --file=*) archivo="\${a#--file=}" ;; esac; done
if [ -n "\${DUMP_VACIO:-}" ]; then : >"$archivo"; else printf 'PGDMP copia de mentira' >"$archivo"; fi
`,
  pg_restore: `#!/bin/sh
${anotar}
if [ -n "\${FALLA_PG_RESTORE:-}" ]; then echo "pg_restore: archivo danado" >&2; exit 1; fi
echo "; lista de mentira"
`,
  rclone: `#!/bin/sh
${anotar}
case "$1" in
  copyto) if [ -n "\${FALLA_RCLONE_COPYTO:-}" ]; then echo "rclone: sin red" >&2; exit 1; fi ;;
  lsf)
    if [ -n "\${FALLA_RCLONE_LSF:-}" ]; then echo "rclone: sin permiso" >&2; exit 1; fi
    for n in \${LISTA_DRIVE:-}; do printf '%s\\n' "$n"; done ;;
esac
exit 0
`,
  curl: `#!/bin/sh
${anotar}
siguiente=""
for a in "$@"; do
  case "$siguiente" in
    subir) grep '^Subject:' "$a" | tr -d '\\r' | sed 's/^/ASUNTO\\t/' >>"$REGISTRO" ;;
    netrc) sed 's/^/NETRC\\t/' "$a" >>"$REGISTRO" ;;
  esac
  siguiente=""
  case "$a" in
    --upload-file) siguiente="subir" ;;
    --netrc-file) siguiente="netrc" ;;
  esac
done
exit 0
`,
};

const temporales = [];
process.on("exit", () => {
  for (const d of temporales) fs.rmSync(d, { recursive: true, force: true });
});

// Un caso: carpeta temporal con bin/ (falsos), respaldos/ (RESPALDO_DIR) y registro.txt.
function nuevoCaso() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "respaldo-"));
  temporales.push(raiz);
  const bin = path.join(raiz, "bin");
  const dir = path.join(raiz, "respaldos");
  fs.mkdirSync(bin);
  fs.mkdirSync(dir);
  for (const [nombre, contenido] of Object.entries(FALSOS)) {
    const p = path.join(bin, nombre);
    fs.writeFileSync(p, contenido.replace(/\r\n/g, "\n"));
    fs.chmodSync(p, 0o755);
  }
  const registro = path.join(raiz, "registro.txt");
  fs.writeFileSync(registro, "");
  return { raiz, bin, dir, registro };
}

const epoch = (iso) => String(Math.floor(Date.parse(iso) / 1000));

// Corre `sh respaldo.sh <modo>` a la hora `iso` (UTC) con las variables extra de `extra`.
function correr(caso, modo, iso, extra = {}) {
  const base = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^path$/i.test(k)) continue;
    if (/^(SMTP_|RESPALDO_|RCLONE_|PG|FALLA_|DUMP_VACIO|LISTA_DRIVE|REGISTRO|ULTIMO_INTENTO)/.test(k)) continue;
    base[k] = v;
  }
  const pathReal = process.env.PATH ?? process.env.Path ?? "";
  const env = {
    ...base,
    PATH: `${aPosix(caso.bin)}${path.delimiter}${pathReal}`,
    REGISTRO: aPosix(caso.registro),
    RESPALDO_DIR: aPosix(caso.dir),
    RESPALDO_AHORA: epoch(iso),
    RESPALDO_DATABASE_URL: "postgresql://lector:clave@base.invalid:5432/aizencrm",
    RESPALDO_AVISO_A: AVISO_A,
    SMTP_HOST: "smtp.ejemplo.invalid",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "usuario@ejemplo.invalid",
    SMTP_PASS,
    SMTP_FROM: "AizenCRM <crm@ejemplo.invalid>",
    ...extra,
  };
  const r = spawnSync(SH, [aPosix(SCRIPT), modo], { env, encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status, salida: `${r.stdout}${r.stderr}` };
}

// Llamadas anotadas: [{ cmd, args }], mas las lineas especiales PGOPTIONS, ASUNTO y NETRC.
function llamadas(caso) {
  return fs
    .readFileSync(caso.registro, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((linea) => {
      const [cmd, ...args] = linea.split("\t");
      return { cmd, args };
    });
}
const de = (caso, cmd) => llamadas(caso).filter((l) => l.cmd === cmd);
const rclone = (caso, sub) => de(caso, "rclone").filter((l) => l.args[0] === sub);
const dumpsEn = (dir) => fs.readdirSync(dir).filter((n) => n.includes(".dump")).sort();

let casos = 0;
const prueba = (nombre, fn) => {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

// 1. Nombre del archivo con la fecha de Colombia (UTC-5).
prueba("a las 02:00 de Colombia respalda como aizencrm-<fecha de Colombia>.dump", () => {
  const c = nuevoCaso();
  const r = correr(c, "tick", "2026-10-23T07:00:00Z");
  assert.equal(r.status, 0, r.salida);
  assert.equal(de(c, "pg_dump").length, 1);
  assert.deepEqual(dumpsEn(c.dir), ["aizencrm-2026-10-23.dump"]);
});
prueba("a las 23:30 del dia anterior en Colombia (04:30Z) no respalda", () => {
  const c = nuevoCaso();
  correr(c, "tick", "2026-10-23T04:30:00Z");
  assert.equal(llamadas(c).length, 0);
  assert.deepEqual(dumpsEn(c.dir), []);
});
prueba("en el borde (05:00Z = 00:00 de Colombia) la fecha ya es la del 23 y el tick no corre", () => {
  const c = nuevoCaso();
  correr(c, "tick", "2026-10-23T05:00:00Z");
  assert.equal(llamadas(c).length, 0);
  correr(c, "ahora", "2026-10-23T05:00:00Z");
  assert.deepEqual(dumpsEn(c.dir), ["aizencrm-2026-10-23.dump"]);
  const c2 = nuevoCaso();
  correr(c2, "ahora", "2026-10-23T04:59:59Z");
  assert.deepEqual(dumpsEn(c2.dir), ["aizencrm-2026-10-22.dump"]);
});

// 2. Una sola vez por noche.
prueba("una sola vez por noche: 07:00Z y 07:01Z llaman a pg_dump una vez; 06:59Z nada", () => {
  const c = nuevoCaso();
  correr(c, "tick", "2026-10-23T06:59:00Z");
  assert.equal(de(c, "pg_dump").length, 0);
  correr(c, "tick", "2026-10-23T07:00:00Z");
  correr(c, "tick", "2026-10-23T07:01:00Z");
  correr(c, "tick", "2026-10-23T07:59:00Z");
  assert.equal(de(c, "pg_dump").length, 1);
  correr(c, "tick", "2026-10-24T07:00:00Z");
  assert.equal(de(c, "pg_dump").length, 2);
  assert.ok(dumpsEn(c.dir).includes("aizencrm-2026-10-24.dump"));
});
prueba("si falla, no reintenta cada minuto esa noche", () => {
  const c = nuevoCaso();
  correr(c, "tick", "2026-10-23T07:00:00Z", { FALLA_PG_DUMP: "1" });
  correr(c, "tick", "2026-10-23T07:01:00Z", { FALLA_PG_DUMP: "1" });
  assert.equal(de(c, "pg_dump").length, 1);
  assert.equal(de(c, "curl").length, 1);
});

// 3. Borrado en Drive.
prueba("en Drive borra solo aizencrm-<fecha>.dump de 30 dias o mas (quedan hoy y los 29 anteriores)", () => {
  const c = nuevoCaso();
  const lista = [
    "aizencrm-2026-09-22.dump", // 31 dias
    "aizencrm-2026-09-23.dump", // 30 dias
    "aizencrm-2026-09-24.dump", // 29 dias
    "aizencrm-2026-10-23.dump", // hoy
    "otro-archivo.txt",
    "aizencrm-malo.dump",
    "aizencrm-2026-01-01.dump.bak",
  ].join(" ");
  const r = correr(c, "ahora", "2026-10-23T07:00:00Z", { LISTA_DRIVE: lista });
  assert.equal(r.status, 0, r.salida);
  const lsf = rclone(c, "lsf");
  assert.equal(lsf.length, 1);
  const a = lsf[0].args;
  assert.equal(a[a.indexOf("--max-depth") + 1], "1");
  assert.equal(a[a.length - 1], CARPETA);
  assert.deepEqual(
    rclone(c, "deletefile").map((l) => l.args.slice(1)),
    [[`${CARPETA}/aizencrm-2026-09-22.dump`], [`${CARPETA}/aizencrm-2026-09-23.dump`]],
  );
  for (const peligroso of ["delete", "purge", "rmdirs", "rmdir", "sync", "move"]) {
    assert.equal(rclone(c, peligroso).length, 0, `nunca debe llamar rclone ${peligroso}`);
  }
  assert.equal(de(c, "curl").length, 0);
});

// 4. Fallos: aviso por correo con el paso.
const FALLOS = [
  { nombre: "falla pg_dump", env: { FALLA_PG_DUMP: "1" }, paso: "copiar", subio: false },
  { nombre: "el dump queda vacio", env: { DUMP_VACIO: "1" }, paso: "revisar", subio: false },
  { nombre: "falla pg_restore --list", env: { FALLA_PG_RESTORE: "1" }, paso: "revisar", subio: false },
  { nombre: "falla rclone copyto", env: { FALLA_RCLONE_COPYTO: "1" }, paso: "subir", subio: true },
];
for (const f of FALLOS) {
  prueba(`si ${f.nombre} avisa por correo con el paso '${f.paso}'`, () => {
    const c = nuevoCaso();
    const r = correr(c, "tick", "2026-10-23T07:00:00Z", f.env);
    assert.notEqual(r.status, 0);
    const curl = de(c, "curl");
    assert.equal(curl.length, 1, r.salida);
    const args = curl[0].args;
    assert.equal(args[args.indexOf("--mail-rcpt") + 1], AVISO_A);
    const asunto = de(c, "ASUNTO").map((l) => l.args.join("\t"));
    assert.equal(asunto.length, 1);
    assert.match(asunto[0], new RegExp(`\\(${f.paso}\\)`));
    if (!f.subio) {
      assert.equal(rclone(c, "copyto").length, 0);
      assert.deepEqual(dumpsEn(c.dir), []);
    } else {
      assert.equal(rclone(c, "copyto").length, 1);
      assert.equal(rclone(c, "deletefile").length, 0);
    }
    // No quedan el mensaje ni las credenciales en la carpeta.
    assert.ok(!fs.existsSync(path.join(c.dir, ".aviso.netrc")));
    assert.ok(!fs.existsSync(path.join(c.dir, ".aviso.txt")));
  });
}
prueba("sin RESPALDO_DATABASE_URL avisa en 'copiar' y no llama a pg_dump", () => {
  const c = nuevoCaso();
  correr(c, "ahora", "2026-10-23T07:00:00Z", { RESPALDO_DATABASE_URL: "" });
  assert.equal(de(c, "pg_dump").length, 0);
  assert.match(de(c, "ASUNTO")[0].args.join(" "), /\(copiar\)/);
});

// 5. Exito.
prueba("exito: sube con copyto al destino correcto, no avisa y pg_dump va en solo lectura", () => {
  const c = nuevoCaso();
  const r = correr(c, "tick", "2026-10-23T07:00:00Z");
  assert.equal(r.status, 0, r.salida);
  assert.equal(de(c, "curl").length, 0);
  const copyto = rclone(c, "copyto");
  assert.equal(copyto.length, 1);
  assert.deepEqual(copyto[0].args.slice(1), [
    `${aPosix(c.dir)}/aizencrm-2026-10-23.dump`,
    `${CARPETA}/aizencrm-2026-10-23.dump`,
  ]);
  const pgoptions = de(c, "PGOPTIONS")[0].args.join("\t");
  assert.match(pgoptions, /default_transaction_read_only=on/);
  const dump = de(c, "pg_dump")[0].args;
  assert.ok(dump.includes("--format=custom"));
  assert.ok(dump.some((a) => a.startsWith("--dbname=")));
  // pg_restore revisa la copia antes de subirla.
  assert.equal(de(c, "pg_restore")[0].args[0], "--list");
  const orden = llamadas(c).map((l) => l.cmd).filter((x) => x !== "PGOPTIONS");
  assert.deepEqual(orden.slice(0, 3), ["pg_dump", "pg_restore", "rclone"]);
  assert.ok(!fs.existsSync(path.join(c.dir, ".errores.txt")));
});

// 6. Copias locales.
prueba("en el servidor quedan solo las 3 copias mas recientes y no toca archivos ajenos", () => {
  const c = nuevoCaso();
  for (const d of ["10", "11", "12", "13", "14"]) {
    fs.writeFileSync(path.join(c.dir, `aizencrm-2026-10-${d}.dump`), "viejo");
  }
  fs.writeFileSync(path.join(c.dir, "notas.txt"), "no borrar");
  fs.writeFileSync(path.join(c.dir, "aizencrm-a-mano.dump"), "no borrar");
  const r = correr(c, "tick", "2026-10-23T07:00:00Z");
  assert.equal(r.status, 0, r.salida);
  assert.deepEqual(
    fs.readdirSync(c.dir).filter((n) => /^aizencrm-\d{4}-\d{2}-\d{2}\.dump$/.test(n)).sort(),
    ["aizencrm-2026-10-13.dump", "aizencrm-2026-10-14.dump", "aizencrm-2026-10-23.dump"],
  );
  assert.ok(fs.existsSync(path.join(c.dir, "notas.txt")));
  assert.ok(fs.existsSync(path.join(c.dir, "aizencrm-a-mano.dump")));
});

// 7. Sin claves en el codigo.
const CLAVES_DE_EJEMPLO = /^(\$.*|<.*>|clave|password|pass|contrase(n|ñ)a|secret[oa]?|usuario|x+|\*+|\.\.\.|changeme)$/i;
const VALOR_DE_VARIABLE = /^\$\{[A-Za-z_][A-Za-z0-9_]*(:?[-?])?\}$|^\$\{[A-Za-z_][A-Za-z0-9_]*:?\?[^}]*\}$/;
function buscarClaves(texto) {
  const hallazgos = [];
  texto.split(/\r?\n/).forEach((linea, i) => {
    const en = (que) => hallazgos.push(`linea ${i + 1}: ${que}`);
    if (/(access_token|refresh_token)["']?\s*[:=]\s*["']?[A-Za-z0-9._\-/]{8,}/i.test(linea)) en("token");
    if (/ya29\.[A-Za-z0-9_-]/.test(linea)) en("token de acceso de Google (ya29.)");
    if (/1\/\/0[A-Za-z0-9_-]{5,}/.test(linea)) en("refresh token de Google (1//0)");
    for (const m of linea.matchAll(/postgres(?:ql)?:\/\/[^:/\s@"']+:([^@\s"']+)@/gi)) {
      if (!CLAVES_DE_EJEMPLO.test(m[1])) en(`contrasena en URL de postgres (${m[1].slice(0, 2)}...)`);
    }
    // Se salta el uso de la variable (${SMTP_PASS:-}, $SMTP_PASS): solo cuenta cuando se le da valor.
    // "pass" de un JSON (config.example.json de aizen1): solo vale un texto de ejemplo en MAYUSCULAS.
    const json = linea.match(/"pass"\s*:\s*"([^"]*)"/i);
    if (json && json[1] && !/^[A-Z0-9-]+$/.test(json[1])) en('"pass" con valor que no es de ejemplo');
    const v = linea.match(/(?<![$\w{])(SMTP_PASS|RCLONE_CONFIG_DRIVE_TOKEN)["']?\s*[:=]\s*(.*)$/);
    if (v) {
      const valor = v[2].trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
      if (valor && !VALOR_DE_VARIABLE.test(valor)) en(`${v[1]} con valor literal`);
    }
  });
  return hallazgos;
}
prueba("el buscador de claves detecta claves plantadas (y deja pasar las de ejemplo)", () => {
  assert.equal(buscarClaves('SMTP_PASS: "hunter2hunter2"').length, 1);
  assert.equal(buscarClaves("RCLONE_CONFIG_DRIVE_TOKEN={\"x\":1}").length, 1);
  assert.equal(buscarClaves('"refresh_token":"' + "1//" + '0abcdefghijk"').length, 2);
  assert.equal(buscarClaves("x=" + "ya" + "29.a0AfH6SM").length, 1);
  assert.equal(buscarClaves("postgresql://lector:" + "S3cr3t0!@db:5432/x").length, 1);
  assert.equal(buscarClaves('SMTP_PASS: "${SMTP_PASS}"').length, 0);
  assert.equal(buscarClaves("RCLONE_CONFIG_DRIVE_TOKEN: ${RCLONE_CONFIG_DRIVE_TOKEN}").length, 0);
  assert.equal(buscarClaves("postgresql://usuario:clave@host:5432/db").length, 0);
  assert.equal(buscarClaves("postgresql://lector:${CLAVE}@host:5432/db").length, 0);
  assert.equal(buscarClaves('[ -z "${SMTP_PASS:-}" ]').length, 0);
  assert.equal(buscarClaves('    "pass": "abcd efgh ijkl mnop",').length, 1);
  assert.equal(buscarClaves('    "pass": "CONTRASENA-DE-APLICACION",').length, 0);
});
prueba("sin claves en docker/respaldo/**, docker-compose.portainer.yml ni Dockerfile", () => {
  const archivos = [];
  const recorrer = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else archivos.push(p);
    }
  };
  recorrer(path.join(RAIZ, "docker", "respaldo"));
  for (const f of ["docker-compose.portainer.yml", "Dockerfile"]) {
    const p = path.join(RAIZ, f);
    if (fs.existsSync(p)) archivos.push(p);
  }
  assert.ok(archivos.some((p) => p.endsWith("respaldo.sh")));
  const problemas = archivos.flatMap((p) =>
    buscarClaves(fs.readFileSync(p, "utf8")).map((h) => `${path.relative(RAIZ, p)} ${h}`),
  );
  assert.deepEqual(problemas, []);
});

// 8. La contrasena SMTP no va en la linea de comandos.
prueba("la contrasena SMTP no aparece en los argumentos de curl (va por --netrc-file)", () => {
  const c = nuevoCaso();
  const r = correr(c, "tick", "2026-10-23T07:00:00Z", { FALLA_PG_DUMP: "1" });
  const curl = de(c, "curl");
  assert.equal(curl.length, 1);
  assert.ok(curl[0].args.includes("--netrc-file"));
  assert.ok(!curl[0].args.some((a) => a.includes(SMTP_PASS)), "la contrasena salio en los argumentos");
  assert.ok(de(c, "NETRC").some((l) => l.args.join(" ").includes(SMTP_PASS)));
  assert.ok(!r.salida.includes(SMTP_PASS), "la contrasena salio en los registros");
});

// 9. El correo: contrasena con espacios, TLS y remitente.
prueba("una contrasena con espacios va entre comillas en el netrc (la de aplicacion de Gmail)", () => {
  const c = nuevoCaso();
  correr(c, "tick", "2026-10-23T07:00:00Z", { FALLA_PG_DUMP: "1", SMTP_PASS: 'abcd efgh "x\\y' });
  const netrc = de(c, "NETRC").map((l) => l.args.join("\t"));
  assert.equal(netrc.length, 1);
  assert.match(netrc[0], /password "abcd efgh \\"x\\\\y"$/);
});
prueba("sin SMTP_SECURE usa STARTTLS obligatorio; con SMTP_SECURE=true usa smtps", () => {
  const c = nuevoCaso();
  correr(c, "tick", "2026-10-23T07:00:00Z", { FALLA_PG_DUMP: "1" });
  const a = de(c, "curl")[0].args;
  assert.equal(a[a.indexOf("--url") + 1], "smtp://smtp.ejemplo.invalid:587");
  assert.ok(a.includes("--ssl-reqd"));
  // El sobre lleva solo el correo de "AizenCRM <crm@ejemplo.invalid>".
  assert.equal(a[a.indexOf("--mail-from") + 1], "crm@ejemplo.invalid");
  const c2 = nuevoCaso();
  correr(c2, "tick", "2026-10-23T07:00:00Z", { FALLA_PG_DUMP: "1", SMTP_SECURE: "true", SMTP_PORT: "465" });
  const a2 = de(c2, "curl")[0].args;
  assert.equal(a2[a2.indexOf("--url") + 1], "smtps://smtp.ejemplo.invalid:465");
});
prueba("si no se puede listar Drive para borrar, avisa (y la copia ya quedo subida)", () => {
  const c = nuevoCaso();
  const r = correr(c, "tick", "2026-10-23T07:00:00Z", { FALLA_RCLONE_LSF: "1" });
  assert.notEqual(r.status, 0);
  assert.equal(rclone(c, "copyto").length, 1);
  assert.equal(rclone(c, "deletefile").length, 0);
  assert.match(de(c, "ASUNTO")[0].args.join(" "), /\(borrar viejos en Drive\)/);
});
prueba("pg_dump tiene limite de espera de bloqueos", () => {
  const c = nuevoCaso();
  correr(c, "tick", "2026-10-23T07:00:00Z");
  assert.ok(de(c, "pg_dump")[0].args.some((a) => a.startsWith("--lock-timeout=")));
});

// 10. Los guiones van con LF: con CRLF fallan en el contenedor.
prueba("los guiones de docker/respaldo no tienen CRLF", () => {
  for (const f of ["respaldo.sh", "restaurar-prueba.sh"]) {
    const texto = fs.readFileSync(path.join(RAIZ, "docker", "respaldo", f), "utf8");
    assert.ok(!texto.includes("\r"), `${f} tiene CRLF`);
  }
});

console.log(`${casos} pruebas de respaldo OK`);
