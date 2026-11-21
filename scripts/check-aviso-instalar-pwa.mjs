// Pruebas de las notificaciones en todo el CRM y la franja de iPhone para instalar la app (21-11-2026).
// Correr: npm run test:aviso-instalar-pwa
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const leer = (ruta) => fs.readFileSync(path.resolve(ruta), "utf8");

const armazon = leer("src/components/app-shell.tsx");
const chats = leer("src/app/cliente/chats/page.tsx");
const layout = leer("src/app/layout.tsx");
const interruptor = leer("src/components/chats/notification-permission-toggle.tsx");
const franja = leer("src/components/chats/aviso-instalar-pwa.tsx");

// pwa-instalada.ts no importa nada: se transpila y se evalúa con un navigator/window de mentira.
function cargarPwaInstalada({ userAgent, standaloneMedia = false, navigatorStandalone }) {
  const sourcePath = path.resolve("src/lib/pwa-instalada.ts");
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const navigator = { userAgent, standalone: navigatorStandalone };
  const window = { matchMedia: () => ({ matches: standaloneMedia }) };
  const mod = { exports: {} };
  new Function("exports", "module", "navigator", "window", transpiled.outputText)(
    mod.exports,
    mod,
    navigator,
    window,
  );
  return mod.exports;
}

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";

prueba("detecta iPhone/iPad y no confunde un Android", () => {
  assert.equal(cargarPwaInstalada({ userAgent: IPHONE }).isProbablyIos(), true);
  assert.equal(cargarPwaInstalada({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5)" }).isProbablyIos(), true);
  assert.equal(cargarPwaInstalada({ userAgent: ANDROID }).isProbablyIos(), false);
});

prueba("la app instalada se reconoce por display-mode o por navigator.standalone", () => {
  assert.equal(cargarPwaInstalada({ userAgent: IPHONE }).isStandalone(), false);
  assert.equal(cargarPwaInstalada({ userAgent: IPHONE, standaloneMedia: true }).isStandalone(), true);
  assert.equal(cargarPwaInstalada({ userAgent: IPHONE, navigatorStandalone: true }).isStandalone(), true);
});

prueba("el interruptor de Ajustes usa las funciones compartidas y no tiene copia propia", () => {
  assert.ok(interruptor.includes('from "@/lib/pwa-instalada"'), "notification-permission-toggle no importa pwa-instalada");
  assert.ok(!/function isProbablyIos\(/.test(interruptor), "notification-permission-toggle todavia define isProbablyIos");
  assert.ok(!/function isStandalone\(/.test(interruptor), "notification-permission-toggle todavia define isStandalone");
});

prueba("PushSubscriptionManager se monta una sola vez, en el armazón y no en Chats", () => {
  assert.equal((armazon.match(/<PushSubscriptionManager\b/g) ?? []).length, 1, "app-shell debe montar PushSubscriptionManager una vez");
  assert.ok(!chats.includes("<PushSubscriptionManager"), "la pagina de Chats todavia monta PushSubscriptionManager");
  const bloque = armazon.slice(armazon.indexOf("<ChatsOfficialRealtime"), armazon.indexOf("<PushSubscriptionManager"));
  assert.ok(bloque.length > 0 && !bloque.includes(") : null}"), "PushSubscriptionManager debe ir junto a ChatsOfficialRealtime");
});

prueba("la franja sale solo a quien tiene el permiso de llamadas", () => {
  assert.ok(/puedeVerLlamadas && [^\n]*<AvisoInstalarPwa|puedeVerLlamadas &&[\s\S]{0,120}<AvisoInstalarPwa/.test(armazon), "la franja no depende de puedeVerLlamadas");
  assert.ok(/canAccessClientModule\(clientAccess, "llamadas"\)/.test(layout), "layout no calcula el permiso de llamadas");
});

prueba("la franja: instalar en Safari, pedir permiso instalada, nada con permiso; se cierra por sesión", () => {
  assert.ok(franja.includes("Compartir → Agregar a inicio"), "falta el texto de instalar");
  assert.ok(/if \(!isStandalone\(\)\) return "instalar"/.test(franja), "sin instalar no pide instalar");
  assert.ok(/permission === "granted"\) return "nada"/.test(franja), "con permiso dado todavia sale");
  assert.ok(franja.includes("requestPermissionAndSubscribe"), "instalada no pide el permiso");
  assert.ok(franja.includes("sessionStorage"), "el cierre no se recuerda en la sesion");
});

console.log(`\n${pruebas} pruebas ok`);
