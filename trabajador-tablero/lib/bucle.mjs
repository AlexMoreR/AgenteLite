// Una vuelta del trabajador: pregunta al CRM si hay algo (/tomar) y, si hay, hace esa etapa con su
// latido cada minuto. Si el latido dice que la tarjeta ya venció (409), se cancela lo que esté corriendo
// (el CRM la pasa a ERROR en el próximo /tomar). Si la etapa falla, avisa /error con el motivo.
import { ErrorDeEtapa, construir, planear, subir } from "./etapas.mjs";

const ETAPAS = { planear, construir, subir };

export async function unaVuelta({ crm, config, registro }) {
  const respuesta = await crm.tomar();
  if (respuesta.vencidas?.length) registro.aviso(`el CRM pasó a ERROR por vencidas: ${respuesta.vencidas.join(", ")}`);
  if (!respuesta.tarjeta) return { hizo: null, motivo: respuesta.motivo };
  const { tarjeta, hacer } = respuesta;
  registro.info(`tomé "${tarjeta.titulo}" (${tarjeta.id}, ${tarjeta.repo}) para ${hacer}`);
  const resultado = await procesar({ crm, config, registro }, tarjeta, hacer);
  return { hizo: hacer, tarjetaId: tarjeta.id, ...resultado };
}

export async function procesar({ crm, config, registro }, tarjeta, hacer) {
  const control = new AbortController();
  let vencida = false;
  const latir = async () => {
    try {
      await crm.latido(tarjeta.id);
    } catch (error) {
      registro.aviso(`latido de ${tarjeta.id}: ${error.message}`);
      if (error.status === 409 || error.status === 404) {
        vencida = true;
        control.abort();
      }
    }
  };
  const reloj = setInterval(() => void latir(), Math.max(1, config.tiempos.latidoSegundos) * 1000);
  const contexto = { config, registro, senal: control.signal };
  try {
    const etapa = ETAPAS[hacer];
    if (!etapa) throw new ErrorDeEtapa(`El CRM pidió "${hacer}", que este trabajador no sabe hacer (¿hay que actualizarlo?).`);
    const salida = await etapa(contexto, tarjeta);
    if (vencida) throw new ErrorDeEtapa("La tarjeta venció en el CRM mientras se trabajaba.");
    let respuesta;
    if (hacer === "planear") respuesta = await crm.plan(tarjeta.id, salida.plan);
    else if (hacer === "construir") respuesta = await crm.resultado(tarjeta.id, salida);
    else respuesta = await crm.subida(tarjeta.id, { commit: salida.commit, version: salida.version, linkCommit: salida.linkCommit });
    registro.info(`listo "${tarjeta.titulo}" (${hacer})${respuesta?.estado ? `: quedó ${respuesta.estado}` : ""}`);
    // estado = SUBIENDO: se construyó y sube sola; el que llama la toma enseguida, sin esperar el minuto.
    return { ok: true, estado: respuesta?.estado ?? null };
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    if (vencida) {
      registro.error(`"${tarjeta.titulo}" venció en el CRM: ${motivo}`);
      return { ok: false, motivo, vencida: true };
    }
    registro.error(`"${tarjeta.titulo}" (${hacer}) falló: ${motivo}`);
    try {
      await crm.error(tarjeta.id, motivo, error?.zonas, error?.reversion);
    } catch (otro) {
      registro.error(`no se pudo avisar el error al CRM: ${otro.message}`);
    }
    return { ok: false, motivo, zonas: error?.zonas ?? [] };
  } finally {
    clearInterval(reloj);
  }
}
