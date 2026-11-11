// SOLO EL ÁREA PERMITIDA (10-nov-2026, T-737). Con `areaPermitidaId` en la config, el Coordinador trabaja SOLO las tarjetas que
// cuelgan de esa tarjeta Área (por id, nunca por nombre), a cualquier profundidad (sub-áreas incluidas); con `tableroId`, además,
// solo las de ese tablero. Las demás no se tocan: ni planear, ni construir, ni subir, ni recoger errores, ni rescatar, ni revisar
// de nuevo. Sin las claves, todo sigue como antes.
//
// Se hace envolviendo el cliente del CRM (crm.mjs): las listas (/candidatas, /errores, /por-revisar) salen ya filtradas, y /tomar
// manda en `excluir` las que están fuera, así el CRM no las toma. El CRM manda en cada tarjeta `tableroId` y `ancestros` (los ids
// de sus madres, de la más cercana a la más lejana). Una tarjeta sin `ancestros` (un CRM viejo) cuenta como FUERA: con el área
// configurada, sin saber de dónde cuelga no se toca.

/** El filtro de la config: { activo, permite(tarjeta), texto }. Sin `areaPermitidaId` ni `tableroId`, `activo` es false y permite todo. */
export function filtroDeArea(config) {
  const areaId = config?.areaPermitidaId ?? null;
  const tableroId = config?.tableroId ?? null;
  const activo = Boolean(areaId || tableroId);
  const permite = (tarjeta) => {
    if (!activo) return true;
    if (!tarjeta || typeof tarjeta !== "object") return false;
    if (tableroId && tarjeta.tableroId !== tableroId) return false;
    if (!areaId) return true;
    return tarjeta.id === areaId || (Array.isArray(tarjeta.ancestros) && tarjeta.ancestros.includes(areaId));
  };
  const texto = [areaId ? `el área ${areaId}` : null, tableroId ? `el tablero ${tableroId}` : null].filter(Boolean).join(" de ");
  return { activo, permite, texto };
}

/**
 * El cliente del CRM que solo deja ver y tomar las tarjetas del área permitida. Sin el área en la config devuelve `crm` tal cual.
 *   - candidatas / errores / porRevisar: la misma respuesta, sin las de fuera.
 *   - tomar: mira las candidatas primero y suma a `excluir` las de fuera; si no queda ninguna de dentro, no llama a /tomar
 *     ({ tarjeta: null, motivo: "fuera_del_area" }). Si igual llega una de fuera (apareció entre las dos llamadas), la suelta
 *     sin error y contesta como si no hubiera nada.
 */
export function crmDelArea(crm, config, registro = null) {
  const filtro = filtroDeArea(config);
  if (!filtro.activo) return crm;
  let avisoSinAncestros = false;
  const avisarSiCrmViejo = (tarjetas) => {
    if (avisoSinAncestros || !config?.areaPermitidaId) return;
    if (tarjetas.some((tarjeta) => tarjeta && !Array.isArray(tarjeta.ancestros))) {
      avisoSinAncestros = true;
      registro?.aviso?.(`solo ${filtro.texto}: el CRM no manda "ancestros" en las tarjetas (¿versión vieja?); no tomo esas hasta que lo mande`);
    }
  };
  const separar = (tarjetas) => {
    const lista = Array.isArray(tarjetas) ? tarjetas : [];
    avisarSiCrmViejo(lista);
    return { dentro: lista.filter(filtro.permite), fuera: lista.filter((tarjeta) => !filtro.permite(tarjeta)) };
  };

  return {
    ...crm,
    async candidatas(...argumentos) {
      const respuesta = await crm.candidatas(...argumentos);
      return { ...respuesta, candidatas: separar(respuesta?.candidatas).dentro };
    },
    async errores(...argumentos) {
      const respuesta = await crm.errores(...argumentos);
      return { ...respuesta, tarjetas: separar(respuesta?.tarjetas).dentro };
    },
    async porRevisar(...argumentos) {
      const respuesta = await crm.porRevisar(...argumentos);
      const filtrada = { ...respuesta, tarjetas: separar(respuesta?.tarjetas).dentro };
      if (respuesta && "paraRevisarDeNuevo" in respuesta) filtrada.paraRevisarDeNuevo = separar(respuesta.paraRevisarDeNuevo).dentro;
      return filtrada;
    },
    async tomar(opciones = {}) {
      const { candidatas = [] } = (await crm.candidatas()) ?? {};
      const { dentro, fuera } = separar(candidatas);
      const excluir = [...new Set([...(opciones?.excluir ?? []), ...fuera.map((tarjeta) => tarjeta.id)])];
      if (!dentro.some((tarjeta) => !excluir.includes(tarjeta.id))) return { tarjeta: null, motivo: "fuera_del_area" };
      const respuesta = await crm.tomar({ ...opciones, excluir });
      if (!respuesta?.tarjeta || filtro.permite(respuesta.tarjeta)) return respuesta;
      // Una de fuera que apareció entre /candidatas y /tomar: vuelve a la fila sin error y no se trabaja.
      registro?.aviso?.(`"${respuesta.tarjeta.titulo}" (${respuesta.tarjeta.id}) no cuelga de ${filtro.texto}: la suelto sin trabajarla`);
      try {
        await crm.soltar(respuesta.tarjeta.id, `El Coordinador solo trabaja ${filtro.texto}.`);
      } catch (error) {
        registro?.aviso?.(`no se pudo soltar "${respuesta.tarjeta.titulo}" (${error?.message ?? error}): su candado vence solo`);
      }
      return { ...respuesta, tarjeta: null, hacer: undefined, motivo: "fuera_del_area" };
    },
  };
}
