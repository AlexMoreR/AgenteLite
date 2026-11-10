// Pruebas de la llamada en curso global (no se corta al cambiar de chat, 10-11-2026).
// Correr: npm run test:llamada-global
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const leer = (ruta) => fs.readFileSync(path.resolve(ruta), "utf8");

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

console.log(`${pruebas} pruebas ok`);
