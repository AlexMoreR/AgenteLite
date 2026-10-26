// El CANDADO de solo lectura del Agente de Marketing en Meta Ads (agentes-de-area/marketing/.claude/settings.json).
// No usa red ni Claude. Correr: node agentes-de-area/pruebas/probar-solo-lectura-meta.mjs
//
// Qué comprueba:
//  1. Cada herramienta de Meta PERMITIDA es de lectura (get/list/…); ninguna escribe.
//  2. Nunca se permite el servidor de Meta completo (`mcp__meta`): una herramienta nueva de Meta queda bloqueada porque solo
//     entran las que están nombradas. Cada herramienta de Meta que crea, edita, prende, pausa o borra está en la lista PROHIBIDA.
//  3. El lanzador le pasa esa lista a Claude Code (--allowedTools / --disallowedTools) y el agente no tiene Bash ni WhatsApp.
//  4. En el MCP del CRM solo puede leer y guardar su resumen: nada de WhatsApp, tarjetas ni edición del bot.
//  5. Los archivos del agente (CLAUDE.md y prompts) repiten el límite y el código del lanzador no llama a ninguna herramienta de Meta.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARKETING = path.resolve(AQUI, "..", "marketing");
const { herramientasDelAgente } = await import("../correr-agente.mjs");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const settings = JSON.parse(fs.readFileSync(path.join(MARKETING, ".claude", "settings.json"), "utf8"));
const permitidas = settings.permissions.allow;
const prohibidas = settings.permissions.deny;
const deMeta = (lista) => lista.filter((h) => h.startsWith("mcp__meta"));

const VERBOS_DE_LECTURA = /^mcp__meta__(get|list|read|search|fetch|preview|describe)_/;
const VERBOS = "create|update|edit|delete|remove|pause|enable|disable|activate|resume|launch|publish|upload|duplicate|copy|set|add|post|send|archive|budget|boost|attach|link|assign|run|start|stop|schedule";
// Se compara por PALABRAS (separadas por _): "adsets" no es el verbo "set".
const VERBOS_DE_ESCRITURA = new RegExp(`(^|_)(${VERBOS})(_|$)`);

prueba("toda herramienta de Meta permitida es de LECTURA", () => {
  const meta = deMeta(permitidas);
  assert.ok(meta.length >= 5, "hay herramientas de lectura permitidas");
  for (const h of meta) {
    assert.match(h, VERBOS_DE_LECTURA, `${h} no parece de lectura`);
    assert.doesNotMatch(h.replace("mcp__meta__", ""), VERBOS_DE_ESCRITURA, `${h} suena a escritura`);
  }
});

prueba("nunca se permite el servidor de Meta completo ni un comodín", () => {
  assert.ok(!permitidas.includes("mcp__meta"));
  assert.ok(!permitidas.some((h) => /mcp__meta\*?$/.test(h) || h.includes("*")), "sin comodines");
  // Lo que no está nombrado se bloquea (en `claude -p` no hay quien apruebe), y además se prohíben por nombre todas las que escriben.
  for (const h of [
    "campaign", "adset", "ad", "ad_creative", "custom_audience",
  ]) {
    for (const verbo of ["create", "update", "delete"]) {
      assert.ok(prohibidas.includes(`mcp__meta__${verbo}_${h}`), `falta prohibir ${verbo}_${h}`);
    }
  }
  for (const h of ["pause_campaign", "pause_adset", "pause_ad", "enable_campaign", "enable_adset", "enable_ad", "update_budget", "upload_ad_image", "upload_ad_video", "create_catalog", "create_pixel", "create_ab_test", "create_lookalike_audience"]) {
    assert.ok(prohibidas.includes(`mcp__meta__${h}`), `falta prohibir ${h}`);
  }
});

