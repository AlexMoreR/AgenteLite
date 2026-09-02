/**
 * Sacar del chat los datos que hacen falta para cotizar.
 *
 * Cuando el cliente decide comprar, los datos ya estan escritos en la conversacion: dijo su
 * nombre, dicto la cedula, conto en que ciudad esta. Igual alguien los vuelve a tipear a mano en
 * la cotizacion, releyendo el chat hacia arriba para encontrarlos. Eso es lo que se automatiza.
 *
 * Nada de lo que sale de aca se guarda solo: se PROPONE, y una persona lo acepta. Una direccion
 * mal leida no es un error de pantalla, es un mueble que llega a la casa equivocada.
 *
 * Se busca en dos pasadas, de la barata a la cara:
 *   1. Reglas, gratis: la cedula y el NIT tienen forma fija, y las ciudades son una lista.
 *   2. IA, una sola llamada: para nombre completo, direccion y productos, que son texto libre y
 *      ninguna expresion regular los agarra.
 * A la IA solo se le pregunta por lo que las reglas NO encontraron.
 */

export const CAMPOS_DE_FICHA = [
  { clave: "fullName", etiqueta: "Nombre completo", ejemplo: "Como va en la factura" },
  { clave: "document", etiqueta: "NIT / Cédula", ejemplo: "Sin puntos" },
  { clave: "email", etiqueta: "Correo electrónico", ejemplo: "Para enviar la factura" },
  { clave: "city", etiqueta: "Ciudad", ejemplo: "Para el envío" },
  { clave: "department", etiqueta: "Departamento", ejemplo: "Valle del Cauca, Antioquia…" },
  { clave: "address", etiqueta: "Dirección", ejemplo: "Calle, número, barrio" },
  { clave: "products", etiqueta: "Productos", ejemplo: "Qué pidió y cuántos" },
] as const;

export type CampoDeFicha = (typeof CAMPOS_DE_FICHA)[number]["clave"];

export type FichaDeCotizacion = Record<CampoDeFicha, string>;

/** Un dato encontrado en el chat, con la prueba de donde salio. */
export type DatoHallado = {
  valor: string;
  /** La frase textual del cliente. Es lo que deja verificar el dato sin releer el chat entero. */
  frase: string;
  fecha: string | null;
  /** "reglas" = lo saco una expresion regular; "ia" = lo leyo la IA. */
  como: "reglas" | "ia";
};

export type Sugerencias = Partial<Record<CampoDeFicha, DatoHallado>>;

export type TurnoDelChat = {
  direction: "INBOUND" | "OUTBOUND";
  content: string | null;
  type: string;
  createdAt: Date;
};

export function fichaVacia(): FichaDeCotizacion {
  return {
    fullName: "",
    document: "",
    email: "",
    city: "",
    department: "",
    address: "",
    products: "",
  };
}

/* ------------------------------------------------------------------ reglas */

/**
 * Las ciudades que aparecen en los chats.
 *
 * Es una lista y no "cualquier palabra con mayuscula" porque los envios van a un punado de
 * ciudades, y una lista no confunde un apellido con un destino. Si el cliente nombra un pueblo
 * que no esta aca, la casilla queda vacia y la escriben a mano: es el mismo trabajo de hoy, no
 * uno peor.
 */
