// Pruebas de lo nuevo del Coordinador (26-oct-2026): medir el tamaño antes de planear, dependencias antes de arrancar,
// que los builds no choquen y recoger los errores viejos. Con un CRM falso y sin Claude (las sesiones se inyectan).
//   node trabajador-tablero/pruebas/probar-medir.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { medirAntesDePlanear } from "../lib/bucle.mjs";
import { conReintentoPorCandado, crearSerieDeBuilds, esAvisoDeCandado } from "../lib/candado-de-build.mjs";
import { completarConfig } from "../lib/config.mjs";
import { medirTarjeta, referenciasDeLaTarjeta, referenciasParaDepender, tamanoDeLaRespuesta } from "../lib/medir.mjs";
import { crearRecogedor, decidirRecogida, leerEstadoDeRecoger } from "../lib/recoger-errores.mjs";
import { dependenciasDeLaRespuesta, detalleDeLimpieza, esSoloLoDeMain, firmasDeFalla, notaDeYaHecho, tituloDeLimpieza, yaEstaHechoDe } from "../lib/revision-previa.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const registro = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(m), aviso: (m) => lineas.push(m), error: (m) => lineas.push(m) };
};

const TEXTO_GRANDE = [
  "Hacer una pantalla nueva del módulo de Reuniones con migración y un agente nuevo.",
  ...Array.from({ length: 14 }, (_, i) => `${i + 1}. Punto número ${i + 1} de lo que hay que cambiar en el módulo y la pantalla ${"con mucho detalle ".repeat(12)}`),
  "Se toca prisma/schema.prisma y hay una migración. ".repeat(40),
].join("\n");

const tarjetaGrande = { id: "cmvgrande0000000000000000", titulo: "Reuniones completas", detalle: TEXTO_GRANDE, repo: "aizencrm" };
const tarjetaChica = { id: "cmvchica00000000000000000", titulo: "Cambiar un texto", detalle: "Cambiar el título del botón de Guardar por Guardar cambios.", repo: "aizencrm" };

const config = { tiempos: { planMinutos: 19 }, medir: { activo: true, puntosGrande: 4, puntosDudosa: 2, consultaHaiku: true } };

function crmFalso(extra = {}) {
  const llamadas = [];
  const crm = {
    llamadas,
    partir: async (id, datos) => (llamadas.push(["partir", id, datos]), { ok: true }),
    depender: async (id, datos) => (llamadas.push(["depender", id, datos]), { ok: true, creadas: [], soltada: false }),
    ...extra,
  };
  return crm;
}

const PARTES = [
  { titulo: "Base", detalle: "Parte 1: la base de datos." },
  { titulo: "Pantalla", detalle: "Parte 2: la pantalla." },
];

await prueba("medir: una tarjeta con texto largo, migración y pantalla nueva es grande; una chica no", async () => {
  const grande = medirTarjeta(tarjetaGrande);
  assert.equal(grande.tamano, "grande", JSON.stringify(grande));
  assert.ok(grande.motivos.some((m) => /migraci/.test(m)));
  assert.equal(medirTarjeta(tarjetaChica).tamano, "chica");
});

await prueba("medir: una parte, una ya partida o una que viene de reparación NO se vuelve a partir", async () => {
  for (const extra of [{ esParte: true }, { resultado: { partida: { hijas: ["x"] } } }, { reparaciones: 1 }]) {
    const medida = medirTarjeta({ ...tarjetaGrande, ...extra });
    assert.equal(medida.tamano, "chica");
    assert.ok(medida.razon);
  }
});

await prueba("medir: la consulta de Haiku se lee como grande/chica y lo raro queda sin respuesta", () => {
  assert.equal(tamanoDeLaRespuesta("grande"), "grande");
  assert.equal(tamanoDeLaRespuesta("\n**Grande**: toca todo"), "grande");
  assert.equal(tamanoDeLaRespuesta("chica"), "chica");
  assert.equal(tamanoDeLaRespuesta("no sé"), null);
});

