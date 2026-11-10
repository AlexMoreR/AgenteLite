// Pruebas de la llamada en curso global (no se corta al cambiar de chat, 10-11-2026).
// Correr: npm run test:llamada-global
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const leer = (ruta) => fs.readFileSync(path.resolve(ruta), "utf8");

const providers = leer("src/components/providers.tsx");
const boton = leer("src/features/llamadas/components/BotonLlamar.tsx");
const hook = leer("src/features/llamadas/components/useLlamada.ts");
const global = leer("src/features/llamadas/components/LlamadaEnCurso.tsx");

// El .ts se carga como en check-audio-de-llamada.mjs: se transpila con typescript (ya instalado)
// en vez de bajar tsx con npx en cada corrida.
const require = createRequire(import.meta.url);
function cargarTs(relativo) {
  const sourcePath = path.resolve(relativo);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    require,
    mod,
    sourcePath,
    path.dirname(sourcePath),
  );
  return mod.exports;
}

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("la llamada se monta una sola vez para todo el CRM, en los providers", () => {
  assert.ok(providers.includes("LlamadaEnCurso"), "providers.tsx no monta LlamadaEnCursoProvider");
  assert.ok(/<LlamadaEnCursoProvider>/.test(providers), "falta <LlamadaEnCursoProvider> en providers.tsx");
});

prueba("el boton de llamar es solo un boton: sin llamada ni audio propios", () => {
  assert.ok(!boton.includes("useLlamada("), "BotonLlamar.tsx todavia arma su propia llamada");
  assert.ok(!boton.includes("<audio"), "BotonLlamar.tsx todavia tiene su propio <audio>");
  assert.ok(boton.includes("useLlamadaEnCurso()"), "BotonLlamar.tsx no usa la llamada global");
  assert.ok(boton.includes("Ya hay una llamada en curso"), "falta el aviso de llamada en curso");
});

prueba("el unico useLlamada del CRM y su audio viven en LlamadaEnCurso.tsx", () => {
  assert.ok(global.includes("useLlamada("), "LlamadaEnCurso.tsx no usa useLlamada");
  assert.ok(/<audio ref=\{audioRef\} autoPlay playsInline className="hidden" \/>/.test(global));
  assert.ok(global.includes("<PanelDeLlamada"), "falta el panel en LlamadaEnCurso.tsx");
});

