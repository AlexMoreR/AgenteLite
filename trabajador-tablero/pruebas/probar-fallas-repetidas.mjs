// Pruebas de las FALLAS REPETIDAS del Coordinador (25-nov-2026), parte 1: "no arrancó" y la reversión falsa (T-902 470c7f1,
// T-800). Parte 2: la nube sin señal se reintenta en una sesión nueva (T-921) y la bitácora anota las fallas repetidas.
// Sin red de verdad, sin CRM y sin WhatsApp:
//   node trabajador-tablero/pruebas/probar-fallas-repetidas.mjs   (también corre dentro de npm run test:trabajador-tablero)
// El CRM falso es un servidor local que contesta /api/version; el git falso es un repo con su "origin" en una carpeta
// temporal; el ssh falso imprime el log de actualizar.sh que pide la prueba; el reloj falso se adelanta con cada espera.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { rutaDeIncidentes } from "../lib/bitacora.mjs";
import { resolverLaSubidaDeshecha } from "../lib/bucle.mjs";
import { LOG_ACTUALIZAR_POR_DEFECTO, PISO_VERSION_MINUTOS, completarConfig } from "../lib/config.mjs";
import { FRASES_DE_LA_CAUSA, SIN_REPARACION_AUTOMATICA, TOPE_INTENTOS_DE_SUBIDA, causaConMarca, causaExterna, decidir, diagnosticar, estrategiaDeLaCausa, queHacerConLaSubidaDeshecha } from "../lib/diagnostico.mjs";
import { ErrorDeEtapa, esperarVersion, ramaParaLaNube, subir } from "../lib/etapas.mjs";
import { nombreDeRama } from "../lib/git.mjs";
import { abreSesionNueva, lanzarSesionDeLaNube, sesionesDeIntentosAnteriores } from "../lib/nube.mjs";

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
    // Parte 2: la bitácora la anota como reversion_falsa / resubir, con la línea "Qué se intentó".
    const anotada = fs.readFileSync(rutaDeIncidentes(config.carpetaTrabajo, "aizencrm"), "utf8");
    assert.match(anotada, /^- Qué falló: se deshizo antes de que el servidor bajara la versión \(reversión falsa\)$/m);
    assert.match(anotada, /^- Cómo se resolvió: se vuelve a subir el mismo commit$/m);
    assert.match(anotada, new RegExp(`^- Qué se intentó: intento ${TOPE_INTENTOS_DE_SUBIDA} de ${TOPE_INTENTOS_DE_SUBIDA} \\(no suma al tope de subidas`, "m"));

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

  /* ── parte 2: la nube sin señal (T-921, la misma sesión fija session_01XuE6FdupseQWg3mMsf45er recibió el reintento) ── */
  const FIJA = "session_01XuE6FdupseQWg3mMsf45er";
  const NUEVA = "session_01NuevaDeLaPrueba2";
  const CLAUDE_LOG = path.join(T, "claude-nube.log");
  const CLAUDE = path.join(T, "claude-nube-falso.mjs");
  // El claude falso: `-p <msg> --cloud <session_…>` es escribirle a una sesión que ya existe (contesta su JSON); `-p --cloud`
  // sin id abre una sesión nueva e imprime su link (CLAUDE_FALSO_LINK, o NUEVA). Anota cada llamada.
  fs.writeFileSync(
    CLAUDE,
    [
      'import fs from "node:fs";',
      "const args = process.argv.slice(2);",
      `fs.appendFileSync(${JSON.stringify(CLAUDE_LOG)}, JSON.stringify(args) + "\\n");`,
      'const i = args.indexOf("--cloud");',
      'const id = /^session_/.test(args[i + 1] ?? "") ? args[i + 1] : null;',
      'if (id) { console.log(JSON.stringify({ ok: true, session_id: id })); process.exit(0); }',
      `console.log("Sesión creada: " + (process.env.CLAUDE_FALSO_LINK || "https://claude.ai/code/${NUEVA}") + " (lista)");`,
    ].join("\n"),
  );
  const llamadasAClaude = () => (fs.existsSync(CLAUDE_LOG) ? fs.readFileSync(CLAUDE_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const aLaFija = () => llamadasAClaude().filter((args) => args.includes(FIJA));
  const configNube = { ...config, nube: { ...config.nube, activa: true, comandoClaude: [process.execPath, CLAUDE], terminal: "sin-terminal", chequeoPrevio: false, lanzarMinutos: 1 } };
  // Con sesión fija Y modo orquestador: lo de T-921.
  const repoFijo = { ...repo, clave: "aizencrm", github: "prueba/repo", nube: { sesionFija: FIJA, orquestador: true } };
  const errorSinSenal = (link) =>
    new ErrorDeEtapa(`La sesión de la nube no dio señal (ni el commit "inicio:" ni ningún otro) en la rama tablero/t921-x en 20 min: se cortó la espera. Mírala: ${link}`, { categoria: "nube_sin_resultado" });

  await prueba("nube sin señal: el reintento abre una sesión nueva", async () => {
    // 1) Ya no va directo a ERROR: se repara con la estrategia sesion_nueva, y la marca deja el link entero.
    assert.ok(!SIN_REPARACION_AUTOMATICA.includes("nube_sin_resultado"));
    const diagnostico = diagnosticar({ error: errorSinSenal(`https://claude.ai/code/${FIJA}`), etapa: "construir" });
    assert.equal(diagnostico.categoria, "nube_sin_resultado");
    const decision = decidir({ diagnostico, tarjeta: { reparaciones: 0, ultimosIntentos: [] }, etapa: "construir" });
    assert.deepEqual([decision.accion, decision.cuenta, decision.estrategia], ["reparar", true, "sesion_nueva"]);
    const causa = causaConMarca(diagnostico.causa, decision.estrategia);
    assert.ok(causa.length <= 160 + " [estrategia: sesion_nueva]".length, `cabe en las 200 del CRM con su cola: ${causa}`);
    assert.ok(causa.includes(`https://claude.ai/code/${FIJA}`), `el link no se corta: ${causa}`);
    assert.equal(estrategiaDeLaCausa(causa), "sesion_nueva");
    // La 3.ª vez seguida queda la alerta (ERROR): 2 sesiones nuevas probadas.
    const dos = [1, 2].map(() => ({ accion: "reparar", etapa: "construir", categoria: "nube_sin_resultado", causa }));
    assert.equal(decidir({ diagnostico, tarjeta: { reparaciones: 2, ultimosIntentos: dos }, etapa: "construir" }).accion, "escalar");

    // 2) El lanzamiento: con sesión fija y orquestador, la tarjeta que ya tuvo nube_sin_resultado abre una sesión nueva
    //    (`claude -p --cloud` sin id) y no le escribe a la sesión fija.
    const tarjeta = { id: "cmt921xx0001", titulo: "Coordinador nube sin señal", repo: "aizencrm", ultimosIntentos: [{ numero: 1, accion: "reparar", etapa: "construir", categoria: "nube_sin_resultado", causa }] };
    const registro = registroFalso();
    const lanzado = await lanzarSesionDeLaNube({ config: configNube, registro, orquestador: true }, { repo: repoFijo, cwd: T, prompt: "construye la tarjeta", tarjeta });
    assert.equal(lanzado.link, `https://claude.ai/code/${NUEVA}`);
    assert.equal(lanzado.via, "sin-terminal", "es `claude --cloud`, no la sesión fija");
    assert.deepEqual(aLaFija(), [], "nada a la sesión fija");
    assert.ok(registro.lineas.some((l) => /abro una sesión nueva con claude --cloud/.test(l)), registro.lineas.join("\n"));

    // 3) La rama sigue con su sufijo nuevo: la del intento anterior ya está en GitHub -> -nube2.
    const principal = nombreDeRama(tarjeta);
    g(REPO, "push", "-q", "origin", `main:refs/heads/${principal}`);
    const rama = await ramaParaLaNube(repoFijo, tarjeta);
    assert.equal(rama, `${principal}-nube2`);
  });

  await prueba("nube sin señal: nunca reusa la sesión de un intento anterior", async () => {
    const causaVieja = causaConMarca(diagnosticar({ error: errorSinSenal(`https://claude.ai/code/${FIJA}`), etapa: "construir" }).causa, "sesion_nueva");
    const tarjeta = { id: "cmt921xx0002", titulo: "Otra", repo: "aizencrm", ultimosIntentos: [{ accion: "reparar", categoria: "nube_sin_resultado", causa: causaVieja }], ultimoError: `x\nSesión de la nube: https://claude.ai/code/${NUEVA}` };
    // Los links de los intentos anteriores (causa y último error), y la fija es una de ellas.
    assert.deepEqual(sesionesDeIntentosAnteriores(tarjeta).sort(), [FIJA, NUEVA].sort());
    assert.deepEqual(abreSesionNueva({ orquestador: true }, repoFijo, tarjeta), { nueva: true, porque: "ya_usada" });
    // Sin modo orquestador, solo con sesión fija, tampoco se le escribe.
    assert.equal(abreSesionNueva({}, { ...repoFijo, nube: { sesionFija: FIJA, orquestador: false } }, tarjeta).nueva, true);

    // Si `claude --cloud` devolviera la sesión de un intento anterior, no se sigue con ella (nube_sin_resultado: otra nueva).
    const antes = aLaFija().length;
    process.env.CLAUDE_FALSO_LINK = `https://claude.ai/code/${NUEVA}`;
    try {
      const error = await lanzarSesionDeLaNube({ config: configNube, registro: registroFalso() }, { repo: repoFijo, cwd: T, prompt: "p", tarjeta }).then(
        () => assert.fail("no tenía que reusar la sesión"),
        (e) => e,
      );
      assert.equal(error.categoria, "nube_sin_resultado", error.message);
      assert.match(error.message, /no se reusa/);
    } finally {
      delete process.env.CLAUDE_FALSO_LINK;
    }
    assert.equal(aLaFija().length, antes, "nunca se le escribió a la sesión fija");

    // Sin un intento nube_sin_resultado todo sigue como antes: va a la sesión fija (solo cambia esa tarjeta).
    const normal = await lanzarSesionDeLaNube({ config: configNube, registro: registroFalso(), orquestador: true }, { repo: repoFijo, cwd: T, prompt: "p", tarjeta: { id: "t3", ultimosIntentos: [{ categoria: "no_compila", causa: "x" }] } });
    assert.equal(normal.via, "sesion-fija");
    assert.equal(normal.link, `https://claude.ai/code/${FIJA}`);
  });

  console.log(`\n${pruebas} pruebas OK`);
} finally {
  servidor.close();
  fs.rmSync(T, { recursive: true, force: true, maxRetries: 3 });
}