await prueba("dependencias: el molde nombrado por id se detecta; un id nombrado como causa de un error NO", () => {
  const molde = { id: "cmvmarketing000000000000000", detalle: "Se hace igual que el molde del Agente de Ventas cmvkcrakm00no2nlgu1khlqi3, que sirve de plantilla." };
  assert.deepEqual(referenciasDeLaTarjeta(molde).ids, ["cmvkcrakm00no2nlgu1khlqi3"]);
  assert.deepEqual(referenciasParaDepender(molde), ["cmvkcrakm00no2nlgu1khlqi3"]);
  const causas = { id: "cmvotra0000000000000000000", detalle: "Cerebro cmvigqzs009a72ojhdhjv33sj: build bloqueado.\nReuniones cmvl5crud00go2vmq336apn7w: se pasó del tiempo." };
  assert.deepEqual(referenciasParaDepender(causas), []);
  const porTitulo = { id: "x", detalle: "Esto depende de «Agente de Ventas» para existir." };
  assert.deepEqual(referenciasParaDepender(porTitulo), ["Agente de Ventas"]);
  assert.deepEqual(referenciasParaDepender({ id: "cmvkcrakm00no2nlgu1khlqi3", detalle: "El molde cmvkcrakm00no2nlgu1khlqi3" }), [], "nunca depende de sí misma");
});

await prueba("tarjeta grande: se parte ANTES de planear (no se abre ninguna sesión de plan) y las partes se piden con etapa planear", async () => {
  const crm = crmFalso();
  const log = registro();
  let partidas = 0;
  const resultado = await medirAntesDePlanear({ crm, config, registro: log, contexto: {}, partir: async () => (partidas++, PARTES) }, tarjetaGrande);
  assert.deepEqual(resultado, { ok: true, estado: "PLANEANDO", partes: 2 });
  const [llamada] = crm.llamadas.filter(([nombre]) => nombre === "partir");
  assert.equal(llamada[1], tarjetaGrande.id);
  assert.equal(llamada[2].etapa, "planear");
  assert.equal(llamada[2].partes.length, 2);
  assert.equal(partidas, 1);
});

await prueba("tarjeta chica: pasa directo a planear, sin partirse", async () => {
  const crm = crmFalso();
  const resultado = await medirAntesDePlanear({ crm, config, registro: registro(), contexto: {}, partir: async () => assert.fail("no debía partir") }, tarjetaChica);
  assert.equal(resultado, null);
  assert.equal(crm.llamadas.length, 0);
});

await prueba("tarjeta dudosa: decide la consulta corta con Haiku (grande parte, chica planea)", async () => {
  const dudosa = { id: "cmvdudosa0000000000000000", titulo: "Algo mediano", detalle: `${"Texto de relleno para que sea largo. ".repeat(60)}\nIncluye una migración.` };
  assert.equal(medirTarjeta(dudosa, config.medir).tamano, "dudosa");
  const parte = await medirAntesDePlanear({ crm: crmFalso(), config, registro: registro(), contexto: {}, medirHaiku: async () => "grande", partir: async () => PARTES }, dudosa);
  assert.equal(parte.partes, 2);
  const plan = await medirAntesDePlanear({ crm: crmFalso(), config, registro: registro(), contexto: {}, medirHaiku: async () => "chica", partir: async () => assert.fail("no debía partir") }, dudosa);
  assert.equal(plan, null);
  // Si la consulta falla, se planea como siempre.
  const falla = await medirAntesDePlanear({ crm: crmFalso(), config, registro: registro(), contexto: {}, medirHaiku: async () => Promise.reject(new Error("sin red")), partir: async () => assert.fail("x") }, dudosa);
  assert.equal(falla, null);
});

await prueba("si partir falla (CRM viejo o sesión sin partes), se planea entera: medir nunca frena", async () => {
  const crm = crmFalso({ partir: async () => Promise.reject(new Error("El CRM contestó 409.")) });
  assert.equal(await medirAntesDePlanear({ crm, config, registro: registro(), contexto: {}, partir: async () => PARTES }, tarjetaGrande), null);
  assert.equal(await medirAntesDePlanear({ crm: crmFalso(), config, registro: registro(), contexto: {}, partir: async () => Promise.reject(new Error("mal")) }, tarjetaGrande), null);
  // El límite de uso de Claude sí sube (la tarjeta se suelta sin error).
  await assert.rejects(medirAntesDePlanear({ crm: crmFalso(), config, registro: registro(), contexto: {}, partir: async () => Promise.reject(Object.assign(new Error("límite"), { limiteDeUso: true })) }, tarjetaGrande), /límite/);
});

