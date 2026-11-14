// Pruebas de la llamada de tres, parte 1: la mezcla de sonido
// (src/features/llamadas/components/puente-de-llamadas.ts) y el servidor que marca por otra linea
// (src/app/api/wacalls/llamada/route.ts y src/lib/wacalls.ts).
// Parte 2: el hook useLlamada.ts con dos llamadas a la vez y el puente entre ellas.
// Correr: npm run test:llamada-de-tres
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
// Carga un .ts transpilado; sus imports relativos ("./audio-de-llamada") se cargan igual.
function cargarTs(sourcePath) {
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  const requerir = (spec) =>
    spec.startsWith("./") ? cargarTs(path.resolve(path.dirname(sourcePath), `${spec}.ts`)) : require(spec);
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    requerir,
    mod,
    sourcePath,
    path.dirname(sourcePath),
  );
  return mod.exports;
}
const { sumarPcm, mezclaParaLlamada, mezclaParaParlante, ColaDeSonido } = cargarTs(
  path.resolve("src/features/llamadas/components/puente-de-llamadas.ts"),
);
const { LIMITE_COLA_BYTES } = cargarTs(path.resolve("src/features/llamadas/components/audio-de-llamada.ts"));

const ruta = fs.readFileSync(path.resolve("src/app/api/wacalls/llamada/route.ts"), "utf8");
const wacalls = fs.readFileSync(path.resolve("src/lib/wacalls.ts"), "utf8");
const hook = fs.readFileSync(path.resolve("src/features/llamadas/components/useLlamada.ts"), "utf8");
const puente = fs.readFileSync(path.resolve("src/features/llamadas/components/puente-de-llamadas.ts"), "utf8");

