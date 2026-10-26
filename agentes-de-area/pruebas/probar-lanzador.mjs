// Pruebas del LANZADOR del agente de área (agentes-de-area/correr-agente.mjs) con un Claude y un CRM de mentira,
// como las del trabajador del tablero. No usa red, ni Claude, ni la base. Correr: node agentes-de-area/pruebas/probar-lanzador.mjs
//
// Este mismo archivo hace de `claude` falso cuando se lo llama con `--claude-falso` (se lanza de verdad como proceso, para
// probar también el paso del prompt por stdin y la detección del límite de uso).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESTE = fileURLToPath(import.meta.url);

/* ── El Claude falso ──────────────────────────────────────────────────────────────────────────── */
if (process.argv.includes("--claude-falso")) {
  let prompt = "";
  for await (const trozo of process.stdin) prompt += trozo;
  const ruta = /^SALIDA: (.+)$/m.exec(prompt)?.[1]?.trim();
  const contador = process.env.CLAUDE_FALSO_CONTADOR;
  const llamadas = Number(fs.existsSync(contador) ? fs.readFileSync(contador, "utf8") : "0") + 1;
  fs.writeFileSync(contador, String(llamadas));
  fs.appendFileSync(`${contador}.prompts`, `${prompt}\n=====\n`);
  if (llamadas <= Number(process.env.CLAUDE_FALSO_LIMITES ?? 0)) {
    console.log("You've hit your session limit · resets 1:20am");
    process.exit(1);
  }
  if (process.env.CLAUDE_FALSO_MODO === "caido") {
    console.error("Error: algo se rompió");
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(
    ruta,
    JSON.stringify({
      numeros: { total: { ventas: 1 } },
      meta: { ventasHoy: 1 },
      subagentes: { cerrador: { listas: 2 }, cobrador: { cobros: 1 } },
      sugeridos: [{ asesora: "Ingrid", conversacion_id: "c1" }],
      textoAlexander: "Ayer: 1 venta. Meta de hoy: 1 venta.",
      mensajesAsesoras: [
        { nombre: "Ingrid", numero: "573004445566", texto: "Ingrid, tus 5 clientes de hoy" },
        { nombre: "Ingrid (repetida)", numero: "+57 300 444 5566", texto: "otro mensaje a Ingrid" },
        { nombre: "María", numero: "573007778899", texto: "María, tus 5 clientes de hoy" },
        { nombre: "UN CLIENTE", numero: "573120000000", texto: "esto jamás debe salir" },
      ],
    }),
  );
  console.log("listo");
  process.exit(0);
}

/* ── Las pruebas ──────────────────────────────────────────────────────────────────────────────── */
const { correr, ejecutarClaudeReal, esLimiteDeUso, horaBogota, instanteDeHora, subagentesDeHoy, leerEncabezado, mensajesUnicos } = await import("../correr-agente.mjs");

const ALEXANDER = "573001112233";
const EQUIPO = new Set([ALEXANDER, "573004445566", "573007778899"]);
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

function entorno({ inicio, limites = 0, modo = "", activo = false }) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "agente-ventas-"));
  const carpetaAgentes = path.join(raiz, "agentes");
  fs.cpSync(path.resolve(path.dirname(ESTE), "..", "ventas"), path.join(carpetaAgentes, "ventas"), { recursive: true });
  const contador = path.join(raiz, "contador");
  let reloj = new Date(inicio).getTime();
  const dormidos = [];
  const llamadas = [];
  const enviosDeHoy = new Set();
  const config = {
    carpetaTrabajo: path.join(raiz, "trabajo"),
    carpetaAgentes,
    comandoClaude: [process.execPath, ESTE, "--claude-falso"],
    numeroAlexander: ALEXANDER,
    horaEntrega: "07:30",
    esperaLimiteMinutos: 30,
  };
  const dias = new Map();
  const entradas = {
    config,
    ahora: () => new Date(reloj),
    dormir: async (ms) => {
      dormidos.push(ms);
      reloj += ms;
    },
    imprimir: () => {},
    // El Claude falso se lanza DE VERDAD (proceso aparte); solo el reloj es de mentira.
    ejecutar: ({ prompt, cwd }) => {
      process.env.CLAUDE_FALSO_CONTADOR = contador;
      process.env.CLAUDE_FALSO_LIMITES = String(limites);
      process.env.CLAUDE_FALSO_MODO = modo;
      return ejecutarClaudeReal({ config, prompt, cwd });
    },
    // Un CRM de mentira con las mismas reglas que pone el real.
    llamarMcp: async (nombre, args) => {
      llamadas.push({ nombre, args, en: new Date(reloj).toISOString() });
      if (nombre === "guardar_resumen_del_dia") {
        dias.set(args.fecha, args);
        return { fecha: args.fecha, esPrueba: !activo };
      }
      const numero = args.numero;
      if (!EQUIPO.has(numero)) return { enviado: false, estado: "BLOQUEADO", motivo: "ese número no es del equipo" };
      if (!activo) return { enviado: false, estado: "BLOQUEADO", motivo: "interruptor apagado: no se mandó" };
      if (enviosDeHoy.has(numero)) return { enviado: false, estado: "YA_ENVIADO", motivo: "ya se le mandó hoy" };
      enviosDeHoy.add(numero);
      return { enviado: true, estado: "ENVIADO" };
    },
  };
  return { entradas, config, llamadas, dormidos, dias, contador, raiz, reloj: () => new Date(reloj) };
}
const enviadosA = (llamadas) => llamadas.filter((l) => l.nombre === "mandar_whatsapp_al_equipo");

