// SOLO EL ÁREA PERMITIDA (10-nov-2026, T-737). Con `areaPermitidaId` en la config, el Coordinador trabaja SOLO las tarjetas que
// cuelgan de esa tarjeta Área (por id, nunca por nombre), a cualquier profundidad (sub-áreas incluidas); con `tableroId`, además,
// solo las de ese tablero. Las demás no se tocan: ni planear, ni construir, ni subir, ni recoger errores, ni rescatar, ni revisar
// de nuevo. Sin las claves, todo sigue como antes.
//
// Se hace envolviendo el cliente del CRM (crm.mjs): las listas (/candidatas, /errores, /por-revisar) salen ya filtradas, y /tomar
// manda en `excluir` las que están fuera, así el CRM no las toma. El CRM manda en cada tarjeta `tableroId` y `ancestros` (los ids
// de sus madres, de la más cercana a la más lejana). Una tarjeta sin `ancestros` (un CRM viejo) cuenta como FUERA: con el área
// configurada, sin saber de dónde cuelga no se toca.
//
// SE MANDA AL CRM (24-nov-2026, parte 2 de «tomar todo lo de Features»): el id va en /candidatas (query), en /tomar (cuerpo) y
// en el latido, así el CRM filtra en la base (parte 1). Este filtro local queda de RESPALDO, por si el CRM es viejo.
// LAS YA EMPEZADAS SE TERMINAN: una de fuera con `intentos` > 0 (ya la tomó el Coordinador alguna vez) no se descarta ni se
// suelta, igual que en el CRM (dentroDelArea, sql-trabajador.ts). Una de fuera con `intentos` = 0 sí se descarta.
//   - /candidatas no manda `intentos`: ahí cuenta como empezada la que está en PLAN_APROBADO o SUBIENDO (solo se llega ahí
//     después de tomarla). Si igual era una sin empezar (un plan escrito a mano), /tomar la delata y se suelta.
//   - /tomar devuelve `intentos` YA SUMADO (la toma suma 1): empezada antes = `intentos` - 1 > 0.

/** El id del Área configurado (`areaPermitidaId`), o null. Lo usan crm.mjs (/candidatas y /tomar) y latido.mjs. */
export function areaPermitidaIdDe(config) {
  const id = typeof config?.areaPermitidaId === "string" ? config.areaPermitidaId.trim() : "";
  return id || null;
}

/** Estados a los que una tarjeta solo llega después de tomarla (para /candidatas, que no manda `intentos`). */
const ESTADOS_YA_EMPEZADOS = new Set(["PLAN_APROBADO", "SUBIENDO"]);

/** Ya la tomó el Coordinador alguna vez: `intentos` > 0 o, sin ese dato, un estado al que solo se llega trabajándola. */
export function yaEmpezada(tarjeta) {
  if (!tarjeta || typeof tarjeta !== "object") return false;
  if (typeof tarjeta.intentos === "number") return tarjeta.intentos > 0;
  return ESTADOS_YA_EMPEZADOS.has(tarjeta.estado);
}

/** La que acaba de devolver /tomar ya estaba empezada ANTES de esta toma (`intentos` llega con el 1 de la toma sumado). */
export function empezadaAntesDeTomar(respuesta) {
  const tarjeta = respuesta?.tarjeta;
  if (!tarjeta || typeof tarjeta !== "object") return false;
  if (typeof tarjeta.intentos === "number") return tarjeta.intentos - 1 > 0;
  // Un CRM sin `intentos`: construir o subir solo se hace con una que ya se planeó.
  return respuesta.hacer === "construir" || respuesta.hacer === "subir";
}

/**
 * El filtro de la config: { activo, permite(tarjeta), texto }. Sin `areaPermitidaId` ni `tableroId`, `activo` es false y permite todo.
 * `permite` deja pasar las del área y, con el área configurada, las de fuera ya empezadas (yaEmpezada). `delArea(tarjeta)` es solo
 * la parte del área, sin esa excepción.
 */
export function filtroDeArea(config) {
  const areaId = areaPermitidaIdDe(config);
  const tableroId = config?.tableroId ?? null;
  const activo = Boolean(areaId || tableroId);
  const enTablero = (tarjeta) => Boolean(tarjeta) && typeof tarjeta === "object" && (!tableroId || tarjeta.tableroId === tableroId);
  const delArea = (tarjeta) => {
    if (!activo) return true;
    if (!enTablero(tarjeta)) return false;
    if (!areaId) return true;
    return tarjeta.id === areaId || (Array.isArray(tarjeta.ancestros) && tarjeta.ancestros.includes(areaId));
  };
  // Fuera del área pero ya empezada: se termina (el tablero se sigue respetando).
  const permite = (tarjeta) => delArea(tarjeta) || (Boolean(areaId) && enTablero(tarjeta) && yaEmpezada(tarjeta));
  const texto = [areaId ? `el área ${areaId}` : null, tableroId ? `el tablero ${tableroId}` : null].filter(Boolean).join(" de ");
  return { activo, permite, delArea, enTablero, texto };
}

/**
 * El cliente del CRM que solo deja ver y tomar las tarjetas del área permitida. Sin el área en la config devuelve `crm` tal cual.
 *   - candidatas / errores / porRevisar: la misma respuesta, sin las de fuera.
 *   - tomar: mira las candidatas primero y suma a `excluir` las de fuera; si no queda ninguna de dentro, no llama a /tomar
 *     ({ tarjeta: null, motivo: "fuera_del_area" }). Si igual llega una de fuera SIN empezar (apareció entre las dos llamadas, o
 *     un CRM viejo), la suelta sin error, la recuerda para no volver a tomarla y contesta como si no hubiera nada. Una de fuera
 *     ya empezada (empezadaAntesDeTomar) se trabaja hasta el final.
 */
export function crmDelArea(crm, config, registro = null) {
  const filtro = filtroDeArea(config);
  if (!filtro.activo) return crm;
  let avisoSinAncestros = false;
  // Las de fuera sin empezar que ya se soltaron una vez: van siempre en `excluir` (así un CRM viejo no las da en cada vuelta).
  const soltadas = new Set();
  const avisarSiCrmViejo = (tarjetas) => {
    if (avisoSinAncestros || !areaPermitidaIdDe(config)) return;
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
      // Las soltadas se excluyen mientras sigan fuera del área: si el dueño la mueve a Features, se toma.
      const otraVez = candidatas.filter((tarjeta) => soltadas.has(tarjeta?.id) && !filtro.delArea(tarjeta)).map((tarjeta) => tarjeta.id);
      const excluir = [...new Set([...(opciones?.excluir ?? []), ...fuera.map((tarjeta) => tarjeta.id), ...otraVez])];
      if (!dentro.some((tarjeta) => !excluir.includes(tarjeta.id))) return { tarjeta: null, motivo: "fuera_del_area" };
      const respuesta = await crm.tomar({ ...opciones, excluir });
      if (!respuesta?.tarjeta || filtro.delArea(respuesta.tarjeta)) return respuesta;
      // De fuera pero ya empezada antes de esta toma: se termina.
      if (areaPermitidaIdDe(config) && filtro.enTablero(respuesta.tarjeta) && empezadaAntesDeTomar(respuesta)) return respuesta;
      // Una de fuera sin empezar (apareció entre /candidatas y /tomar, o un CRM viejo): vuelve a la fila sin error y no se trabaja.
      soltadas.add(respuesta.tarjeta.id);
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
