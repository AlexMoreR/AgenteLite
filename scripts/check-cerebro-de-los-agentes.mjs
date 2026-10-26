// Pruebas del cerebro para los agentes de área (Ventas, Marketing y Sistemas): cada uno lee SOLO su parte, anota SOLO en
// su carpeta "Aprendizajes de <área>" (agregando al final, con fecha), y marca los datos que chocan como alertas de
// Observación sin cambiar ningún dato. Usa un Drive y una base de mentira: no necesita red ni base.
// Correr: npm run test:cerebro-de-los-agentes
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws1";
const USUARIO = { workspaceId: WS, userId: "alex" };

/* ── Una base y un Drive de mentira ── */

const MD = "text/markdown";
const GOOGLE_DOC = "application/vnd.google-apps.document";
const CARPETA = "application/vnd.google-apps.folder";

const estado = { conectado: true, supervisor: true, filas: new Map(), archivosDrive: new Map(), cambios: [], alertas: new Map(), siguiente: 1, llamadasDeDrive: [] };

const coincide = (fila, cond) => {
  for (const [campo, valor] of Object.entries(cond)) {
    if (campo === "workspaceId") continue;
    if (campo === "OR") {
      if (!valor.some((o) => coincide(fila, o))) return false;
    } else if (campo === "nombre" && valor && typeof valor === "object") {
      if (String(fila.nombre).toLowerCase() !== String(valor.equals).toLowerCase()) return false;
    } else if (valor && typeof valor === "object" && "contains" in valor) {
      if (!String(fila[campo] ?? "").toLowerCase().includes(String(valor.contains).toLowerCase())) return false;
    } else if (fila[campo] !== valor) return false;
  }
  return true;
};

const prisma = {
  cerebroConexion: { findUnique: async () => (estado.conectado ? { carpetaId: "raiz", carpetaNombre: "Magilus", tokenCifrado: "x" } : null) },
  cerebroDocumento: {
    findMany: async ({ where }) => [...estado.filas.values()].filter((f) => coincide(f, where)),
    findUnique: async ({ where }) => estado.filas.get(where.workspaceId_driveId.driveId) ?? null,
    findFirst: async ({ where }) => [...estado.filas.values()].find((f) => coincide(f, where)) ?? null,
    upsert: async ({ where, create, update }) => {
      const id = where.workspaceId_driveId.driveId;
      const previa = estado.filas.get(id);
      estado.filas.set(id, previa ? { ...previa, ...update } : { id: `f${estado.siguiente++}`, ...create });
    },
    update: async ({ where, data }) => {
      const fila = [...estado.filas.values()].find((f) => f.id === where.id);
      Object.assign(fila, data);
    },
  },
  cerebroCambio: { create: async ({ data }) => void estado.cambios.push(data) },
  supervisorAlerta: {
    findUnique: async ({ where }) => estado.alertas.get(where.claveAbierta) ?? null,
    create: async ({ data }) => {
      if (estado.alertas.has(data.claveAbierta)) throw new Error("unique");
      const fila = { id: `a${estado.siguiente++}`, ...data };
      estado.alertas.set(data.claveAbierta, fila);
      return { id: fila.id, vecesVista: fila.vecesVista };
    },
    update: async ({ where, data }) => {
      const fila = [...estado.alertas.values()].find((a) => a.id === where.id);
      Object.assign(fila, data);
    },
  },
};