prueba("al cerrar la pantalla o desmontar se cuelga en WaCalls con sendBeacon", () => {
  assert.ok(hook.includes("sendBeacon"), "useLlamada.ts no usa sendBeacon");
  assert.ok(/sendBeacon\("\/api\/wacalls\/llamada"/.test(hook), "sendBeacon no va a /api/wacalls/llamada");
  assert.ok(/keepalive: true/.test(hook), "falta el fetch con keepalive cuando no hay sendBeacon");
  assert.ok(/accion: "colgar", callId, channelId/.test(hook), "el colgar al salir no lleva el mismo cuerpo");
  assert.ok(/addEventListener\("pagehide"/.test(hook), "falta el listener de pagehide");
});

prueba("la linea llega al marcar y queda fijada antes de iniciar", () => {
  assert.ok(!/useLlamada\(\{[^}]*channelId/.test(hook), "el hook todavia recibe channelId en sus opciones");
  assert.ok(/canalRef\.current = channelId \?\? undefined;[\s\S]*accion: "iniciar"/.test(hook));
});

// --- El cuadro de la llamada minimizada: movible, recuerda dónde quedó y se vuelve burbuja ---

const {
  ajustarDentroDePantalla,
  leerPreferencia,
  leerPreferenciaGuardada,
  posicionPorDefecto,
  tamanoDeLaForma,
  escribirPreferencia,
  CLAVE_DEL_CUADRO,
  MARGEN_DEL_CUADRO: M,
} = cargarTs("src/features/llamadas/components/posicion-del-cuadro.ts");

const panel = leer("src/features/llamadas/components/PanelDeLlamada.tsx");

const ventana = { anchoVentana: 1280, altoVentana: 800 };
const tamano = { ancho: 320, alto: 64 };
const dentro = (p, t = tamano, v = ventana) =>
  p.x >= M && p.y >= M && p.x + t.ancho <= v.anchoVentana - M && p.y + t.alto <= v.altoVentana - M;

prueba("una posicion fuera de la pantalla, en cualquier esquina y con negativos, queda dentro", () => {
  const casos = [
    { x: -500, y: -500 },
    { x: 99999, y: -20 },
    { x: -1, y: 99999 },
    { x: 5000, y: 5000 },
    { x: -0.5, y: 400 },
    { x: Number.NaN, y: Number.POSITIVE_INFINITY },
  ];
  for (const caso of casos) {
    const p = ajustarDentroDePantalla(caso, tamano, ventana);
    assert.ok(dentro(p), `quedo afuera: ${JSON.stringify(caso)} -> ${JSON.stringify(p)}`);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  // Las cuatro esquinas quedan pegadas al margen, no mas alla.
  assert.deepEqual(ajustarDentroDePantalla({ x: -9, y: -9 }, tamano, ventana), { x: M, y: M });
  assert.deepEqual(ajustarDentroDePantalla({ x: 9e9, y: 9e9 }, tamano, ventana), {
    x: 1280 - 320 - M,
    y: 800 - 64 - M,
  });
  // Una posicion que ya esta dentro no se mueve.
  assert.deepEqual(ajustarDentroDePantalla({ x: 300, y: 200 }, tamano, ventana), { x: 300, y: 200 });
  // Pantalla mas chica que el cuadro: no da negativos.
  const chica = ajustarDentroDePantalla({ x: 50, y: 50 }, tamano, { anchoVentana: 100, altoVentana: 40 });
  assert.deepEqual(chica, { x: M, y: M });
});

prueba("en un celular angosto la tarjeta se encoge y la burbuja cabe", () => {
  const celular = { anchoVentana: 320, altoVentana: 640 };
  const t = tamanoDeLaForma("tarjeta", celular);
  assert.ok(t.ancho <= 320 - 2 * M, "la tarjeta es mas ancha que el celular");
  const b = tamanoDeLaForma("burbuja", celular);
  assert.ok(dentro(ajustarDentroDePantalla({ x: 900, y: 900 }, b, celular), b, celular));
});

prueba("la posicion por defecto es arriba a la derecha y dentro", () => {
  const p = posicionPorDefecto(ventana);
  assert.equal(p.forma, "tarjeta");
  assert.equal(p.y, M);
  assert.equal(p.x, 1280 - 320 - M);
  assert.ok(dentro(p));
});

prueba("un valor guardado roto o raro vuelve a la posicion por defecto sin fallar", () => {
  const porDefecto = posicionPorDefecto(ventana);
  const raros = [
    null,
    undefined,
    "",
    "{roto",
    "null",
    "42",
    '"texto"',
    "[]",
    "{}",
    '{"x":"10","y":20,"forma":"tarjeta"}',
    '{"x":10,"y":null,"forma":"burbuja"}',
    '{"x":1e999,"y":20,"forma":"tarjeta"}',
    '{"x":10,"y":20,"forma":"circulo"}',
    '{"x":10,"y":20}',
  ];
  for (const texto of raros) {
    assert.doesNotThrow(() => leerPreferencia(texto, ventana));
    assert.deepEqual(leerPreferencia(texto, ventana), porDefecto, `no volvio al defecto: ${texto}`);
    assert.equal(leerPreferenciaGuardada(texto), null);
  }
});

prueba("lo guardado se recupera en su forma y ajustado a la pantalla de ahora", () => {
  const texto = escribirPreferencia({ x: 40, y: 500, forma: "burbuja" });
  assert.deepEqual(leerPreferencia(texto, ventana), { x: 40, y: 500, forma: "burbuja" });
  // Guardado en una pantalla grande, leido en una chica: queda dentro.
  const lejos = escribirPreferencia({ x: 2400, y: 1300, forma: "tarjeta" });
  const celular = { anchoVentana: 375, altoVentana: 700 };
  const p = leerPreferencia(lejos, celular);
  assert.equal(p.forma, "tarjeta");
  assert.ok(dentro(p, tamanoDeLaForma("tarjeta", celular), celular));
  assert.equal(CLAVE_DEL_CUADRO, "llamada:cuadro");
});

prueba("el panel se arrastra con pointer events y touch-none solo en la agarradera", () => {
  assert.ok(!panel.includes("fixed inset-x-0 bottom-4"), "el cuadro sigue fijo abajo, tapando la caja de escribir");
  for (const evento of ["onPointerDown", "onPointerMove", "onPointerUp", "setPointerCapture"]) {
    assert.ok(panel.includes(evento), `falta ${evento} en PanelDeLlamada.tsx`);
  }
  assert.ok(panel.includes("UMBRAL_DE_ARRASTRE"), "falta distinguir el toque del arrastre");
  assert.equal((panel.match(/touch-none select-none/g) ?? []).length, 2, "touch-none tiene que ir solo en la agarradera y en la burbuja");
  assert.ok(panel.includes('addEventListener("resize"'), "falta reajustar al cambiar el tamano de la ventana");
  assert.ok(panel.includes("localStorage.setItem(CLAVE_DEL_CUADRO"), "no se guarda la posicion");
});

prueba("la preferencia se lee en un useEffect y cada llamada arranca en pantalla completa", () => {
  assert.ok(/useEffect\(\(\) => \{[\s\S]*?localStorage\.getItem\(CLAVE_DEL_CUADRO\)/.test(global));
  assert.ok(/setDatos\(\{ telefono, nombre, avatarUrl \}\);\s*setExpandido\(true\);/.test(global));
  assert.ok(global.includes("cuadro={cuadro}"), "LlamadaEnCurso no le pasa el cuadro al panel");
});

console.log(`${pruebas} pruebas ok`);
