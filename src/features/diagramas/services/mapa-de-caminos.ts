import type { Edge, Node } from "@xyflow/react";

/**
 * El mapa de los caminos que toman los clientes.
 *
 * Un chat suelto dibujado tal cual son cuarenta cajas ilegibles que no se pueden comparar con
 * ningun otro chat. Lo que sirve es al reves: resumir cada conversacion en unos pocos PASOS y
 * fundirlos todos en un mismo arbol, de modo que dos clientes que preguntaron el precio compartan
 * esa caja. Con treinta chats encima se lee solo: 24 preguntan precio, 18 de esos piden envio, 3
 * compran. Ahi estan los caminos, y sobre todo se ve donde se caen.
 *
 * Por eso el paso que devuelve la IA tiene que ser CORTO y generico ("Pregunta precio"), no la
 * frase del cliente: si cada uno trae su redaccion, nada se funde con nada y el mapa vuelve a ser
 * una lista de conversaciones sueltas.
 */

export type QuienHabla = "cliente" | "nosotros";

export type PasoDelChat = {
  quien: QuienHabla;
  paso: string;
};

/** El humano es el cliente y el robot somos nosotros, como los pidio Alex. */
const ICONO_POR_QUIEN: Record<QuienHabla, string> = {
  cliente: "🧑",
  nosotros: "🤖",
};

/** El color separa de un vistazo quien habla, sin tener que leer el icono. */
const COLOR_POR_QUIEN: Record<QuienHabla, string> = {
  cliente: "azul",
  nosotros: "neutro",
};

const RAIZ = "camino-inicio";

/**
 * Los mensajes del chat, tal cual, listos para el mapa.
 *
 * Un intento anterior resumia cada conversacion con IA en pasos genericos ("Pregunta precio").
 * Alex lo probo y pidio lo contrario: quiere leer LO QUE SE HABLO, mensaje por mensaje. Y eso trae
 * de regalo que no haga falta IA: no cuesta plata, no tarda y no puede equivocarse.
 *
 * El cruce entre chats sigue existiendo donde de verdad existe: los mensajes NUESTROS son
 * guionados y salen identicos en todas las conversaciones, asi que la bienvenida y el guion arman
 * el tronco comun. Lo que escribe cada cliente casi nunca coincide, y por eso las ramas se abren
 * justo donde cada uno agarro para su lado, que es lo que se quiere ver.
 */

/** Lo que se muestra cuando el mensaje es un archivo y no texto. */
const ETIQUETA_POR_TIPO: Record<string, string> = {
  IMAGE: "\ud83d\udcf7 Foto",
  VIDEO: "\ud83c\udfa5 Video",
  AUDIO: "\ud83c\udfa4 Audio",
  DOCUMENT: "\ud83d\udcc4 Documento",
  STICKER: "\ud83d\ude42 Sticker",
  LOCATION: "\ud83d\udccd Ubicacion",
  CONTACTS: "\ud83d\udc64 Contacto",
};

/*
  El texto va COMPLETO.

  Antes se cortaba a 180 caracteres para que la caja no creciera. Pero el mapa existe justamente
  para LEER lo que se hablo: cortado a la mitad obliga a ir a buscar el chat, que es lo que uno
  queria evitar. Las cajas quedan mas grandes y esta bien; el ancho y la separacion se ajustaron
  para eso.
*/

export type MensajeDelChat = {
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
  type: string | null;
};

/*
  La firma se saca del texto.

  Los mensajes que escriben las asesoras a mano salen firmados ("...*Ingrid Sanchez* ..."), y
  dejandola pegada el MISMO mensaje escrito por dos personas distintas queda como dos cajas
  distintas: el tronco comun se partiria al medio por quien lo mando.
*/
const FIRMA_AL_PRINCIPIO = /^[^\p{L}\p{N}]*\*[^*]+\*\s*/u;

