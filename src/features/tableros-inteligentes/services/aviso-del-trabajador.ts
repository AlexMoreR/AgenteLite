import { recibirAvisoDelCoordinador } from "./avisos-al-dueno";
import { ErrorDelTrabajador, type ContextoTrabajador } from "./trabajador";

/*
  AVISO DEL COORDINADOR por WhatsApp (24-oct-2026): el Coordinador del Tablero IA (PC aizen1) le avisa al dueño
  solo dos cosas que el CRM no puede ver por su cuenta: que se agotó el límite de Claude y todo quedó en pausa
  (tipo "limite") o que necesita algo que no puede hacer solo (tipo "necesita"). Un aviso sin tipo (el del
  umbral del plan, que ya no se manda) se descarta sin error.

  Todo lo demás (reglas, silencio de 9 p. m. a 7 a. m., uno por problema cada 3 horas, número del dueño, línea
  Admin) está en avisos-al-dueno.ts. Antes el número salía de una AppSetting que ninguna pantalla llenaba y
  cada aviso respondía 412; ahora sale de Mi empresa → Claude y, si falta, queda anotado en esa caja.
*/

export const MAXIMO_TEXTO_DE_AVISO = 500;

/** El texto como lo manda el Coordinador: no vacío, hasta 500 caracteres. */
export function textoDeAvisoDeEntrada(valor: unknown): string {
  const texto = typeof valor === "string" ? valor.replace(/\r\n/g, "\n").trim() : "";
  if (!texto) throw new ErrorDelTrabajador("Falta el texto del aviso.", 400);
  if (texto.length > MAXIMO_TEXTO_DE_AVISO) {
    throw new ErrorDelTrabajador(`El aviso tiene ${texto.length} caracteres: el máximo es ${MAXIMO_TEXTO_DE_AVISO}.`, 400);
  }
  return texto;
}

export async function enviarAvisoDelTrabajador(contexto: ContextoTrabajador, cuerpo: unknown) {
  const datos = (cuerpo ?? {}) as { texto?: unknown; tipo?: unknown };
  const texto = textoDeAvisoDeEntrada(datos.texto);
  return recibirAvisoDelCoordinador(contexto.workspaceId, datos.tipo, texto);
}