const drive = {
  async metadatos(id) {
    const a = estado.archivosDrive.get(id);
    estado.llamadasDeDrive.push(["metadatos", id]);
    return { driveId: id, nombre: a.nombre, tipo: a.tipo, versionDrive: String(a.version), padreId: a.padre, modificadoEnDrive: "2026-10-26T10:00:00.000Z", linkDrive: `https://drive/${id}` };
  },
  async leerTexto(id) {
    estado.llamadasDeDrive.push(["leerTexto", id]);
    return estado.archivosDrive.get(id).texto;
  },
  async crearTexto(carpetaId, nombre, contenido) {
    estado.llamadasDeDrive.push(["crearTexto", carpetaId, nombre]);
    const id = `n${estado.siguiente++}`;
    estado.archivosDrive.set(id, { nombre, tipo: MD, texto: contenido, version: 1, padre: carpetaId });
    return { driveId: id, nombre, tipo: MD, versionDrive: "1", padreId: carpetaId, modificadoEnDrive: "2026-10-26T10:00:00.000Z", linkDrive: `https://drive/${id}` };
  },
  async reemplazarTexto(id, contenido, tipo) {
    estado.llamadasDeDrive.push(["reemplazarTexto", id]);
    if (tipo === GOOGLE_DOC || tipo === CARPETA) throw new Error("Solo se escriben textos .md o .txt");
    const a = estado.archivosDrive.get(id);
    a.texto = contenido;
    a.version += 1;
    return { driveId: id, nombre: a.nombre, tipo: a.tipo, versionDrive: String(a.version), padreId: a.padre, modificadoEnDrive: "2026-10-26T11:00:00.000Z", linkDrive: `https://drive/${id}` };
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "./conexion": {},
  "@/features/cerebro/services/conexion": {
    driveDelNegocio: async () => {
      if (!estado.conectado) throw new Error("El cerebro no está conectado a Google Drive.");
      return { drive, conexion: { carpetaId: "raiz" } };
    },
  },
  "@/features/agentes-de-area/servicios/config": {},
  "@/features/agentes-de-area/servicios/envios": {},
  "@/features/agentes-de-area/servicios/numeros-de-marketing": {},
  "@/features/agentes-de-area/servicios/numeros": {},
  "@/features/agentes-de-area/servicios/resumenes": {},
  "@/features/agentes-de-area/servicios/revision-de-sistemas": {},
  "@/lib/mcp/supervisor": { puedeVerElSupervisor: async () => estado.supervisor },
};

const nada = {};
const reglasCerebro = cargar("src/features/cerebro/services/reglas.ts");
const escribir = cargar("src/features/cerebro/services/escribir.ts", {
  "@/lib/prisma": nada,
  "@/features/tableros-inteligentes/services/tableros": nada,
  "./conexion": nada,
  "./permisos": nada,
});
const consultas = cargar("src/features/cerebro/services/consultas.ts", { "@/lib/prisma": { prisma }, "./conexion": mocks["@/features/cerebro/services/conexion"] });
mocks["@/features/cerebro/services/consultas"] = consultas;
mocks["@/features/cerebro/services/escribir"] = escribir;
const dominio = cargar("src/features/agentes-de-area/dominio/cerebro-del-area.ts");
const reglas = cargar("src/features/agentes-de-area/dominio/reglas.ts");
const servicio = cargar("src/features/agentes-de-area/servicios/cerebro-del-area.ts", mocks);
const mcp = cargar("src/lib/mcp/agentes-de-area.ts", mocks);

let pruebas = 0;
const fallas = [];
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}

const llamar = (herramienta, args, contexto = USUARIO) => mcp.ejecutarHerramientaMcpAgentesDeArea(herramienta, args, contexto);

/* El mes de hoy: así el archivo "del mes" que ya existe en Marketing es el de hoy. */
const HOY = reglas.hoyEnBogota();
const ARCHIVO_DEL_MES = `aprendizajes-${HOY.slice(0, 7)}.md`;

function agregar(id, ruta, { tipo = MD, texto = "", padre = "raiz" } = {}) {
  const nombre = ruta.split("/").at(-1);
  const esCarpeta = tipo === CARPETA;
  estado.filas.set(id, {
    id: `f${estado.siguiente++}`,
    workspaceId: WS,
    driveId: id,
    padreId: padre,
    nombre,
    ruta,
    tipo,
    esCarpeta,
    texto: esCarpeta ? null : texto,
    textoTruncado: false,
    versionDrive: "1",
    modificadoEnDrive: new Date("2026-10-20T10:00:00Z"),
    linkDrive: `https://drive/${id}`,
    enDrive: true,
  });
  estado.archivosDrive.set(id, { nombre, tipo, texto, version: 1, padre });
}