export function pasosLiteralesDelChat(mensajes: MensajeDelChat[]): PasoDelChat[] {
  const pasos: PasoDelChat[] = [];

  for (const mensaje of mensajes) {
    const quien: QuienHabla = mensaje.direction === "INBOUND" ? "cliente" : "nosotros";
    const texto0 = (mensaje.content ?? "").trim().replace(FIRMA_AL_PRINCIPIO, "").trim();
    let texto = texto0;

    if (!texto) {
      texto = ETIQUETA_POR_TIPO[(mensaje.type ?? "").toUpperCase()] ?? "";
      if (!texto) {
        // Un mensaje sin texto y sin tipo conocido no aporta nada al mapa.
        continue;
      }
    }


    // Dos mensajes seguidos IDENTICOS del mismo lado son el mismo momento repetido.
    const anterior = pasos[pasos.length - 1];
    if (anterior && anterior.quien === quien && anterior.paso === texto) {
      continue;
    }

    pasos.push({ quien, paso: texto });
  }

  return pasos;
}

/** La llave con la que dos pasos se consideran EL MISMO. Sin tildes, sin mayusculas, sin puntos. */
export function llaveDePaso(quien: QuienHabla, paso: string): string {
  const limpio = paso
    .toLowerCase()
    .normalize("NFD")
    // Las tildes se sacan por su rango unicode y no escribiendolas: un acento suelto en el codigo
    // fuente es invisible y se pierde en cualquier copiado.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${quien}:${limpio}`;
}

type DatosDeNodo = {
  texto: string;
  icono: string;
  color: string;
  /** Lo que dice el paso, sin el contador. Es la llave del cruce y NO se toca al editar a mano. */
  paso: string;
  quien: QuienHabla;
  veces: number;
};

function textoDeNodo(paso: string, veces: number): string {
  // El contador va en negrita y en su propio renglon: es el dato que se busca al mirar el mapa.
  return veces > 1 ? `${paso}\n**${veces} clientes**` : paso;
}

function leerDatos(nodo: Node): DatosDeNodo | null {
  const datos = nodo.data as Partial<DatosDeNodo> | undefined;
  if (!datos || typeof datos.paso !== "string") {
    return null;
  }
  return {
    texto: typeof datos.texto === "string" ? datos.texto : datos.paso,
    icono: typeof datos.icono === "string" ? datos.icono : "",
    color: typeof datos.color === "string" ? datos.color : "neutro",
    paso: datos.paso,
    quien: datos.quien === "cliente" ? "cliente" : "nosotros",
    veces: typeof datos.veces === "number" ? datos.veces : 1,
  };
}

/**
 * Mete un chat en el mapa.
 *
 * Se recorre el arbol desde la raiz siguiendo los pasos: si desde donde estoy ya sale una caja con
 * ESE mismo paso, se le suma uno al contador y se sigue por ahi; si no sale, se crea. Asi los
 * caminos compartidos se apilan y las diferencias se abren en ramas.
 *
 * Respeta lo que haya editado una persona: el cruce se hace por `paso` (que no se toca al escribir
 * en la caja) y solo se reescribe el `texto` de las cajas que este recorrido tocó.
 */
/** Si desde `desde` se puede llegar a `hasta` siguiendo las flechas. */
function alcanza(aristas: Edge[], desde: string, hasta: string): boolean {
  if (desde === hasta) {
    return true;
  }
  const pendientes = [desde];
  const vistos = new Set<string>([desde]);
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    for (const arista of aristas) {
      if (arista.source !== actual || vistos.has(arista.target)) {
        continue;
      }
      if (arista.target === hasta) {
        return true;
      }
      vistos.add(arista.target);
      pendientes.push(arista.target);
    }
  }
  return false;
}

