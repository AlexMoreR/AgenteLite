/**
 * ESCENARIOS DORADOS del Combo de Camilla para el Change Guardian.
 *
 * Salen de lo que escriben los clientes de verdad (Ventas 1, sep–oct 2026) y de las auditorías
 * del 9-oct-2026 (Ventas/2026-10-09-auditoria-embudo-combo-camilla). Cada uno dice lo que se
 * espera y lo que está prohibido según la política vigente:
 *
 * - Al texto del anuncio NO se le sueltan precio ni fotos: primero se pregunta qué servicios va a
 *   ofrecer (así fue hasta el 6-oct y así quedó desde la v191).
 * - Nunca "envío gratis" a secas (solo con el 50/50, y lo confirma la asesora).
 * - La contraentrega está suspendida: nunca prometerla.
 * - Intención fuerte (separar, consignar, dos combos, envío a su ciudad) → avisar a una asesora.
 *
 * Los ids de producto y de flujo son de cada negocio: se pasan al armar los escenarios.
 */

import type { Escenario } from "./guardian";
import { TEXTO_DEL_ANUNCIO_COMBO } from "./lead";

const SIN_ENVIO_GRATIS = "env[ií]o gratis";
const SIN_CONTRAENTREGA_SI = "(^|[^o] )(s[ií],? )?(manejamos|hacemos|tenemos|aceptamos) (pago )?contra ?entrega";