function sembrar() {
  estado.conectado = true;
  estado.supervisor = true;
  estado.filas.clear();
  estado.archivosDrive.clear();
  estado.cambios.length = 0;
  estado.alertas.clear();
  estado.llamadasDeDrive.length = 0;
  for (const c of ["Ventas", "Precios", "Equipo", "Marketing", "Tecnología", "Finanzas", "Decisiones de Magilus", "Aprendizajes de Ventas", "Aprendizajes de Marketing"]) {
    agregar(`c-${c}`, c, { tipo: CARPETA });
  }
  agregar("d-guion", "Ventas/Guion de cierre.md", { padre: "c-Ventas", texto: "El cierre se hace en 2 mensajes." });
  agregar("d-precios", "Precios/Lista de precios.md", { padre: "c-Precios", texto: "Camilla Magilus: $1.200.000" });
  agregar("d-equipo", "Equipo/Asesoras.md", { padre: "c-Equipo", texto: "María Camila atiende ventas." });
  agregar("d-marketing", "Marketing/Campañas.md", { padre: "c-Marketing", texto: "No se pausa para reaprender." });
  agregar("d-stack", "Tecnología/Stack.md", { padre: "c-Tecnología", texto: "Next.js y Postgres." });
  agregar("d-finanzas", "Finanzas/Secreto.md", { padre: "c-Finanzas", texto: "NOMINA SECRETA" });
  agregar("d-decisiones", "Decisiones de Magilus/Decisiones.md", { padre: "c-Decisiones de Magilus", texto: "Decidido: no se regalan envíos." });
  agregar("d-apr-marketing", `Aprendizajes de Marketing/${ARCHIVO_DEL_MES}`, { padre: "c-Aprendizajes de Marketing", texto: "# Aprendizajes de Marketing\n\n## 2026-10-01 — Agente de Marketing\n\nPrimer aprendizaje." });
}

const rutasDe = (respuesta) => [...(respuesta.documentos ?? []), ...(respuesta.decisiones ?? [])].map((d) => d.ruta).sort();
const soloDrive = (accion) => estado.llamadasDeDrive.filter(([que]) => que === accion);

/* ── Qué carpetas lee cada área ── */

await prueba("las reglas: cada área lee solo lo suyo, las decisiones y su carpeta de aprendizajes", () => {
  assert.deepEqual(dominio.carpetasDeLectura("ventas"), ["Ventas", "Precios", "Equipo", "Decisiones de Magilus", "Aprendizajes de Ventas"]);
  assert.deepEqual(dominio.carpetasDeLectura("marketing"), ["Marketing", "Precios", "Decisiones de Magilus", "Aprendizajes de Marketing"]);
  assert.deepEqual(dominio.carpetasDeLectura("sistemas"), ["Tecnología", "Decisiones de Magilus", "Aprendizajes de Sistemas"]);
  assert.equal(dominio.puedeLeerElArea("ventas", "Precios/Lista.md"), true);
  assert.equal(dominio.puedeLeerElArea("ventas", "Marketing/Campañas.md"), false);
  assert.equal(dominio.puedeLeerElArea("sistemas", "tecnologia/Stack.md"), true, "sin tildes ni mayúsculas es la misma carpeta");
  assert.equal(dominio.puedeLeerElArea("sistemas", "Aprendizajes de Ventas/x.md"), false, "ni los aprendizajes de otra área");
  assert.equal(dominio.puedeLeerElArea("ventas", "Decisiones de Magilus.md"), true, "las decisiones también valen como documento suelto");
  assert.equal(dominio.puedeLeerElArea("ventas", "Precios y más/x.md"), false, "una carpeta que solo empieza igual no cuenta");
});

await prueba("Ventas solo ve Ventas, Precios, Equipo, Decisiones y su carpeta; no ve Marketing, Tecnología ni Finanzas", async () => {
  sembrar();
  const r = await llamar("cerebro_del_area", { area: "ventas" });
  assert.equal(r.conectado, true);
  assert.deepEqual(rutasDe(r), ["Decisiones de Magilus/Decisiones.md", "Equipo/Asesoras.md", "Precios/Lista de precios.md", "Ventas/Guion de cierre.md"].sort());
  assert.match(JSON.stringify(r.decisiones), /no se regalan envíos/, "las decisiones vienen siempre");
  assert.ok(!JSON.stringify(r).includes("NOMINA SECRETA") && !JSON.stringify(r).includes("Stack"));
});

await prueba("Marketing solo ve lo suyo (y su archivo de aprendizajes); Sistemas solo Tecnología", async () => {
  sembrar();
  const m = await llamar("cerebro_del_area", { area: "marketing" });
  assert.deepEqual(rutasDe(m), ["Aprendizajes de Marketing/" + ARCHIVO_DEL_MES, "Decisiones de Magilus/Decisiones.md", "Marketing/Campañas.md", "Precios/Lista de precios.md"].sort());
  const s = await llamar("cerebro_del_area", { area: "sistemas" });
  assert.deepEqual(rutasDe(s), ["Decisiones de Magilus/Decisiones.md", "Tecnología/Stack.md"].sort());
});

