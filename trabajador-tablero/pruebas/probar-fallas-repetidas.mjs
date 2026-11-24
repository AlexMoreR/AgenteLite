// Pruebas de las fallas repetidas del Coordinador (24-nov-2026), parte 1: «no arrancó».
// La reversión falsa de T-902 (470c7f1) y T-800: con el reloj de la etapa subir ya gastado (el CI tardó), esperarVersion lanzaba
// al instante y la versión se deshacía a los ~2 min, antes de que el servidor bajara la imagen. Acá, con un CRM falso (su
// /api/version y el cliente que anota lo que se le pide), un git de prueba en una carpeta temporal, el ssh falso y un reloj
// falso que se adelanta a mano, se comprueba que:
//   - no se deshace antes del piso de 15 min desde la subida, aunque reloj.resta() lance;
//   - antes de deshacer se lee /api/version y el log de actualizar.sh: sin "listo: version <sha>" la reversión es "falsa";
//   - una reversión falsa decide "esperar", no suma al tope de subidas y en la vuelta siguiente se sube el mismo commit.
//   node trabajador-tablero/pruebas/probar-fallas-repetidas.mjs   (también corre dentro de npm run test:trabajador-tablero)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolverLaSubidaDeshecha } from "../lib/bucle.mjs";
import { LOG_ACTUALIZAR_POR_DEFECTO, PISO_VERSION_MINUTOS, completarConfig } from "../lib/config.mjs";
import { FRASES_DE_LA_CAUSA, TOPE_INTENTOS_DE_SUBIDA, causaExterna, decidir, queHacerConLaSubidaDeshecha } from "../lib/diagnostico.mjs";
import { ErrorDeEtapa, esperarVersion, revertQueLoDeshace, revisarAntesDeDeshacer, shasListosDelLog } from "../lib/etapas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MINUTO = 60_000;
const T = fs.mkdtempSync(path.join(os.tmpdir(), "fallas-repetidas-"));

let fallas = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas += 1;
    console.log(`not ok - ${nombre}`);
    console.log(error?.stack ?? error);
  }
}

// ── El git de prueba: un remoto "bare" y su clon, con main ──
const g = (cwd, ...argumentos) =>
  execFileSync("git", argumentos, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "Prueba", GIT_AUTHOR_EMAIL: "p@x.co", GIT_COMMITTER_NAME: "Prueba", GIT_COMMITTER_EMAIL: "p@x.co" },
  }).trim();
const REMOTO = path.join(T, "remoto.git");
const REPO = path.join(T, "repo");
g(T, "init", "--bare", "-q", "-b", "main", REMOTO);
g(T, "clone", "-q", REMOTO, REPO);
g(REPO, "checkout", "-q", "-B", "main");
fs.writeFileSync(path.join(REPO, "leeme.txt"), "base\n");
g(REPO, "add", ".");
g(REPO, "commit", "-q", "-m", "base");
const VIEJA = g(REPO, "rev-parse", "HEAD");
// El commit de la tarea (el que se subió y "no arrancó").
fs.writeFileSync(path.join(REPO, "compras.ts"), "export const compras = 1;\n");
g(REPO, "add", ".");
g(REPO, "commit", "-q", "-m", "tarea: editar compra");
const COMMIT = g(REPO, "rev-parse", "HEAD");
g(REPO, "push", "-q", "origin", "main");

// ── El CRM falso: /api/version dice lo que pongamos en `versionDelCrm` ──
let versionDelCrm = VIEJA;
let lecturasDeVersion = 0;
const servidor = http.createServer((pedido, respuesta) => {
  if (pedido.method === "GET" && pedido.url === "/api/version") {
    lecturasDeVersion += 1;
    respuesta.writeHead(200, { "Content-Type": "application/json" });
    return respuesta.end(JSON.stringify({ version: versionDelCrm }));
  }
  respuesta.writeHead(404);
  respuesta.end();
});
await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
const URL_VERSION = `http://127.0.0.1:${servidor.address().port}/api/version`;

/** El reloj falso: `ahora()` no corre solo; `esperar(ms)` lo adelanta sin dormir de verdad. */
function crearRelojFalso(inicio = Date.parse("2026-11-24T10:00:00Z")) {
  let t = inicio;
  return { ahora: () => t, esperar: async (ms) => void (t += ms), pasar: (minutos) => void (t += minutos * MINUTO), inicio };
}