await prueba("dependencia sin terminar: la tarjeta queda 'Esperando a «X»' (vuelve a la fila), no se planea ni se mide", async () => {
  const crm = crmFalso({ depender: async () => ({ ok: true, estado: "APROBADO", creadas: ["cmvkcrakm00no2nlgu1khlqi3"], soltada: true, esperando: "Esperando a «Agente de Ventas»" }) });
  const marketing = { id: "cmvmarketing000000000000000", titulo: "Agente de Marketing", detalle: "Igual que el molde cmvkcrakm00no2nlgu1khlqi3." };
  const resultado = await medirAntesDePlanear({ crm, config, registro: registro(), contexto: {}, partir: async () => assert.fail("no debía partir") }, marketing);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.estado, "APROBADO");
  assert.equal(resultado.esperando, "Esperando a «Agente de Ventas»");
});

await prueba("dependencia ya hecha: sigue a medir y planear normal", async () => {
  const crm = crmFalso({ depender: async () => ({ ok: true, creadas: [], soltada: false, esperando: null }) });
  const marketing = { id: "cmvmarketing000000000000000", titulo: "Agente", detalle: "Igual que el molde cmvkcrakm00no2nlgu1khlqi3." };
  assert.equal(await medirAntesDePlanear({ crm, config, registro: registro(), contexto: {} }, marketing), null);
});

await prueba("medir apagado en la configuración: no hace nada", async () => {
  const crm = crmFalso();
  assert.equal(await medirAntesDePlanear({ crm, config: { ...config, medir: { ...config.medir, activo: false } }, registro: registro(), contexto: {} }, tarjetaGrande), null);
  assert.equal(crm.llamadas.length, 0);
});

await prueba("builds: el aviso de candado se reconoce; el segundo build de una carpeta espera su turno (no chocan)", async () => {
  assert.ok(esAvisoDeCandado(new Error("Unable to acquire lock at .next/lock, is another instance of next build running?")));
  assert.ok(!esAvisoDeCandado(new Error("Type error: Property x does not exist")));
  const serie = crearSerieDeBuilds();
  const orden = [];
  let corriendo = 0;
  let maximo = 0;
  const build = (nombre, ms) => async () => {
    corriendo += 1;
    maximo = Math.max(maximo, corriendo);
    orden.push(`${nombre}:empieza`);
    await new Promise((r) => setTimeout(r, ms));
    orden.push(`${nombre}:termina`);
    corriendo -= 1;
    return nombre;
  };
  const resultados = await Promise.all([serie.correr("/tmp/x", build("a", 30)), serie.correr("/tmp/x", build("b", 5)), serie.correr("/tmp/otra", build("c", 5))]);
  assert.deepEqual(resultados, ["a", "b", "c"]);
  assert.ok(orden.indexOf("a:termina") < orden.indexOf("b:empieza"), orden.join(" "));
  assert.deepEqual(serie.estado(), { corriendo: 0, enFila: 0 });
  // Un build que falla no deja la carpeta trabada.
  await assert.rejects(serie.correr("/tmp/x", async () => Promise.reject(new Error("falló"))), /falló/);
  assert.equal(await serie.correr("/tmp/x", async () => "ok"), "ok");
});

await prueba("builds: con el aviso de candado espera, limpia y reintenta SIN contar intento; otro error o pasadas las esperas se relanza", async () => {
  let llamadas = 0;
  const esperas = [];
  let limpiezas = 0;
  let devuelto = 0;
  const { valor, esperas: hechas } = await conReintentoPorCandado(
    async () => {
      llamadas += 1;
      if (llamadas <= 2) throw new Error("Unable to acquire lock: another instance of next build running");
      return "compiló";
    },
    { esperaMs: 60_000, esperar: async (ms) => esperas.push(ms), limpiar: async () => (limpiezas += 1), extender: (ms) => (devuelto += ms), hayOtroBuild: () => false },
  );
  assert.equal(valor, "compiló");
  assert.equal(hechas, 2);
  assert.deepEqual(esperas, [60_000, 60_000]);
  assert.equal(limpiezas, 2);
  assert.equal(devuelto, 120_000, "la espera se le devuelve al reloj de la etapa");
  // Si el otro build sigue corriendo, el candado no se toca.
  let tocado = 0;
  let vez = 0;
  await conReintentoPorCandado(async () => (++vez === 1 ? Promise.reject(new Error("another instance of next build")) : "ok"), { esperar: async () => {}, limpiar: async () => (tocado += 1), hayOtroBuild: () => true });
  assert.equal(tocado, 0);
  await assert.rejects(conReintentoPorCandado(async () => Promise.reject(new Error("Type error")), { esperar: async () => assert.fail("no espera") }), /Type error/);
  let intentos = 0;
  await assert.rejects(
    conReintentoPorCandado(async () => (intentos++, Promise.reject(new Error("Unable to acquire lock"))), { maximoEsperas: 3, esperar: async () => {} }),
    /Unable to acquire lock/,
  );
  assert.equal(intentos, 4);
});