const CIUDADES = [
  "Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Cúcuta", "Bucaramanga", "Pereira",
  "Santa Marta", "Ibagué", "Manizales", "Villavicencio", "Pasto", "Montería", "Neiva", "Armenia",
  "Popayán", "Sincelejo", "Valledupar", "Riohacha", "Tunja", "Florencia", "Quibdó", "Yopal",
  "Mocoa", "San Andrés", "Leticia", "Arauca", "Inírida", "Mitú", "Puerto Carreño",
  "San José del Guaviare", "Soacha", "Bello", "Itagüí", "Envigado", "Rionegro", "Palmira",
  "Buenaventura", "Tuluá", "Soledad", "Malambo", "Girón", "Floridablanca", "Piedecuesta",
  "Barrancabermeja", "Duitama", "Sogamoso", "Zipaquirá", "Chía", "Facatativá", "Fusagasugá",
  "Girardot", "Mosquera", "Funza", "Cajicá", "Tocancipá", "Apartadó", "Turbo", "Caucasia",
  "Sabaneta", "Copacabana", "La Estrella", "Dosquebradas", "Cartago", "Buga", "Jamundí", "Yumbo",
  "Candelaria", "Espinal", "Melgar", "Ocaña", "Aguachica", "Magangué", "Turbaco", "Maicao",
  "Ciénaga", "Fundación", "Sahagún", "Lorica", "Cereté", "Planeta Rica", "Corozal", "Tumaco",
  "Ipiales", "Pitalito", "Garzón", "La Dorada", "Chiquinquirá", "Acacías",
];

/**
 * Sin tildes y en minuscula: nadie escribe "Medellín" con tilde en WhatsApp.
 *
 * Se cambian las letras una por una en vez de normalizar a NFD y borrar los acentos sueltos: son
 * las cinco vocales y la enie, y un mapa explicito se lee y se corrige, mientras que el rango de
 * marcas combinantes es un renglon de caracteres invisibles que cualquier editor puede comerse.
 */
const SIN_TILDE: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n",
  Á: "a", É: "e", Í: "i", Ó: "o", Ú: "u", Ü: "u", Ñ: "n",
};

function plano(texto: string): string {
  return texto.toLowerCase().replace(/[áéíóúüñ]/g, (letra) => SIN_TILDE[letra] ?? letra);
}

const CIUDADES_PLANAS = CIUDADES.map((ciudad) => ({ ciudad, plana: plano(ciudad) }));

/**
 * Un numero de documento dicho con una palabra que lo anuncia.
 *
 * Se exige la palabra ("cc", "nit", "cedula"...) porque en un chat de ventas vuelan numeros
 * sueltos —precios, medidas, cantidades— y agarrar cualquiera de 8 cifras llenaria la casilla con
 * basura. El caso del numero solo, sin palabra, se trata aparte y con mas cuidado.
 */
const PATRON_DOCUMENTO =
  /\b(?:c\.?\s?c\.?|cedula|cédula|nit|documento|identificacion|identificación|rut)\b[^\d]{0,12}(\d[\d.\s,-]{4,17}\d)/i;

/** Un celular colombiano: 10 cifras que arrancan en 3. Nunca es una cedula. */
function pareceTelefono(digitos: string): boolean {
  return /^3\d{9}$/.test(digitos);
}

function limpiarDocumento(crudo: string): string {
  // El digito de verificacion del NIT se conserva (900123456-7): va en la factura.
  const sinEspacios = crudo.trim().replace(/[.\s,]/g, "");
  const partes = sinEspacios.split("-");
  const base = partes[0].replace(/\D/g, "");
  const dv = partes.length > 1 ? partes[1].replace(/\D/g, "").slice(0, 1) : "";
  return dv ? `${base}-${dv}` : base;
}

function recortar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().slice(0, 160);
}

function buscarDocumento(turnos: TurnoDelChat[]): DatoHallado | null {
  // Se recorre del final hacia atras: si el cliente corrigio su cedula, vale la ultima.
  for (const turno of [...turnos].reverse()) {
    const texto = (turno.content ?? "").trim();
    if (!texto) {
      continue;
    }

    const conPalabra = PATRON_DOCUMENTO.exec(texto);
    if (conPalabra) {
      const valor = limpiarDocumento(conPalabra[1]);
      const digitos = valor.replace(/\D/g, "");
      if (digitos.length >= 6 && digitos.length <= 11) {
        return {
          valor,
          frase: recortar(texto),
          fecha: turno.createdAt.toISOString(),
          como: "reglas",
        };
      }
    }

    /*
      Un mensaje que es SOLO el numero.

      Es el caso mas comun de todos: se le pide la cedula y el cliente manda "1020304050" y nada
      mas. Se acepta unicamente si el mensaje entero es ese numero —asi no se confunde con un
      precio dentro de una frase— y si no tiene pinta de celular.
    */
    const soloNumero = texto.replace(/[.\s,-]/g, "");
    if (/^\d{6,11}$/.test(soloNumero) && !pareceTelefono(soloNumero)) {
      return {
        valor: soloNumero,
        frase: recortar(texto),
        fecha: turno.createdAt.toISOString(),
        como: "reglas",
      };
    }
  }
  return null;
}

