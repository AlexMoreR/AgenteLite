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

// 1) Las clases comunes: solo el icono en un cuadrito (como antes del 7-nov), todos del mismo alto.
const alto = comun.match(/export const ALTO_DE_LA_BARRA = "([^"]+)"/);
assert.ok(alto, "falta la constante ALTO_DE_LA_BARRA");
assert.equal(alto[1], "h-8", "los botones de la barra miden unos 32 px (h-8), solo el icono");
const boton = comun.match(/export const CLASES_BOTON_DE_LA_BARRA = `([^`]+)`/);
assert.ok(boton, "falta la constante CLASES_BOTON_DE_LA_BARRA");
assert.ok(boton[1].includes("${ALTO_DE_LA_BARRA}"), "el boton toma su alto de ALTO_DE_LA_BARRA");
for (const clase of ["shrink-0", "items-center", "justify-center"]) {
  assert.ok(boton[1].split(" ").includes(clase), `el boton de la barra debe tener ${clase}`);
}
assert.ok(!boton[1].split(" ").includes("flex-col"), "el boton ya no apila icono y texto");
const etiqueta = comun.match(/export const CLASES_ETIQUETA_DE_LA_BARRA = "([^"]+)"/);
assert.ok(etiqueta, "falta la constante CLASES_ETIQUETA_DE_LA_BARRA");
assert.equal(etiqueta[1], "sr-only", "el nombre no se ve en la barra (solo lectores de pantalla)");
assert.ok(comun.includes("export function mostrarNombreAlMantener"), "existe el aviso del nombre al mantener presionado");
assert.ok(comun.includes("(pointer: coarse)"), "el aviso solo corre con pantalla tactil (el mouse usa el title)");

// 2) Cada boton de la barra usa el estilo comun, conserva su texto solo para lectores y avisa su nombre al mantener presionado.
const conEstilo = (fuente, nombre) =>
  assert.ok(
    fuente.includes("className={CLASES_BOTON_DE_LA_BARRA}") && fuente.includes("onContextMenu={mostrarNombreAlMantener("),
    `${nombre}: el boton de la barra debe usar CLASES_BOTON_DE_LA_BARRA y mostrarNombreAlMantener`,
  );
conEstilo(posponer, "Resolver o posponer");
conEstilo(resolver, "Resolver (sin ficha)");
conEstilo(asignar, "Asignar");
conEstilo(etiquetas, "Etiquetas");
conEstilo(panel, "Nota y Agendar");
const cuantas = (fuente, texto) => fuente.split(texto).length - 1;
assert.equal(cuantas(panel, "className={CLASES_BOTON_DE_LA_BARRA}"), 2, "Nota y Agendar usan el estilo de la barra");
assert.equal(cuantas(panel, "onContextMenu={mostrarNombreAlMantener("), 2, "Nota y Agendar avisan su nombre al mantener presionado");

assert.ok(posponer.includes('"Reabrir" : "Resolver"'), "el menu con boton conserva Resolver (o Reabrir) como texto para lectores");
assert.ok(resolver.includes('{resolved ? "Reabrir" : "Resolver"}'), "el boton sin ficha conserva Resolver (o Reabrir)");
assert.ok(asignar.includes('{assignee ? "Asignado" : "Asignar"}'), "el boton de asignar conserva Asignar (o Asignado)");
assert.ok(etiquetas.includes(">Etiquetas</span>"), "el boton de etiquetas conserva su texto");
assert.ok(panel.includes(">Nota</span>"), "el boton de nota conserva su texto");
assert.ok(panel.includes(">Agendar</span>"), "el boton de seguimiento conserva su texto");
for (const [fuente, nombre] of [[posponer, "posponer"], [resolver, "resolver"], [asignar, "asignar"], [etiquetas, "etiquetas"]]) {
  assert.ok(fuente.includes("title="), `${nombre}: conserva el title (nombre al pasar el mouse)`);
}
assert.ok(panel.includes('title="Nota interna"') && panel.includes('title="Agendar seguimiento"'), "Nota y Agendar conservan el title");

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