/** El reloj de la etapa subir ya gastado: resta() lanza como relojDeEtapa cuando el CI se comió los 44 min. */
function relojDeEtapaGastado() {
  const veces = { resta: 0 };
  return {
    veces,
    resta() {
      veces.resta += 1;
      throw new ErrorDeEtapa("Se pasó del tiempo de subir (44 min).", { categoria: "tiempo_agotado" });
    },
    extender() {},
    esperado: () => 0,
  };
}

const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`), error: (m) => lineas.push(`ERROR ${m}`) };
};

const repoDePrueba = (subida = {}) => ({
  clave: "aizencrm",
  ruta: REPO,
  remoto: "origin",
  ramaBase: "main",
  subida: {
    urlVersion: URL_VERSION,
    campoVersion: "version",
    versionMinutos: 0,
    ciMinutos: 20,
    urlArranque: null,
    pisoVersionMinutos: PISO_VERSION_MINUTOS,
    logActualizar: LOG_ACTUALIZAR_POR_DEFECTO,
    ...subida,
  },
});

const configDePrueba = { carpetaTrabajo: path.join(T, "trabajo"), ssh: { comando: [process.execPath, path.join(AQUI, "ssh-falso.mjs")], destino: "prueba@servidor-falso" } };

try {
  await prueba("config: el piso de 15 min y el comando del log de actualizar.sh salen de config.example.json", async () => {
    const ejemplo = JSON.parse(fs.readFileSync(path.join(AQUI, "..", "config.example.json"), "utf8"));
    const completa = completarConfig(ejemplo);
    assert.equal(PISO_VERSION_MINUTOS, 15);
    assert.equal(completa.repos.aizencrm.subida.pisoVersionMinutos, 15);
    assert.equal(completa.repos.aizencrm.subida.logActualizar, "tail -n 300 /var/log/crm-actualizar.log");
    // Sin la clave: el de por defecto para el CRM; Gestión tiene su propio logsArranque y no lee el log del CRM.
    const sinClaves = structuredClone(ejemplo);
    delete sinClaves.repos.aizencrm.subida.logActualizar;
    delete sinClaves.repos.aizencrm.subida.pisoVersionMinutos;
    const porDefecto = completarConfig(sinClaves);
    assert.equal(porDefecto.repos.aizencrm.subida.logActualizar, LOG_ACTUALIZAR_POR_DEFECTO);
    assert.equal(porDefecto.repos.aizencrm.subida.pisoVersionMinutos, PISO_VERSION_MINUTOS);
    assert.equal(porDefecto.repos.gestion.subida.logActualizar, null);
  });

  await prueba("no arrancó: con el reloj de la etapa gastado no deshace antes de 15 min", async () => {
    const reloj = relojDeEtapaGastado();
    const falso = crearRelojFalso();
    versionDelCrm = VIEJA;
    lecturasDeVersion = 0;
    let error = null;
    try {
      await esperarVersion({ registro: registroFalso() }, repoDePrueba(), COMMIT, reloj, { subidoEn: falso.inicio, ahora: falso.ahora, esperar: falso.esperar });
    } catch (lanzado) {
      error = lanzado;
    }
    assert.ok(error instanceof ErrorDeEtapa, "se rinde con un ErrorDeEtapa (no arrancó)");
    assert.equal(error.esperandoVersion, true, "subir() revisa antes de deshacer");
    assert.doesNotMatch(error.message, /Se pasó del tiempo/, "no es el error del reloj de la etapa");
    assert.equal(reloj.veces.resta, 0, "esperarVersion no llama a reloj.resta()");
    const esperado = falso.ahora() - falso.inicio;
    assert.ok(esperado >= 15 * MINUTO, `esperó ${esperado / MINUTO} min desde la subida`);
    assert.ok(esperado < 16 * MINUTO, `no esperó de más (${esperado / MINUTO} min)`);
    assert.ok(lecturasDeVersion > 80, `siguió preguntando a /api/version (${lecturasDeVersion} veces)`);

    // Sin la corrida del CI: el piso más el tiempo del CI (20 min).
    const otro = crearRelojFalso();
    await assert.rejects(esperarVersion({}, repoDePrueba(), COMMIT, relojDeEtapaGastado(), { sinCi: true, subidoEn: otro.inicio, ahora: otro.ahora, esperar: otro.esperar }));
    assert.ok(otro.ahora() - otro.inicio >= 35 * MINUTO, `sin CI esperó ${(otro.ahora() - otro.inicio) / MINUTO} min`);

    // Si la versión llega a los 12 min, no se deshace nada.
    const tarde = crearRelojFalso();
    let vueltas = 0;
    const subida = await esperarVersion({}, repoDePrueba(), COMMIT, relojDeEtapaGastado(), {
      subidoEn: tarde.inicio,
      ahora: tarde.ahora,
      esperar: async (ms) => {
        await tarde.esperar(ms);
        vueltas += 1;
        if (tarde.ahora() - tarde.inicio >= 12 * MINUTO) versionDelCrm = COMMIT;
      },
    });
    assert.equal(subida.version, COMMIT);
    assert.ok(vueltas > 0);
    versionDelCrm = VIEJA;
  });

  await prueba("antes de deshacer: /api/version y el log de actualizar.sh por ssh deciden si la reversión es falsa", async () => {
    const contexto = { config: configDePrueba, registro: registroFalso() };
    const falso = crearRelojFalso();
    falso.pasar(20);
    const revisar = () => revisarAntesDeDeshacer(contexto, repoDePrueba(), COMMIT, { subidoEn: falso.inicio, ahora: falso.ahora });
    const anterior = process.env.SSH_FALSO_LOG_ACTUALIZAR;
    try {
      // El log dice "listo" solo con la versión vieja: la nueva nunca llegó al servidor -> falsa, con las líneas del log.
      process.env.SSH_FALSO_LOG_ACTUALIZAR = `2026-11-24 10:01 bajando imagen\n2026-11-24 10:02 listo: version ${VIEJA}`;
      const sinListo = await revisar();
      assert.equal(sinListo.arranco, false);
      assert.equal(sinListo.falsa, true);
      assert.equal(sinListo.leyoElLog, true);
      assert.match(sinListo.porQue, /no dice "listo: version"/);
      assert.ok(sinListo.lineas.some((linea) => linea.includes(`listo: version ${VIEJA}`)), "las líneas del log van en la causa");
      // El log dice "listo" con el commit subido: arrancó y falló de verdad -> no es falsa (cuenta como siempre).
      process.env.SSH_FALSO_LOG_ACTUALIZAR = `2026-11-24 10:09 listo: version ${COMMIT}\n2026-11-24 10:12 contenedor reiniciado`;
      const conListo = await revisar();
      assert.equal(conListo.falsa, false);
      // El ssh no responde: decide solo /api/version con el piso (pasaron 20 min: no es falsa).
      process.env.SSH_FALSO_LOG_ACTUALIZAR = "caido";
      const sinSsh = await revisar();
      assert.equal(sinSsh.leyoElLog, false);
      assert.equal(sinSsh.falsa, false);
      // …y si se iba a deshacer antes del piso, sí es falsa.
      const temprano = crearRelojFalso();
      temprano.pasar(2);
      const antesDelPiso = await revisarAntesDeDeshacer(contexto, repoDePrueba(), COMMIT, { subidoEn: temprano.inicio, ahora: temprano.ahora });
      assert.equal(antesDelPiso.falsa, true);
      assert.match(antesDelPiso.porQue, /menos de los 15 min/);
      // /api/version ya dice el commit: no se deshace.
      versionDelCrm = COMMIT;
      assert.deepEqual(await revisar(), { arranco: true, version: COMMIT });
    } finally {
      versionDelCrm = VIEJA;
      if (anterior === undefined) delete process.env.SSH_FALSO_LOG_ACTUALIZAR;
      else process.env.SSH_FALSO_LOG_ACTUALIZAR = anterior;
    }
    assert.deepEqual(shasListosDelLog(["listo: version abc1234", "x", "listo: version DEF5678", "listo: version abc1234"]), ["abc1234", "def5678"]);
  });

  await prueba("reversión falsa: se vuelve a subir el mismo commit", async () => {
    const reversion = { ok: true, commit: COMMIT, revert: null, clase: "falsa", sencilla: FRASES_DE_LA_CAUSA.falsa, lineas: ["el log de actualizar.sh no dice listo"] };
    const diagnostico = { categoria: "otra", causa: "Se subió, no arrancó y se deshizo", error: "Se subió, no arrancó y se deshizo." };
    // Decide "esperar" y no cuenta: aunque ya lleve TOPE - 1 subidas deshechas, no se escala ni se pide arreglo.
    assert.equal(queHacerConLaSubidaDeshecha(diagnostico, reversion), "esperar");
    const previas = Array.from({ length: TOPE_INTENTOS_DE_SUBIDA - 1 }, () => ({ categoria: "subida_revertida" }));
    const decision = decidir({ diagnostico, tarjeta: { titulo: "Editar compra", ultimosIntentos: previas }, etapa: "subir", reversion });
    assert.equal(decision.accion, "esperar");
    assert.equal(decision.cuenta, false);
    assert.equal(causaExterna(diagnostico, { reversion, repo: "aizencrm", tarjeta: { titulo: "Editar compra" } }), null, "no pide «Arreglo de subida»");

    // En main: el commit de la tarea y su revert (lo que hizo deshacerSubida).
    g(REPO, "revert", "--no-edit", COMMIT);
    g(REPO, "push", "-q", "origin", "main");
    const revert = g(REPO, "rev-parse", "HEAD");
    reversion.revert = revert;

    // El bucle con el CRM falso: suelta la tarjeta SIN la categoría subida_revertida (no suma al tope del CRM), sin ERROR ni arreglo.
    const llamadas = [];
    const crm = {
      soltar: async (id, motivo, extra) => void llamadas.push(["soltar", id, motivo, extra]),
      error: async (...datos) => void llamadas.push(["error", ...datos]),
      causaExterna: async (...datos) => (llamadas.push(["causaExterna", ...datos]), {}),
      aviso: async (...datos) => void llamadas.push(["aviso", ...datos]),
    };
    const registro = registroFalso();
    const tarjeta = { id: "tarjeta-t902", titulo: "Editar compra", repo: "aizencrm", ultimosIntentos: previas };
    const error = new ErrorDeEtapa("Se subió, no arrancó y se deshizo; producción vuelve a la versión anterior.", { reversion });
    const intento = { etapa: "subir", categoria: "otra", causa: "no arrancó", error: error.message };
    const salida = await resolverLaSubidaDeshecha({ crm, config: configDePrueba, registro }, tarjeta, "subir", error, { diagnostico, intento, motivo: error.message, causaParaLaTarjeta: "no arrancó" });
    assert.equal(salida.accion, "esperar");
    assert.equal(salida.falsa, true);
    assert.deepEqual(llamadas.map(([accion]) => accion), ["soltar"], "solo suelta: sin ERROR, sin arreglo, sin WhatsApp");
    const [, id, motivo, extra] = llamadas[0];
    assert.equal(id, tarjeta.id);
    assert.notEqual(extra.categoria, "subida_revertida", "no cuenta como subida deshecha");
    assert.match(motivo, /se vuelve a subir el mismo commit/);

    // La vuelta siguiente (subir): revertQueLoDeshace ve el revert y, deshaciéndolo sobre main, vuelve el mismo cambio.
    g(REPO, "fetch", "-q", "origin");
    assert.equal(await revertQueLoDeshace(REPO, "origin/main", COMMIT), revert);
    g(REPO, "reset", "-q", "--hard", "origin/main");
    assert.ok(!fs.existsSync(path.join(REPO, "compras.ts")), "después del revert el cambio no está");
    g(REPO, "revert", "--no-edit", revert);
    assert.equal(g(REPO, "diff", COMMIT, "HEAD"), "", "lo que se sube es exactamente el commit de la tarea");
    assert.equal(g(REPO, "diff", `${COMMIT}^`, COMMIT), g(REPO, "diff", "HEAD^", "HEAD"), "el mismo cambio");
    g(REPO, "push", "-q", "origin", "main");
    g(REPO, "fetch", "-q", "origin");
    assert.equal(await revertQueLoDeshace(REPO, "origin/main", COMMIT), null, "ya no está deshecho: vale como subido");
  });
} finally {
  servidor.close();
  fs.rmSync(T, { recursive: true, force: true });
}

if (fallas) {
  console.log(`\n${fallas} prueba(s) fallaron`);
  process.exit(1);
}
console.log("\nfallas repetidas: todas bien");