/** El cuerpo de `const <nombre> = ...` dentro del hook, hasta la siguiente declaracion del hook. */
function cuerpoDe(nombre) {
  const inicio = hook.indexOf(`const ${nombre} = `);
  assert.ok(inicio > 0, `no se encontro ${nombre} en useLlamada.ts`);
  const resto = hook.slice(inicio + 1);
  const fin = resto.search(/\n  (const |useEffect\(|return \{)/);
  return fin < 0 ? resto : resto.slice(0, fin);
}

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const pcm = (...muestras) => Int16Array.from(muestras);
const lista = (x) => Array.from(x);

prueba("la suma va muestra por muestra", () => {
  const r = sumarPcm(pcm(1, 2, 3, -4), pcm(10, -20, 30, 40));
  assert.ok(r instanceof Int16Array);
  assert.deepEqual(lista(r), [11, -18, 33, 36]);
});

prueba("la suma nunca pasa de 32767 ni de -32768", () => {
  const r = sumarPcm(pcm(32767, 30000, -32768, -30000, 20000), pcm(1, 30000, -1, -30000, -20000));
  assert.deepEqual(lista(r), [32767, 32767, -32768, -32768, 0]);
  const fuerte = sumarPcm(new Int16Array(320).fill(32767), new Int16Array(320).fill(32767));
  assert.ok(lista(fuerte).every((m) => m === 32767), "no da la vuelta a negativo");
});

prueba("si un paquete es mas corto, lo que falta cuenta como silencio", () => {
  assert.deepEqual(lista(sumarPcm(pcm(1, 2, 3, 4), pcm(10))), [11, 2, 3, 4]);
  assert.deepEqual(lista(sumarPcm(pcm(), pcm(5, 6))), [5, 6]);
});

prueba("la suma no cambia los paquetes que recibe", () => {
  const a = pcm(1, 2);
  const b = pcm(3, 4);
  sumarPcm(a, b);
  assert.deepEqual(lista(a), [1, 2]);
  assert.deepEqual(lista(b), [3, 4]);
});

const microfono = pcm(100, 200, 300);
const llamadaA = pcm(1, 2, 3);
const llamadaB = pcm(1000, 2000, 3000);

prueba("la llamada A recibe microfono + B, y la llamada B recibe microfono + A", () => {
  const paraA = mezclaParaLlamada({ microfono, otraLlamada: llamadaB, silenciado: false });
  const paraB = mezclaParaLlamada({ microfono, otraLlamada: llamadaA, silenciado: false });
  assert.deepEqual(lista(paraA), [1100, 2200, 3300]);
  assert.deepEqual(lista(paraB), [101, 202, 303]);
});

prueba("con Alexander silenciado, A sigue recibiendo el sonido de B (y B el de A)", () => {
  const paraA = mezclaParaLlamada({ microfono, otraLlamada: llamadaB, silenciado: true });
  const paraB = mezclaParaLlamada({ microfono, otraLlamada: llamadaA, silenciado: true });
  assert.deepEqual(lista(paraA), lista(llamadaB));
  assert.deepEqual(lista(paraB), lista(llamadaA));
  assert.deepEqual(lista(microfono), [100, 200, 300], "silenciar no borra el microfono original");
});

prueba("el parlante suena A + B", () => {
  assert.deepEqual(lista(mezclaParaParlante(llamadaA, llamadaB)), [1001, 2002, 3003]);
});

prueba("route.ts: el permiso del modulo llamadas se pide antes de cualquier accion", () => {
  const permiso = ruta.indexOf('canAccessClientModule(access, "llamadas")');
  assert.ok(permiso > 0, "falta el control de permiso del modulo llamadas");
  const despues = [
    ruta.indexOf("await request.json()"),
    ruta.indexOf("getLineasDelNegocio(access.workspaceId)"),
    ruta.indexOf("getWaCallsSessionIdForChannel("),
    ruta.indexOf("switch (cuerpo.accion)"),
    ruta.indexOf("waCallsRequest<"),
  ];
  for (const posicion of despues) {
    assert.ok(posicion > permiso, `algo corre antes del permiso (posicion ${posicion})`);
  }
  // Si no tiene permiso, la ruta corta ahi mismo.
  assert.match(ruta.slice(permiso, permiso + 200), /status: 403/);
});

prueba("route.ts: la busqueda de otra linea filtra por el negocio de la sesion", () => {
  const llamadas = ruta.match(/getOtraLineaDelNegocio\(\s*([^,]+),/g) ?? [];
  assert.ok(llamadas.length >= 1, "iniciar no busca otra linea");
  for (const llamada of llamadas) {
    assert.match(llamada, /getOtraLineaDelNegocio\(\s*access\.workspaceId,/);
  }
  assert.ok(ruta.includes("No hay otra línea libre para agregar a alguien"));
  assert.match(ruta, /sessionId: linea/, "la respuesta de iniciar devuelve la linea usada");
  // Una linea que manda el navegador solo se acepta si es de este negocio.
  assert.match(ruta, /getLineasDelNegocio\(access\.workspaceId\)\)\.includes\(sidPedido\)/);
});

prueba("wacalls.ts: las lineas del negocio salen solo de canales de ese workspaceId", () => {
  const inicio = wacalls.indexOf("export async function getLineasDelNegocio(");
  assert.ok(inicio > 0);
  const cuerpo = wacalls.slice(inicio, wacalls.indexOf("\n}\n", inicio));
  assert.match(cuerpo, /where: \{ workspaceId, isActive: true \}/);
  const otra = wacalls.indexOf("export async function getOtraLineaDelNegocio(");
  assert.ok(otra > 0);
  assert.match(wacalls.slice(otra, wacalls.indexOf("\n}\n", otra)), /getLineasDelNegocio\(workspaceId\)/);
});

// --- Parte 2: la cola de cada llamada en el puente ---

prueba("la cola entrega los paquetes en orden y, vacia, da silencio", () => {
  const cola = new ColaDeSonido();
  assert.equal(cola.sacar().length, 0, "vacia da un paquete vacio");
  cola.meter(pcm(1, 2));
  cola.meter(pcm(3));
  assert.deepEqual(lista(cola.sacar()), [1, 2]);
  assert.deepEqual(lista(cola.sacar()), [3]);
  assert.equal(cola.tamanoEnBytes, 0);
  // Un paquete vacio suma como silencio: el microfono pasa igual.
  assert.deepEqual(lista(mezclaParaLlamada({ microfono, otraLlamada: cola.sacar(), silenciado: false })), [100, 200, 300]);
});

prueba("la cola bota el sonido atrasado (lo mas viejo) pasado el limite de hayQueDescartar", () => {
  const cola = new ColaDeSonido();
  const paquete = (n) => new Int16Array(320).fill(n);
  for (let i = 0; i < 40; i += 1) cola.meter(paquete(i));
  assert.ok(cola.tamanoEnBytes <= LIMITE_COLA_BYTES, "la cola paso el limite");
  assert.ok(cola.descartados > 0, "no boto nada");
  // Lo que queda es lo mas nuevo: el ultimo que entro sigue ahi y el primero ya no.
  const primero = cola.sacar();
  assert.ok(primero[0] > 0, "quedo el paquete mas viejo");
  let ultimo = primero;
  for (let s = cola.sacar(); s.length > 0; s = cola.sacar()) ultimo = s;
  assert.equal(ultimo[0], 39);
  assert.ok(/hayQueDescartar\(this\.bytes\)/.test(puente), "la cola no usa hayQueDescartar");
});

// --- Parte 2: useLlamada.ts ---

prueba("useLlamada.ts usa las funciones de puente-de-llamadas.ts", () => {
  assert.match(hook, /import \{ ColaDeSonido, mezclaParaLlamada, mezclaParaParlante \} from "\.\/puente-de-llamadas";/);
  assert.match(hook, /mezclaParaLlamada\(\{ microfono, otraLlamada: deB, silenciado: silencio \}\)/, "A no recibe microfono + B");
  assert.match(hook, /mezclaParaLlamada\(\{ microfono, otraLlamada: deA, silenciado: silencio \}\)/, "B no recibe microfono + A");
  assert.match(hook, /mezclaParaParlante\(deA, deB\)/, "el parlante no suena A + B");
  assert.match(hook, /const silencio = silenciadoRef\.current;/, "el silencio no sale del ref");
  // Lo que llega de cada llamada pasa por su cola mientras hay puente.
  assert.match(hook, /colaPrincipalRef\.current\.meter\(aInt16\(evento\.data\)\)/);
  assert.match(hook, /s\.cola\.meter\(aInt16\(evento\.data\)\)/);
});

prueba("colgar la principal pasa por las dos llamadas", () => {
  const colgar = cuerpoDe("colgar");
  assert.match(colgar, /soltarSegunda\("colgo", null, false\)/, "colgar no suelta a la persona agregada");
  assert.match(colgar, /colgarEnServidor\(\{ callId, channelId: canalRef\.current \}\)/, "colgar no cuelga la principal");
  // Y limpiar (lo que corre cuando la principal termina sola) tambien la suelta.
  assert.match(cuerpoDe("limpiar"), /soltarSegunda\(/);
  // Soltar la segunda la cuelga en WaCalls por SU linea.
  assert.match(cuerpoDe("soltarSegunda"), /colgarSegundaSinEsperar\(s\)/);
  assert.match(hook, /colgarSinEsperar\(s\.callId, undefined, s\.linea\)/);
});

prueba("pagehide cuelga las dos llamadas", () => {
  const efecto = hook.slice(hook.indexOf("const alCerrarPantalla = () => {"), hook.indexOf('addEventListener("pagehide"'));
  assert.match(efecto, /colgarAlSalir\(\)/, "pagehide no pasa por colgarAlSalir");
  const alSalir = cuerpoDe("colgarAlSalir");
  assert.match(alSalir, /colgarSinEsperar\(callId, canalRef\.current\)/, "no cuelga la principal");
  assert.match(alSalir, /segundaRef\.current[\s\S]*colgarSegundaSinEsperar\(s\)/, "no cuelga a la persona agregada");
});

prueba("agregarPersona marca por otra linea y no toca la principal si falla", () => {
  const agregar = cuerpoDe("agregarPersona");
  assert.match(agregar, /otraLineaDistintaDe: lineaPrincipal/);
  assert.match(agregar, /s\.linea = iniciada\.sessionId/, "no guarda la linea que devuelve la ruta");
  assert.match(hook, /lineaPrincipalRef\.current = iniciada\.sessionId/);
  assert.match(agregar, /if \(segundaRef\.current\) \{\s*onError/, "permite mas de una persona extra");
  assert.match(agregar, /negociarAudio\(pc, \{ callId: s\.callId, sessionId: s\.linea \}\)/);
  // Si falla, muestra el error y suelta solo la segunda.
  const captura = agregar.slice(agregar.indexOf("} catch (error) {"));
  assert.match(captura, /onError\?\.\(mensaje\)/);
  assert.match(captura, /soltarSegunda\("error", mensaje, true\)/);
  assert.ok(!/colgar\(\)|limpiar\(\)|cambiarEstado\(/.test(agregar), "agregarPersona toca la llamada principal");
});

prueba("quitarPersona cuelga solo la segunda; silenciar con puente es solo local", () => {
  const quitar = cuerpoDe("quitarPersona");
  assert.match(quitar, /soltarSegunda\("colgo", null, true\)/);
  assert.ok(!/colgar\(|limpiar\(/.test(quitar));
  const silenciar = cuerpoDe("alternarSilencio");
  assert.match(silenciar, /silenciadoRef\.current = siguiente;[\s\S]*if \(segundaRef\.current\) \{\s*return;\s*\}[\s\S]*accion: "silenciar"/);
  assert.match(hook, /return \{[\s\S]*segunda,\s*agregarPersona,\s*quitarPersona,\s*\};/);
});

console.log(`\n${pruebas} pruebas ok`);
