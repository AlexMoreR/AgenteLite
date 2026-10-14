/**
 * EL MAPA DEL LIBRO DE REGLAS: el libro convertido en cajas y flechas, para MIRAR.
 *
 * Alex lo pidió para ver de un vistazo cómo está cableado el bot (13-oct-2026): qué regla vive en
 * qué paso, a qué paso lleva, qué producto activa, qué flujo manda y dónde avisa a una asesora.
 * No edita nada: el libro se sigue dictando hablando con Claude.
 *
 * Todo el acomodo es DETERMINISTA (carriles y grilla, sin física): el mismo libro dibuja siempre el
 * mismo mapa, así uno aprende dónde está cada cosa. Este archivo no sabe nada de React ni de la
 * librería del lienzo: devuelve datos planos y se prueba con `npm run test:v3-mapa`.
 */

import { PASOS_DEL_EMBUDO, normalizar, pesoDeLaRegla, type LibroDeReglas, type PasoDelEmbudo, type ReglaV3 } from "./reglas";

export type TipoDeDisparador = ReglaV3["cuando"]["tipo"];
export type CarrilId = PasoDelEmbudo | "CUALQUIERA";

export const NOMBRE_DEL_DISPARADOR: Record<TipoDeDisparador, string> = {
  frase: "Frase",
  intencion: "Intención",
  paso: "Paso",
  sin_respuesta: "Sin respuesta",
  siempre: "Siempre",
};

export const NOMBRE_DEL_CARRIL: Record<CarrilId, string> = {
  PRESENTACION: "Presentación",
  IDENTIFICACION: "Identificación",
  PRODUCTO: "Producto",
  OBJECIONES: "Objeciones",
  CIERRE: "Cierre",
  CUALQUIERA: "Sin paso / en cualquier momento",
};

export type Chip = { id: string; texto: string };

export type DatosRegla = {
  tipo: "regla";
  reglaId: string;
  nombre: string;
  disparador: TipoDeDisparador;
  resumen: string;
  chips: Chip[];
  prioridad: number;
  activa: boolean;
  carril: CarrilId;
};
export type DatosPaso = { tipo: "paso"; paso: PasoDelEmbudo; nombre: string; reglas: number };
export type DatosCarril = { tipo: "carril"; carril: CarrilId; nombre: string; ancho: number; alto: number };
export type DatosDestino = {
  tipo: "producto" | "flujo" | "asesora" | "pausa" | "entrada";
  nombre: string;
  reglas: number;
};
export type DatosNodo = DatosRegla | DatosPaso | DatosCarril | DatosDestino;

export type NodoMapa = { id: string; x: number; y: number; ancho: number; alto: number; datos: DatosNodo };
export type TipoDeArista = "paso" | "producto" | "flujo" | "asesora" | "pausa" | "entrada";
export type AristaMapa = { id: string; desde: string; hasta: string; tipo: TipoDeArista };

export type MapaDelLibro = {
  nodos: NodoMapa[];
  aristas: AristaMapa[];
  /** Los productos que aparecen en alguna regla visible, para los filtros. */
  productos: Chip[];
  totales: { reglas: number; visibles: number; inactivas: number };
};

export type OpcionesDelMapa = {
  nombresDeProductos?: Record<string, string>;
  titulosDeFlujos?: Record<string, string>;
  verInactivas?: boolean;
  /** Id de producto: deja solo las reglas que lo tocan. */
  producto?: string | null;
};

/* ------------------------------------------------------------------ medidas */

export const MEDIDAS = {
  reglaAncho: 230,
  reglaAlto: 78,
  separacion: 14,
  margenCarril: 18,
  separacionCarriles: 40,
  altoCabecera: 70,
  inicioReglas: 110,
  destinoAncho: 210,
  destinoAlto: 48,
  entradaAncho: 160,
} as const;

/** Columnas de un carril: crece con las reglas para que ninguno quede como una torre de 60 cajas. */
export function columnasDelCarril(cantidad: number): number {
  if (cantidad <= 6) return 1;
  return Math.min(4, Math.ceil(Math.sqrt(cantidad / 3)));
}