// Lunes 26-oct-2026: 07:00 Bogotá = 12:00 UTC.
await prueba("a tiempo: corre a las 7:00, espera hasta las 7:30 y entrega UN mensaje a Alexander y UNO a cada asesora", async () => {
  const e = entorno({ inicio: "2026-10-26T12:00:00Z", activo: true });
  const r = await correr(e.entradas);
  assert.equal(r.estado, "entregado");
  assert.equal(r.tarde, false);
  const envios = enviadosA(e.llamadas);
  assert.deepEqual(envios.map((l) => l.args.numero), [ALEXANDER, "573004445566", "573007778899", "573120000000"]);
  assert.ok(envios.every((l) => l.en === "2026-10-26T12:30:00.000Z"), "todos salen a las 7:30");
  assert.ok(!envios[0].args.texto.startsWith("Salió tarde"));
  assert.equal(enviadosA(e.llamadas).filter((l) => l.args.numero === "573004445566").length, 1, "Ingrid recibe uno solo aunque el agente lo repitió");
  assert.equal(e.dias.get("2026-10-26").salio_tarde, false);
  assert.equal(e.dias.size, 1);
  assert.ok(e.dormidos.some((ms) => ms === 30 * 60_000), "esperó hasta las 7:30");
  assert.match(fs.readFileSync(path.join(e.config.carpetaTrabajo, "logs", "ventas-2026-10-26.log"), "utf8"), /listo:/);
});

await prueba("a un número de cliente que se cuele en la lista, el servidor lo rechaza y el lanzador sigue", async () => {
  const e = entorno({ inicio: "2026-10-26T12:00:00Z", activo: true });
  const r = await correr(e.entradas);
  const cliente = r.envios.find((x) => x.nombre === "UN CLIENTE");
  assert.equal(cliente.enviado, false);
  assert.equal(cliente.estado, "BLOQUEADO");
  assert.equal(r.envios.filter((x) => x.enviado).length, 3);
});

await prueba("con el interruptor apagado el resumen queda como prueba y ningún mensaje sale", async () => {
  const e = entorno({ inicio: "2026-10-26T12:00:00Z", activo: false });
  const r = await correr(e.entradas);
  assert.equal(r.estado, "entregado");
  assert.equal(r.envios.filter((x) => x.enviado).length, 0);
  assert.equal(e.dias.size, 1);
  const log = fs.readFileSync(path.join(e.config.carpetaTrabajo, "logs", "ventas-2026-10-26.log"), "utf8");
  assert.match(log, /interruptor apagado/);
  assert.match(log, /PRUEBA/);
});

await prueba("corre tarde (aizen1 prendió a las 7:42): entrega enseguida y avisa 'Salió tarde'", async () => {
  const e = entorno({ inicio: "2026-10-26T12:42:00Z", activo: true });
  const r = await correr(e.entradas);
  assert.equal(r.tarde, true);
  const alexander = enviadosA(e.llamadas)[0];
  assert.equal(alexander.args.numero, ALEXANDER);
  assert.ok(alexander.args.texto.startsWith("Salió tarde (aizen1 prendió a las 07:42)"), alexander.args.texto);
  assert.equal(e.dormidos.filter((ms) => ms > 60_000).length, 0, "no espera nada");
  assert.equal(e.dias.get("2026-10-26").salio_tarde, true);
  assert.equal(e.dias.get("2026-10-26").nota_tarde, "aizen1 prendió a las 07:42");
  assert.ok(!enviadosA(e.llamadas).slice(1).some((l) => l.args.texto.startsWith("Salió tarde")), "solo Alexander recibe el aviso");
});

