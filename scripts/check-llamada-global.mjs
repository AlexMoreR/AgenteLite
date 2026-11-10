// La llamada de WhatsApp vive una sola vez para todo el CRM y no se corta al cambiar de chat
// (tarjeta q4fgfwur, parte 1). Lee el codigo: no hace falta navegador ni base.
// Correr: npm run test:llamada-global
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const leer = (archivo) => fs.readFileSync(path.resolve(archivo), "utf8");

const providers = leer("src/components/providers.tsx");
const boton = leer("src/features/llamadas/components/BotonLlamar.tsx");
const hook = leer("src/features/llamadas/components/useLlamada.ts");
const global = leer("src/features/llamadas/components/LlamadaEnCurso.tsx");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("providers.tsx monta la llamada global", () => {
  assert.ok(providers.includes("LlamadaEnCurso"), "providers.tsx no menciona LlamadaEnCurso");
  assert.match(providers, /<LlamadaEnCursoProvider>/);
  // Dentro de SessionProvider: la llamada necesita la sesion de la asesora.
  assert.ok(
    providers.indexOf("<SessionProvider") < providers.indexOf("<LlamadaEnCursoProvider>") &&
      providers.indexOf("</LlamadaEnCursoProvider>") < providers.indexOf("</SessionProvider>"),
    "LlamadaEnCursoProvider tiene que estar adentro de SessionProvider",
  );
});

prueba("BotonLlamar es solo un boton: sin llamada ni audio propios", () => {
  assert.ok(!boton.includes("useLlamada("), "BotonLlamar no puede tener su propio useLlamada(");
  assert.ok(!boton.includes("<audio"), "BotonLlamar no puede tener su propio <audio");
  assert.ok(!boton.includes("<PanelDeLlamada"), "el panel vive en LlamadaEnCurso.tsx");
  assert.ok(boton.includes("useLlamadaEnCurso()"));
  assert.ok(boton.includes("marcar("));
  assert.ok(boton.includes("Ya hay una llamada en curso"));
});

prueba("LlamadaEnCurso.tsx tiene el unico useLlamada, el panel y el audio", () => {
  assert.equal(global.split("useLlamada(").length - 1, 1, "tiene que haber exactamente un useLlamada(");
  assert.ok(global.includes("<PanelDeLlamada"));
  assert.match(global, /<audio ref=\{audioRef\} autoPlay playsInline className="hidden" \/>/);
  assert.ok(global.includes('estado !== "libre"'), "con la llamada libre no se dibuja el panel");
});

prueba("useLlamada cuelga en WaCalls al cerrar la pestaña o desmontar", () => {
  assert.ok(hook.includes("sendBeacon"), "useLlamada.ts no usa sendBeacon");
  const desdeBeacon = hook.slice(hook.indexOf("navigator.sendBeacon("));
  assert.ok(desdeBeacon.slice(0, 200).includes('"/api/wacalls/llamada"'), "sendBeacon tiene que ir a /api/wacalls/llamada");
  assert.ok(hook.includes('accion: "colgar"'), "mismo cuerpo que colgar()");
  assert.ok(hook.includes("keepalive: true"), "sin sendBeacon, fetch con keepalive");
  assert.ok(hook.includes('addEventListener("pagehide"'));
});

prueba("la linea se recibe al marcar y queda fijada antes de iniciar", () => {
  assert.match(hook, /async \(telefono: string, channelId\?: string \| null, esOculto = false\)/);
  const iniciar = hook.indexOf('accion: "iniciar"');
  const fijada = hook.indexOf("canalRef.current = channelId");
  assert.ok(fijada > 0 && fijada < iniciar, "canalRef se fija antes de iniciar");
});

console.log(`\n${pruebas} pruebas ok`);