await prueba("un documento de otra carpeta se rechaza (por id) y la búsqueda no lo devuelve", async () => {
  sembrar();
  await assert.rejects(() => llamar("cerebro_del_area", { area: "ventas", documento_id: "d-marketing" }), /no es de las carpetas/);
  await assert.rejects(() => llamar("cerebro_del_area", { area: "ventas", documento_id: "d-finanzas" }), /no es de las carpetas/);
  await assert.rejects(() => llamar("cerebro_del_area", { area: "sistemas", documento_id: "d-precios" }), /no es de las carpetas/);
  const ok = await llamar("cerebro_del_area", { area: "ventas", documento_id: "d-precios" });
  assert.equal(ok.documento.ruta, "Precios/Lista de precios.md");
  assert.match(ok.documento.texto, /1\.200\.000/);
  const busca = await llamar("cerebro_del_area", { area: "ventas", busqueda: "pausa reaprender secreta camilla" });
  assert.deepEqual(busca.resultados.map((x) => x.ruta), ["Precios/Lista de precios.md"], "Marketing y Finanzas no salen aunque coincidan");
  const nada2 = await llamar("cerebro_del_area", { area: "sistemas", busqueda: "camilla" });
  assert.equal(nada2.resultados.length, 0);
  assert.match(nada2.aviso, /no inventes/i);
});

await prueba("la lectura nunca escribe en el Drive y recorta los documentos largos", async () => {
  sembrar();
  agregar("d-largo", "Ventas/Largo.md", { padre: "c-Ventas", texto: "x".repeat(50_000) });
  const r = await llamar("cerebro_del_area", { area: "ventas", documento_id: "d-largo" });
  assert.equal(r.documento.texto.length, dominio.MAXIMO_TEXTO_POR_DOCUMENTO_LEIDO);
  assert.equal(r.documento.texto_recortado, true);
  assert.equal(estado.llamadasDeDrive.filter(([que]) => que === "crearTexto" || que === "reemplazarTexto").length, 0);
  assert.equal(estado.cambios.length, 0);
});

await prueba("con el cerebro desconectado, las tres herramientas lo dicen y no escriben nada", async () => {
  sembrar();
  estado.conectado = false;
  const lee = await llamar("cerebro_del_area", { area: "ventas" });
  assert.equal(lee.conectado, false);
  assert.match(lee.aviso, /no está conectado/);
  const anota = await llamar("cerebro_anotar_aprendizaje", { area: "ventas", texto: "Algo que aprendí hoy en ventas." });
  assert.equal(anota.anotado, false);
  assert.equal(anota.conectado, false);
  assert.equal(estado.cambios.length, 0);
  // Marcar un dato viejo no necesita el Drive: es una alerta del Supervisor.
  const marca = await llamar("cerebro_marcar_dato_viejo", { area: "ventas", documento: "Precios/Lista de precios.md", lo_que_dice_el_cerebro: "$1.200.000", lo_que_dice_el_sistema: "$1.350.000", fuente: "crm" });
  assert.equal(marca.marcada, true);
});

/* ── Anotar un aprendizaje ── */

await prueba("anotar crea el archivo del mes en su carpeta, con fecha y nombre del agente, y queda en el registro", async () => {
  sembrar();
  const r = await llamar("cerebro_anotar_aprendizaje", { area: "ventas", texto: "Las que preguntan por envío compran más si se les responde en 5 minutos." });
  assert.equal(r.anotado, true);
  assert.equal(r.accion, "crear");
  assert.equal(r.ruta, `Aprendizajes de Ventas/${ARCHIVO_DEL_MES}`);
  const texto = [...estado.archivosDrive.values()].find((a) => a.nombre === ARCHIVO_DEL_MES && a.padre === "c-Aprendizajes de Ventas").texto;
  assert.match(texto, new RegExp(`## ${HOY} — Agente de Ventas`));
  assert.match(texto, /5 minutos/);
  assert.equal(estado.cambios.length, 1);
  assert.equal(estado.cambios[0].origen, "AGENTE_VENTAS");
  assert.equal(estado.cambios[0].quienNombre, "Agente de Ventas");
  assert.equal(estado.cambios[0].accion, "crear");
});

