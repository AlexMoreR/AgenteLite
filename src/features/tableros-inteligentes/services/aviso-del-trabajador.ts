import { ErrorDelTrabajador, type ContextoTrabajador } from "./trabajador";
import { TIPOS_DEL_COORDINADOR, aTresLineas, enSilencioDeAvisos, registrarAvisoDelCoordinador } from "./avisos-al-dueno";

/*
  AVISO DEL TRABAJADOR por WhatsApp (23-oct-2026): el trabajador del Tablero IA (PC aizen1) le avisa al
  dueño, por ejemplo, que el plan de Claude pasó el umbral de uso. Sale desde la línea Admin del negocio
  (la que se llama "Admin" o tiene purpose ADMIN; nunca una de ventas) al número guardado en la AppSetting
  `trabajador:aviso-telefono:<workspaceId>`. Sin número: 412. Como mucho 1 aviso por minuto por negocio y
  500 caracteres. El envío es el de siempre (`sendEvolutionTextMessageWithReconnect`, que también sabe
  WAHA): no se toca nada de la zona de chats. No se guarda en ningún chat (como los avisos de gravedad).

  26-oct-2026 (decisión del dueño: solo avisos súper importantes): el CRM solo deja pasar avisos con tipo
  "limite" (Claude se agotó y todo quedó en pausa) o "necesita" (algo que el sistema no puede hacer solo); sin
  tipo o con otro, los descarta con 200 `descartado: true`. El número ya NO sale de la AppSetting a mano: sale
  de la caja de Mi empresa → Claude (services/avisos-al-dueno.ts, que valida el número, usa la línea Admin por
  id, calla de noche, respeta el interruptor y no repite el mismo aviso antes de 3 horas). Eso arregla el 412.

  26-oct-2026: el aviso lleva MÁXIMO 3 LÍNEAS (si llega con más, se recorta a 3) y hay SILENCIO de 9:00 p. m.
  a 7:00 a. m. (Bogotá): en ese horario no se manda y se contesta `silenciado: true` (200), para que el
  Coordinador lo vuelva a intentar y salga a las 7 a. m. si sigue siendo cierto.
*/

export const MAXIMO_TEXTO_DE_AVISO = 500;
const UN_MINUTO = 60_000;

/** ¿Es hora de silencio (9:00 p. m. a 6:59 a. m. de Bogotá, UTC-5 todo el año)? */
export const enSilencio = enSilencioDeAvisos;

/** Último aviso por negocio (en memoria del proceso: el CRM corre en un solo contenedor). */
const ultimoAviso = new Map<string, number>();

/** El texto como lo manda el trabajador: no vacío, hasta 500 caracteres, máximo 3 líneas. */
export function textoDeAvisoDeEntrada(valor: unknown): string {
  const texto = typeof valor === "string" ? aTresLineas(valor.replace(/\r\n/g, "\n").trim()) : "";
  if (!texto) throw new ErrorDelTrabajador("Falta el texto del aviso.", 400);
  if (texto.length > MAXIMO_TEXTO_DE_AVISO) {
    throw new ErrorDelTrabajador(`El aviso tiene ${texto.length} caracteres: el máximo es ${MAXIMO_TEXTO_DE_AVISO}.`, 400);
  }
  return texto;
}

/** ¿Ya salió un aviso de este negocio en el último minuto? Si no, anota este. */
export function puedeAvisarAhora(workspaceId: string, ahora = Date.now()): boolean {
  const ultimo = ultimoAviso.get(workspaceId) ?? 0;
  if (ahora - ultimo < UN_MINUTO) return false;
  ultimoAviso.set(workspaceId, ahora);
  return true;
}

export async function enviarAvisoDelTrabajador(contexto: ContextoTrabajador, cuerpo: unknown, ahora: Date = new Date()) {
  const datos = cuerpo as { texto?: unknown; tipo?: unknown } | null;
  const texto = textoDeAvisoDeEntrada(datos?.texto);
  // Sin tipo permitido ("limite" o "necesita") se descarta sin error: el Coordinador viejo sigue andando sin molestar al dueño.
  if (!TIPOS_DEL_COORDINADOR.includes(datos?.tipo as never)) return { descartado: true as const };
  // De 9 p. m. a 7 a. m. no se manda nada: el Coordinador lo reintenta y sale a las 7 a. m. si sigue siendo cierto.
  if (enSilencio(ahora)) return { silenciado: true as const };
  if (!puedeAvisarAhora(contexto.workspaceId, ahora.getTime())) {
    throw new ErrorDelTrabajador("Ya salió un aviso en el último minuto: se manda como mucho uno por minuto.", 429);
  }
  const respuesta = await registrarAvisoDelCoordinador(contexto.workspaceId, datos?.tipo, texto, ahora);
  // Lo que no se mandó (apagado, repetido, sin número, línea caída) no cuenta para el límite de 1 por minuto.
  if (respuesta.salio !== true) ultimoAviso.delete(contexto.workspaceId);
  return respuesta;
}
