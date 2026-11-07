// Pruebas de la barra de acciones del chat en celular (parte 2): cada boton muestra una etiqueta corta debajo del
// icono (Asignar/Asignado, Nota, Agendar, Etiquetas, Resolver/Reabrir), sin cambiar los nombres accesibles, y la barra
// real y su silueta usan el mismo alto para que no salte al cargar. Lee el codigo fuente; no necesita base ni red.
// El boton del Mapa del lead ya no esta en la barra: lo quito Alexander el 6-nov-2026 (commit fe0a5ac).
// Correr: node scripts/check-chats-celular.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const leer = (ruta) => fs.readFileSync(path.resolve(ruta), "utf8");

const comun = leer("src/components/chats/boton-de-la-barra.ts");
const posponer = leer("src/components/chats/snooze-chat-control.tsx");
const resolver = leer("src/components/chats/resolve-chat-control.tsx");
const asignar = leer("src/components/chats/assign-chat-control.tsx");
const etiquetas = leer("src/components/chats/chat-tags-control.tsx");
const panel = leer("src/components/chats/chat-conversation-panel.tsx");
const acciones = leer("src/components/chats/chat-header-actions.tsx");

// 1) Las clases comunes: icono arriba y texto abajo, sin encogerse, todos del mismo alto.
const alto = comun.match(/export const ALTO_DE_LA_BARRA = "([^"]+)"/);
assert.ok(alto, "falta la constante ALTO_DE_LA_BARRA");
assert.equal(alto[1], "h-11", "los botones de la barra miden unos 44 px (h-11)");
const boton = comun.match(/export const CLASES_BOTON_DE_LA_BARRA = `([^`]+)`/);
assert.ok(boton, "falta la constante CLASES_BOTON_DE_LA_BARRA");
assert.ok(boton[1].includes("${ALTO_DE_LA_BARRA}"), "el boton toma su alto de ALTO_DE_LA_BARRA");
for (const clase of ["flex-col", "shrink-0", "items-center"]) {
  assert.ok(boton[1].split(" ").includes(clase), `el boton de la barra debe tener ${clase}`);
}
const etiqueta = comun.match(/export const CLASES_ETIQUETA_DE_LA_BARRA = "([^"]+)"/);
assert.ok(etiqueta, "falta la constante CLASES_ETIQUETA_DE_LA_BARRA");
for (const clase of ["text-[10px]", "whitespace-nowrap"]) {
  assert.ok(etiqueta[1].split(" ").includes(clase), `la etiqueta debe tener ${clase} (unos 10 px, sin cortarse)`);
}

// 2) Cada boton de la barra usa el estilo comun y muestra su texto visible.
const conEstilo = (fuente, nombre) =>
  assert.ok(
    fuente.includes("className={CLASES_BOTON_DE_LA_BARRA}") && fuente.includes("className={CLASES_ETIQUETA_DE_LA_BARRA}"),
    `${nombre}: el boton de la barra debe usar CLASES_BOTON_DE_LA_BARRA y CLASES_ETIQUETA_DE_LA_BARRA`,
  );
conEstilo(posponer, "Resolver o posponer");
conEstilo(resolver, "Resolver (sin ficha)");
conEstilo(asignar, "Asignar");
conEstilo(etiquetas, "Etiquetas");
conEstilo(panel, "Nota y Agendar");
assert.equal(panel.match(/className=\{CLASES_BOTON_DE_LA_BARRA\}/g)?.length, 2, "Nota y Agendar usan el estilo de la barra");

assert.ok(/"Reabrir" : "Resolver"/.test(posponer), "el boton con menu dice Resolver (o Reabrir)");
assert.ok(/\{resolved \? "Reabrir" : "Resolver"\}/.test(resolver), "el boton sin ficha dice Resolver (o Reabrir)");
assert.ok(/\{assignee \? "Asignado" : "Asignar"\}/.test(asignar), "el boton de asignar dice Asignar (o Asignado)");
assert.ok(/>Etiquetas<\/span>/.test(etiquetas), "el boton de etiquetas dice Etiquetas");
assert.ok(/>Nota<\/span>/.test(panel), "el boton de nota dice Nota");
assert.ok(/>Agendar<\/span>/.test(panel), "el boton de seguimiento dice Agendar");

// 3) Los nombres accesibles no cambian.
assert.ok(posponer.includes('aria-label="Resolver o posponer"'), "sigue el aria-label 'Resolver o posponer'");
assert.ok(
  resolver.includes('aria-label={resolved ? "Reabrir conversación" : "Resolver conversación"}'),
  "siguen los aria-label 'Resolver conversación' y 'Reabrir conversación'",
);
assert.ok(
  asignar.includes('aria-label={assignee ? `Asignado a ${buttonLabel}` : "Asignar chat"}'),
  "siguen los aria-label 'Asignar chat' y 'Asignado a…'",
);
assert.ok(etiquetas.includes('aria-label="Etiquetas"'), "sigue el aria-label 'Etiquetas'");
assert.ok(panel.includes('aria-label="Nota interna"'), "sigue el aria-label 'Nota interna'");
assert.ok(panel.includes('aria-label="Agendar seguimiento"'), "sigue el aria-label 'Agendar seguimiento'");

// 4) El menu de Resolver sigue igual: la opcion de resolver adentro y Posponer…, con la flechita que avisa del menu.
assert.ok(posponer.includes("comoOpcion"), "el menu conserva Resolver como opcion (comoOpcion)");
assert.ok(posponer.includes("Posponer…"), "el menu conserva 'Posponer…'");
assert.ok(posponer.includes('<ChevronDown className="size-3.5 text-muted-foreground" />'), "conserva la flechita del menu");

// 5) La barra real y la silueta usan el mismo alto: ninguna silueta de la barra queda en size-8.
assert.ok(acciones.includes('import { ALTO_DE_LA_BARRA } from "./boton-de-la-barra"'), "la silueta toma el alto de boton-de-la-barra");
const silueta = acciones.slice(acciones.indexOf("export function BarraDeAccionesEnSilueta"), acciones.indexOf("export function BarraDeAccionesDelChat"));
assert.ok(silueta.length > 0, "no se encontro BarraDeAccionesEnSilueta");
assert.equal(silueta.match(/\$\{ALTO_DE_LA_BARRA\}/g)?.length, 2, "Asignar y Resolver en silueta usan ALTO_DE_LA_BARRA");
assert.ok(!/Skeleton className="(size-8|h-8)[^"]*rounded-lg"/.test(silueta), "la silueta de la barra no puede quedar en size-8");

const inicioBarra = panel.indexOf("ref={refBarraQueSeDesliza}");
assert.ok(inicioBarra > 0, "no se encontro la barra del panel");
const barraDelPanel = panel.slice(inicioBarra, panel.indexOf("<ChatTagsControl", inicioBarra));
assert.equal(barraDelPanel.match(/Skeleton className=\{`\$\{ALTO_DE_LA_BARRA\}/g)?.length, 3, "las tres siluetas del panel usan ALTO_DE_LA_BARRA");
assert.ok(!barraDelPanel.includes('<Skeleton className="size-8 rounded-lg" />'), "las siluetas del panel no pueden quedar en size-8");

// 6) Solo en la barra: las variantes de escritorio no se tocan.
assert.ok(resolver.includes("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5"), "el Resolver de escritorio no cambia");
assert.ok(asignar.includes("inline-flex h-7 max-w-[160px] items-center gap-1.5"), "el Asignar de escritorio no cambia");

console.log("check-chats-celular: OK");
