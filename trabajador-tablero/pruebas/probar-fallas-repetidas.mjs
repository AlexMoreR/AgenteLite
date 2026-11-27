// Pruebas de las FALLAS REPETIDAS del Coordinador (25-nov-2026), parte 1: "no arrancó" y la reversión falsa (T-902 470c7f1,
// T-800); parte 2: la nube sin señal se reintenta en una sesión nueva (T-921) y la bitácora; parte 3: Claude no cambió nada (T-625,
// que ya estaba en b52c1b45): si ya está en main pasa a HECHO, si no se vuelve a planear. Sin red de verdad, sin CRM y sin WhatsApp:
//   node trabajador-tablero/pruebas/probar-fallas-repetidas.mjs   (también corre dentro de npm run test:trabajador-tablero)
// El CRM falso es un servidor local que contesta /api/version; el git falso es un repo con su "origin" en una carpeta
// temporal; el ssh falso imprime el log de actualizar.sh que pide la prueba; el reloj falso se adelanta con cada espera.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { manejarFalla, procesar, referenciasDeLaCausa, resolverLaSubidaDeshecha } from "../lib/bucle.mjs";
import { LOG_ACTUALIZAR_POR_DEFECTO, PISO_VERSION_MINUTOS, completarConfig } from "../lib/config.mjs";
import {
  FRASES_DE_LA_CAUSA,
  MISMA_CAUSA,
  SIN_REPARACION_AUTOMATICA,
  TOPE_INTENTOS_DE_SUBIDA,
  causaConMarca,
  causaEnUnaFrase,
  causaExterna,
  causaParaComparar,
  decidir,
  esCausaDeDependencia,
  esLaMismaCausa,
  diagnosticar,
  estrategiaDeLaCausa,
  queHacerConLaSubidaDeshecha,
  sinMarcaDeEstrategia,
} from "../lib/diagnostico.mjs";
import { ErrorDeEtapa, esperarVersion, ramaParaLaNube, subir } from "../lib/etapas.mjs";
import { nombreDeRama } from "../lib/git.mjs";
import { abreSesionNueva, lanzarSesionDeLaNube, linksDeIntentosAnteriores } from "../lib/nube.mjs";
import { cargar } from "../../scripts/supervisor-cargar.mjs";

// Las reglas REALES del CRM (estadoTrasReparar, estrategiaDeEntrada): las mismas que usa /reparar.
const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
const T = fs.mkdtempSync(path.join(os.tmpdir(), "fallas-repetidas-"));
const REMOTO = path.join(T, "remoto.git");
const REPO = path.join(T, "repo");
const g = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@x.co", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const shaDe = (ref) => execFileSync("git", ["--git-dir", REMOTO, "rev-parse", ref], { encoding: "utf8" }).trim();

/* ── el git falso ── */
fs.mkdirSync(REPO);
execFileSync("git", ["init", "--bare", "-b", "main", REMOTO], { stdio: "ignore" });
g(REPO, "init", "-b", "main");
fs.writeFileSync(path.join(REPO, "package.json"), '{ "name": "repo-de-prueba", "private": true }\n');
fs.writeFileSync(path.join(REPO, "a.txt"), "lo de main\n");
g(REPO, "add", "-A");
g(REPO, "commit", "-m", "base");
g(REPO, "remote", "add", "origin", REMOTO);
g(REPO, "push", "-q", "-u", "origin", "main");

/* ── el CRM falso: /api/version dice lo que diga `versionDelServidor` (por defecto, el main de "origin") ── */
let versionDelServidor = null;
const servidor = http.createServer((pedido, respuesta) => {
  if (pedido.method === "GET" && pedido.url === "/api/version") {
    const version = typeof versionDelServidor === "function" ? versionDelServidor() : (versionDelServidor ?? shaDe("main"));
    respuesta.writeHead(200, { "Content-Type": "application/json" });
    return respuesta.end(JSON.stringify({ version }));
  }
  respuesta.writeHead(404);
  respuesta.end();
});
await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
const PUERTO = servidor.address().port;