export function fundirChatEnMapa(input: {
  nodos: Node[];
  aristas: Edge[];
  pasos: PasoDelChat[];
}): { nodos: Node[]; aristas: Edge[] } {
  const nodos = input.nodos.map((nodo) => ({ ...nodo }));
  const aristas = input.aristas.map((arista) => ({ ...arista }));

  // La raiz existe siempre: es el "todos los chats empiezan aca" que hace que el mapa sea UN arbol
  // y no un monton de cadenas sueltas.
  let raiz = nodos.find((nodo) => nodo.id === RAIZ);
  if (!raiz) {
    raiz = {
      id: RAIZ,
      type: "idea",
      position: { x: 0, y: 0 },
      style: { width: ANCHO_DE_CAJA },
      data: {
        texto: "Empieza la conversación",
        icono: "🎯",
        color: "verde",
        paso: "__inicio__",
        quien: "nosotros",
        veces: 0,
      } satisfies DatosDeNodo,
    };
    nodos.push(raiz);
  }
  const datosRaiz = leerDatos(raiz);
  if (datosRaiz) {
    raiz.data = { ...datosRaiz, veces: datosRaiz.veces + 1, texto: "Empieza la conversación" };
  }

  let actual = RAIZ;
  const pisadosEnEsteChat = new Set<string>([RAIZ]);

  for (const paso of input.pasos) {
    const llave = llaveDePaso(paso.quien, paso.paso);

    const existente = nodos.find((nodo) => {
      if (pisadosEnEsteChat.has(nodo.id)) {
        return false;
      }
      const datos = leerDatos(nodo);
      if (!datos || llaveDePaso(datos.quien, datos.paso) !== llave) {
        return false;
      }
      /*
        No se une si eso cerraria un circulo.

        Pasa cuando un chat llega a una frase que OTRO chat ya habia dicho antes en su recorrido:
        la flecha volveria hacia atras y el mapa dejaria de leerse de arriba hacia abajo. Medido:
        4 de 76 flechas quedaban apuntando para arriba. En ese caso se prefiere una caja repetida
        antes que un mapa con vueltas.
      */
      return !alcanza(aristas, nodo.id, actual);
    });

    if (existente) {
      const datos = leerDatos(existente)!;
      const veces = datos.veces + 1;
      existente.data = { ...datos, veces, texto: textoDeNodo(datos.paso, veces) };

      const idUnion = `union-${actual}-${existente.id}`;
      if (!aristas.some((arista) => arista.id === idUnion)) {
        aristas.push({ id: idUnion, source: actual, target: existente.id, type: "borrable" });
      }
      actual = existente.id;
      pisadosEnEsteChat.add(existente.id);
      continue;
    }


    const id = `camino-${llave.replace(/[^a-z0-9]/g, "-")}-${nodos.length}`;
    nodos.push({
      id,
      type: "idea",
      position: { x: 0, y: 0 },
      style: { width: ANCHO_DE_CAJA },
      data: {
        texto: textoDeNodo(paso.paso, 1),
        icono: ICONO_POR_QUIEN[paso.quien],
        color: COLOR_POR_QUIEN[paso.quien],
        paso: paso.paso,
        quien: paso.quien,
        veces: 1,
      } satisfies DatosDeNodo,
    });
    aristas.push({
      id: `union-${actual}-${id}`,
      source: actual,
      target: id,
      type: "borrable",
    });
    actual = id;
    pisadosEnEsteChat.add(id);
  }

  return { nodos: acomodar(nodos, aristas), aristas };
}

/*
  El mapa avanza de IZQUIERDA a DERECHA, como se lee.

  Iba de arriba hacia abajo y con el texto completo se volvia una columna larguisima: para seguir
  una conversacion habia que scrollear sin parar, y las ramas quedaban una debajo de otra, lejos
  entre si. De costado, cada paso de la charla avanza a la derecha y las ramas se abren hacia
  arriba y hacia abajo, que es donde se ven de un vistazo.
*/
/** Cuanto avanza el mapa por cada paso de la conversacion. */
const PASO_HORIZONTAL = 340;
/** Cuanto se separan dos ramas. Generoso porque con el texto completo las cajas son altas. */
const SEPARACION_ENTRE_RAMAS = 190;
/** Ancho de cada caja. Mas ancha que antes porque ahora entra el mensaje entero. */
const ANCHO_DE_CAJA = 260;

