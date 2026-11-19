// TARJETAS SIN SEÑAL (18-nov-2026, decisión del dueño; ajustada el mismo día: cada 15 min, y 30 min sin señal en vez de 2 h).
// El 18-nov había 17 tarjetas tomadas por el Coordinador (PLANEANDO, EN_CURSO, SUBIENDO), algunas desde el 9-nov, sin que
// ninguna sesión las trabajara: aizen1 estuvo apagado por un corte de luz, el Coordinador reiniciado no las soltó (/arranque
// soltó 0) y las SUBIENDO no vencen solas. Hubo que soltarlas a mano.
//
// El CRM no le da al Coordinador la lista de las tarjetas tomadas con su último latido (/candidatas solo trae las que se pueden
// tomar, /errores las de ERROR; el CRM guarda el candado `trabajoVenceEn`, no la hora del latido). Por eso el Coordinador lleva
// la suya: <carpetaTrabajo>/sin-latido.json, con cada tarjeta que toma y la hora de su última señal (el último latido que el CRM
// aceptó). Revisarla NO usa Claude: solo compara horas (y, si hace falta, mira la rama en GitHub).
//
//   1. CADA 15 MIN (config.sinLatido.revisarCadaMinutos) se mira cada tarjeta tomada. Una que lleva MÁS DE 30 MIN
//      (config.sinLatido.minutosSinSenal) sin señal y que ninguna sesión viva de este Coordinador trabaja se suelta sola
//      (/soltar, sin ERROR) y vuelve a la fila para empezar de nuevo desde main: un reintento.
//   2. Si en el segundo intento vuelve a quedar sin señal: /error ("sin señal ... dos veces") y UN WhatsApp al dueño (aviso
//      "necesita" con la tarjeta, el mismo canal de los demás avisos). Un solo aviso por falla: al pasar a ERROR la tarjeta sale
//      del archivo.
//   3. Si la sesión se quedó con una PREGUNTA (el commit vacío "pregunta: …" que deja la sesión de la nube, nube.mjs:
//      preguntaDelCommit), la tarjeta pasa a ERROR con la pregunta escrita para que el dueño la conteste. No cuenta como reintento
//      ni manda WhatsApp (el dueño la ve en la tarjeta).
//   4. Una tarjeta en las manos de una sesión viva (aizen1 o nube) nunca se toca: el reloj corre desde su ÚLTIMA señal, no desde
//      que se tomó. La nube también manda latido: lo manda este mismo Coordinador cada minuto mientras espera a la sesión (procesar),
//      así que vale el mismo umbral de 30 min.
//   5. El CRM da 502 a ratos y eso no es sesión muerta: si no se puede LEER el CRM (/candidatas), esa revisión no suelta nada y los
//      30 min vuelven a contar desde la última falla del CRM.
//   6. Al ARRANCAR el Coordinador (después de un apagón o una actualización) no queda ninguna sesión viva: lo que quedó tomado se
//      retoma enseguida, sin esperar los 30 min y sin contar como intento (el culpable fue el apagón, no la sesión):
//      /arranque suelta lo que tiene candado y retomarAlArrancar suelta el resto (SUBIENDO, que no vence sola).
// Cuando una etapa termina bien, la tarjeta sale del archivo: avanzó, y el contador vuelve a empezar.
// Todo lo del sistema (reloj, crm, archivo, GitHub) entra por parámetros para probarlo sin red.
import fs from "node:fs";
import path from "node:path";

/** Cada cuántos minutos se revisan las tarjetas tomadas (por defecto; config.sinLatido.revisarCadaMinutos). */
export const MINUTOS_ENTRE_REVISIONES = 15;

/** Sin señal por más de esto, la tarjeta se suelta (o, la segunda vez, pasa a ERROR) (por defecto; config.sinLatido.minutosSinSenal). */
export const MINUTOS_SIN_SENAL = 30;