await prueba("se agota el límite del plan: espera, reintenta sin romper nada y avisa que salió tarde", async () => {
  const e = entorno({ inicio: "2026-10-26T12:00:00Z", limites: 2, activo: true });
  const r = await correr(e.entradas);
  assert.equal(r.estado, "entregado");
  assert.equal(fs.readFileSync(e.contador, "utf8"), "3", "Claude se llamó 3 veces");
  assert.deepEqual(e.dormidos.slice(0, 2), [30 * 60_000, 30 * 60_000]);
  assert.equal(r.tarde, true, "con dos esperas de 30 min ya pasaron las 7:30");
  assert.ok(enviadosA(e.llamadas)[0].args.texto.startsWith("Salió tarde ("));
  assert.match(fs.readFileSync(path.join(e.config.carpetaTrabajo, "logs", "ventas-2026-10-26.log"), "utf8"), /límite de uso del plan/);
});

await prueba("si el límite no se levanta nunca, termina con FALLO y no manda nada", async () => {
  const e = entorno({ inicio: "2026-10-26T12:00:00Z", limites: 999, activo: true });
  e.config.maxReintentosLimite = 3;
  const r = await correr(e.entradas);
  assert.equal(r.estado, "fallo");
  assert.equal(r.motivo, "limite_de_uso");
  assert.equal(e.llamadas.length, 0);
});

await prueba("si Claude se cae, FALLO con las últimas líneas y no manda nada", async () => {
  const e = entorno({ inicio: "2026-10-26T12:00:00Z", modo: "caido", activo: true });
  const r = await correr(e.entradas);
  assert.equal(r.estado, "fallo");
  assert.match(r.ultimas, /algo se rompió/);
  assert.equal(e.llamadas.length, 0);
});

await prueba("el domingo no corre", async () => {
  const e = entorno({ inicio: "2026-10-25T12:00:00Z", activo: true });
  const r = await correr(e.entradas);
  assert.equal(r.estado, "no_corre_hoy");
  assert.equal(e.llamadas.length, 0);
  assert.ok(!fs.existsSync(e.contador), "ni siquiera abrió Claude");
});

await prueba("si la tarea se dispara dos veces el mismo día, la segunda no repite nada", async () => {
  const e = entorno({ inicio: "2026-10-26T12:00:00Z", activo: true });
  await correr(e.entradas);
  const antes = e.llamadas.length;
  const segunda = await correr(e.entradas);
  assert.equal(segunda.estado, "ya_entrego");
  assert.equal(e.llamadas.length, antes);
});

await prueba("el analista de perdidos solo va el sábado (o con --forzar-sabado)", async () => {
  const carpeta = path.resolve(path.dirname(ESTE), "..", "ventas");
  const claves = (dia) => subagentesDeHoy(carpeta, dia).map((s) => s.clave);
  assert.deepEqual(claves(1), ["cerrador", "cobrador"]);
  assert.deepEqual(claves(6), ["analista-de-perdidos", "cerrador", "cobrador"]);
  const e = entorno({ inicio: "2026-10-26T12:00:00Z", activo: true });
  await correr({ ...e.entradas, forzarSabado: true });
  assert.match(fs.readFileSync(`${e.contador}.prompts`, "utf8"), /analista-de-perdidos/);
  const normal = entorno({ inicio: "2026-10-26T12:00:00Z", activo: true });
  await correr(normal.entradas);
  assert.doesNotMatch(fs.readFileSync(`${normal.contador}.prompts`, "utf8"), /analista-de-perdidos/);
});

await prueba("piezas sueltas: límite de uso, hora de Colombia, encabezado de subagente, mensajes únicos", async () => {
  assert.equal(esLimiteDeUso("Claude AI usage limit reached|1761210000"), true);
  assert.equal(esLimiteDeUso("todo bien"), false);
  assert.deepEqual(horaBogota(new Date("2026-10-26T04:59:00Z")), { fecha: "2026-10-25", hhmm: "23:59", diaSemana: 0 });
  assert.equal(instanteDeHora("2026-10-26", "07:30").toISOString(), "2026-10-26T12:30:00.000Z");
  assert.deepEqual(leerEncabezado("---\nnombre: Cobrador\ncuando: diario\n---\ncuerpo"), { nombre: "Cobrador", cuando: "diario" });
  const { mensajes, repetidos } = mensajesUnicos([
    { nombre: "a", numero: "300 111", texto: "x" },
    { nombre: "a2", numero: "300111", texto: "y" },
    { nombre: "sin texto", numero: "999", texto: " " },
  ]);
  assert.equal(mensajes.length, 1);
  assert.equal(repetidos.length, 1);
});

console.log(`\n${pruebas} pruebas pasaron`);