/* ------------------------------------------------------------------ lectura de una regla */

export const ID_ENTRADA = "entrada";
export const ID_ASESORA = "fin:asesora";
export const ID_PAUSA = "fin:pausa";
export const idDeRegla = (id: string) => `regla:${id}`;
export const idDePaso = (paso: PasoDelEmbudo) => `paso:${paso}`;
export const idDeProducto = (id: string) => `producto:${id}`;
export const idDeFlujo = (id: string) => `flujo:${id}`;
const idDeCarril = (carril: CarrilId) => `carril:${carril}`;

const ES_PASO = new Set<string>(PASOS_DEL_EMBUDO.map((p) => p.paso));

export function carrilDeLaRegla(regla: ReglaV3): CarrilId {
  const paso = regla.soloSi?.pasoActual ?? (regla.cuando.tipo === "paso" ? regla.cuando.paso : undefined);
  return paso && ES_PASO.has(paso) ? paso : "CUALQUIERA";
}

function recortar(texto: string, maximo: number) {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, maximo - 1).trimEnd()}…`;
}

/** "frase: precio, cuánto vale +12" — lo que cabe en la caja. */
export function resumenDelDisparador(regla: ReglaV3, nombresDeProductos: Record<string, string> = {}): string {
  const cuando = regla.cuando;
  switch (cuando.tipo) {
    case "frase": {
      const frases = cuando.frases ?? [];
      const primeras = frases.slice(0, 2).join(", ");
      const resto = frases.length > 2 ? ` +${frases.length - 2}` : "";
      return `frase${cuando.exacta ? " exacta" : ""}: ${recortar(primeras, 46)}${resto}`;
    }
    case "intencion":
      return `intención: ${recortar(cuando.descripcion ?? "", 56)}`;
    case "paso":
      return `paso: ${NOMBRE_DEL_CARRIL[cuando.paso] ?? cuando.paso} · ${recortar(nombresDeProductos[cuando.producto] ?? cuando.producto, 24)}`;
    case "sin_respuesta":
      return `sin respuesta: ${cuando.minutos} min`;
    default:
      return "siempre";
  }
}

/** Los productos que una regla toca: el que exige, el de su disparador y los que activa. */
export function productosDeLaRegla(regla: ReglaV3): string[] {
  const ids = new Set<string>();
  const activo = regla.soloSi?.productoActivo;
  if (activo && activo !== "ninguno" && activo !== "cualquiera") ids.add(activo);
  if (regla.cuando.tipo === "paso" && regla.cuando.producto) ids.add(regla.cuando.producto);
  for (const accion of regla.entonces ?? []) {
    if (accion.tipo === "activar_producto" && accion.productoId) ids.add(accion.productoId);
  }
  return [...ids];
}

function chipsDeLaRegla(regla: ReglaV3, nombres: Record<string, string>): Chip[] {
  const chips: Chip[] = [];
  const activo = regla.soloSi?.productoActivo;
  if (activo === "ninguno") chips.push({ id: "ninguno", texto: "sin producto" });
  else if (activo === "cualquiera") chips.push({ id: "cualquiera", texto: "con producto" });
  else if (activo) chips.push({ id: activo, texto: nombres[activo] ?? "producto" });
  if (regla.cuando.tipo === "paso" && regla.cuando.producto && regla.cuando.producto !== activo) {
    chips.push({ id: regla.cuando.producto, texto: nombres[regla.cuando.producto] ?? "producto" });
  }
  if (regla.soloSi?.esPrimerMensaje === true) chips.push({ id: "primer", texto: "1er mensaje" });
  return chips;
}

/** ¿La regla tiene algo que ver con lo que se busca? Nombre, frases, descripción y textos. */
export function coincideConLaBusqueda(regla: ReglaV3, busqueda: string): boolean {
  const buscado = normalizar(busqueda);
  if (!buscado) return false;
  const partes: string[] = [regla.nombre];
  if (regla.cuando.tipo === "frase") partes.push(...(regla.cuando.frases ?? []));
  if (regla.cuando.tipo === "intencion") partes.push(regla.cuando.descripcion ?? "");
  for (const accion of regla.entonces ?? []) {
    if (accion.tipo === "mensaje") partes.push(accion.texto ?? "");
    if (accion.tipo === "responder_con_ia") partes.push(accion.guia ?? "");
    if (accion.tipo === "flujo") partes.push(accion.titulo ?? "");
    if (accion.tipo === "avisar_asesor") partes.push(accion.motivo ?? "");
    if (accion.tipo === "activar_producto") partes.push(accion.nombre ?? "");
  }
  return partes.some((parte) => normalizar(parte).includes(buscado));
}

/** Prioridad real (1 = la que manda primero), igual que el orden de la vista de lista. */
export function prioridades(libro: LibroDeReglas): Map<string, number> {
  const orden = libro.reglas
    .map((regla, indice) => ({ regla, indice }))
    .sort((a, b) => pesoDeLaRegla(a.regla) - pesoDeLaRegla(b.regla) || a.indice - b.indice);
  return new Map(orden.map(({ regla }, posicion) => [regla.id, posicion + 1]));
}

/* ------------------------------------------------------------------ el mapa */

export function construirMapa(libro: LibroDeReglas, opciones: OpcionesDelMapa = {}): MapaDelLibro {
  const nombresDeProductos = opciones.nombresDeProductos ?? {};
  const titulos = opciones.titulosDeFlujos ?? {};
  const prioridad = prioridades(libro);

  // Los nombres que traen las propias acciones sirven de respaldo si el producto ya no está en la base.
  const nombres: Record<string, string> = {};
  for (const regla of libro.reglas) {
    for (const accion of regla.entonces ?? []) {
      if (accion.tipo === "activar_producto" && accion.nombre) nombres[accion.productoId] = accion.nombre;
    }
  }
  Object.assign(nombres, nombresDeProductos);

  const inactivas = libro.reglas.filter((regla) => !regla.activa).length;
  const porEstado = libro.reglas.filter((regla) => regla.activa || opciones.verInactivas);

  const productosVisibles = new Map<string, number>();
  for (const regla of porEstado) {
    for (const id of productosDeLaRegla(regla)) productosVisibles.set(id, (productosVisibles.get(id) ?? 0) + 1);
  }

  const visibles = opciones.producto
    ? porEstado.filter((regla) => productosDeLaRegla(regla).includes(opciones.producto as string))
    : porEstado;

  const ordenadas = [...visibles].sort((a, b) => (prioridad.get(a.id) ?? 0) - (prioridad.get(b.id) ?? 0));

  const carriles: CarrilId[] = [...PASOS_DEL_EMBUDO.map((p) => p.paso), "CUALQUIERA"];
  const porCarril = new Map<CarrilId, ReglaV3[]>(carriles.map((c) => [c, []]));
  for (const regla of ordenadas) porCarril.get(carrilDeLaRegla(regla))!.push(regla);

  const nodos: NodoMapa[] = [];
  const aristas: AristaMapa[] = [];
  const M = MEDIDAS;

  // Entrada a la izquierda de todo.
  let x = 0;
  const hayPrimerMensaje = ordenadas.some((regla) => regla.soloSi?.esPrimerMensaje === true);
  const reglasDeEntrada = ordenadas.filter((regla) => regla.soloSi?.esPrimerMensaje === true).length;
  if (hayPrimerMensaje) {
    nodos.push({
      id: ID_ENTRADA,
      x,
      y: M.inicioReglas,
      ancho: M.entradaAncho,
      alto: M.destinoAlto,
      datos: { tipo: "entrada", nombre: "Primer mensaje", reglas: reglasDeEntrada },
    });
    x += M.entradaAncho + M.separacionCarriles * 2;
  }

  let altoMaximo = 0;
  for (const carril of carriles) {
    const reglas = porCarril.get(carril)!;
    const columnas = columnasDelCarril(reglas.length);
    const ancho = columnas * M.reglaAncho + (columnas - 1) * M.separacion + M.margenCarril * 2;
    const filas = Math.max(1, Math.ceil(reglas.length / columnas));
    const alto = M.inicioReglas + filas * (M.reglaAlto + M.separacion) + M.margenCarril;
    altoMaximo = Math.max(altoMaximo, alto);

    nodos.push({
      id: idDeCarril(carril),
      x,
      y: 0,
      ancho,
      alto,
      datos: { tipo: "carril", carril, nombre: NOMBRE_DEL_CARRIL[carril], ancho, alto },
    });

    if (carril !== "CUALQUIERA") {
      nodos.push({
        id: idDePaso(carril),
        x: x + M.margenCarril,
        y: M.margenCarril,
        ancho: ancho - M.margenCarril * 2,
        alto: M.altoCabecera - M.margenCarril,
        datos: { tipo: "paso", paso: carril, nombre: NOMBRE_DEL_CARRIL[carril], reglas: reglas.length },
      });
    }

    reglas.forEach((regla, indice) => {
      const columna = indice % columnas;
      const fila = Math.floor(indice / columnas);
      nodos.push({
        id: idDeRegla(regla.id),
        x: x + M.margenCarril + columna * (M.reglaAncho + M.separacion),
        y: M.inicioReglas + fila * (M.reglaAlto + M.separacion),
        ancho: M.reglaAncho,
        alto: M.reglaAlto,
        datos: {
          tipo: "regla",
          reglaId: regla.id,
          nombre: regla.nombre,
          disparador: regla.cuando.tipo,
          resumen: resumenDelDisparador(regla, nombres),
          chips: chipsDeLaRegla(regla, nombres),
          prioridad: prioridad.get(regla.id) ?? 0,
          activa: regla.activa,
          carril,
        },
      });
    });

    x += ancho + M.separacionCarriles;
  }
  // Las alturas de todos los carriles se igualan: se lee como una tabla.
  for (const nodo of nodos) {
    if (nodo.datos.tipo === "carril") {
      nodo.alto = altoMaximo;
      nodo.datos.alto = altoMaximo;
    }
  }

  // Destinos: productos, flujos y los dos finales, en columnas a la derecha.
  const productos = new Map<string, number>();
  const flujos = new Map<string, { titulo: string; reglas: number }>();
  let asesora = 0;
  let pausa = 0;
  const vistas = new Set<string>();
  const agregarArista = (desde: string, hasta: string, tipo: TipoDeArista) => {
    const id = `${desde}->${hasta}`;
    if (vistas.has(id)) return false;
    vistas.add(id);
    aristas.push({ id, desde, hasta, tipo });
    return true;
  };

  for (const regla of ordenadas) {
    const origen = idDeRegla(regla.id);
    if (regla.soloSi?.esPrimerMensaje === true) agregarArista(ID_ENTRADA, origen, "entrada");
    for (const accion of regla.entonces ?? []) {
      if (accion.tipo === "ir_al_paso" && ES_PASO.has(accion.paso)) {
        agregarArista(origen, idDePaso(accion.paso), "paso");
      } else if (accion.tipo === "activar_producto" && accion.productoId) {
        if (agregarArista(origen, idDeProducto(accion.productoId), "producto")) {
          productos.set(accion.productoId, (productos.get(accion.productoId) ?? 0) + 1);
        }
      } else if (accion.tipo === "flujo" && accion.flujoId) {
        if (agregarArista(origen, idDeFlujo(accion.flujoId), "flujo")) {
          const titulo = titulos[accion.flujoId] ?? accion.titulo ?? "Flujo sin nombre";
          flujos.set(accion.flujoId, { titulo, reglas: (flujos.get(accion.flujoId)?.reglas ?? 0) + 1 });
        }
      } else if (accion.tipo === "avisar_asesor") {
        if (agregarArista(origen, ID_ASESORA, "asesora")) asesora += 1;
      } else if (accion.tipo === "pausar_ia") {
        if (agregarArista(origen, ID_PAUSA, "pausa")) pausa += 1;
      }
    }
  }

  const columnaDestinos = (inicioX: number, items: { id: string; datos: DatosDestino }[]) => {
    items.forEach((item, indice) => {
      nodos.push({
        id: item.id,
        x: inicioX,
        y: M.inicioReglas + indice * (M.destinoAlto + M.separacion * 2),
        ancho: M.destinoAncho,
        alto: M.destinoAlto,
        datos: item.datos,
      });
    });
    return items.length > 0 ? inicioX + M.destinoAncho + M.separacionCarriles * 2 : inicioX;
  };

  x += M.separacionCarriles;
  x = columnaDestinos(
    x,
    [...productos.entries()]
      .map(([id, reglas]) => ({ id: idDeProducto(id), datos: { tipo: "producto" as const, nombre: nombres[id] ?? "Producto", reglas } }))
      .sort((a, b) => a.datos.nombre.localeCompare(b.datos.nombre, "es")),
  );
  x = columnaDestinos(
    x,
    [...flujos.entries()]
      .map(([id, flujo]) => ({ id: idDeFlujo(id), datos: { tipo: "flujo" as const, nombre: flujo.titulo, reglas: flujo.reglas } }))
      .sort((a, b) => a.datos.nombre.localeCompare(b.datos.nombre, "es")),
  );
  const finales: { id: string; datos: DatosDestino }[] = [];
  if (asesora) finales.push({ id: ID_ASESORA, datos: { tipo: "asesora", nombre: "Avisa asesora", reglas: asesora } });
  if (pausa) finales.push({ id: ID_PAUSA, datos: { tipo: "pausa", nombre: "Pausa IA", reglas: pausa } });
  columnaDestinos(x, finales);

  return {
    nodos,
    aristas,
    productos: [...productosVisibles.entries()]
      .map(([id]) => ({ id, texto: nombres[id] ?? "Producto" }))
      .sort((a, b) => a.texto.localeCompare(b.texto, "es")),
    totales: { reglas: libro.reglas.length, visibles: ordenadas.length, inactivas },
  };
}

/**
 * Lo que se ilumina al tocar un nodo: el nodo, sus vecinos directos y las flechas entre ellos.
 * Tocar un paso, un producto o un flujo muestra todas las reglas que llegan ahí.
 */
export function conectadosA(mapa: Pick<MapaDelLibro, "aristas">, nodoId: string): { nodos: Set<string>; aristas: Set<string> } {
  const nodos = new Set<string>([nodoId]);
  const aristas = new Set<string>();
  for (const arista of mapa.aristas) {
    if (arista.desde === nodoId || arista.hasta === nodoId) {
      aristas.add(arista.id);
      nodos.add(arista.desde);
      nodos.add(arista.hasta);
    }
  }
  return { nodos, aristas };
}

/** Lo que se ilumina con la búsqueda: las reglas que coinciden y todo lo que sale de ellas. */
export function resaltarBusqueda(
  libro: LibroDeReglas,
  mapa: Pick<MapaDelLibro, "aristas" | "nodos">,
  busqueda: string,
): { nodos: Set<string>; aristas: Set<string> } | null {
  if (!normalizar(busqueda)) return null;
  const enElMapa = new Set(mapa.nodos.map((nodo) => nodo.id));
  const nodos = new Set<string>();
  const aristas = new Set<string>();
  for (const regla of libro.reglas) {
    const id = idDeRegla(regla.id);
    if (!enElMapa.has(id) || !coincideConLaBusqueda(regla, busqueda)) continue;
    const vecinos = conectadosA(mapa, id);
    vecinos.nodos.forEach((n) => nodos.add(n));
    vecinos.aristas.forEach((a) => aristas.add(a));
  }
  return { nodos, aristas };
}