await prueba("anotar solo AGREGA al final: lo anterior queda intacto, con fecha, y el origen es el del agente", async () => {
  sembrar();
  const antes = estado.archivosDrive.get("d-apr-marketing").texto;
  const r = await llamar("cerebro_anotar_aprendizaje", { area: "marketing", texto: "El anuncio de video trae más chats Calientes que el de foto." });
  assert.equal(r.accion, "agregar");
  const despues = estado.archivosDrive.get("d-apr-marketing").texto;
  assert.ok(despues.startsWith(antes.trimEnd()), "lo que ya estaba sigue igual al principio");
  assert.match(despues.slice(antes.length), new RegExp(`## ${HOY} — Agente de Marketing[\\s\\S]*video`));
  assert.equal(soloDrive("crearTexto").length, 0, "no crea otro archivo");
  assert.equal(estado.cambios.at(-1).origen, "AGENTE_MARKETING");
  assert.equal(estado.cambios.at(-1).accion, "agregar");
  assert.equal(estado.cambios.at(-1).antes, antes, "el registro guarda el antes");
  // Una segunda anotación se suma a la primera.
  await llamar("cerebro_anotar_aprendizaje", { area: "marketing", texto: "Segunda anotación del mismo día, otro hallazgo." });
  const final = estado.archivosDrive.get("d-apr-marketing").texto;
  assert.ok(final.includes("Primer aprendizaje.") && final.includes("video") && final.includes("Segunda anotación"));
});

await prueba("anotar solo escribe en su carpeta: nunca en Decisiones de Magilus ni en otra carpeta", async () => {
  sembrar();
  assert.equal(dominio.puedeAnotarEn("ventas", `Aprendizajes de Ventas/${ARCHIVO_DEL_MES}`), true);
  for (const ruta of ["Decisiones de Magilus/Decisiones.md", "Precios/Lista de precios.md", `Aprendizajes de Marketing/${ARCHIVO_DEL_MES}`, "Aprendizajes de Ventas/otro.md", `Aprendizajes de Ventas/sub/${ARCHIVO_DEL_MES}`]) {
    assert.equal(dominio.puedeAnotarEn("ventas", ruta), false, ruta);
  }
  await llamar("cerebro_anotar_aprendizaje", { area: "ventas", texto: "Un aprendizaje cualquiera de ventas." });
  const escritos = estado.llamadasDeDrive.filter(([que]) => que === "crearTexto" || que === "reemplazarTexto");
  assert.deepEqual(escritos.map((e) => e[1]), ["c-Aprendizajes de Ventas"], "lo único escrito fue dentro de su carpeta de aprendizajes");
  assert.equal(estado.archivosDrive.get("d-decisiones").texto, "Decidido: no se regalan envíos.");
  // El agente no puede pedir otra ruta: la herramienta no recibe ni carpeta ni documento.
  const herramienta = mcp.HERRAMIENTAS_MCP_AGENTES_DE_AREA.find((h) => h.name === "cerebro_anotar_aprendizaje");
  assert.deepEqual(Object.keys(herramienta.inputSchema.properties).sort(), ["area", "texto"]);
});

await prueba("anotar se rechaza si el archivo del mes es un Google Doc", async () => {
  sembrar();
  estado.filas.get("d-apr-marketing").tipo = GOOGLE_DOC;
  estado.filas.get("d-apr-marketing").nombre = ARCHIVO_DEL_MES;
  estado.archivosDrive.get("d-apr-marketing").tipo = GOOGLE_DOC;
  const r = await llamar("cerebro_anotar_aprendizaje", { area: "marketing", texto: "Esto no debe escribirse en un Google Doc." });
  assert.equal(r.anotado, false);
  assert.match(r.aviso, /Google Doc/);
  assert.equal(estado.cambios.length, 0);
  assert.equal(soloDrive("reemplazarTexto").length, 0);
});