prueba("ninguna herramienta de Meta está permitida y prohibida a la vez, y las prohibidas de Meta son de escritura", () => {
  for (const h of deMeta(prohibidas)) {
    assert.ok(!permitidas.includes(h), `${h} está en las dos listas`);
    assert.match(h, VERBOS_DE_ESCRITURA, `${h} está prohibida pero no suena a escritura`);
  }
});

prueba("el lanzador pasa a Claude Code esa lista (permitidas y prohibidas) tal cual", () => {
  const { permitidas: p, prohibidas: d, deSettings } = herramientasDelAgente({}, MARKETING);
  assert.equal(deSettings, true);
  assert.deepEqual(p, permitidas);
  assert.deepEqual(d, prohibidas);
  // Aunque config.local.json pidiera más, manda el candado de la carpeta.
  const forzado = herramientasDelAgente({ herramientasPermitidas: ["mcp__meta"], herramientasProhibidas: [] }, MARKETING);
  assert.ok(!forzado.permitidas.includes("mcp__meta"));
  const fuente = fs.readFileSync(path.resolve(AQUI, "..", "correr-agente.mjs"), "utf8");
  assert.ok(fuente.includes('"--allowedTools"') && fuente.includes('"--disallowedTools"'));
});

prueba("sin Bash, sin navegar y sin WhatsApp; en el CRM solo lee y guarda su resumen", () => {
  for (const h of ["Bash", "WebFetch", "WebSearch", "mcp__aizencrm__mandar_whatsapp_al_equipo", "mcp__aizencrm__crear_tarjeta", "mcp__aizencrm__editar_paso_del_embudo", "mcp__aizencrm__editar_texto_del_agente"]) {
    assert.ok(prohibidas.includes(h), `${h} tiene que estar prohibida`);
    assert.ok(!permitidas.includes(h), `${h} no puede estar permitida`);
  }
  assert.ok(!permitidas.includes("mcp__aizencrm"), "no se permite el servidor del CRM completo");
  const crm = permitidas.filter((h) => h.startsWith("mcp__aizencrm__"));
  assert.deepEqual(
    crm.sort(),
    ["agente_de_marketing", "guardar_resumen_del_dia", "listar_conversaciones", "listar_productos", "numeros_de_marketing", "ver_conversacion"].map((n) => `mcp__aizencrm__${n}`).sort(),
  );
});

prueba("el CLAUDE.md y los prompts repiten el límite, y el lanzador no llama a ninguna herramienta de Meta", () => {
  const claude = fs.readFileSync(path.join(MARKETING, "CLAUDE.md"), "utf8");
  assert.match(claude, /SOLO LEES/);
  assert.match(claude, /Nunca pausas, prendes, editas presupuesto, creas/);
  assert.match(claude, /reaprenda/);
  for (const sub of ["vigilante-de-pauta", "calidad-del-lead", "ideas-de-anuncio"]) {
    const texto = fs.readFileSync(path.join(MARKETING, "subagentes", sub, "PROMPT.md"), "utf8");
    assert.match(texto, /Solo lees|solo lees|No creas nada en Meta/i, sub);
  }
  const lanzador = fs.readFileSync(path.resolve(AQUI, "..", "correr-agente.mjs"), "utf8");
  assert.ok(!/mcp__meta__|graph\.facebook|adsets?\b.*POST/i.test(lanzador.replace(/^\s*\/\/.*$/gm, "")), "el lanzador no habla con Meta");
  const ideas = fs.readFileSync(path.join(MARKETING, "subagentes", "ideas-de-anuncio", "PROMPT.md"), "utf8");
  assert.match(ideas, /MÁXIMO 3/);
  assert.match(ideas, /fotos propias de Magilus/);
});

prueba("el .mcp.json.example no trae claves reales", () => {
  const ejemplo = fs.readFileSync(path.join(MARKETING, ".mcp.json.example"), "utf8");
  assert.ok(/PEGAR_AQUI/.test(ejemplo));
  assert.ok(!/eyJ|EAA[A-Za-z0-9]{20}/.test(ejemplo));
});

console.log(`\n${pruebas} pruebas pasaron`);
