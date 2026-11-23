// FEATURES SE APRUEBA Y SUBE SOLO (23-nov-2026, decisión de Alexander). Puro: sin disco, red ni procesos.
//
// Las tarjetas del tablero Features (T-736) ya no esperan ningún "sí" de Alexander, ni para pasar el plan a construir (aunque el
// RIESGO sea ALTO o el plan traiga preguntas abiertas: se sigue con la opción recomendada y queda escrita en la tarjeta) ni para
// subir (si build y pruebas pasan, sube sola en TODAS las zonas: BOT_VENTAS, LIBRO_V3, CHATS, META_ADS y dinero de Gestión, con la
// vigilancia de 30 min y la reversión automática de siempre). ÚNICA excepción: lo que sube presupuesto, prende campañas o crea gasto
// nuevo en Meta Ads, que sigue esperando el sí de Alexander.
//
// Es una REGLA EN CÓDIGO (config.local.json no se versiona). Para apagarla basta cambiar FEATURES_SUBE_SOLO a false (o arrancar
// el Coordinador con COORDINADOR_FEATURES_SUBE_SOLO=0): vuelve a regir lo que diga la configuración, sin tocar nada más.

/** El tablero Features. */
export const FEATURES_TABLERO_ID = "cmvg35cqq001i2io6q1hfwvio";

/** El interruptor. false = todo vuelve a como estaba antes del 23-nov-2026. */
export const FEATURES_SUBE_SOLO = true;

/**
 * ¿Un envío nuevo de mensajes a clientes (chats / bot de ventas) frena la subida de Features? false (decisión del 23-nov: solo el
 * gasto en Meta Ads frena): sube igual, con una línea de aviso en las pruebas y la vigilancia de 30 min. true = queda en ERROR
 * con el motivo, como en el resto de los tableros.
 */
export const FEATURES_ENVIO_NUEVO_FRENA = false;

/** Las zonas que suben solas en Features, además de las que traiga la configuración del repo. */
export const ZONAS_QUE_SUBEN_SOLAS_EN_FEATURES = ["BOT_VENTAS", "LIBRO_V3", "CHATS", "META_ADS"];

/** ¿Está prendida la regla? (el interruptor del código y la variable de entorno de emergencia). */
export function featuresSubeSolo(entorno = process.env) {
  return FEATURES_SUBE_SOLO && !/^(0|false|no|off)$/i.test(String(entorno?.COORDINADOR_FEATURES_SUBE_SOLO ?? ""));
}

/** ¿La tarjeta es del tablero Features? (por id del tablero, nunca por nombre). */
export function esTarjetaDeFeatures(tarjeta) {
  return Boolean(tarjeta) && tarjeta.tableroId === FEATURES_TABLERO_ID;
}

/** ¿Rige la regla de Features para esta tarjeta? */
export function aplicaFeaturesAuto(tarjeta, entorno = process.env) {
  return featuresSubeSolo(entorno) && esTarjetaDeFeatures(tarjeta);
}

/**
 * El repo tal como se usa para esta tarjeta: el de la configuración, y si es de Features, subiendo solo en todas las zonas
 * (`featuresAuto: true` para que las etapas sepan por qué). Devuelve el mismo objeto si no aplica.
 */
export function repoParaLaTarjeta(repo, tarjeta, entorno = process.env) {
  if (!repo || !aplicaFeaturesAuto(tarjeta, entorno)) return repo;
  const zonas = [...new Set([...(repo.zonasQueSubenSolas ?? []), ...ZONAS_QUE_SUBEN_SOLAS_EN_FEATURES, ...Object.keys(repo.zonasProtegidas ?? {})])];
  return { ...repo, subirSolo: true, zonasQueSubenSolas: zonas, featuresAuto: true };
}

/**
 * En Features, ¿este motivo de "no sube sola" frena de verdad? Solo el gasto en Meta Ads (esperaAlDueno) y, si se prende
 * FEATURES_ENVIO_NUEVO_FRENA, un envío nuevo de mensajes a clientes. Cualquier otro motivo (falta la simulación V3, falta la frase
 * de la prueba extra) se anota como aviso en las pruebas y la tarjeta sube igual.
 */
export function motivoFrenaEnFeatures(motivo, esperaAlDueno) {
  if (!motivo) return false;
  if (esperaAlDueno(motivo)) return true;
  return FEATURES_ENVIO_NUEVO_FRENA && /env[ií]o (nuevo )?de mensaje/i.test(motivo);
}