/** Si no se puede mirar la rama de una pregunta posible, la tarjeta espera hasta este múltiplo de los minutos sin señal y después se suelta igual. */
const VECES_QUE_ESPERA_LA_PREGUNTA = 4;

/** La marca que deja el /soltar del primer intento en la causa (así el contador sale también de los intentos del CRM). */
export const MARCA_SIN_LATIDO = "sin señal de la sesión";

/** Las marcas de la primera versión (2 h): los intentos viejos del CRM las traen y siguen contando. */
const MARCAS_ANTERIORES = ["sin latido más de 2 h"];

/** Lo que se suelta y no se vuelve a tomar se olvida a los 14 días (el archivo no crece para siempre). */
const DIAS_PARA_OLVIDAR = 14;

const MINUTO = 60_000;
const HORA = 3_600_000;

export const rutaDeSinLatido = (carpetaTrabajo) => path.join(carpetaTrabajo, "sin-latido.json");

/** El archivo, o null si no existe o no se puede leer. */
export function leerSinLatido(carpetaTrabajo) {
  try {
    const datos = JSON.parse(fs.readFileSync(rutaDeSinLatido(carpetaTrabajo), "utf8").replace(/^﻿/, ""));
    return datos && typeof datos === "object" && datos.tarjetas && typeof datos.tarjetas === "object" ? datos : null;
  } catch {
    return null;
  }
}

function guardarSinLatido(carpetaTrabajo, datos) {
  fs.mkdirSync(carpetaTrabajo, { recursive: true });
  const ruta = rutaDeSinLatido(carpetaTrabajo);
  fs.writeFileSync(`${ruta}.tmp`, `${JSON.stringify(datos, null, 2)}\n`);
  fs.renameSync(`${ruta}.tmp`, ruta);
}

/** Cuántas veces ya se soltó por falta de señal en esta etapa, según los intentos que trae /tomar (0 a 1). */
export function vecesEnLosIntentos(tarjeta, hacer) {
  const intentos = Array.isArray(tarjeta?.ultimosIntentos) ? tarjeta.ultimosIntentos : [];
  const marcas = [MARCA_SIN_LATIDO, ...MARCAS_ANTERIORES];
  return intentos.some((intento) => intento?.etapa === hacer && marcas.some((marca) => String(intento?.causa ?? "").includes(marca))) ? 1 : 0;
}

/** El motivo de ERROR para el dueño (3 líneas). "Necesita que" hace que el recogedor diario la deje al dueño y no la reintente. */
export function motivoDeDosVeces(entrada, minutos = MINUTOS_SIN_SENAL) {
  return [
    `${MARCA_SIN_LATIDO} más de ${minutos} min, dos veces: nadie la trabajó al ${entrada.etapa ?? "trabajarla"} (¿aizen1 apagado o sin conexión?).`,
    "El Coordinador ya la soltó sola una vez y volvió a quedar quieta.",
    "Necesita que la revises: pulsa Reintentar cuando aizen1 esté bien.",
  ].join("\n");
}

/** UNA línea para el WhatsApp del dueño. */
export function textoDelAvisoDeDosVeces(entrada, minutos = MINUTOS_SIN_SENAL) {
  return `⚠️ Tablero IA: "${entrada.titulo ?? entrada.id}" quedó en ERROR: su sesión llevó más de ${minutos} min sin señal por segunda vez (al ${entrada.etapa ?? "trabajarla"}). Revísala y pulsa Reintentar.`;
}

/** El motivo de ERROR cuando la sesión se quedó con una pregunta: la pregunta escrita y qué hacer. */
export function motivoDeLaPregunta(pregunta) {
  return [`La sesión de la nube hizo una pregunta y paró: ${pregunta}`, "Necesita que la contestes: responde en el detalle de la tarjeta y apruébala de nuevo."].join("\n");
}