await prueba("configuración: medir, recogerErrores y candadoDeBuild vienen con valores y se validan", () => {
  const base = { urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: os.tmpdir(), remoto: "origin", ramaBase: "main", verificar: [["npm", "run", "build"]], pruebas: [] } } };
  const buena = completarConfig(base);
  assert.deepEqual(buena.medir, { activo: true, puntosGrande: 4, puntosDudosa: 2, consultaHaiku: true });
  assert.deepEqual(buena.recogerErrores, { activo: true, maximoPorDia: 6, maximoPorTarjeta: 2 });
  assert.deepEqual(buena.candadoDeBuild, { esperaSegundos: 60, maximoEsperas: 10 });
  assert.throws(() => completarConfig({ ...base, medir: { puntosGrande: 1, puntosDudosa: 3 } }), /puntosDudosa/);
  assert.throws(() => completarConfig({ ...base, recogerErrores: { maximoPorDia: 0 } }), /maximoPorDia/);
});

/* ───────────────────────────────────────────────────────────── recoger los errores viejos ── */

const error = (extra) => ({ id: "e", titulo: "Una", repo: "aizencrm", plan: null, esParte: false, recogidas: 0, lineaParaElDueno: null, motivo: null, ultimoError: null, ultimosIntentos: [], ...extra });

await prueba("recoger: por candado se reintenta; por tiempo se parte; si pide una decisión, línea para el dueño; ya recogida 2 veces, se salta", () => {
  const candado = decidirRecogida(error({ motivo: "No compiló: falló el build", ultimoError: "Unable to acquire lock at .next/lock: another instance of next build running" }));
  assert.equal(candado.accion, "reintentar");
  const tiempo = decidirRecogida(error({ motivo: "Falló: tardó más de 19 min en escribir el plan: se cortó", ultimosIntentos: [{ etapa: "planear" }] }));
  assert.equal(tiempo.accion, "partir", JSON.stringify(tiempo));
  const decision = decidirRecogida(error({ motivo: "Falta que decidas A o B sobre la carpeta de Drive" }));
  assert.equal(decision.accion, "dueno");
  assert.match(decision.linea, /Necesita algo tuyo/);
  assert.equal(decidirRecogida(error({ motivo: "build bloqueado: another instance of next build", recogidas: 2 })).accion, "saltar");
  // Una parte que se pasó de tiempo no se parte otra vez: se reintenta.
  assert.equal(decidirRecogida(error({ esParte: true, motivo: "Se pasó del tiempo: Claude tardó más de 50 min" })).accion, "reintentar");
  // Una falla de código que ya agotó 3 reparaciones no se reintenta a ciegas: va al dueño.
  assert.equal(decidirRecogida(error({ motivo: "No compiló: el código tiene errores de tipos (TypeScript)" })).accion, "dueno");
});

function recogedorDePrueba(tarjetas, extra = {}) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "recoger-"));
  const llamadas = [];
  const crm = {
    errores: async () => ({ tarjetas }),
    recoger: async (id, datos) => (llamadas.push([id, datos]), { ok: true }),
  };
  let ahora = new Date("2026-10-26T15:00:00Z");
  const recogedor = crearRecogedor({
    crm,
    config: { carpetaTrabajo: carpeta, recogerErrores: { activo: true, maximoPorDia: 6, maximoPorTarjeta: 2 } },
    registro: registro(),
    partir: async () => PARTES,
    ahora: () => ahora,
    ...extra,
  });
  return { recogedor, llamadas, carpeta, pasarA: (iso) => (ahora = new Date(iso)) };
}

await prueba("recoger: aplica la decisión a cada tarjeta y corre UNA sola vez por día (y otra al día siguiente)", async () => {
  const tarjetas = [
    error({ id: "cerebro", titulo: "Cerebro", motivo: "No compiló", ultimoError: "Unable to acquire lock ... another instance of next build running" }),
    error({ id: "reuniones", titulo: "Reuniones", motivo: "Se pasó del tiempo: falló el build, tardó más de 90 min", ultimosIntentos: [{ etapa: "construir" }] }),
    error({ id: "decide", titulo: "Pide decisión", motivo: "Falta que decidas A o B sobre el Drive" }),
  ];
  const { recogedor, llamadas, carpeta, pasarA } = recogedorDePrueba(tarjetas);
  const primera = await recogedor.revisar();
  assert.equal(primera.hizo, true);
  assert.deepEqual(llamadas.map(([id, d]) => [id, d.decision]), [["cerebro", "reintentar"], ["reuniones", "partir"], ["decide", "dueno"]]);
  assert.equal(llamadas[1][1].partes.length, 2);
  assert.match(llamadas[2][1].linea, /Necesita algo tuyo/);
  assert.equal(leerEstadoDeRecoger(carpeta).fecha, "2026-10-26");
  const segunda = await recogedor.revisar();
  assert.equal(segunda.hizo, false);
  assert.equal(llamadas.length, 3, "no repite el mismo día");
  pasarA("2026-10-27T15:00:00Z");
  assert.equal((await recogedor.revisar()).hizo, true);
});