function buscarCiudad(turnos: TurnoDelChat[]): DatoHallado | null {
  for (const turno of [...turnos].reverse()) {
    const texto = (turno.content ?? "").trim();
    if (!texto) {
      continue;
    }
    const textoPlano = plano(texto);
    for (const { ciudad, plana } of CIUDADES_PLANAS) {
      // Con bordes de palabra: sin esto "Cali" salta dentro de "calidad" y "Chia" dentro de otra.
      const patron = new RegExp(
        `(^|[^a-z0-9])${plana.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
      );
      if (patron.test(textoPlano)) {
        return {
          valor: ciudad,
          frase: recortar(texto),
          fecha: turno.createdAt.toISOString(),
          como: "reglas",
        };
      }
    }
  }
  return null;
}

/*
  El correo tiene forma fija, asi que sale con una regla y no cuesta una llamada a la IA.

  Se busca en lo que escribio el CLIENTE, como todo lo demas: nuestras plantillas llevan el correo
  del negocio y sin ese filtro se propondria "ventas@magilus.com" como el correo de la clienta.
*/
const PATRON_CORREO = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function buscarCorreo(turnos: TurnoDelChat[]): DatoHallado | null {
  // Del final hacia atras: si lo corrigio, vale el ultimo que dicto.
  for (const turno of [...turnos].reverse()) {
    const texto = (turno.content ?? "").trim();
    if (!texto) {
      continue;
    }
    const hallado = PATRON_CORREO.exec(texto);
    if (hallado) {
      return {
        valor: hallado[0].toLowerCase(),
        frase: recortar(texto),
        fecha: turno.createdAt.toISOString(),
        como: "reglas",
      };
    }
  }
  return null;
}

/** Lo que se puede sacar sin gastar un peso. */
export function buscarPorReglas(turnos: TurnoDelChat[]): Sugerencias {
  // Solo lo que dijo EL CLIENTE: nuestra propia plantilla dice "envianos tu cedula" y contiene la
  // palabra, y las respuestas del bot nombran ciudades a las que despachamos.
  const delCliente = turnos.filter(
    (turno) => turno.direction === "INBOUND" && turno.type !== "SYSTEM",
  );
  const sugerencias: Sugerencias = {};

  const documento = buscarDocumento(delCliente);
  if (documento) {
    sugerencias.document = documento;
  }
  const ciudad = buscarCiudad(delCliente);
  if (ciudad) {
    sugerencias.city = ciudad;
  }
  const correo = buscarCorreo(delCliente);
  if (correo) {
    sugerencias.email = correo;
  }
  return sugerencias;
}

/* ---------------------------------------------------------------------- IA */

/**
 * La transcripcion que lee la IA.
 *
 * Se marca quien hablo porque importa muchisimo: el nombre y la direccion valen si los dijo el
 * CLIENTE. Nuestra propia bodega tiene direccion y aparece escrita en el chat; sin saber quien
 * dijo cada cosa, la IA la copiaria como direccion de entrega.
 */
export function armarTranscripcion(turnos: TurnoDelChat[]): string {
  return turnos
    .filter((turno) => turno.type !== "SYSTEM" && (turno.content ?? "").trim())
    .slice(-40)
    .map((turno) => {
      const quien = turno.direction === "INBOUND" ? "CLIENTE" : "NOSOTROS";
      return `${quien}: ${(turno.content ?? "").replace(/\s+/g, " ").trim().slice(0, 300)}`;
    })
    .join("\n");
}

const SISTEMA = `Sos un asistente que lee una conversacion de WhatsApp entre un negocio de mobiliario para salones de belleza y un cliente, y extrae SOLO los datos que el CLIENTE dio para hacerle una cotizacion.

Devolves SOLO un JSON con estas claves:
- "fullName": el nombre y apellido del cliente, tal como lo dijo. Si solo dijo el nombre de pila, ponelo igual.
- "address": la direccion de entrega del cliente (calle, numero, barrio, conjunto, apartamento).
- "products": que productos pidio y cuantos, en una linea corta. Ej: "2 sillas de barberia negras, 1 lavacabezas".
- Y por cada uno, su frase: la frase TEXTUAL del cliente de donde lo sacaste, copiada tal cual, maximo 160 caracteres. Claves: "fraseFullName", "fraseAddress", "fraseProducts".

Reglas que no se rompen:
- Solo lo que dijo el CLIENTE. Las lineas que empiezan con NOSOTROS son nuestras: la direccion de nuestra bodega, nuestro nombre y los productos que le OFRECIMOS no cuentan.
- No adivines ni completes. Si el dato no esta, poné "" en el campo Y en su frase.
- La frase tiene que aparecer LITERAL en la conversacion. Si no la podes copiar textual, el dato no esta: poné "".
- No inventes direcciones a partir de una ciudad, ni apellidos a partir de un nombre.`;

type RespuestaIA = {
  fullName?: unknown;
  address?: unknown;
  department?: unknown;
  products?: unknown;
  fraseFullName?: unknown;
  fraseAddress?: unknown;
  fraseDepartment?: unknown;
  fraseProducts?: unknown;
};

/** Los campos de texto libre: los unicos que justifican pagar una llamada a la IA. */
const CAMPOS_DE_IA: CampoDeFicha[] = ["fullName", "address", "department", "products"];

export async function buscarConIA(input: {
  transcripcion: string;
  faltantes: CampoDeFicha[];
  model?: string;
}): Promise<Sugerencias> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const aBuscar = CAMPOS_DE_IA.filter((campo) => input.faltantes.includes(campo));
  if (!apiKey || !input.transcripcion.trim() || aBuscar.length === 0) {
    return {};
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: input.model?.trim() || "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: input.transcripcion },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`OpenAI respondio ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const crudo = payload.choices?.[0]?.message?.content?.trim();
  if (!crudo) {
    return {};
  }

  const datos = JSON.parse(crudo) as RespuestaIA;
  const texto = (valor: unknown, max: number) =>
    typeof valor === "string" ? valor.replace(/\s+/g, " ").trim().slice(0, max) : "";

  const leidos: Array<{ campo: CampoDeFicha; valor: string; frase: string }> = [
    {
      campo: "fullName",
      valor: texto(datos.fullName, 120),
      frase: texto(datos.fraseFullName, 160),
    },
    { campo: "address", valor: texto(datos.address, 200), frase: texto(datos.fraseAddress, 160) },
    {
      campo: "department",
      valor: texto(datos.department, 120),
      frase: texto(datos.fraseDepartment, 160),
    },
    {
      campo: "products",
      valor: texto(datos.products, 300),
      frase: texto(datos.fraseProducts, 160),
    },
  ];

  const sugerencias: Sugerencias = {};
  for (const item of leidos) {
    if (!aBuscar.includes(item.campo) || !item.valor) {
      continue;
    }
    /*
      Sin frase que respalde el dato, se descarta.

      Es la unica defensa barata contra la IA inventando: se le pide copiar la frase textual, y si
      no la copio es porque el dato no salio del chat. Ademas la frase es lo que hace verificable
      la sugerencia para quien la acepta de un toque.
    */
    if (!item.frase) {
      continue;
    }
    sugerencias[item.campo] = { valor: item.valor, frase: item.frase, fecha: null, como: "ia" };
  }
  return sugerencias;
}