/* ── el ssh falso: imprime SSH_FALSO_ACTUALIZAR (un archivo) o falla con SSH_FALSO_ACTUALIZAR_FALLA=1; anota lo que le piden ── */
const SSH = path.join(T, "ssh-actualizar.mjs");
const SSH_LOG = path.join(T, "ssh.log");
fs.writeFileSync(
  SSH,
  [
    'import fs from "node:fs";',
    "const [destino, remoto] = process.argv.slice(2);",
    `fs.appendFileSync(${JSON.stringify(SSH_LOG)}, JSON.stringify({ destino, remoto }) + "\\n");`,
    'if (process.env.SSH_FALSO_ACTUALIZAR_FALLA === "1") { console.error("ssh: connect to host servidor-falso port 22: Connection refused"); process.exit(255); }',
    'if (process.env.SSH_FALSO_ACTUALIZAR) process.stdout.write(fs.readFileSync(process.env.SSH_FALSO_ACTUALIZAR, "utf8"));',
  ].join("\n"),
);
const LOG_DEL_SERVIDOR = path.join(T, "crm-actualizar.log");
const conLogDelServidor = (texto) => {
  fs.writeFileSync(LOG_DEL_SERVIDOR, texto);
  process.env.SSH_FALSO_ACTUALIZAR = LOG_DEL_SERVIDOR;
  delete process.env.SSH_FALSO_ACTUALIZAR_FALLA;
};
const pedidosAlSsh = () => (fs.existsSync(SSH_LOG) ? fs.readFileSync(SSH_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

const config = completarConfig({
  urlCrm: "https://crm.ejemplo.com",
  claveTrabajador: "aizen_trab_x",
  carpetaTrabajo: path.join(T, "trabajo"),
  nube: { activa: false },
  limites: { esperaMaximaMinutos: 0 },
  git: { nombre: "Trabajador de prueba", correo: "trabajador@x.co" },
  ssh: { comando: [process.execPath, SSH], destino: "prueba@servidor-falso", psql: "psql -U postgres" },
  repos: {
    aizencrm: {
      ruta: REPO,
      subirSolo: false,
      ramaBase: "main",
      remoto: "origin",
      verificar: [[process.execPath, "-e", "console.log('verificar ok')"]],
      pruebas: [[process.execPath, "-e", "console.log('pruebas ok')"]],
      // Lo que pide el plan: el piso de 15 y el comando del log por defecto (sin escribirlos en la configuración).
      subida: { urlVersion: `http://127.0.0.1:${PUERTO}/api/version`, campoVersion: "version", versionMinutos: 1 },
    },
  },
});
const repo = config.repos.aizencrm;

/** El reloj falso: cada espera adelanta la hora sin dormir de verdad. */
const relojFalso = (inicio = 1_800_000_000_000) => {
  let ahora = inicio;
  return { ahora: () => ahora, dormir: async (ms) => void (ahora += ms), adelantar: (ms) => void (ahora += ms) };
};
/** El reloj de la etapa subir ya gastado (el CI tardó): resta() lanza al instante, como relojDeEtapa. */
const relojDeEtapaGastado = {
  resta() {
    throw new ErrorDeEtapa("Se pasó del tiempo de subir (44 min).", { categoria: "tiempo_agotado" });
  },
  extender() {},
  esperado: () => 0,
};
const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`), error: (m) => lineas.push(`ERROR ${m}`) };
};

/** Un commit nuevo en main de "origin" (lo que subió la tarjeta) y el main de antes. */
const subirAlgo = (texto) => {
  const antes = shaDe("main");
  fs.writeFileSync(path.join(REPO, "a.txt"), texto);
  g(REPO, "commit", "-qam", `cambio: ${texto.trim()}`);
  g(REPO, "push", "-q", "origin", "main");
  return { antes, commit: shaDe("main") };
};

try {
  await prueba("configuración: el piso de 15 min y el comando del log de actualizar.sh por defecto", async () => {
    assert.equal(PISO_VERSION_MINUTOS, 15);
    assert.equal(LOG_ACTUALIZAR_POR_DEFECTO, "tail -n 300 /var/log/crm-actualizar.log");
    assert.equal(repo.subida.pisoMinutos, 15);
    assert.equal(repo.subida.logActualizar, LOG_ACTUALIZAR_POR_DEFECTO);
    const conOtro = completarConfig({ ...config, repos: { aizencrm: { ruta: REPO, subirSolo: false, subida: { pisoMinutos: 5, logActualizar: "tail -n 50 /var/log/otro.log" } } } });
    assert.equal(conOtro.repos.aizencrm.subida.pisoMinutos, 15, "un piso más chico no baja de 15");
    assert.equal(conOtro.repos.aizencrm.subida.logActualizar, "tail -n 50 /var/log/otro.log");
    const ejemplo = JSON.parse(fs.readFileSync(new URL("../config.example.json", import.meta.url), "utf8"));
    assert.equal(ejemplo.repos.aizencrm.subida.logActualizar, LOG_ACTUALIZAR_POR_DEFECTO);
    assert.equal(ejemplo.repos.aizencrm.subida.pisoMinutos, 15);
  });

  await prueba("no arrancó: con el reloj de la etapa gastado no deshace antes de 15 min", async () => {
    const { antes, commit } = subirAlgo("versión que el servidor tarda en bajar\n");
    // El servidor sigue en la versión anterior y su log todavía no dice "listo" con el commit nuevo.
    versionDelServidor = antes;
    conLogDelServidor(`2026-11-25 10:00:01 bajando imagen\n2026-11-25 10:00:02 listo: version ${antes}\n`);
    const tiempo = relojFalso();
    const subidoEn = tiempo.ahora();
    const registro = registroFalso();
    const error = await esperarVersion({ config, registro, tiempo }, repo, commit, relojDeEtapaGastado, { subidoEn }).then(
      () => assert.fail("tenía que decir que no arrancó"),
      (e) => e,
    );
    assert.ok(error instanceof ErrorDeEtapa, String(error));
    assert.notEqual(error.categoria, "tiempo_agotado", "no lanza por el reloj de la etapa");
    assert.ok(tiempo.ahora() - subidoEn >= 15 * MIN, `esperó ${(tiempo.ahora() - subidoEn) / MIN} min, menos de 15`);
    assert.match(error.message, /la versión nueva no arrancó/);
    // Antes de deshacer leyó /api/version y el log por ssh, con ssh.destino y el comando por defecto; las líneas van en la causa.
    const pedido = pedidosAlSsh().at(-1);
    assert.deepEqual(pedido, { destino: "prueba@servidor-falso", remoto: "tail -n 300 /var/log/crm-actualizar.log" });
    assert.match(error.message, /Log del servidor \(tail -n 300 \/var\/log\/crm-actualizar\.log\)/);
    assert.match(error.message, /bajando imagen/);
    assert.equal(error.antesDeDeshacer.falsa, true, "el log no dice listo con el commit nuevo: reversión falsa");
    assert.ok(error.antesDeDeshacer.lineas.some((l) => /bajando imagen/.test(l)));

    // Sin la corrida del CI se le da también el tiempo del CI (20 min): 35 en total.
    const otro = relojFalso();
    const desdeSinCi = otro.ahora();
    const sinCi = await esperarVersion({ config, registro, tiempo: otro }, repo, commit, relojDeEtapaGastado, { subidoEn: desdeSinCi, sinCi: true }).catch((e) => e);
    assert.ok(sinCi instanceof ErrorDeEtapa);
    assert.ok(otro.ahora() - desdeSinCi >= 35 * MIN, `sin CI esperó ${(otro.ahora() - desdeSinCi) / MIN} min`);

    // Si el servidor baja la imagen al minuto 12, NO se deshace (antes se deshacía a los ~2 min con el reloj gastado).
    const tarde = relojFalso();
    const desde = tarde.ahora();
    versionDelServidor = () => (tarde.ahora() - desde >= 12 * MIN ? commit : antes);
    const bien = await esperarVersion({ config, registro, tiempo: tarde }, repo, commit, relojDeEtapaGastado, { subidoEn: desde });
    assert.equal(bien.version, commit);
    assert.ok(tarde.ahora() - desde >= 12 * MIN && tarde.ahora() - desde < 13 * MIN);
  });

  await prueba("no arrancó de verdad: el log dice listo con el commit nuevo y /api/version ya no: la reversión NO es falsa", async () => {
    const { antes, commit } = subirAlgo("versión que arrancó y se cayó\n");
    versionDelServidor = antes;
    conLogDelServidor(`2026-11-25 11:00:00 listo: version ${commit}\n2026-11-25 11:02:00 la app nueva dejó de contestar\n`);
    const tiempo = relojFalso();
    const error = await esperarVersion({ config, registro: registroFalso(), tiempo }, repo, commit, relojDeEtapaGastado, { subidoEn: tiempo.ahora() }).catch((e) => e);
    assert.ok(error instanceof ErrorDeEtapa);
    assert.equal(error.antesDeDeshacer.falsa, false);
    assert.equal(error.antesDeDeshacer.ssh, true);
  });

  await prueba("sin ssh: decide solo /api/version con el piso de 15 min (no es falsa pasado el piso)", async () => {
    const { antes, commit } = subirAlgo("versión sin ssh\n");
    versionDelServidor = antes;
    process.env.SSH_FALSO_ACTUALIZAR_FALLA = "1";
    try {
      const tiempo = relojFalso();
      const desde0 = tiempo.ahora();
      const error = await esperarVersion({ config, registro: registroFalso(), tiempo }, repo, commit, relojDeEtapaGastado, { subidoEn: desde0 }).catch((e) => e);
      assert.ok(error instanceof ErrorDeEtapa);
      assert.ok(tiempo.ahora() - desde0 >= 15 * MIN);
      assert.equal(error.antesDeDeshacer.ssh, false);
      assert.equal(error.antesDeDeshacer.falsa, false, "pasado el piso y sin log, decide /api/version: no arrancó");
      assert.match(error.message, /No se pudo leer el log del servidor/);
      // Y si justo antes de deshacer /api/version ya dice el commit, no se deshace.
      const casi = relojFalso();
      const desde = casi.ahora();
      versionDelServidor = () => (casi.ahora() - desde > 15 * MIN ? commit : antes);
      const bien = await esperarVersion({ config, registro: registroFalso(), tiempo: casi }, repo, commit, relojDeEtapaGastado, { subidoEn: desde });
      assert.equal(bien.version, commit);
    } finally {
      delete process.env.SSH_FALSO_ACTUALIZAR_FALLA;
    }
  });

  await prueba("reversión falsa: se vuelve a subir el mismo commit", async () => {
    // 1) La decisión: falsa espera, no cuenta y no suma al tope (aunque ya lleve 2 subidas deshechas).
    const diagnostico = { categoria: "otra", causa: "Se subió, no arrancó y se deshizo", error: "Se subió, no arrancó y se deshizo." };
    const previos = Array.from({ length: TOPE_INTENTOS_DE_SUBIDA - 1 }, () => ({ etapa: "subir", categoria: "subida_revertida", causa: "x" }));
    const reversion = { ok: true, commit: "c".repeat(40), revert: "d".repeat(40), clase: "falsa", sencilla: FRASES_DE_LA_CAUSA.falsa, lineas: ["bajando imagen"] };
    assert.equal(queHacerConLaSubidaDeshecha(diagnostico, reversion), "esperar");
    const decision = decidir({ diagnostico, tarjeta: { titulo: "Cambio", ultimosIntentos: previos }, etapa: "subir", reversion });
    assert.deepEqual([decision.accion, decision.cuenta, decision.agotado], ["esperar", false, undefined]);
    assert.equal(decidir({ diagnostico, tarjeta: { ultimosIntentos: previos }, etapa: "subir", reversion: { ...reversion, clase: "pasajera" } }).agotado, true, "una pasajera sí llega al tope");
    assert.equal(causaExterna(diagnostico, { reversion, repo: "aizencrm", tarjeta: { titulo: "Cambio" } }), null, "no se pide «Arreglo de subida»");

    // 2) El bucle la suelta SIN la categoría subida_revertida (el CRM no la cuenta) y sin ERROR ni arreglo.
    const llamadas = [];
    const crm = {
      soltar: async (id, motivo, extra) => (llamadas.push(["soltar", id, motivo, extra]), { ok: true }),
      error: async (...args) => (llamadas.push(["error", ...args]), { ok: true }),
      causaExterna: async (...args) => (llamadas.push(["causaExterna", ...args]), { ok: true }),
      aviso: async (...args) => (llamadas.push(["aviso", ...args]), { ok: true }),
    };
    const tarjeta = { id: "t1", titulo: "Cambio que el servidor tardó en bajar", repo: "aizencrm", ultimosIntentos: previos };
    const errorFalso = new ErrorDeEtapa("Se subió, no arrancó y se deshizo.", { reversion });
    const intento = { etapa: "subir", categoria: "otra", causa: "no arrancó", error: "x" };
    const salida = await resolverLaSubidaDeshecha({ crm, config: { ...config, bitacora: { ...config.bitacora, activa: false } }, registro: registroFalso() }, tarjeta, "subir", errorFalso, {
      diagnostico,
      intento,
      motivo: errorFalso.message,
      causaParaLaTarjeta: diagnostico.causa,
    });
    assert.equal(salida.accion, "esperar");
    assert.deepEqual(llamadas.map(([que]) => que), ["soltar"], "solo se suelta: ni ERROR, ni arreglo, ni aviso");
    const [, id, motivo, extra] = llamadas[0];
    assert.equal(id, "t1");
    assert.notEqual(extra.categoria, "subida_revertida", "no suma al tope de subidas");
    assert.match(motivo, /mismo commit/);
    // Parte 2: en la bitácora queda como reversión falsa y se resuelve volviendo a subir (reversion_falsa / resubir).
    const bitacora = fs.readFileSync(path.join(config.carpetaTrabajo, "incidentes", "aizencrm.md"), "utf8");
    assert.match(bitacora, /^- Qué falló: se deshizo antes de que el servidor bajara la versión nueva \(reversión falsa\)$/m);
    assert.match(bitacora, /^- Cómo se resolvió: se vuelve a subir el mismo commit$/m);
    assert.match(bitacora, /^- Qué se intentó: intento 3 de 3 \(/m);

    // 3) De punta a punta con subir(): la 1.ª vuelta sube, el servidor no baja la imagen (su log no dice "listo" con el commit) y
    //    se deshace con clase "falsa"; la vuelta siguiente ve el commit deshecho en main (revertQueLoDeshace), deshace el revert y
    //    sube el MISMO cambio otra vez.
    const base = shaDe("main");
    const rama = "tablero/abcd1234-cambio-falso";
    g(REPO, "checkout", "-q", "-b", rama, base);
    fs.writeFileSync(path.join(REPO, "a.txt"), "lo de la tarjeta\n");
    g(REPO, "commit", "-qam", "lo de la tarjeta");
    g(REPO, "push", "-q", "origin", rama);
    g(REPO, "checkout", "-q", "main");
    const laTarjeta = { id: "abcd1234", titulo: tarjeta.titulo, repo: "aizencrm", zonasAprobadas: [], resultado: { rama, paso: true, base, commit: shaDe(rama) } };
    versionDelServidor = base;
    conLogDelServidor(`2026-11-25 12:00:00 bajando imagen\n2026-11-25 12:00:01 listo: version ${base}\n`);
    const primera = registroFalso();
    const deshecha = await subir({ config, registro: primera, tiempo: relojFalso() }, laTarjeta).then(
      () => assert.fail("tenía que deshacerse"),
      (e) => e,
    );
    assert.equal(deshecha.reversion?.ok, true, deshecha.message);
    assert.equal(deshecha.reversion.clase, "falsa", deshecha.message);
    assert.equal(deshecha.reversion.sencilla, FRASES_DE_LA_CAUSA.falsa);
    assert.match(deshecha.message, /bajando imagen/, "las líneas del log van en la causa");
    const subido = deshecha.reversion.commit;
    const revert = shaDe("main");
    assert.equal(deshecha.reversion.revert, revert);
    assert.match(g(REPO, "log", "-1", "--format=%s", "origin/main"), /^revert: deshacer [0-9a-f]{10} \(el despliegue falló\)/);

    versionDelServidor = null; // ahora el servidor toma lo que haya en main
    const segunda = registroFalso();
    const subida = await subir({ config, registro: segunda, tiempo: relojFalso() }, laTarjeta);
    assert.ok(segunda.lineas.some((l) => /se deshizo \(revert [0-9a-f]{10}\): no vale como subido; se deshace el revert/.test(l)), segunda.lineas.join("\n"));
    assert.equal(subida.commit, shaDe("main"));
    assert.equal(g(REPO, "rev-parse", `${subida.commit}~1`), revert, "se subió encima del revert");
    assert.equal(g(REPO, "show", `${subida.commit}:a.txt`), "lo de la tarjeta", "es el mismo cambio de la tarjeta");
    assert.equal(g(REPO, "diff", subido, subida.commit, "--stat"), "", "el contenido es el mismo commit");
  });

  /* ── parte 2: la nube sin señal (T-921: el reintento volvió a session_01XuE6FdupseQWg3mMsf45er) ── */

  // El claude falso: con `-p <mensaje> --cloud <id>` contesta como la sesión fija; con `-p --cloud` (sin id) abre una sesión
  // NUEVA y da su link (o el de CLAUDE_FALSO_LINK). Anota cada llamada.
  const CLAUDE = path.join(T, "claude-falso.mjs");
  const CLAUDE_LOG = path.join(T, "claude.log");
  fs.writeFileSync(
    CLAUDE,
    [
      'import fs from "node:fs";',
      "const args = process.argv.slice(2);",
      `fs.appendFileSync(${JSON.stringify(CLAUDE_LOG)}, JSON.stringify(args) + "\\n");`,
      'const i = args.indexOf("--cloud");',
      'const id = args[i + 1] && !args[i + 1].startsWith("-") ? args[i + 1] : null;',
      'if (id) { console.log(JSON.stringify({ ok: true, session_id: id })); process.exit(0); }',
      'const n = fs.readFileSync(' + JSON.stringify(CLAUDE_LOG) + ', "utf8").trim().split("\\n").length;',
      'console.log(process.env.CLAUDE_FALSO_LINK || `Sesión creada: https://claude.ai/code/session_NUEVA${n}`);',
    ].join("\n"),
  );
  const llamadasAClaude = () => (fs.existsSync(CLAUDE_LOG) ? fs.readFileSync(CLAUDE_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const SESION_FIJA = "session_01XuE6FdupseQWg3mMsf45er";
  const LINK_FIJA = `https://claude.ai/code/${SESION_FIJA}`;
  const configNube = { ...config, nube: { ...config.nube, activa: true, terminal: "sin-terminal", chequeoPrevio: false, comandoClaude: [process.execPath, CLAUDE], lanzarMinutos: 1 } };
  // El proyecto con sesión fija y en modo orquestador (lo peor de T-921: todo iba a la misma sesión).
  const repoConFija = { ...configNube.repos.aizencrm, clave: "aizencrm", nube: { sesionFija: SESION_FIJA, orquestador: true } };
  const contextoNube = (extra = {}) => ({ config: configNube, registro: registroFalso(), orquestador: true, ...extra });

  await prueba("nube sin señal: el reintento abre una sesión nueva", async () => {
    // 1) Ya no va directo al dueño: se repara con la estrategia sesion_nueva, y la causa guarda el link entero.
    assert.ok(!SIN_REPARACION_AUTOMATICA.includes("nube_sin_resultado"));
    const diagnostico = diagnosticar({
      error: new ErrorDeEtapa(`La sesión de la nube no dio señal (ni el commit "inicio:" ni ningún otro) en la rama ${"r".repeat(90)} en 20 min: se cortó la espera. Mírala: ${LINK_FIJA}`, { categoria: "nube_sin_resultado" }),
      etapa: "construir",
    });
    assert.equal(diagnostico.categoria, "nube_sin_resultado");
    const decision = decidir({ diagnostico, tarjeta: { reparaciones: 0, ultimosIntentos: [] }, etapa: "construir" });
    assert.deepEqual([decision.accion, decision.cuenta, decision.estrategia], ["reparar", true, "sesion_nueva"]);
    assert.match(decision.queCambia, /sesión nueva/);
    // Lo que guarda el CRM: la marca y su cola " (estrategia: sesion_nueva)", recortado a 200: el link no se corta.
    const marcada = causaConMarca(diagnostico.causa, decision.estrategia);
    const cola = " (estrategia: sesion_nueva)";
    const guardada = `${marcada.slice(0, 200 - cola.length)}${cola}`;
    assert.ok(guardada.length <= 200);
    assert.ok(guardada.includes(LINK_FIJA), guardada);
    assert.equal(estrategiaDeLaCausa(guardada), "sesion_nueva");
    assert.ok(sinMarcaDeEstrategia(guardada).endsWith(LINK_FIJA));
    // Parte 4: con la misma causa, la 2.ª reparación ya no repite sesion_nueva (pasa a la siguiente de su lista) y la alerta
    // llega recién con la 4.ª falla, tras 3 intentos distintos (el tope de 3 reparaciones del CRM).
    const previa = { accion: "reparar", etapa: "construir", categoria: "nube_sin_resultado", causa: guardada };
    assert.equal(decidir({ diagnostico, tarjeta: { reparaciones: 1, ultimosIntentos: [previa] }, etapa: "construir" }).estrategia, "opus");
    assert.equal(decidir({ diagnostico, tarjeta: { reparaciones: 2, ultimosIntentos: [previa, previa] }, etapa: "construir" }).accion, "reparar");
    assert.equal(decidir({ diagnostico, tarjeta: { reparaciones: 3, ultimosIntentos: [previa, previa, previa] }, etapa: "construir" }).agotado, true);

    // 2) La tarjeta con ese intento: aunque el proyecto tenga sesión fija y modo orquestador, abre una sesión NUEVA con --cloud.
    const tarjeta = { id: "cmyjn7ul5g0000000000000", titulo: "Cambio que la nube no terminó", repo: "aizencrm", ultimosIntentos: [previa] };
    assert.equal(abreSesionNueva(repoConFija, tarjeta), true);
    assert.equal(abreSesionNueva(repoConFija, { ...tarjeta, ultimosIntentos: [] }), false, "sin la falla, sigue con la sesión fija");
    const antes = llamadasAClaude().length;
    const lanzado = await lanzarSesionDeLaNube(contextoNube(), { repo: repoConFija, cwd: T, prompt: "la tarea", tarjeta });
    const llamadas = llamadasAClaude().slice(antes);
    assert.equal(llamadas.length, 1, "una sola llamada: sin /clear ni mensaje a la sesión fija");
    assert.deepEqual(llamadas[0].slice(0, 2), ["-p", "--cloud"], "claude -p --cloud sin id: una sesión nueva");
    assert.ok(!llamadas[0].includes(SESION_FIJA), "no le escribe a la sesión fija");
    assert.match(lanzado.link, /^https:\/\/claude\.ai\/code\/session_NUEVA\d+$/);
    assert.notEqual(lanzado.link, LINK_FIJA);

    // 3) La rama: la del intento anterior ya está en GitHub, así que el reintento usa la suya con -nube2.
    const principal = nombreDeRama(tarjeta);
    g(REPO, "push", "-q", "origin", `main:refs/heads/${principal}`);
    assert.equal(await ramaParaLaNube(repo, tarjeta), `${principal}-nube2`);
  });

  await prueba("nube sin señal: nunca reusa la sesión de un intento anterior", async () => {
    // Sin la falla de la nube, una tarjeta nueva del proyecto sigue yendo a la sesión fija (el modo orquestador no cambia).
    const antes = llamadasAClaude().length;
    const aLaFija = await lanzarSesionDeLaNube(contextoNube(), { repo: repoConFija, cwd: T, prompt: "otra tarea", tarjeta: { id: "otra", titulo: "Otra", ultimosIntentos: [] } });
    assert.equal(aLaFija.via, "sesion-fija");
    assert.ok(llamadasAClaude().slice(antes).every((args) => args.includes(SESION_FIJA)));

    // Un intento anterior (de otra categoría) ya usó la sesión fija: su link sale de las causas o del último error, y no se reusa.
    const tarjeta = {
      id: "cmyjn7ul5g1111111111111",
      titulo: "Cambio con pruebas que fallaron en la nube",
      ultimosIntentos: [{ accion: "reparar", etapa: "construir", categoria: "fallan_pruebas", causa: "Fallaron las pruebas: not ok 3" }],
      ultimoError: `La sesión de la nube dejó el resultado FALLO (build=OK tests=FALLO).\nSesión de la nube: ${LINK_FIJA}`,
    };
    assert.deepEqual(linksDeIntentosAnteriores(tarjeta), [LINK_FIJA]);
    assert.equal(abreSesionNueva(repoConFija, tarjeta), true);
    const desde = llamadasAClaude().length;
    const lanzado = await lanzarSesionDeLaNube(contextoNube(), { repo: repoConFija, cwd: T, prompt: "la tarea", tarjeta });
    assert.ok(!llamadasAClaude().slice(desde).some((args) => args.includes(SESION_FIJA)), "no le escribe a la sesión de antes");
    assert.notEqual(lanzado.link, LINK_FIJA);

    // Si `claude --cloud` devolviera el link de un intento anterior, no se le deja la tarea.
    process.env.CLAUDE_FALSO_LINK = `Sesión creada: ${LINK_FIJA}`;
    try {
      const error = await lanzarSesionDeLaNube(contextoNube(), { repo: repoConFija, cwd: T, prompt: "la tarea", tarjeta }).catch((e) => e);
      assert.ok(error instanceof ErrorDeEtapa, String(error));
      assert.match(error.message, /sesión de un intento anterior/);
    } finally {
      delete process.env.CLAUDE_FALSO_LINK;
    }
  });

  await prueba("nube sin señal: repararLaFalla la anota en la bitácora con «Qué se intentó»", async () => {
    const llamadas = [];
    const crm = {
      latido: async () => ({ ok: true }),
      reparar: async (id, datos) => (llamadas.push(["reparar", id, datos]), { ok: true, reparaciones: 1 }),
      error: async (...args) => (llamadas.push(["error", ...args]), { ok: true }),
      soltar: async () => ({ ok: true }),
      aviso: async () => ({ ok: true }),
      causaExterna: async () => ({ ok: true }),
    };
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-bitacora-"));
    const conCarpeta = { ...config, carpetaTrabajo: carpeta };
    const tarjeta = { id: "cmyjn7ul5g2222222222222", titulo: "Nube que no dio señal", repo: "aizencrm", topeReparaciones: 3, reparaciones: 0, intentos: 1, ultimosIntentos: [] };
    const salida = await procesar({ crm, config: conCarpeta, registro: { info: () => {}, aviso: () => {}, error: () => {} } }, tarjeta, `La sesión de la nube no dio señal (ni el commit "inicio:" ni ningún otro) en la rama r en 20 min: se cortó la espera. Mírala: ${LINK_FIJA}`);
    assert.equal(salida.accion, "reparar");
    const [, , datos] = llamadas.find(([que]) => que === "reparar");
    assert.equal(datos.estrategia, "sesion_nueva");
    assert.match(datos.causa, new RegExp(`${LINK_FIJA} \\[estrategia: sesion_nueva\\]$`));
    const texto = fs.readFileSync(path.join(carpeta, "incidentes", "aizencrm.md"), "utf8");
    assert.match(texto, /^- Qué falló: la sesión de la nube no dio señal ni dejó su resultado$/m);
    assert.match(texto, /^- Qué se intentó: intento 1 de 3 \(nube_sin_resultado; /m);
    assert.match(texto, /^- Cómo se resolvió: reintento en una sesión nueva de la nube/m);
    assert.match(texto, /^- Regla: Si la nube no da señal, se reintenta en una sesión nueva/m);
  });

  /* ── parte 3: no cambió nada (T-625: ya estaba en b52c1b45 y se volvió a construir con el plan viejo) ── */

  // El CRM falso de estas pruebas: anota lo que le piden; /reparar usa las reglas reales para el estado al que vuelve.
  const crmDeNoCambio = (tarjeta) => {
    const llamadas = [];
    const crm = {
      latido: async () => ({ ok: true }),
      yaHecha: async (id, datos) => (llamadas.push(["ya-hecha", id, datos]), Object.assign(tarjeta, { estado: "HECHO" }), { ok: true, estado: "HECHO" }),
      reparar: async (id, datos) => {
        llamadas.push(["reparar", id, datos]);
        tarjeta.estado = reglas.estadoTrasReparar(tarjeta.estado, reglas.estrategiaDeEntrada(datos.estrategia));
        return { ok: true, estado: tarjeta.estado, reparaciones: (tarjeta.reparaciones ?? 0) + 1 };
      },
      error: async (...args) => (llamadas.push(["error", ...args]), { ok: true }),
      soltar: async (...args) => (llamadas.push(["soltar", ...args]), { ok: true }),
      aviso: async () => ({ ok: true }),
      causaExterna: async (...args) => (llamadas.push(["causaExterna", ...args]), { ok: true }),
    };
    return { crm, llamadas };
  };
  const NO_CAMBIO = "Claude no cambió ningún archivo.";

  await prueba("no cambió nada: si el commit ya está en main pasa a HECHO con la nota y el commit", async () => {
    const tarjeta = {
      id: "cmyjn7ul5g3333333333333",
      titulo: "Arreglar el botón de exportar contactos",
      repo: "aizencrm",
      estado: "EN_CURSO",
      plan: "Cambiar src/app/exportar/boton.tsx para que exporte.",
      topeReparaciones: 3,
      reparaciones: 0,
      intentos: 1,
      ultimosIntentos: [],
    };
    // En el main falso: el commit «tablero: … (<idCorto>)» de la tarjeta.
    const idDeLaTarjeta = nombreDeRama(tarjeta).split("/")[1].split("-")[0];
    // El main local se pone al día con "origin" (la prueba de subir empujó desde su worktree).
    g(REPO, "checkout", "-q", "main");
    g(REPO, "fetch", "-q", "origin");
    g(REPO, "reset", "-q", "--hard", "origin/main");
    fs.mkdirSync(path.join(REPO, "src", "app", "exportar"), { recursive: true });
    fs.writeFileSync(path.join(REPO, "src", "app", "exportar", "boton.tsx"), "export const Boton = () => null;\n");
    g(REPO, "add", "-A");
    g(REPO, "commit", "-qm", `tablero: ${tarjeta.titulo} (${idDeLaTarjeta})`);
    g(REPO, "push", "-q", "origin", "main");
    const commit = shaDe("main");
    const { crm, llamadas } = crmDeNoCambio(tarjeta);
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-no-cambio-"));
    const salida = await procesar({ crm, config: { ...config, carpetaTrabajo: carpeta }, registro: registroFalso() }, tarjeta, NO_CAMBIO);
    assert.equal(salida.accion, "ya_en_main", JSON.stringify(salida));
    assert.equal(salida.yaHecha, true);
    assert.deepEqual(llamadas.map(([que]) => que), ["ya-hecha"], "ni reparar ni ERROR");
    const [, id, datos] = llamadas[0];
    assert.equal(id, tarjeta.id);
    assert.equal(datos.commit, commit);
    assert.ok(datos.nota.startsWith(`ya estaba hecho (commit ${commit}): `), datos.nota);
    assert.match(datos.motivo, /ya está en main/);
    assert.equal(tarjeta.estado, "HECHO");
    const texto = fs.readFileSync(path.join(carpeta, "incidentes", "aizencrm.md"), "utf8");
    assert.match(texto, /^- Qué falló: Claude terminó sin cambiar ningún archivo$/m);
    assert.match(texto, /^- Cómo se resolvió: ya estaba hecho en main$/m);

    // Sin el id: la mayoría de las palabras del título y un archivo del plan también cuentan; solo el título, no.
    const otra = { ...tarjeta, id: "cmyjn7ul5g4444444444444", estado: "EN_CURSO" };
    const conTitulo = crmDeNoCambio(otra);
    const porTitulo = await procesar({ crm: conTitulo.crm, config: { ...config, carpetaTrabajo: carpeta }, registro: registroFalso() }, otra, NO_CAMBIO);
    assert.equal(porTitulo.accion, "ya_en_main");
    assert.equal(conTitulo.llamadas[0][2].commit, commit);
    const sinArchivo = { ...otra, id: "cmyjn7ul5g5555555555555", estado: "EN_CURSO", plan: "Cambiar src/lib/otra-cosa.ts." };
    const sinElArchivo = crmDeNoCambio(sinArchivo);
    const noEsta = await procesar({ crm: sinElArchivo.crm, config: { ...config, carpetaTrabajo: carpeta }, registro: registroFalso() }, sinArchivo, NO_CAMBIO);
    assert.equal(noEsta.accion, "reparar", "el título solo no basta: hace falta un archivo del plan");
  });

  await prueba("no cambió nada: si no está en main vuelve a APROBADO con plan nuevo", async () => {
    const tarjeta = {
      id: "cmyjn7ul5g6666666666666",
      titulo: "Agregar el filtro de ciudad en la bandeja",
      repo: "aizencrm",
      estado: "EN_CURSO",
      plan: "Cambiar src/app/bandeja/filtro.tsx.",
      topeReparaciones: 3,
      reparaciones: 0,
      intentos: 1,
      ultimosIntentos: [],
    };
    const { crm, llamadas } = crmDeNoCambio(tarjeta);
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-plan-nuevo-"));
    const salida = await procesar({ crm, config: { ...config, carpetaTrabajo: carpeta }, registro: registroFalso() }, tarjeta, NO_CAMBIO);
    assert.equal(salida.accion, "reparar");
    assert.equal(salida.estrategia, "plan_nuevo");
    assert.deepEqual(llamadas.map(([que]) => que), ["reparar"]);
    const [, , datos] = llamadas[0];
    assert.equal(datos.estrategia, "plan_nuevo");
    assert.equal(datos.categoria, "no_cambio_nada");
    assert.match(datos.causa, /\[estrategia: plan_nuevo\]$/);
    // Con las reglas reales del CRM vuelve a APROBADO (se planea otra vez), no a PLAN_APROBADO con el plan viejo.
    assert.equal(tarjeta.estado, "APROBADO");
    assert.equal(reglas.estadoTrasReparar("EN_CURSO", null), "PLAN_APROBADO", "sin plan_nuevo, como siempre");
    assert.equal(reglas.estadoTrasReparar("EN_CURSO", "opus"), "PLAN_APROBADO");
    const texto = fs.readFileSync(path.join(carpeta, "incidentes", "aizencrm.md"), "utf8");
    assert.match(texto, /^- Cómo se resolvió: se vuelve a planear la tarea$/m);
    // Parte 4: con la misma causa, plan_nuevo no se repite (sigue opus) y la alerta llega con la 4.ª falla, tras 3 intentos distintos.
    const previa = { accion: "reparar", etapa: "construir", categoria: "no_cambio_nada", causa: datos.causa };
    const diagnostico = { categoria: "no_cambio_nada", causa: "Claude terminó sin cambiar ningún archivo" };
    assert.equal(decidir({ diagnostico, tarjeta: { reparaciones: 1, ultimosIntentos: [previa] }, etapa: "construir" }).estrategia, "opus");
    assert.equal(decidir({ diagnostico, tarjeta: { reparaciones: 2, ultimosIntentos: [previa, previa] }, etapa: "construir" }).accion, "reparar");
    assert.equal(decidir({ diagnostico, tarjeta: { reparaciones: 3, ultimosIntentos: [previa, previa, previa] }, etapa: "construir" }).agotado, true);
  });

  /* ── parte 4: una sola alerta, y solo tras 3 intentos distintos ── */

  await prueba("una sola alerta: error agotado solo tras 3 intentos distintos", async () => {
    // El CRM falso: guarda los intentos como /reparar y /error (con la marca de estrategia que agrega el CRM) y lleva la cuenta.
    const tarjeta = {
      id: "cmyjn7ul5g7777777777777",
      titulo: "Cambio cuyas pruebas siguen fallando",
      repo: "aizencrm",
      estado: "EN_CURSO",
      plan: "Cambiar src/lib/algo.ts.",
      topeReparaciones: 3,
      reparaciones: 0,
      intentos: 1,
      ultimosIntentos: [],
    };
    const llamadas = [];
    const crm = {
      latido: async () => ({ ok: true }),
      reparar: async (id, datos) => {
        llamadas.push(["reparar", id, datos]);
        if (tarjeta.reparaciones >= reglas.TOPE_DE_REPARACIONES) throw Object.assign(new Error("ya lleva 3 reparaciones"), { status: 409 });
        const estrategia = reglas.estrategiaDeEntrada(datos.estrategia);
        tarjeta.reparaciones += 1;
        tarjeta.ultimosIntentos.push({ accion: "reparar", etapa: datos.etapa, categoria: datos.categoria, causa: reglas.causaConEstrategia(datos.causa, estrategia), error: datos.error });
        tarjeta.estado = reglas.estadoTrasReparar("EN_CURSO", estrategia);
        return { ok: true, estado: tarjeta.estado, reparaciones: tarjeta.reparaciones };
      },
      error: async (...args) => (llamadas.push(["error", ...args]), { ok: true }),
      soltar: async (...args) => (llamadas.push(["soltar", ...args]), { ok: true }),
      aviso: async (...args) => (llamadas.push(["aviso", ...args]), { ok: true }),
      causaExterna: async (...args) => (llamadas.push(["causaExterna", ...args]), { ok: true }),
    };
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-agotado-"));
    const conCarpeta = { ...config, carpetaTrabajo: carpeta, bitacora: { ...config.bitacora, activa: false } };
    // Las mismas pruebas fallan 4 veces seguidas, con la misma causa (la salida completa del comando trae 40 líneas).
    const salidaDePruebas = [...Array.from({ length: 39 }, (_, i) => `ok ${i + 1} - prueba ${i + 1}`), "not ok 40 - la bandeja suma mal los totales"].join("\n");
    const fallaDePruebas = () => Object.assign(new ErrorDeEtapa("Fallaron las pruebas que ya existen. No se subió nada.\nnot ok 40 - la bandeja suma mal los totales"), { salida: salidaDePruebas });
    // El registro guarda el log de cada intento en la carpeta (como registro.guardarIntento de registro.mjs).
    const registro = {
      ...registroFalso(),
      guardarIntento: ({ tarjetaId, etapa, texto }) => {
        const ruta = path.join(carpeta, `${tarjetaId}-${llamadas.length}-${etapa}.log`);
        fs.writeFileSync(ruta, texto);
        return ruta;
      },
    };
    const salidas = [];
    for (let vez = 1; vez <= 4; vez += 1) {
      tarjeta.intentos = vez;
      const args = { crm, config: conCarpeta, registro, contexto: { config: conCarpeta, registro }, bitacora: [`INFO intento ${vez}`] };
      salidas.push(await manejarFalla(args, { ...tarjeta, ultimosIntentos: [...tarjeta.ultimosIntentos] }, "construir", fallaDePruebas()));
      if (vez < 4) assert.ok(!llamadas.some(([que]) => que === "error" || que === "aviso"), `la falla ${vez} no crea alerta`);
    }
    // Exactamente 3 reparaciones (cada una con su estrategia, todas distintas) y 1 error agotado al final; ningún aviso.
    const reparaciones = llamadas.filter(([que]) => que === "reparar");
    const errores = llamadas.filter(([que]) => que === "error");
    assert.equal(reparaciones.length, 3, JSON.stringify(llamadas.map(([que]) => que)));
    assert.deepEqual(reparaciones.map(([, , datos]) => datos.estrategia), ["arreglo", "opus", "nube"], "3 estrategias distintas");
    assert.equal(errores.length, 1);
    assert.equal(llamadas.at(-1)[0], "error", "el error es lo último, ninguno antes");
    assert.ok(!llamadas.some(([que]) => que === "aviso"), "sin WhatsApp");
    assert.deepEqual(salidas.map((s) => s.accion), ["reparar", "reparar", "reparar", "escalar"]);
    const [, id, resumen, , , extra] = errores[0];
    assert.equal(id, tarjeta.id);
    assert.equal(extra.agotado, true);
    assert.equal(extra.categoria, "fallan_pruebas");
    assert.ok(resumen.split("\n").length <= 3, resumen);
    assert.match(resumen, /^Qué se intentó: .*3 veces de formas distintas \(arreglo, opus, nube\)/m);
    assert.match(resumen, /^Causa: Las pruebas siguen fallando/m);
    // El intento siguiente de las pruebas recibe la ruta del log completo y sus últimas 30 líneas (no solo la primera línea).
    const [, , primera] = reparaciones[0];
    const ruta = primera.error.match(/^Log completo del intento anterior \(en aizen1\): (.+)$/m)?.[1];
    assert.ok(ruta && fs.existsSync(ruta), primera.error);
    assert.match(fs.readFileSync(ruta, "utf8"), /not ok 40 - la bandeja suma mal los totales\s*$/, "el log guardado termina con la salida del comando");
    assert.match(primera.error, /Últimas 30 líneas del log:\n/);
    assert.match(primera.error, /ok 11 - prueba 11\n[\s\S]*not ok 40/, "trae las últimas 30 líneas de la salida");
    assert.doesNotMatch(primera.error, /ok 10 - prueba 10\n/, "solo las últimas 30");
  });

  /* ── 27-nov-2026, parte 3 de «si una reparación falla por el mismo motivo, no repetir igual»: la misma causa no se repara igual ── */

  // El CRM falso de la parte 3: anota todo; /depender suelta la tarjeta (la otra no está HECHO); /reparar suma como el de verdad.
  const crmDeMismaCausa = (tarjeta, { depender = async () => ({ ok: true, soltada: true, estado: "PLAN_APROBADO", esperando: "Esperando a «Parte 1»" }) } = {}) => {
    const llamadas = [];
    const crm = {
      latido: async () => ({ ok: true }),
      depender: async (id, datos) => (llamadas.push(["depender", id, datos]), depender(id, datos)),
      reparar: async (id, datos) => {
        llamadas.push(["reparar", id, datos]);
        tarjeta.reparaciones = (tarjeta.reparaciones ?? 0) + 1;
        tarjeta.ultimosIntentos.push({ accion: "reparar", etapa: datos.etapa, categoria: datos.categoria, causa: reglas.causaConEstrategia(datos.causa, reglas.estrategiaDeEntrada(datos.estrategia)) });
        return { ok: true, reparaciones: tarjeta.reparaciones };
      },
      error: async (...args) => (llamadas.push(["error", ...args]), { ok: true }),
      soltar: async (...args) => (llamadas.push(["soltar", ...args]), { ok: true }),
      aviso: async (...args) => (llamadas.push(["aviso", ...args]), { ok: true }),
      causaExterna: async (...args) => (llamadas.push(["causaExterna", ...args]), { ok: true }),
      yaHecha: async (...args) => (llamadas.push(["ya-hecha", ...args]), { ok: true, estado: "HECHO" }),
    };
    return { crm, llamadas };
  };
  const argsDe = (crm, carpeta) => {
    const conCarpeta = { ...config, carpetaTrabajo: carpeta };
    const registro = registroFalso();
    return { crm, config: conCarpeta, registro, contexto: { config: conCarpeta, registro }, bitacora: [] };
  };
  const PARTE_1 = "La parte 1 no está en main: no se puede construir sobre ella.";

  await prueba("misma causa: la causa en una frase y la comparación sin hashes, fechas ni links", async () => {
    assert.equal(causaEnUnaFrase({ categoria: "otra", causa: "La parte 1 no está en main (commit 1a2b3c4d5e) https://x.co/y [estrategia: opus]" }), "otra: La parte N no está en main");
    // Dos fallas que solo cambian en el commit o la fecha cuentan como la misma.
    assert.equal(causaParaComparar("Falta el commit 1a2b3c4d5e del 2026-11-26"), causaParaComparar("Falta el commit 9f8e7d6c5b del 2026-11-27"));
    assert.equal(causaParaComparar("Se cortó el 26-nov-2026"), causaParaComparar("Se cortó el 27-oct-2026"));
    assert.ok(esLaMismaCausa({ categoria: "otra", causa: "No está el commit abc1234" }, { categoria: "otra", causa: "No está el commit def5678 [estrategia: opus]" }));
    assert.ok(!esLaMismaCausa({ categoria: "otra", causa: "falta la tabla Pedido" }, { categoria: "otra", causa: "falta la tabla Cliente" }), "lo demás sigue siendo distinto");
    // Qué es una causa de dependencia o de main (y qué no).
    for (const si of ["La parte 1 no está en main", "Depende de «Parte 1: la base»", "DEPENDE_DE: T-996", "la parte 2 de 4 no está todavía"]) assert.ok(esCausaDeDependencia(si), si);
    for (const no of ["no cambió nada y no está en main: se vuelve a planear", "Fallaron las pruebas: not ok 3", ""]) assert.ok(!esCausaDeDependencia(no), no);
    // Las referencias que nombra la causa: «títulos» e ids, sin la propia tarjeta.
    assert.deepEqual(referenciasDeLaCausa("Depende de «Parte 1: la base» y de cmabcdefghijklmnopqrstuvw", { id: "cmzzzzzzzzzzzzzzzzzzzzzzz", titulo: "Yo" }), ["cmabcdefghijklmnopqrstuvw", "Parte 1: la base"]);
    assert.deepEqual(referenciasDeLaCausa("La parte 1 no está en main"), []);
  });

  await prueba("misma causa de dependencia: la 3.ª decisión es esperar_dependencia, no reparar", async () => {
    const diagnostico = diagnosticar({ error: new ErrorDeEtapa(PARTE_1), etapa: "construir" });
    assert.equal(diagnostico.categoria, "otra");
    const previa = { accion: "reparar", etapa: "construir", categoria: "otra", causa: diagnostico.causa };
    const primera = decidir({ diagnostico, tarjeta: { reparaciones: 0, ultimosIntentos: [] }, etapa: "construir" });
    assert.equal(primera.accion, "reparar", "la 1.ª vez se repara como siempre");
    assert.ok(primera.porQueEsDistinto, "la reparación dice por qué es distinta");
    // Dos fallas seguidas con la misma causa ("la parte 1 no está en main", aunque cambie el commit): la siguiente no repara.
    const otraVez = { ...previa, causa: `${diagnostico.causa} (commit 1a2b3c4d5e) [estrategia: opus]` };
    for (const intentos of [[previa], [previa, otraVez]]) {
      const decision = decidir({ diagnostico, tarjeta: { reparaciones: intentos.length, ultimosIntentos: intentos }, etapa: "construir" });
      assert.equal(decision.accion, "esperar_dependencia", JSON.stringify(decision));
      assert.equal(decision.cuenta, false, "no gasta reparación");
      assert.match(decision.porQueEsDistinto, /no se repara igual/);
      assert.match(decision.queCambia, /se espera a la tarjeta de la que depende/);
    }
    // Un no_cambio_nada cuyo NO_CAMBIE dice lo mismo también espera (no prueba Opus ni plan nuevo).
    const sinCambios = { categoria: "no_cambio_nada", causa: "Claude terminó sin cambiar ningún archivo: la parte 1 no está en main" };
    const previaSinCambios = { accion: "reparar", etapa: "construir", categoria: "no_cambio_nada", causa: `${sinCambios.causa} [estrategia: plan_nuevo] (estrategia: plan_nuevo)` };
    assert.equal(decidir({ diagnostico: sinCambios, tarjeta: { reparaciones: 1, ultimosIntentos: [previaSinCambios] }, etapa: "construir" }).accion, "esperar_dependencia");
    // Las causas de código siguen sus estrategias de siempre, aunque digan "no está en main".
    const pruebasRotas = { categoria: "fallan_pruebas", causa: "Fallaron las pruebas que ya existían: not ok 3 - la función no está en main" };
    const previaDePruebas = { accion: "reparar", etapa: "construir", categoria: "fallan_pruebas", causa: `${pruebasRotas.causa} [estrategia: arreglo]` };
    const deCodigo = decidir({ diagnostico: pruebasRotas, tarjeta: { reparaciones: 1, ultimosIntentos: [previaDePruebas] }, etapa: "construir" });
    assert.deepEqual([deCodigo.accion, deCodigo.estrategia], ["reparar", "opus"]);
    // Una causa distinta a la anterior, aunque sea de dependencia, se repara la 1.ª vez.
    assert.equal(decidir({ diagnostico, tarjeta: { reparaciones: 1, ultimosIntentos: [{ ...previa, causa: "Otra cosa distinta que falló antes" }] }, etapa: "construir" }).accion, "reparar");
  });

  await prueba("esperar_dependencia: llama crm.depender con las referencias de la tarjeta; sin referencias, crm.error depende_de_sin_main; nunca crm.reparar", async () => {
    const diagnostico = diagnosticar({ error: new ErrorDeEtapa(PARTE_1), etapa: "construir" });
    const previas = () => [
      { accion: "reparar", etapa: "construir", categoria: "otra", causa: diagnostico.causa },
      { accion: "reparar", etapa: "construir", categoria: "otra", causa: `${diagnostico.causa} [estrategia: opus] (estrategia: opus)` },
    ];
    // 1) La tarjeta nombra a la parte 1 ("depende de «…»"): flecha y espera, sin reparar.
    const conReferencia = {
      id: "cmyjn7ul5g8888888888888",
      titulo: "Coordinador: parte 3",
      detalle: "Parte 3 de 4. Depende de «Coordinador parte 1».",
      repo: "aizencrm",
      estado: "EN_CURSO",
      topeReparaciones: 3,
      reparaciones: 2,
      intentos: 3,
      ultimosIntentos: previas(),
    };
    const uno = crmDeMismaCausa(conReferencia);
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-misma-causa-"));
    const salida = await manejarFalla(argsDe(uno.crm, carpeta), conReferencia, "construir", new ErrorDeEtapa(PARTE_1));
    assert.equal(salida.accion, "esperar_dependencia", JSON.stringify(salida));
    assert.deepEqual(uno.llamadas.map(([que]) => que), ["depender"], "solo la flecha: ni reparar ni ERROR");
    assert.deepEqual(uno.llamadas[0][2].referencias, ["Coordinador parte 1"]);
    // Queda en la bitácora como corte por misma causa, con su porqué.
    const texto = fs.readFileSync(path.join(carpeta, "incidentes", "aizencrm.md"), "utf8");
    assert.match(texto, /^- Qué falló: se cortó: misma causa que el intento anterior$/m);
    assert.match(texto, /^- Causa: otra: La parte N no está en main/m);
    assert.match(texto, /^- Qué cambia: no se repara: se espera a la tarjeta de la que depende/m);
    assert.match(texto, /^- Por qué es distinto: no se repara igual/m);
    assert.match(texto, /^- Cómo se resolvió: se espera a la tarjeta de la que depende, sin reparar ni gastar intento$/m);

    // 2) Sin a quién esperar: ERROR depende_de_sin_main con el motivo y el porqué; ni depender ni reparar.
    const sinReferencia = { ...conReferencia, id: "cmyjn7ul5g9999999999999", titulo: "Coordinador: otra parte", detalle: "Algo sin nombres.", ultimosIntentos: previas() };
    const dos = crmDeMismaCausa(sinReferencia);
    const sinNadie = await manejarFalla(argsDe(dos.crm, fs.mkdtempSync(path.join(T, "trabajo-misma-causa-"))), sinReferencia, "construir", new ErrorDeEtapa(PARTE_1));
    assert.equal(sinNadie.categoria, "depende_de_sin_main");
    assert.deepEqual(dos.llamadas.map(([que]) => que), ["error"], "solo ERROR");
    const [, id, resumen, , , extra] = dos.llamadas[0];
    assert.equal(id, sinReferencia.id);
    assert.equal(extra.categoria, "depende_de_sin_main");
    assert.ok(resumen.split("\n").length <= 3, resumen);
    assert.match(resumen, /no se sabe a qué tarjeta esperar/);
    assert.deepEqual(Object.keys(extra.porQue).sort(), ["causa", "porQueEsDistinto", "queCambia"]);

    // 3) La tarjeta nombrada ya está HECHA a mano sin su código en main: el camino de DEPENDE_DE la deja en ERROR (tampoco repara).
    const hechaAMano = { ...conReferencia, id: "cmyjn7ul5g0101010101010", ultimosIntentos: previas() };
    const tres = crmDeMismaCausa(hechaAMano, { depender: async () => ({ ok: true, soltada: false, tarjetas: [{ id: "cmotraotraotraotraotraotr", titulo: "Coordinador parte 1", estado: "HECHO", hechaAMano: true }] }) });
    const sinMain = await manejarFalla(argsDe(tres.crm, fs.mkdtempSync(path.join(T, "trabajo-misma-causa-"))), hechaAMano, "construir", new ErrorDeEtapa(PARTE_1));
    assert.equal(sinMain.categoria, "depende_de_sin_main", JSON.stringify(sinMain));
    assert.deepEqual(tres.llamadas.map(([que]) => que), ["depender", "error"]);
    assert.ok(tres.llamadas[1][5].porQue, "el ERROR lleva el porqué");
    assert.ok(![uno, dos, tres].some(({ llamadas }) => llamadas.some(([que]) => que === "reparar")), "nunca crm.reparar");
  });

  await prueba("no cambió nada con el mismo motivo dos veces: se escala con mismaCausa, sin una 3.ª reparación", async () => {
    const MOTIVO = "el botón de exportar ya hace lo que pide la tarea";
    const fallaSinCambios = () => new ErrorDeEtapa(`${NO_CAMBIO}\nNO_CAMBIE: ${MOTIVO}`);
    const diagnostico = diagnosticar({ error: fallaSinCambios(), etapa: "construir" });
    assert.equal(diagnostico.categoria, "no_cambio_nada");
    const previas = () => [
      { accion: "reparar", etapa: "construir", categoria: "no_cambio_nada", causa: reglas.causaConEstrategia(causaConMarca(diagnostico.causa, "plan_nuevo"), "plan_nuevo") },
      { accion: "reparar", etapa: "construir", categoria: "no_cambio_nada", causa: reglas.causaConEstrategia(causaConMarca(diagnostico.causa, "opus"), "opus") },
    ];
    const decision = decidir({ diagnostico, tarjeta: { reparaciones: 2, topeReparaciones: 3, ultimosIntentos: previas() }, etapa: "construir" });
    assert.deepEqual([decision.accion, decision.mismaCausa, decision.reparaciones], ["escalar", true, 2], JSON.stringify(decision));
    assert.match(decision.porQueEsDistinto, /no hay nada distinto que probar/);
    // Sin el motivo de NO_CAMBIE, sus estrategias siguen como hoy (queda "nube").
    const sinMotivo = { categoria: "no_cambio_nada", causa: "Claude terminó sin cambiar ningún archivo" };
    const previaSinMotivo = [
      { accion: "reparar", categoria: "no_cambio_nada", causa: `${sinMotivo.causa} [estrategia: plan_nuevo]` },
      { accion: "reparar", categoria: "no_cambio_nada", causa: `${sinMotivo.causa} [estrategia: opus]` },
    ];
    assert.deepEqual(
      ["accion", "estrategia"].map((campo) => decidir({ diagnostico: sinMotivo, tarjeta: { reparaciones: 2, ultimosIntentos: previaSinMotivo }, etapa: "construir" })[campo]),
      ["reparar", "nube"],
    );

    // De punta a punta: no hay tercera llamada a crm.reparar; queda ERROR con el motivo, el porqué y la bitácora del corte.
    const tarjeta = {
      id: "cmyjn7ul5g1212121212121",
      titulo: "Ajustar la ayuda del exportador viejo",
      repo: "aizencrm",
      estado: "EN_CURSO",
      plan: "Cambiar src/lib/no-existe-en-main.ts.",
      topeReparaciones: 3,
      reparaciones: 2,
      intentos: 3,
      ultimosIntentos: previas(),
    };
    const { crm, llamadas } = crmDeMismaCausa(tarjeta);
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-no-cambio-igual-"));
    const salida = await manejarFalla(argsDe(crm, carpeta), { ...tarjeta, ultimosIntentos: previas() }, "construir", fallaSinCambios());
    assert.equal(salida.accion, "escalar", JSON.stringify(salida));
    assert.equal(salida.mismaCausa, true);
    assert.ok(!llamadas.some(([que]) => que === "reparar"), "sin una 3.ª reparación");
    const errores = llamadas.filter(([que]) => que === "error");
    assert.equal(errores.length, 1);
    const [, , resumen, , , extra] = errores[0];
    assert.ok(resumen.includes(MISMA_CAUSA), resumen);
    assert.equal(extra.categoria, "no_cambio_nada");
    assert.match(extra.porQue.causa, /^no_cambio_nada: Claude terminó sin cambiar ningún archivo: el botón de exportar/);
    assert.match(extra.porQue.queCambia, /no se repara otra vez/);
    assert.match(extra.porQue.porQueEsDistinto, /misma que la del intento anterior/);
    const texto = fs.readFileSync(path.join(carpeta, "incidentes", "aizencrm.md"), "utf8");
    assert.match(texto, /^- Qué falló: se cortó: misma causa que el intento anterior$/m);
    assert.match(texto, /^- Qué cambia: no se repara otra vez/m);
    assert.match(texto, /^- Por qué es distinto: no hay nada distinto que probar/m);
  });

  await prueba("cada reparación manda al CRM y a la bitácora la causa, qué cambia y por qué es distinto", async () => {
    const tarjeta = { id: "cmyjn7ul5g1313131313131", titulo: "Cambio que no compila", repo: "aizencrm", estado: "EN_CURSO", topeReparaciones: 3, reparaciones: 0, intentos: 1, ultimosIntentos: [] };
    const { crm, llamadas } = crmDeMismaCausa(tarjeta);
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-porque-"));
    const salida = await manejarFalla(argsDe(crm, carpeta), { ...tarjeta, ultimosIntentos: [] }, "construir", new ErrorDeEtapa("No compiló.\nsrc/a.ts(3,1): error TS2322: Type 'x' is not assignable", { categoria: "no_compila" }));
    assert.equal(salida.accion, "reparar");
    const [, , datos] = llamadas.find(([que]) => que === "reparar");
    assert.match(datos.porQue.causa, /^no_compila: El código no compila: .*error TSN/);
    assert.match(datos.porQue.queCambia, /primer arreglo/);
    assert.match(datos.porQue.porQueEsDistinto, /primer intento que falla/);
    assert.deepEqual(salida.porQue, datos.porQue);
    // La bitácora la anota aunque no sea una de las fallas repetidas (antes solo se anotaban esas).
    const texto = fs.readFileSync(path.join(carpeta, "incidentes", "aizencrm.md"), "utf8");
    assert.match(texto, /^- Causa: no_compila: El código no compila/m);
    assert.match(texto, /^- Qué cambia: es el primer arreglo/m);
    assert.match(texto, /^- Por qué es distinto: es el primer intento que falla/m);
    assert.equal((texto.match(/^### /gm) ?? []).length, 1, "una sola entrada por falla");
    // Lo que el CRM guarda en el historial: tres textos de 300 letras (porQueDeEntrada de reglas-trabajador.ts).
    assert.deepEqual(reglas.porQueDeEntrada(datos.porQue), datos.porQue);
  });

  console.log(`\n${pruebas} pruebas OK`);
} finally {
  servidor.close();
  fs.rmSync(T, { recursive: true, force: true, maxRetries: 3 });
}
