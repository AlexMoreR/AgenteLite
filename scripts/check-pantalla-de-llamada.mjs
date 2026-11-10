// Pruebas de la pantalla de llamada: tiene que tapar TODA la bandeja (la busqueda y los filtros de
// chats no se pueden ver encima). Pidio el dueno el 10-nov-2026 (tarjeta ui5z7zmx), por segunda vez.
// La pantalla se dibuja con un portal en document.body porque la cabecera del chat (relative z-10 y
// @container en chat-conversation-panel.tsx) encierra cualquier `fixed` que tenga adentro.
// Lee el codigo fuente; no necesita base, red ni navegador.
// Correr: node scripts/check-pantalla-de-llamada.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const leer = (ruta) => fs.readFileSync(path.resolve(ruta), "utf8");

const panel = leer("src/features/llamadas/components/PanelDeLlamada.tsx");
const boton = leer("src/features/llamadas/components/BotonLlamar.tsx");
const bandeja = leer("src/components/chats/appsidebar.tsx");

// Solo el codigo, sin comentarios, para que una explicacion no cuente como si fuera codigo.
const sinComentarios = (fuente) => fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const codigoPanel = sinComentarios(panel);

// 1) El panel usa un portal hacia document.body, para la pantalla grande Y para la barra minimizada.
assert.match(
  codigoPanel,
  /import\s*\{\s*createPortal\s*\}\s*from\s*"react-dom"/,
  "PanelDeLlamada debe importar createPortal de react-dom",
);
const portales = codigoPanel.match(/return createPortal\(/g) ?? [];
assert.equal(portales.length, 2, "la pantalla grande y la barra minimizada se dibujan con createPortal (2 portales)");
const haciaElBody = codigoPanel.match(/,\s*document\.body,?\s*\)/g) ?? [];
assert.equal(haciaElBody.length, 2, "los dos portales van a document.body");
// Ningun return deja la llamada dibujada en su sitio (dentro de la caja del chat).
assert.doesNotMatch(codigoPanel, /return\s*\(\s*<div/, "ninguna forma del panel se puede dibujar fuera del portal");

// Solo en el navegador: el portal no se arma en el servidor.
assert.match(codigoPanel, /useSyncExternalStore\(/, "el panel espera a estar en el navegador (useSyncExternalStore)");
assert.match(codigoPanel, /!montado/, "sin montar en el navegador el panel no dibuja nada");

// 2) La pantalla grande cubre todo (fixed inset-0) y las dos formas usan la capa z-[110].
const clases = [...codigoPanel.matchAll(/className="([^"]*\bfixed\b[^"]*)"/g)].map((m) => m[1].split(/\s+/));
assert.equal(clases.length, 2, "hay dos cajas fixed: la pantalla grande y la barra minimizada");
const grande = clases.find((c) => c.includes("inset-0"));
assert.ok(grande, "la pantalla grande tiene fixed inset-0");
assert.ok(grande.includes("z-[110]"), "la pantalla grande tiene z-[110]");
const barra = clases.find((c) => !c.includes("inset-0"));
assert.ok(barra && barra.includes("z-[110]"), "la barra minimizada tiene z-[110]");
assert.doesNotMatch(codigoPanel, /z-\[60\]/, "no queda la capa vieja z-[60]");

// 3) El <audio> se queda en BotonLlamar.tsx, fuera del portal: mover la pantalla no corta el sonido.
assert.match(boton, /<audio ref=\{audioRef\}/, "el <audio> de la llamada sigue en BotonLlamar.tsx");
assert.doesNotMatch(codigoPanel, /<audio\b/, "el <audio> no se mete dentro del panel (ni del portal)");
assert.doesNotMatch(sinComentarios(boton), /createPortal/, "BotonLlamar no usa portal: el audio queda donde estaba");

// 4) La capa de la llamada queda encima de la cabecera de la bandeja (busqueda y filtros).
const capaDe = (lista) => Number(lista.find((c) => /^z-\[?\d+\]?$/.test(c)).replace(/[^\d]/g, ""));
const capaLlamada = capaDe(grande);
const cabecera = bandeja.match(/className="(relative z-\[?\d+\]?[^"]*border-b[^"]*)"/);
assert.ok(cabecera, "no encontre la cabecera de la bandeja (busqueda y filtros) en appsidebar.tsx");
const capaBandeja = capaDe(cabecera[1].split(/\s+/));
assert.ok(
  capaLlamada > capaBandeja,
  `la llamada (z-${capaLlamada}) debe quedar encima de la cabecera de la bandeja (z-${capaBandeja})`,
);
// Y por debajo del bloqueo de plan vencido, que tiene que seguir mandando.
const bloqueo = leer("src/components/client-plan-block-modal.tsx").match(/fixed inset-0 z-\[(\d+)\]/);
assert.ok(bloqueo, "no encontre la capa del aviso de plan vencido");
assert.ok(capaLlamada < Number(bloqueo[1]), "el aviso de plan vencido sigue encima de la llamada");

console.log("OK pantalla de llamada: portal en document.body, z-[110], audio en BotonLlamar, encima de la bandeja");