export function escenariosDelCombo(input: { productoComboId: string; flujoFotosCombo?: string | null }): Escenario[] {
  const combo = input.productoComboId;
  const enPaso = (paso: "PRESENTACION" | "PRODUCTO" | "OBJECIONES" | "CIERRE", flujos: string[] = []) => ({
    productoActivo: combo,
    pasoActual: paso,
    esPrimerMensaje: false,
    flujosEnviados: flujos,
  });
  const yaVioFotos = input.flujoFotosCombo ? [input.flujoFotosCombo] : [];

  return [
    {
      id: "anuncio-exacto",
      nombre: "Texto exacto del anuncio del combo",
      critico: true,
      mensaje: TEXTO_DEL_ANUNCIO_COMBO,
      espera: { activaProducto: true, pasoDespues: "PRESENTACION", preguntaQueCumpla: "servicio" },
      prohibido: { flujoEnRespuesta: true, fotos: true, precio: true, textos: [SIN_ENVIO_GRATIS], maxMensajes: 3 },
      origen: "Incidente 7-oct-2026 (v179–v181): ganó 'Nombra las piezas' por la palabra 'escalera'.",
    },
    {
      id: "anuncio-asteriscos",
      nombre: "Anuncio con el formato de WhatsApp (*COMBO*)",
      critico: true,
      mensaje: "Hola, me interesa el *COMBO* de estética (camilla, escalera, silla y auxiliar)",
      espera: { activaProducto: true, pasoDespues: "PRESENTACION" },
      prohibido: { flujoEnRespuesta: true, fotos: true, precio: true, maxMensajes: 3 },
    },
    {
      id: "anuncio-sin-tildes",
      nombre: "Anuncio sin tildes y en minúsculas",
      critico: true,
      mensaje: "hola me interesa el combo de estetica (camilla, escalera, silla y auxiliar)",
      espera: { activaProducto: true, pasoDespues: "PRESENTACION" },
      prohibido: { flujoEnRespuesta: true, fotos: true, precio: true, maxMensajes: 3 },
    },
    {
      id: "saludo",
      nombre: "Solo saluda: \"Hola\"",
      critico: true,
      mensaje: "Hola",
      prohibido: { flujoEnRespuesta: true, fotos: true, precio: true, maxMensajes: 3 },
    },
    {
      id: "cuanto-cuesta-primero",
      nombre: "Primer mensaje: \"¿Cuánto cuesta?\"",
      critico: false,
      mensaje: "¿Cuánto cuesta?",
      espera: { activaProducto: true },
      prohibido: { flujoEnRespuesta: true, fotos: true, textos: [SIN_ENVIO_GRATIS, SIN_CONTRAENTREGA_SI], maxMensajes: 4 },
    },
    {
      id: "cuanto-cuesta-en-charla",
      nombre: "En la charla: \"¿Cuánto cuesta?\"",
      critico: true,
      mensaje: "cuanto cuesta?",
      estado: enPaso("PRODUCTO"),
      prohibido: { fotos: true, textos: [SIN_ENVIO_GRATIS, SIN_CONTRAENTREGA_SI], maxMensajes: 3 },
    },
    {
      id: "envio-medellin",
      nombre: "\"¿Cuánto vale el envío a Medellín?\"",
      critico: false,
      mensaje: "¿Cuánto vale el envío a Medellín?",
      estado: enPaso("PRODUCTO"),
      espera: { avisaAsesora: true },
      prohibido: { preguntarCiudad: true, textos: [SIN_ENVIO_GRATIS] },
      origen: "Auditoría 9-oct: gana la regla de precio, no avisa y vuelve a preguntar la ciudad.",
    },
    {
      id: "dos-combos",
      nombre: "\"Quiero dos combos\"",
      critico: false,
      mensaje: "Quiero dos combos",
      estado: enPaso("PRESENTACION"),
      espera: { avisaAsesora: true },
      origen: "Auditoría 9-oct: el tope por cantidad empieza en 3 unidades.",
    },
    {
      id: "tres-combos",
      nombre: "\"Necesito 3 combos\" (por mayor)",
      critico: true,
      mensaje: "Necesito 3 combos",
      estado: enPaso("PRODUCTO"),
      espera: { avisaAsesora: true },
    },
    {
      id: "contraentrega",
      nombre: "\"¿Tienen contraentrega?\" (en la charla)",
      critico: true,
      mensaje: "¿Tienen contraentrega?",
      estado: enPaso("PRODUCTO"),
      espera: { avisaAsesora: true },
      prohibido: { textos: [SIN_CONTRAENTREGA_SI, SIN_ENVIO_GRATIS] },
    },
    {
      id: "contraentrega-primero",
      nombre: "Primer mensaje: \"Hola, ¿manejan contraentrega?\"",
      critico: true,
      mensaje: "Hola, ¿manejan contraentrega?",
      espera: { avisaAsesora: true },
      prohibido: { textos: [SIN_CONTRAENTREGA_SI, SIN_ENVIO_GRATIS] },
    },
    {
      id: "dice-servicio",
      nombre: "Contesta su servicio: \"masajes\"",
      critico: true,
      mensaje: "masajes",
      estado: enPaso("PRESENTACION"),
      espera: { pasoDespues: "PRODUCTO" },
      prohibido: { maxMensajes: 3, textos: [SIN_ENVIO_GRATIS] },
    },
    {
      id: "si-fotos",
      nombre: "Acepta ver fotos: \"si\"",
      critico: false,
      mensaje: "si",
      estado: enPaso("PRODUCTO"),
      espera: { pasoDespues: "OBJECIONES" },
      origen: "Las fotos del combo dicen 'envío gratis a ciudades principales' (pendiente en Flujos).",
    },
    {
      id: "solo-camilla",
      nombre: "\"Solo la camilla\"",
      critico: false,
      mensaje: "solo la camilla",
      estado: enPaso("PRODUCTO"),
      espera: { reglaNombreIncluye: ["solo la camilla"] },
      prohibido: { flujoEnRespuesta: true, textos: [SIN_ENVIO_GRATIS] },
    },
    {
      id: "ciudad-directa",
      nombre: "Dice la ciudad: \"Soy de Pereira\" (IA)",
      critico: false,
      mensaje: "Soy de Pereira",
      estado: enPaso("OBJECIONES", yaVioFotos),
      intencionesPorNombre: ["Dice la ciudad"],
      espera: { avisaAsesora: true },
      prohibido: { preguntarCiudad: true, textos: [SIN_ENVIO_GRATIS] },
    },
    {
      id: "separar",
      nombre: "\"¿Cómo hago para separarlo?\" (IA)",
      critico: true,
      mensaje: "Cómo hago para separarlo?",
      estado: enPaso("OBJECIONES", yaVioFotos),
      intencionesPorNombre: ["Dio los datos para comprar"],
      espera: { avisaAsesora: true },
    },
    {
      id: "cuenta-consigno",
      nombre: "\"¿A qué cuenta consigno?\" (IA)",
      critico: true,
      mensaje: "a que cuenta consigno",
      estado: enPaso("CIERRE", yaVioFotos),
      intencionesPorNombre: ["Dio los datos para comprar"],
      espera: { avisaAsesora: true },
    },
    {
      id: "pide-persona",
      nombre: "\"Quiero hablar con un asesor\"",
      critico: true,
      mensaje: "Quiero hablar con un asesor",
      estado: enPaso("PRODUCTO"),
      espera: { avisaAsesora: true },
    },
  ];
}