await prueba("recoger: máximo 6 tarjetas por día y 2 veces cada una; la línea de ayer no se vuelve a escribir", async () => {
  const muchas = Array.from({ length: 9 }, (_, i) => error({ id: `t${i}`, titulo: `T${i}`, motivo: "otro build", ultimoError: "another instance of next build" }));
  const { recogedor, llamadas } = recogedorDePrueba(muchas);
  assert.equal((await recogedor.revisar()).recogidas.length, 6);
  assert.equal(llamadas.length, 6);

  const dos = [error({ id: "ya", titulo: "Ya dos", recogidas: 2, motivo: "another instance of next build" }), error({ id: "lin", titulo: "Con línea", motivo: "Falta que decidas A o B", lineaParaElDueno: "Necesita algo tuyo: Falta que decidas A o B" })];
  const otro = recogedorDePrueba(dos, {});
  const salida = await otro.recogedor.revisar();
  assert.equal(salida.hizo, true);
  assert.equal(otro.llamadas.length, 0, "la de 2 recogidas se salta y la misma línea de ayer no se reescribe");
  const cambiada = recogedorDePrueba([error({ id: "lin2", titulo: "Línea vieja", motivo: "Falta que decidas A o B", lineaParaElDueno: "otra línea de antes" })]);
  await cambiada.recogedor.revisar();
  assert.equal(cambiada.llamadas.length, 1, "si la línea cambió, se reescribe");
});

await prueba("recoger: un error al recoger una no frena a las demás; apagado no hace nada", async () => {
  const tarjetas = [error({ id: "a", titulo: "A", motivo: "otro build", ultimoError: "another instance of next build" }), error({ id: "b", titulo: "B", motivo: "otro build", ultimoError: "another instance of next build" })];
  const llamadas = [];
  const crm = {
    errores: async () => ({ tarjetas }),
    recoger: async (id) => (id === "a" ? Promise.reject(new Error("El CRM contestó 409.")) : (llamadas.push(id), { ok: true })),
  };
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "recoger-"));
  const recogedor = crearRecogedor({ crm, config: { carpetaTrabajo: carpeta, recogerErrores: { activo: true, maximoPorDia: 6, maximoPorTarjeta: 2 } }, registro: registro(), partir: async () => PARTES });
  await recogedor.revisar();
  assert.deepEqual(llamadas, ["b"]);
  const apagado = crearRecogedor({ crm, config: { carpetaTrabajo: carpeta, recogerErrores: { activo: false } }, registro: registro(), partir: async () => PARTES });
  assert.equal((await apagado.revisar()).hizo, false);
});

/* ── Revisión previa (27-oct-2026) ── */

await prueba("dependencias: también se leen en el título y en el plan aprobado, no solo en el detalle", () => {
  const pagina = "cmvpmu7bh00pv2umsnzs9qvgw";
  assert.deepEqual(referenciasDeLaTarjeta({ id: "cmvotra00000000000000000", titulo: "Alertas", detalle: "", plan: `PLAN\n1. Depende de la tarjeta ${pagina}, que aún no subió.` }).ids, [pagina]);
  assert.deepEqual(referenciasDeLaTarjeta({ id: "cmvotra00000000000000000", titulo: `Alertas (requiere «Página de alertas»)`, detalle: "" }).titulos, ["Página de alertas"]);
  assert.deepEqual(referenciasParaDepender({ id: "cmvotra00000000000000000", titulo: "Algo", detalle: "", plan: "Necesita primero «Prioridad y página de alertas» en main." }), ["Prioridad y página de alertas"]);
  // Un id nombrado como ejemplo, sin palabra que lo anuncie, no es una dependencia.
  assert.deepEqual(referenciasDeLaTarjeta({ id: "cmvotra00000000000000000", titulo: "Algo", detalle: "", plan: `El caso de ${pagina} falló ayer.` }).ids, []);
});

