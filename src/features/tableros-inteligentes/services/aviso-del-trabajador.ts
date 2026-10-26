import { ErrorDelTrabajador, type ContextoTrabajador } from "./trabajador";
import { TIPOS_DEL_COORDINADOR, avisoDelCoordinador, type RespuestaDelAviso, type TipoDeAvisoDelCoordinador } from "./avisos-al-dueno";

/*
  AVISO DEL COORDINADOR por WhatsApp. El Coordinador del Tablero IA (PC aizen1) le avisa al dueño SOLO de dos cosas:
  que se agotó el límite de Claude y todo quedó en pausa (tipo "limite") o que necesita algo que no puede hacer solo
  (tipo "necesita"). Un aviso sin tipo (el del umbral de uso, de versiones viejas del Coordinador) se descarta sin
  error: el dueño ya no quiere avisos de avance.

  Sale por services/avisos-al-dueno.ts: línea Admin, número personal guardado en Mi empresa → Claude (validado en el
  servidor), interruptor, silencio nocturno y un solo aviso por problema cada 3 horas. Antes buscaba el número en
  una AppSetting que ninguna pantalla llenaba y respondía 412: ahora, sin número, anota "no salió: falta su número
  en Mi empresa → Claude" y responde 200. El envío es el de siempre (`sendEvolutionTextMessageWithReconnect`).
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

/** El tipo del aviso ("limite" o "necesita"); cualquier otra cosa (o nada) es null y el aviso se descarta. */
export function tipoDeAvisoDeEntrada(valor: unknown): TipoDeAvisoDelCoordinador | null {
  return (TIPOS_DEL_COORDINADOR as readonly string[]).includes(String(valor)) ? (valor as TipoDeAvisoDelCoordinador) : null;
}

export async function enviarAvisoDelTrabajador(contexto: ContextoTrabajador, cuerpo: unknown): Promise<RespuestaDelAviso> {
  const datos = (cuerpo ?? {}) as { texto?: unknown; tipo?: unknown };
  const texto = textoDeAvisoDeEntrada(datos.texto);
  const tipo = tipoDeAvisoDeEntrada(datos.tipo);
  if (!tipo) return { ok: true, enviado: false, motivo: 'descartado: el aviso no trae tipo "limite" o "necesita"' };
  return avisoDelCoordinador(contexto.workspaceId, tipo, texto);
}
