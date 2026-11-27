// Llega de magilus.com con una referencia (TPV001) y el agente le manda la foto del producto (idea de
// Ingrid, 26-nov-2026). Correr: npm run test:agente-v3-producto-del-mensaje
//
// Usa el ejecutor REAL con un catálogo y herramientas de mentira: no toca la base ni WhatsApp.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { FlowStep } from "@/lib/agent-product-flow";

import type { Accion } from "../domain/reglas";
import { pieDeFotoDelProducto, reconocerPorCodigo, type ProductoDelCatalogoV3 } from "../servicios/catalogo";
import { ejecutarAcciones, type Herramientas } from "./ejecutar";

const TARIMA: ProductoDelCatalogoV3 = {
  id: "p-tarima",
  nombre: "TARIMA PARA PEDICURE",
  codigo: "TPV001",
  categoria: "Pedicure",
  precio: 1_250_000,
  precioMayorista: 1_000_000,
  cantidadMinimaMayorista: 6,
  descripcion: "Tarima para pedicure con poceta.",
  foto: "https://magilus.com/fotos/tpv001.jpg",
  ficha: [
    { etiqueta: "Medidas", valor: "180 x 60 x 78 cm" },
    { etiqueta: "Precio especial", valor: "$1.100.000" },
    { etiqueta: "Material", valor: "Madera y cuero sintético" },
    { etiqueta: "Peso", valor: "35 kg" },
    { etiqueta: "Colores", valor: "Negro, blanco" },
  ],
};
const LAVACABEZAS: ProductoDelCatalogoV3 = {
  ...TARIMA,
  id: "p-lava",
  nombre: "LAVACABEZA FIBRA DE VIDRIO",
  codigo: "LCF16",
  foto: "https://magilus.com/fotos/lcf16.jpg",
  ficha: [],
};
const SIN_FOTO: ProductoDelCatalogoV3 = { ...TARIMA, id: "p-sinfoto", nombre: "SILLA MANICURE", codigo: "SMN02", foto: null };
const CATALOGO = [TARIMA, LAVACABEZAS, SIN_FOTO];

// La parte de la regla de magilus.com que importa: el texto, la foto, avisar y pausar.
const BIENVENIDA = "¡Hola! Una asesora te escribe en un momento. ¿En qué ciudad estás?";
const REGLA: Accion[] = [
  { tipo: "mensaje", texto: BIENVENIDA },
  { tipo: "mandar_producto_del_mensaje" },
  { tipo: "avisar_asesor", motivo: "Llegó de magilus.com" },
  { tipo: "pausar_ia" },
];

function herramientasDePrueba(opciones: { yaSalio?: string[]; fallaElEnvioDeFotos?: boolean } = {}) {
  const enviados: FlowStep[] = [];
  const avisos: string[] = [];
  let pausada = false;
  const herramientas: Herramientas = {
    enviarPaso: async (paso) => {
      if (paso.kind === "image" && opciones.fallaElEnvioDeFotos) throw new Error("WhatsApp no respondió");
      enviados.push(paso);
      return true;
    },
    avisarAsesor: async (motivo) => {
      avisos.push(motivo);
    },
    cambiarEtapa: async () => {},
    pausarIa: async () => {
      pausada = true;
    },
    responderConIa: async () => {},
    yaLoDijimos: async (texto) => (opciones.yaSalio ?? []).includes(texto),
  };
  return { herramientas, enviados, avisos, estaPausada: () => pausada };
}

async function correr(mensaje: string, opciones?: Parameters<typeof herramientasDePrueba>[0]) {
  const prueba = herramientasDePrueba(opciones);
  const notas = await ejecutarAcciones(REGLA, {
    workspaceId: "ws",
    mensaje,
    herramientas: prueba.herramientas,
    leerCatalogo: async () => CATALOGO,
  });
  const imagenes = prueba.enviados.filter((paso): paso is Extract<FlowStep, { kind: "image" }> => paso.kind === "image");
  return { ...prueba, notas, imagenes };
}

test("1. Con TPV001 manda la foto con el pie correcto y sin precio", async () => {
  // El texto real que manda la página.
  const { imagenes, enviados, notas } = await correr("Hola, vengo de magilus.com 👋\nMe interesa la *Tarima Para Pedicure* (TPV001)");
  assert.equal(imagenes.length, 1);
  assert.equal(imagenes[0].url, TARIMA.foto);
  assert.equal(
    imagenes[0].caption,
    "*Tarima para pedicure* (TPV001)\n• Medidas: 180 x 60 x 78 cm\n• Material: Madera y cuero sintético\n• Peso: 35 kg",
  );
  // Nada de precio: ni el del catálogo ni un dato de la ficha que hable de plata.
  assert.doesNotMatch(imagenes[0].caption ?? "", /\$|precio|1\.250\.000|1\.100\.000/i);
  assert.ok((imagenes[0].caption ?? "").startsWith("*Tarima para pedicure* (TPV001)"));
  assert.equal(pieDeFotoDelProducto(TARIMA), imagenes[0].caption);
  // La foto sale después del texto de bienvenida.
  assert.equal(enviados[0].kind, "text");
  assert.equal(enviados[1].kind, "image");
  assert.match(notas.join(" "), /Tarima para pedicure \(TPV001\)/);
});

test("2. Sin código no manda imagen (tampoco adivina por el nombre)", async () => {
  const { imagenes, avisos, estaPausada } = await correr("Hola, vengo de magilus.com, me interesa la tarima para pedicure");
  assert.equal(imagenes.length, 0);
  assert.equal(avisos.length, 1);
  assert.equal(estaPausada(), true);
  // Un código pegado a otra palabra tampoco vale.
  assert.equal(reconocerPorCodigo("quiero la XTPV001X", CATALOGO), null);
  // Con guion o en minúsculas sí es el mismo código.
  assert.equal(reconocerPorCodigo("me interesa la tpv-001", CATALOGO)?.id, TARIMA.id);
});

test("3. Con dos códigos no manda imagen", async () => {
  const { imagenes, avisos, estaPausada } = await correr("vengo de magilus.com, me interesan TPV001 y LCF16");
  assert.equal(imagenes.length, 0);
  assert.equal(avisos.length, 1);
  assert.equal(estaPausada(), true);
  // Dos productos con el mismo código: tampoco se adivina.
  assert.equal(reconocerPorCodigo("TPV001", [TARIMA, { ...TARIMA, id: "otro" }]), null);
});

test("4. Si el producto no tiene foto, no manda imagen", async () => {
  const { imagenes, enviados, avisos } = await correr("vengo de magilus.com, me interesa SMN02");
  assert.equal(imagenes.length, 0);
  assert.equal(enviados.length, 1);
  assert.equal(avisos.length, 1);
});

test("5. Si el pie ya salió en el chat, no lo repite", async () => {
  const { imagenes, avisos, estaPausada, notas } = await correr("vengo de magilus.com TPV001", {
    yaSalio: [pieDeFotoDelProducto(TARIMA)],
  });
  assert.equal(imagenes.length, 0);
  assert.equal(avisos.length, 1);
  assert.equal(estaPausada(), true);
  assert.match(notas.join(" "), /no se repitió/);
});

test("6. Si falla el envío de la foto, igual avisa a la asesora y pausa la IA", async () => {
  const { imagenes, enviados, avisos, estaPausada } = await correr("vengo de magilus.com TPV001", {
    fallaElEnvioDeFotos: true,
  });
  assert.equal(imagenes.length, 0);
  assert.equal(enviados.length, 1);
  assert.deepEqual(avisos, ["Llegó de magilus.com"]);
  assert.equal(estaPausada(), true);
});
