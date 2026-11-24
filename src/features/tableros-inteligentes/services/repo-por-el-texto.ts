/*
  REPO POR EL TEXTO (24-nov-2026, "Features solas", parte 3). Función pura, sin base: lee el título y el detalle de una
  tarjeta de Features que no tiene repo y dice en qué repositorio va.
  - Sin ninguna palabra conocida: null (el Coordinador pregunta).
  - Palabras de un solo lado: ese repo.
  - Palabras de los dos lados: si el texto nombra los dos sistemas ("en Gestión" y "en el CRM"), 'los-dos' (se parte en dos
    tarjetas). Si no, gana el lado con mayoría clara (el doble o más); sin ella, null (ante la duda, pregunta).
  Las listas son constantes para ampliarlas después. Prueba: npm run test:tablero-features.
*/

import { normalizar } from "./reglas-riesgo";

export type RepoPorElTexto = "gestion" | "aizencrm" | "los-dos" | null;

/** Palabras que dicen "esto es de Gestión" (sin tildes y en minúscula; el plural también cuenta). */
export const PALABRAS_DE_GESTION = ["magilus.com", "gestion", "venta", "orden", "cotizacion", "proveedora", "pedido"] as const;
/** Palabras que dicen "esto es del CRM". */
export const PALABRAS_DEL_CRM = ["crm", "chat", "bot", "whatsapp", "tablero", "alerta", "asesora"] as const;

/** Las que nombran el SISTEMA (no solo un tema): si el texto nombra uno de cada lado, la tarjeta es de los dos. */
export const NOMBRES_DE_GESTION = ["gestion", "magilus.com"] as const;
export const NOMBRES_DEL_CRM = ["crm"] as const;

/** Cuántas veces el lado que gana tiene que superar al otro para que la mayoría sea clara. */
export const MAYORIA_CLARA = 2;

const escapar = (palabra: string) => palabra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** La palabra sola o en plural ("venta", "ventas"; "orden", "ordenes"), no dentro de otra ("bot" no es "boton"). */
const regexDe = (palabras: readonly string[]) => new RegExp(`(?<![a-z0-9])(?:${palabras.map(escapar).join("|")})(?:es|s)?(?![a-z0-9])`, "g");

const REGEX_GESTION = regexDe(PALABRAS_DE_GESTION);
const REGEX_CRM = regexDe(PALABRAS_DEL_CRM);
const REGEX_NOMBRE_GESTION = regexDe(NOMBRES_DE_GESTION);
const REGEX_NOMBRE_CRM = regexDe(NOMBRES_DEL_CRM);

const veces = (regex: RegExp, texto: string) => (texto.match(regex) ?? []).length;

/** En qué repositorio va una tarjeta según su título y su detalle (ver arriba). */
export function repoPorElTexto(titulo: string | null | undefined, detalle: string | null | undefined): RepoPorElTexto {
  const texto = normalizar(`${titulo ?? ""}\n${detalle ?? ""}`);
  const gestion = veces(REGEX_GESTION, texto);
  const crm = veces(REGEX_CRM, texto);
  if (!gestion && !crm) return null;
  if (!crm) return "gestion";
  if (!gestion) return "aizencrm";
  if (veces(REGEX_NOMBRE_GESTION, texto) && veces(REGEX_NOMBRE_CRM, texto)) return "los-dos";
  if (gestion >= crm * MAYORIA_CLARA) return "gestion";
  if (crm >= gestion * MAYORIA_CLARA) return "aizencrm";
  return null;
}