await prueba("DEPENDE_DE: la sesión nombra la tarjeta por id o por título; las instrucciones repetidas tal cual no cuentan", () => {
  const id = "cmvpmu7bh00pv2umsnzs9qvgw";
  assert.deepEqual(dependenciasDeLaRespuesta(`Faltan cosas.\nDEPENDE_DE: ${id}`), [id]);
  assert.deepEqual(dependenciasDeLaRespuesta("DEPENDE_DE: «Prioridad y página de alertas» y «Otra tarjeta»"), ["Prioridad y página de alertas", "Otra tarjeta"]);
  assert.deepEqual(dependenciasDeLaRespuesta("**DEPENDE_DE:** la página de alertas"), ["la página de alertas"]);
  assert.deepEqual(dependenciasDeLaRespuesta('"DEPENDE_DE: <id o «título» de esa tarjeta>"'), []);
  assert.deepEqual(dependenciasDeLaRespuesta("Sin dependencias."), []);
  // Solo las primeras N líneas (el plan que explica estas palabras no cuenta) o las últimas.
  const plan = "1. Algo\n2. Algo\n3. Algo\n4. Algo\n5. Algo\n6. Algo\nDEPENDE_DE: «X de verdad»";
  assert.deepEqual(dependenciasDeLaRespuesta(plan, { inicio: 5 }), []);
  assert.deepEqual(dependenciasDeLaRespuesta(plan, { final: 2 }), ["X de verdad"]);
});

await prueba("YA_ESTA_HECHO: se lee el commit y el motivo; sin commit legible no vale", () => {
  assert.deepEqual(yaEstaHechoDe("RESUMEN\nYA_ESTA_HECHO: f4759b0 — construida desde el 20-oct"), { commit: "f4759b0", motivo: "construida desde el 20-oct" });
  assert.deepEqual(yaEstaHechoDe("`YA_ESTA_HECHO:` F4759B0A1 - ya está"), { commit: "f4759b0a1", motivo: "ya está" });
  assert.equal(yaEstaHechoDe("YA_ESTA_HECHO: <commit> — <motivo>"), null);
  assert.equal(yaEstaHechoDe("YA_ESTA_HECHO: el commit de antes"), null);
  assert.equal(yaEstaHechoDe("no dijo nada"), null);
  assert.equal(notaDeYaHecho("f4759b0"), "ya estaba hecho (commit f4759b0)");
});

await prueba("código limpio: las firmas de falla (lint, tipos, pruebas) se comparan sin números de línea ni tiempos", () => {
  const main = firmasDeFalla("\u001b[31msrc/a.ts\u001b[0m\n  12:5  error  Unexpected any  @typescript-eslint/no-explicit-any\nsrc/b.ts(3,7): error TS2322: Type 'x' is not assignable.\nnot ok 3 - prueba vieja\n✖ otra vieja (12ms)");
  assert.equal(main.size, 4);
  const tarea = firmasDeFalla("src/a.ts\n  99:1  error  Unexpected any  @typescript-eslint/no-explicit-any\nsrc/b.ts(40,2): error TS2322: Type 'x' is not assignable.\nnot ok 3 - prueba vieja\n✖ otra vieja (340ms)");
  assert.equal(esSoloLoDeMain(tarea, main), true, "lo mismo, aunque cambió de línea y de tiempo");
  assert.equal(esSoloLoDeMain(firmasDeFalla("not ok 3 - prueba vieja\nnot ok 9 - prueba nueva"), main), false, "una falla nueva sigue frenando");
  assert.equal(esSoloLoDeMain(firmasDeFalla("algo se rompió sin forma conocida"), main), false, "sin firmas reconocibles, la falla es de la tarea");
  assert.equal(esSoloLoDeMain(tarea, new Set()), false, "main pasa: la falla es de la tarea");
});

await prueba("limpieza: un solo título por repo y el detalle sin repetidos ni más de 40 líneas", () => {
  assert.equal(tituloDeLimpieza("aizencrm"), "Limpieza: main trae errores viejos (aizencrm)");
  const detalle = detalleDeLimpieza("aizencrm", ["a", "a", " b ", ...Array.from({ length: 60 }, (_, i) => `e${i}`)]);
  assert.equal(detalle.split("\n").filter((linea) => linea.startsWith("- ")).length, 40);
  assert.ok(!detalle.includes("- a\n- a"));
});

console.log(`\n${pruebas} pruebas, todas bien`);