/**
 * La guardia. `vivas()` -> los ids de las tarjetas que tienen ahora las sesiones de este Coordinador (aizen1 y nube).
 * `preguntaDeLaTarjeta(entrada, id)` (opcional) -> la pregunta que dejó la sesión (texto) o null; si lanza, no se pudo mirar.
 *   tomada(tarjeta, hacer)       al tomar una tarjeta (la anota con la hora y el contador).
 *   latio(id)                    cada latido que el CRM aceptó.
 *   termino(id, { ok })          al terminar la etapa: ok la saca; si no, solo deja de estar en las manos.
 *   revisar({ forzar })          cada `revisarCadaMinutos`: suelta, pasa a ERROR o deja con su pregunta las que llevan más de
 *                                `minutosSinSenal` sin señal. -> { sueltas, errores, preguntas }
 *   arranco(sueltas)             tras /arranque: lo que el CRM soltó deja de estar en las manos (no cuenta como intento).
 *   retomarAlArrancar(sueltas)   tras /arranque: suelta lo demás que quedó tomado (SUBIENDO) sin esperar. -> los ids retomados
 */
export function crearGuardiaSinLatido({
  crm,
  config,
  registro,
  vivas = () => [],
  ahora = () => Date.now(),
  minutosSinSenal = config.sinLatido?.minutosSinSenal ?? MINUTOS_SIN_SENAL,
  revisarCadaMinutos = config.sinLatido?.revisarCadaMinutos ?? MINUTOS_ENTRE_REVISIONES,
  preguntaDeLaTarjeta = null,
}) {
  const carpeta = config.carpetaTrabajo;
  const limiteMs = minutosSinSenal * MINUTO;
  const cadaMs = revisarCadaMinutos * MINUTO;
  let ultimaRevision = null;
  let ultimaFallaDelCrm = 0;
  const leer = () => leerSinLatido(carpeta);
  const guardar = (datos) => {
    try {
      guardarSinLatido(carpeta, datos);
    } catch (error) {
      registro.aviso(`sin señal: no pude guardar ${rutaDeSinLatido(carpeta)} (${error?.message ?? error})`);
    }
  };
  const cambiar = (fn) => {
    const datos = leer() ?? { tarjetas: {} };
    fn(datos.tarjetas);
    guardar(datos);
  };
  const iso = () => new Date(ahora()).toISOString();
  /** Cuánto hace de su última señal; si el CRM no se pudo leer después, cuenta desde esa falla (sin latido por culpa del CRM no es sesión muerta). */
  const sinSenalMs = (entrada) => ahora() - Math.max(Date.parse(entrada.ultimoLatido ?? entrada.tomadaEn ?? "") || ahora(), ultimaFallaDelCrm);
  /** Lo que el CRM contesta cuando la tarjeta ya no está en su etapa: no hay nada atascado. */
  const yaNoEsta = (error) => error?.status === 409 || error?.status === 404;
  const olvidarOReservar = (id) =>
    cambiar((tarjetas) => {
      const entrada = tarjetas[id];
      if (!entrada) return;
      // Si ya llevaba un intento sin señal se conserva (la segunda falla real sí va a ERROR); si no, se olvida.
      if (Number(entrada.veces) > 0) Object.assign(entrada, { enLasManos: false, sueltaEn: iso() });
      else delete tarjetas[id];
    });

  return {
    tomada(tarjeta, hacer) {
      // Sin archivo (perdido o primera vez): el contador sale de los intentos del CRM.
      const previo = leer();
      cambiar((tarjetas) => {
        const antes = previo ? tarjetas[tarjeta.id] : null;
        const veces = previo ? (antes?.etapa === hacer ? Number(antes.veces) || 0 : 0) : vecesEnLosIntentos(tarjeta, hacer);
        tarjetas[tarjeta.id] = {
          titulo: tarjeta.titulo ?? null,
          repo: tarjeta.repo ?? null,
          rama: tarjeta.rama ?? null,
          etapa: hacer,
          tomadaEn: iso(),
          ultimoLatido: iso(),
          enLasManos: true,
          veces,
        };
      });
    },
    latio(id) {
      cambiar((tarjetas) => {
        if (tarjetas[id]) tarjetas[id].ultimoLatido = iso();
      });
    },
    termino(id, { ok = false } = {}) {
      cambiar((tarjetas) => {
        const entrada = tarjetas[id];
        if (!entrada) return;
        if (ok || !(Number(entrada.veces) > 0)) delete tarjetas[id];
        else Object.assign(entrada, { enLasManos: false, sueltaEn: iso() });
      });
    },
    arranco(sueltas = []) {
      const soltadas = new Set(sueltas);
      for (const [id, entrada] of Object.entries(leer()?.tarjetas ?? {})) if (soltadas.has(id) && entrada.enLasManos) olvidarOReservar(id);
    },
    async retomarAlArrancar(sueltas = []) {
      const soltadas = new Set(sueltas);
      const retomadas = [];
      for (const [id, entrada] of Object.entries(leer()?.tarjetas ?? {})) {
        // Solo lo que quedó tomado y /arranque no soltó. En el arranque no hay ninguna sesión viva: todo lo tomado es del proceso anterior.
        if (!entrada.enLasManos || soltadas.has(id)) continue;
        const nombre = `"${entrada.titulo ?? id}" (${id})`;
        try {
          await crm.soltar(id, "El Coordinador volvió a arrancar: la retomo desde main (no cuenta como intento).", {
            categoria: "coordinador_cortado",
            causa: "El Coordinador se reinició (apagón o actualización) y la sesión se perdió: se retoma sola, no cuenta como intento.",
            etapa: entrada.etapa ?? undefined,
          });
          registro.info(`arranque: retomo ${nombre} que quedó a medias al ${entrada.etapa}`);
          olvidarOReservar(id);
          retomadas.push(id);
        } catch (error) {
          if (yaNoEsta(error)) {
            registro.info(`arranque: ${nombre} ya no está al ${entrada.etapa} en el CRM (${error.message}); la olvido`);
            cambiar((t) => delete t[id]);
          } else registro.aviso(`arranque: no pude retomar ${nombre} (${error?.message ?? error}); la revisión de cada ${revisarCadaMinutos} min lo intenta`);
        }
      }
      return retomadas;
    },
    async revisar({ forzar = false } = {}) {
      const hechas = { sueltas: [], errores: [], preguntas: [] };
      // Barata: sin tarjetas atrasadas no hay ni una llamada al CRM; y solo corre cada `revisarCadaMinutos`.
      if (!forzar && ultimaRevision !== null && ahora() - ultimaRevision < cadaMs) return hechas;
      ultimaRevision = ahora();
      const datos = leer();
      if (!datos) return hechas;
      const enManos = new Set(vivas());
      const atrasadas = [];
      for (const [id, entrada] of Object.entries(datos.tarjetas)) {
        // Lo soltado que nadie volvió a tomar en DIAS_PARA_OLVIDAR se olvida.
        if (!entrada.enLasManos) {
          if (ahora() - (Date.parse(entrada.sueltaEn ?? "") || 0) > DIAS_PARA_OLVIDAR * 24 * HORA) cambiar((t) => delete t[id]);
          continue;
        }
        // Una sesión viva de este Coordinador la tiene: nunca se toca (su latido corre aparte).
        if (enManos.has(id)) continue;
        if (sinSenalMs(entrada) > limiteMs) atrasadas.push([id, entrada]);
      }
      if (!atrasadas.length) return hechas;
      // El CRM da 502 a ratos: sin poder leerlo no se sabe si la sesión murió o si solo fallaron sus latidos. No se suelta nada.
      if (typeof crm.candidatas === "function") {
        try {
          await crm.candidatas();
        } catch (error) {
          ultimaFallaDelCrm = ahora();
          registro.aviso(`sin señal: el CRM no contesta (${error?.message ?? error}); ${atrasadas.length} tarjeta(s) esperan, no suelto nada y los ${minutosSinSenal} min cuentan desde ahora`);
          return hechas;
        }
      }
      for (const [id, entrada] of atrasadas) {
        const quieta = sinSenalMs(entrada);
        const minutos = Math.floor(quieta / MINUTO);
        const etapa = entrada.etapa ?? undefined;
        const nombre = `"${entrada.titulo ?? id}" (${id})`;
        try {
          // ¿Se quedó con una pregunta? Va a ERROR con la pregunta; no cuenta como reintento.
          let pregunta = null;
          if (preguntaDeLaTarjeta) {
            try {
              pregunta = await preguntaDeLaTarjeta(entrada, id);
            } catch (error) {
              if (quieta <= limiteMs * VECES_QUE_ESPERA_LA_PREGUNTA) {
                registro.aviso(`sin señal: no pude mirar si ${nombre} dejó una pregunta (${error?.message ?? error}); espero a la próxima revisión`);
                continue;
              }
            }
          }
          if (pregunta) {
            await crm.error(id, motivoDeLaPregunta(pregunta), undefined, undefined, {
              categoria: "nube_pregunta",
              causa: `La sesión se quedó con una pregunta y paró (${minutos} min sin señal): ${pregunta}`,
              etapa,
            });
            registro.aviso(`sin señal: ${nombre} se quedó con una pregunta: pasa a ERROR con la pregunta escrita`);
            cambiar((t) => delete t[id]);
            hechas.preguntas.push(id);
          } else if (!(Number(entrada.veces) > 0)) {
            await crm.soltar(id, `El Coordinador la soltó sola: ${MARCA_SIN_LATIDO} (lleva ${minutos} min) y nadie la trabaja. Vuelve a la fila desde main (1 de 2).`, {
              categoria: "coordinador_cortado",
              causa: `${MARCA_SIN_LATIDO} y nadie la trabajaba: se suelta y se reintenta una vez desde main (1 de 2).`,
              etapa,
            });
            registro.aviso(`sin señal: ${nombre} llevaba ${minutos} min sin señal al ${etapa}: la solté y vuelve a la fila (1 de 2)`);
            cambiar((t) => Object.assign(t[id] ?? {}, { veces: 1, enLasManos: false, sueltaEn: iso() }));
            hechas.sueltas.push(id);
          } else {
            await crm.error(id, motivoDeDosVeces(entrada, minutosSinSenal), undefined, undefined, {
              categoria: "coordinador_cortado",
              causa: `${MARCA_SIN_LATIDO}, dos veces: se pasa al dueño.`,
              etapa,
            });
            registro.aviso(`sin señal: ${nombre} volvió a quedar ${minutos} min sin señal al ${etapa}: pasa a ERROR y le aviso al dueño`);
            cambiar((t) => delete t[id]);
            hechas.errores.push(id);
            // UN solo aviso: la tarjeta ya salió del archivo y no se vuelve a mirar; si este no sale no se insiste.
            try {
              await crm.aviso(textoDelAvisoDeDosVeces(entrada, minutosSinSenal), "necesita", id);
            } catch (error) {
              registro.aviso(`sin señal: no salió el WhatsApp al dueño de ${nombre} (${error?.message ?? error}); la tarjeta ya está en ERROR`);
            }
          }
        } catch (error) {
          // 409/404: la tarjeta ya no está en su etapa (el CRM la soltó o la pasó a ERROR, o terminó): no hay nada atascado.
          // Sin red (0) o el CRM caído (5xx): no se suelta nada y se reintenta en la próxima revisión.
          if (yaNoEsta(error)) {
            registro.info(`sin señal: ${nombre} ya no está al ${etapa} en el CRM (${error.message}); la olvido`);
            cambiar((t) => delete t[id]);
          } else {
            registro.aviso(`sin señal: no pude soltar ${nombre} (${error?.message ?? error}); lo intento en la próxima revisión`);
          }
        }
      }
      return hechas;
    },
  };
}