await prueba("si falta la carpeta de aprendizajes, avisa y NO crea nada", async () => {
  sembrar();
  const r = await llamar("cerebro_anotar_aprendizaje", { area: "sistemas", texto: "El deploy tardó más de lo normal hoy." });
  assert.equal(r.anotado, false);
  assert.equal(r.conectado, true);
  assert.match(r.aviso, /No existe la carpeta "Aprendizajes de Sistemas"/);
  assert.match(r.aviso, /No se creó nada/);
  assert.equal(estado.llamadasDeDrive.filter(([que]) => que === "crearTexto" || que === "reemplazarTexto").length, 0);
  assert.equal(estado.cambios.length, 0);
  assert.ok(![...estado.filas.values()].some((f) => f.nombre === "Aprendizajes de Sistemas"));
});

await prueba("anotar rechaza textos vacíos, enormes, áreas inventadas y archivos que ya llegaron al tope", async () => {
  sembrar();
  await assert.rejects(() => llamar("cerebro_anotar_aprendizaje", { area: "ventas", texto: "  " }), /Falta el texto/);
  await assert.rejects(() => llamar("cerebro_anotar_aprendizaje", { area: "ventas", texto: "a".repeat(dominio.MAXIMO_APRENDIZAJE + 1) }), /muy largo/);
  await assert.rejects(() => llamar("cerebro_anotar_aprendizaje", { area: "finanzas", texto: "Un texto largo suficiente." }), /El área tiene que ser/);
  estado.archivosDrive.get("d-apr-marketing").texto = "z".repeat(dominio.MAXIMO_ARCHIVO_DE_APRENDIZAJES);
  const lleno = await llamar("cerebro_anotar_aprendizaje", { area: "marketing", texto: "Ya no cabe nada más en este archivo." });
  assert.equal(lleno.anotado, false);
  assert.match(lleno.aviso, /tope de tamaño/);
  assert.equal(estado.cambios.length, 0);
});

await prueba("el bloque con fecha no deja encabezados del agente que rompan el archivo", () => {
  const bloque = dominio.bloqueDeAprendizaje({ fecha: "2026-10-26", area: "sistemas", texto: "# Título falso\nlínea 2" });
  assert.equal(bloque, "## 2026-10-26 — Agente de Sistemas\n\nTítulo falso\nlínea 2");
});

/* ── Marcar un posible dato viejo ── */

const PEDIDO_VIEJO = { area: "ventas", documento: "Precios/Lista de precios.md", dato: "precio de la camilla", lo_que_dice_el_cerebro: "$1.200.000", lo_que_dice_el_sistema: "$1.350.000", fuente: "gestion" };

await prueba("marcar un dato viejo crea UNA alerta de Observación, familia CEREBRO, y no cambia ningún dato", async () => {
  sembrar();
  const textosAntes = JSON.stringify([...estado.archivosDrive.values()].map((a) => a.texto));
  const r = await llamar("cerebro_marcar_dato_viejo", PEDIDO_VIEJO);
  assert.equal(r.marcada, true);
  assert.equal(r.nueva, true);
  assert.equal(estado.alertas.size, 1);
  const alerta = [...estado.alertas.values()][0];
  assert.equal(alerta.familia, "CEREBRO");
  assert.equal(alerta.severidad, "OBSERVACION");
  assert.equal(alerta.estado, "ABIERTA");
  assert.equal(alerta.titulo, "Posible dato viejo: precio de la camilla");
  assert.match(alerta.texto, /Precios\/Lista de precios\.md/);
  assert.match(alerta.texto, /\$1\.200\.000/);
  assert.match(alerta.texto, /Gestión: \$1\.350\.000/);
  assert.match(r.nota, /No se cambió ningún dato/);
  assert.equal(JSON.stringify([...estado.archivosDrive.values()].map((a) => a.texto)), textosAntes, "el cerebro queda igual");
  assert.equal(estado.cambios.length, 0, "ni siquiera se escribe en el registro del cerebro");
  assert.equal(estado.llamadasDeDrive.filter(([que]) => que === "crearTexto" || que === "reemplazarTexto").length, 0);
});

