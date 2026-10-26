// Comprueba que el Agente de Marketing NO tiene ninguna acción de escritura en Meta Ads, sin red ni Claude real.
//   npm run test:agente-de-marketing-candado
//
// Se revisa: (1) las listas de lib/candado-meta.mjs, (2) que marketing/.claude/settings.json diga lo mismo,
// (3) lo que el lanzador le pasa a Claude Code, (4) que las instrucciones y los prompts no lo contradigan.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { argumentosDeClaude, CEREBRO_DEL_AREA, PROHIBIDAS_DEL_CEREBRO_GENERAL } from "../correr-agente.mjs";
import { CRM_PERMITIDAS_MARKETING, META_ESCRITURA, META_LECTURA, SERVIDOR_META, VERBOS_QUE_ESCRIBEN } from "../lib/candado-meta.mjs";

const CARPETA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKETING = path.join(CARPETA, "marketing");
const settings = JSON.parse(fs.readFileSync(path.join(MARKETING, ".claude", "settings.json"), "utf8"));
const prefijo = `mcp__${SERVIDOR_META}__`;
const nombreCorto = (herramienta) => herramienta.slice(prefijo.length);

let pruebas = 0;
const fallas = [];
function prueba(nombre, fn) {
  try {
    fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}

prueba("ninguna herramienta de Meta permitida tiene un verbo que escribe", () => {
  assert.ok(META_LECTURA.length > 0);
  for (const herramienta of META_LECTURA) {
    assert.ok(herramienta.startsWith(prefijo), herramienta);
    assert.ok(!VERBOS_QUE_ESCRIBEN.test(nombreCorto(herramienta)), `${herramienta} parece de escritura`);
    assert.match(nombreCorto(herramienta), /^get_/, `${herramienta}: las de lectura empiezan con get_`);
  }
});

prueba("TODA herramienta de Meta prohibida es de escritura (crear, editar, prender, pausar, borrar, subir, enviar)", () => {
  for (const herramienta of META_ESCRITURA) {
    assert.ok(herramienta.startsWith(prefijo), herramienta);
    assert.ok(VERBOS_QUE_ESCRIBEN.test(nombreCorto(herramienta)), `${herramienta} no parece de escritura`);
    assert.ok(!META_LECTURA.includes(herramienta), `${herramienta} está en las dos listas`);
  }
});

prueba("la lista prohibida cubre cada verbo y cada objeto de Meta que se puede escribir", () => {
  const objetos = ["campaign", "adset", "ad"];
  for (const objeto of objetos) {
    for (const verbo of ["create", "update", "pause", "resume", "enable", "delete"]) {
      assert.ok(META_ESCRITURA.includes(`${prefijo}${verbo}_${objeto}`), `${verbo}_${objeto}`);
    }
  }
  for (const nombre of ["create_ad_creative", "update_ad_creative", "upload_ad_image", "create_custom_audience", "create_lookalike_audience", "create_catalog", "create_pixel", "send_conversion_event", "create_ab_test", "update_budget"]) {
    assert.ok(META_ESCRITURA.includes(`${prefijo}${nombre}`), nombre);
  }
});

prueba("settings.json (el candado de Claude Code) es exactamente la lista permitida y la prohibida", () => {
  const { allow, deny } = settings.permissions;
  assert.deepEqual(allow.filter((x) => x.startsWith(prefijo)).sort(), [...META_LECTURA].sort());
  assert.deepEqual(deny.filter((x) => x.startsWith(prefijo)).sort(), [...META_ESCRITURA].sort());
  assert.ok(!allow.some((x) => x === `mcp__${SERVIDOR_META}`), 'no se permite el servidor de Meta completo ("mcp__meta-ads")');
  for (const x of CRM_PERMITIDAS_MARKETING) assert.ok(allow.includes(x), x);
});

prueba("el agente no puede mandar WhatsApp ni editar el CRM, el bot o el V3", () => {
  const { allow, deny } = settings.permissions;
  assert.ok(deny.includes("mcp__aizencrm__mandar_whatsapp_al_equipo"));
  assert.ok(deny.includes("Bash") && deny.includes("Edit"));
  // De todo el CRM solo puede leer y guardar su resumen.
  const delCrm = allow.filter((x) => x.startsWith("mcp__aizencrm__")).map((x) => x.replace("mcp__aizencrm__", ""));
  const sinEscritura = /^(mandar|editar|cambiar|crear|borrar|deshacer|v3_|aprobar|corregir|guardar_(?!resumen_del_dia))/;
  for (const nombre of delCrm) assert.ok(!sinEscritura.test(nombre), `${nombre} escribe en el CRM`);
  assert.ok(delCrm.includes("guardar_resumen_del_dia"));
  for (const x of allow) assert.ok(!/whatsapp|v3_|editar_|flujo/i.test(x), x);
});

prueba("settings.json de marketing repite las listas del cerebro del lanzador", () => {
  const { allow, deny } = settings.permissions;
  for (const x of CEREBRO_DEL_AREA) assert.ok(allow.includes(x), `permitida: ${x}`);
  for (const x of PROHIBIDAS_DEL_CEREBRO_GENERAL) assert.ok(deny.includes(x) && !allow.includes(x), `prohibida: ${x}`);
});

prueba("el lanzador abre Claude Code con esa lista: permitidas solo de lectura y prohibidas las de escritura", () => {
  const args = argumentosDeClaude({ modelo: null }, "marketing");
  const desdePermitidas = args.indexOf("--allowedTools");
  const desdeProhibidas = args.indexOf("--disallowedTools");
  assert.ok(desdePermitidas > 0 && desdeProhibidas > desdePermitidas);
  const permitidas = args.slice(desdePermitidas + 1, desdeProhibidas);
  const prohibidas = args.slice(desdeProhibidas + 1);
  const deMeta = permitidas.filter((x) => x.startsWith(prefijo) || x === `mcp__${SERVIDOR_META}`);
  assert.deepEqual([...deMeta].sort(), [...META_LECTURA].sort());
  for (const herramienta of META_ESCRITURA) assert.ok(prohibidas.includes(herramienta), herramienta);
  assert.ok(!permitidas.some((x) => /whatsapp/i.test(x)));
  // Lo mismo debe valer para lo que dice settings.json.
  for (const x of settings.permissions.deny.filter((y) => y.startsWith(prefijo))) assert.ok(prohibidas.includes(x), x);
});

prueba("las instrucciones y los prompts del agente prohíben escribir en Meta y no mencionan herramientas de escritura", () => {
  const claude = fs.readFileSync(path.join(MARKETING, "CLAUDE.md"), "utf8");
  assert.match(claude, /SOLO LEES/);
  assert.match(claude, /Nunca pausas, prendes, editas presupuestos/);
  assert.match(claude, /reaprenda/);
  assert.match(claude, /NUNCA le escribes a un cliente/);
  assert.match(claude, /UNA recomendación/);
  assert.match(claude, /52637946571087/);
  assert.match(claude, /52618893438887/);
  assert.match(claude, /392437484223294/);
  for (const subagente of ["vigilante-de-pauta", "calidad-del-lead", "ideas-de-anuncio"]) {
    const texto = fs.readFileSync(path.join(MARKETING, "subagentes", subagente, "PROMPT.md"), "utf8");
    assert.match(texto, /^Frecuencia:\s*(diario|lunes)/im, subagente);
    for (const herramienta of META_ESCRITURA) assert.ok(!texto.includes(nombreCorto(herramienta)), `${subagente} menciona ${herramienta}`);
  }
  assert.match(fs.readFileSync(path.join(MARKETING, "subagentes", "ideas-de-anuncio", "PROMPT.md"), "utf8"), /^Frecuencia:\s*lunes/im);
  assert.match(fs.readFileSync(path.join(MARKETING, "subagentes", "ideas-de-anuncio", "PROMPT.md"), "utf8"), /máximo 3/);
});

prueba("el lanzador y el ejemplo de configuración no traen claves reales", () => {
  const ejemplo = fs.readFileSync(path.join(MARKETING, ".mcp.json.example"), "utf8");
  assert.ok(ejemplo.includes("PEGAR_AQUI") && ejemplo.includes(`"${SERVIDOR_META}"`));
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:\n- " + fallas.join("\n- "));
  process.exit(1);
}