/**
 * Acomoda el mapa por capas, de arriba hacia abajo.
 *
 * Esto ya no es un arbol: como la misma frase es una sola caja, a una caja pueden llegarle flechas
 * de varios chats distintos. El acomodado anterior recorria como arbol y dejaba 15 de 72 cajas
 * pisadas una encima de otra.
 *
 * Ahora la altura de cada caja es su camino MAS LARGO desde el inicio: asi una caja compartida
 * queda siempre por debajo de todas las que llegan a ella y las flechas van siempre hacia abajo.
 * Dentro de cada capa se ordenan por el promedio de donde estan sus padres, para que las lineas
 * queden cortas y no se crucen mas de lo necesario.
 *
 * Se reacomoda ENTERO en cada chat nuevo: al aparecer una rama, las que ya estaban tienen que
 * correrse o se pisan. Si alguien mueve una caja a mano, el proximo chat la vuelve a alinear —para
 * leer caminos, mandar el orden automatico es lo correcto—.
 */
function acomodar(nodos: Node[], aristas: Edge[]): Node[] {
  const porId = new Map(nodos.map((nodo) => [nodo.id, nodo]));
  const entrantes = new Map<string, string[]>();
  for (const arista of aristas) {
    if (!porId.has(arista.source) || !porId.has(arista.target)) {
      continue;
    }
    entrantes.set(arista.target, [...(entrantes.get(arista.target) ?? []), arista.source]);
  }

  /*
    Altura = camino mas largo desde el inicio.

    Se relaja de a pasadas en vez de recorrer en profundidad: con caminos que se vuelven a juntar,
    un recorrido en profundidad le pone a la caja compartida la altura del PRIMER chat que llego y
    despues las flechas de los otros apuntan para arriba. El tope de pasadas es la red de seguridad
    contra un circulo: no deberia haberlos, pero no puede colgar la pantalla si lo hay.
  */
  const altura = new Map<string, number>();
  for (const nodo of nodos) {
    altura.set(nodo.id, 0);
  }
  for (let pasada = 0; pasada < nodos.length; pasada += 1) {
    let cambio = false;
    for (const arista of aristas) {
      const desde = altura.get(arista.source);
      const hasta = altura.get(arista.target);
      if (desde === undefined || hasta === undefined) {
        continue;
      }
      if (hasta < desde + 1) {
        altura.set(arista.target, desde + 1);
        cambio = true;
      }
    }
    if (!cambio) {
      break;
    }
  }

  const capas = new Map<number, string[]>();
  for (const nodo of nodos) {
    const nivel = altura.get(nodo.id) ?? 0;
    capas.set(nivel, [...(capas.get(nivel) ?? []), nodo.id]);
  }

  const columna = new Map<string, number>();
  const niveles = [...capas.keys()].sort((a, b) => a - b);
  for (const nivel of niveles) {
    const ids = capas.get(nivel) ?? [];
    // Cada caja se pone donde estan sus padres; las de la primera capa, en el orden que vinieron.
    const conPeso = ids.map((id, indice) => {
      const padres = (entrantes.get(id) ?? [])
        .map((padre) => columna.get(padre))
        .filter((valor): valor is number => valor !== undefined);
      return {
        id,
        peso: padres.length > 0 ? padres.reduce((a, b) => a + b, 0) / padres.length : indice,
      };
    });
    conPeso.sort((a, b) => a.peso - b.peso);
    conPeso.forEach((item, indice) => columna.set(item.id, indice));
  }

  return nodos.map((nodo) => {
    const nivel = altura.get(nodo.id);
    const col = columna.get(nodo.id);
    if (nivel === undefined || col === undefined) {
      return nodo;
    }
    return {
      ...nodo,
      // Nivel = a la derecha (avanza la charla). Columna = arriba/abajo (se abren las ramas).
      position: { x: nivel * PASO_HORIZONTAL, y: col * SEPARACION_ENTRE_RAMAS },
    };
  });
}