await prueba("marcar el mismo dato dos veces deja una sola alerta abierta y suma 'vista N veces'; otro dato es otra alerta", async () => {
  sembrar();
  await llamar("cerebro_marcar_dato_viejo", PEDIDO_VIEJO);
  const segunda = await llamar("cerebro_marcar_dato_viejo", { ...PEDIDO_VIEJO, area: "marketing", lo_que_dice_el_sistema: "$1.400.000" });
  assert.equal(segunda.nueva, false);
  assert.equal(segunda.vecesVista, 2);
  assert.equal(estado.alertas.size, 1, "una sola abierta por documento y dato, la marque quien la marque");
  const alerta = [...estado.alertas.values()][0];
  assert.equal(alerta.vecesVista, 2);
  assert.match(alerta.texto, /visto 2 vez/);
  assert.equal(alerta.severidad, "OBSERVACION");
  await llamar("cerebro_marcar_dato_viejo", { ...PEDIDO_VIEJO, dato: "precio del soporte" });
  assert.equal(estado.alertas.size, 2);
});

await prueba("marcar rechaza documentos de otra área, fuentes raras y datos incompletos", async () => {
  sembrar();
  await assert.rejects(() => llamar("cerebro_marcar_dato_viejo", { ...PEDIDO_VIEJO, documento: "Finanzas/Secreto.md" }), /no es de las carpetas/);
  await assert.rejects(() => llamar("cerebro_marcar_dato_viejo", { ...PEDIDO_VIEJO, fuente: "excel" }), /"crm" o "gestion"/);
  await assert.rejects(() => llamar("cerebro_marcar_dato_viejo", { ...PEDIDO_VIEJO, lo_que_dice_el_sistema: "" }), /Falta lo que dice/);
  assert.equal(estado.alertas.size, 0);
});

await prueba("el Supervisor deja quietas las alertas de familia CEREBRO (filtro en vueltas.ts)", () => {
  const texto = fs.readFileSync(path.join(RAIZ, "src/features/supervisor/servicios/vueltas.ts"), "utf8");
  assert.match(texto, /inc\.familia !== "CEREBRO"/);
  const usos = texto.match(/leerIncidentesAbiertos\(workspaceId\)\)[^\n]*/g) ?? [];
  assert.equal(usos.length, 3);
  assert.ok(usos.filter((u) => /noEsDelCerebro|ATENCION/.test(u)).length === 3, "cada lectura de abiertas filtra");
  // La de atención solo toma ATENCION; las otras dos excluyen CEREBRO.
  assert.ok(/\.filter\(noEsDelCerebro\)/.test(texto) && /inc\.familia !== "ATENCION" && noEsDelCerebro\(inc\)/.test(texto));
});

/* ── Permiso ── */

await prueba("sin permiso de supervisor las tres herramientas se rechazan", async () => {
  sembrar();
  estado.supervisor = false;
  await assert.rejects(() => llamar("cerebro_del_area", { area: "ventas" }), /no tiene permiso/);
  await assert.rejects(() => llamar("cerebro_anotar_aprendizaje", { area: "ventas", texto: "Un aprendizaje cualquiera." }), /no tiene permiso/);
  await assert.rejects(() => llamar("cerebro_marcar_dato_viejo", PEDIDO_VIEJO), /no tiene permiso/);
  assert.equal(estado.cambios.length, 0);
  assert.equal(estado.alertas.size, 0);
});

/* ── Que no se toque lo de las otras tarjetas ── */

await prueba("las herramientas nuevas están en la lista de los agentes de área y no en el cerebro general", () => {
  const nombres = mcp.HERRAMIENTAS_MCP_AGENTES_DE_AREA.map((h) => h.name);
  for (const n of ["cerebro_del_area", "cerebro_anotar_aprendizaje", "cerebro_marcar_dato_viejo"]) {
    assert.ok(nombres.includes(n), n);
    assert.equal(mcp.esHerramientaDeAgentesDeArea(n), true);
  }
  const general = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/cerebro.ts"), "utf8");
  assert.ok(!general.includes("cerebro_del_area") && !general.includes("cerebro_anotar_aprendizaje"));
});

await prueba("el servicio no tiene ninguna función que borre y el dominio no escribe en Decisiones", () => {
  const texto = fs.readFileSync(path.join(RAIZ, "src/features/agentes-de-area/servicios/cerebro-del-area.ts"), "utf8");
  assert.ok(!/\.delete\(|deleteMany|papelera|trashed.{0,5}true|reemplazarTexto/.test(texto), "ni borrar ni reemplazar");
  assert.ok(!/modo:\s*"reemplazar"/.test(texto));
  assert.equal(dominio.puedeAnotarEn("ventas", "Decisiones de Magilus/aprendizajes-2026-10.md"), false);
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:\n- " + fallas.join("\n- "));
  process.exit(1);
}
