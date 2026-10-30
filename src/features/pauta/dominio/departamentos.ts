/**
 * DEPARTAMENTOS DE COLOMBIA (reglas puras, sin base ni red): los 32 departamentos más Bogotá D.C., con
 * una clave estable y su nombre para mostrar; qué ciudad o municipio cae en cada uno; cómo nombra Meta
 * cada región; y el departamento de un teléfono fijo cuando el indicativo lo dice.
 *
 * Lo usa el mapa de Colombia de la pauta (src/features/pauta/dominio/mapa.ts).
 * Este archivo no importa Prisma a propósito: se prueba con `node scripts/check-mapa-colombia.mjs`.
 */

export const DEPARTAMENTOS = [
  { clave: "amazonas", nombre: "Amazonas" },
  { clave: "antioquia", nombre: "Antioquia" },
  { clave: "arauca", nombre: "Arauca" },
  { clave: "atlantico", nombre: "Atlántico" },
  { clave: "bogota", nombre: "Bogotá D.C." },
  { clave: "bolivar", nombre: "Bolívar" },
  { clave: "boyaca", nombre: "Boyacá" },
  { clave: "caldas", nombre: "Caldas" },
  { clave: "caqueta", nombre: "Caquetá" },
  { clave: "casanare", nombre: "Casanare" },
  { clave: "cauca", nombre: "Cauca" },
  { clave: "cesar", nombre: "Cesar" },
  { clave: "choco", nombre: "Chocó" },
  { clave: "cordoba", nombre: "Córdoba" },
  { clave: "cundinamarca", nombre: "Cundinamarca" },
  { clave: "guainia", nombre: "Guainía" },
  { clave: "guaviare", nombre: "Guaviare" },
  { clave: "huila", nombre: "Huila" },
  { clave: "la-guajira", nombre: "La Guajira" },
  { clave: "magdalena", nombre: "Magdalena" },
  { clave: "meta", nombre: "Meta" },
  { clave: "narino", nombre: "Nariño" },
  { clave: "norte-de-santander", nombre: "Norte de Santander" },
  { clave: "putumayo", nombre: "Putumayo" },
  { clave: "quindio", nombre: "Quindío" },
  { clave: "risaralda", nombre: "Risaralda" },
  { clave: "san-andres", nombre: "San Andrés y Providencia" },
  { clave: "santander", nombre: "Santander" },
  { clave: "sucre", nombre: "Sucre" },
  { clave: "tolima", nombre: "Tolima" },
  { clave: "valle-del-cauca", nombre: "Valle del Cauca" },
  { clave: "vaupes", nombre: "Vaupés" },
  { clave: "vichada", nombre: "Vichada" },
] as const;

export type ClaveDepartamento = (typeof DEPARTAMENTOS)[number]["clave"];

const CLAVES = new Set<string>(DEPARTAMENTOS.map((d) => d.clave));

export function esClaveDepartamento(texto: unknown): texto is ClaveDepartamento {
  return typeof texto === "string" && CLAVES.has(texto);
}

export function nombreDelDepartamento(clave: ClaveDepartamento): string {
  return DEPARTAMENTOS.find((d) => d.clave === clave)?.nombre ?? clave;
}

/**
 * Limpia un texto antes de comparar: quita tildes (y la ñ queda n), pasa a minúsculas, quita las
 * palabras "departamento" y "department", y deja solo letras y números separados por un espacio.
 */
export function limpiarTexto(texto: string | null | undefined): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(departamento|department|depto|dpto)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Otras formas de escribir el departamento (además de su nombre), como las escribe la gente o Gestión. */
const OTROS_NOMBRES: Partial<Record<ClaveDepartamento, string[]>> = {
  bogota: ["Bogotá", "Bogota DC", "Bogotá D.C.", "Bogotá, D.C.", "Distrito Capital", "Distrito Capital de Bogotá", "Bogotá Distrito Capital", "Santa Fe de Bogotá", "Santafé de Bogotá"],
  "la-guajira": ["Guajira"],
  "norte-de-santander": ["Nte de Santander", "N de Santander"],
  "san-andres": ["San Andrés", "San Andrés, Providencia y Santa Catalina", "Archipiélago de San Andrés, Providencia y Santa Catalina", "San Andrés y Providencia", "Archipiélago de San Andrés"],
  "valle-del-cauca": ["Valle"],
};

/**
 * Cómo nombra Meta cada región en el desglose por región (a veces con "Department" al final, que la
 * limpieza quita). Solo los nombres que no salen ya del nombre del departamento o de OTROS_NOMBRES.
 */
const NOMBRES_DE_META: Partial<Record<ClaveDepartamento, string[]>> = {
  bogota: ["Bogota", "Bogota, D.C.", "Bogotá D.C.", "Capital District"],
  "san-andres": ["Archipiélago de San Andrés, Providencia y Santa Catalina Department", "San Andres y Providencia Department", "San Andrés and Providencia"],
  "valle-del-cauca": ["Valle del Cauca Department"],
  choco: ["Chocó Department"],
};

/** Ciudades y municipios principales: capitales, ciudades grandes y municipios del Chocó. */
const CIUDADES: Record<ClaveDepartamento, string[]> = {
  amazonas: ["Leticia", "Puerto Nariño"],
  antioquia: ["Medellín", "Bello", "Itagüí", "Envigado", "Sabaneta", "La Estrella", "Caldas Antioquia", "Copacabana", "Girardota", "Rionegro", "Marinilla", "La Ceja", "El Retiro", "Guarne", "El Carmen de Viboral", "Apartadó", "Turbo", "Carepa", "Chigorodó", "Necoclí", "Caucasia", "Santa Fe de Antioquia", "Yarumal", "Puerto Berrío", "Andes", "Segovia", "Remedios", "El Bagre"],
  arauca: ["Arauca", "Saravena", "Tame", "Arauquita", "Fortul"],
  atlantico: ["Barranquilla", "Soledad", "Malambo", "Puerto Colombia", "Galapa", "Sabanalarga", "Baranoa", "Sabanagrande"],
  bogota: ["Bogotá", "Bogota DC", "Bogotá D.C.", "Usme", "Suba", "Kennedy", "Bosa", "Engativá", "Usaquén", "Fontibón", "Ciudad Bolívar"],
  bolivar: ["Cartagena", "Cartagena de Indias", "Magangué", "Turbaco", "Arjona", "El Carmen de Bolívar", "Mompox", "Santa Cruz de Mompox"],
  boyaca: ["Tunja", "Duitama", "Sogamoso", "Chiquinquirá", "Paipa", "Puerto Boyacá", "Villa de Leyva", "Moniquirá", "Garagoa"],
  caldas: ["Manizales", "Villamaría", "Chinchiná", "La Dorada", "Riosucio", "Anserma", "Aguadas", "Salamina"],
  caqueta: ["Florencia", "San Vicente del Caguán", "Cartagena del Chairá", "Puerto Rico Caquetá"],
  casanare: ["Yopal", "Aguazul", "Villanueva Casanare", "Tauramena", "Paz de Ariporo", "Monterrey Casanare"],
  cauca: ["Popayán", "Santander de Quilichao", "Puerto Tejada", "Patía", "El Bordo", "Piendamó", "Guapi", "Miranda Cauca"],
  cesar: ["Valledupar", "Aguachica", "Agustín Codazzi", "Codazzi", "Bosconia", "La Jagua de Ibirico", "Curumaní", "Chimichagua"],
  choco: ["Quibdó", "Istmina", "Tadó", "Condoto", "Riosucio Chocó", "Bahía Solano", "Nuquí", "Acandí", "Unguía", "Bojayá", "Bellavista", "El Carmen de Atrato", "Lloró", "Medio Atrato", "Atrato", "Yuto", "Novita", "Nóvita", "Sipí", "Medio San Juan", "Andagoya", "Litoral del San Juan", "Docordó", "Juradó", "Bagadó", "Cértegui", "Unión Panamericana", "Ánimas", "Alto Baudó", "Pie de Pató", "Bajo Baudó", "Pizarro", "Medio Baudó", "Río Quito", "Paimadó", "Río Iró", "Santa Rita de Iró", "Carmen del Darién", "Curbaradó", "Belén de Bajirá", "Mutatá Chocó", "El Cantón de San Pablo", "Managrú"],
  cordoba: ["Montería", "Cereté", "Lorica", "Santa Cruz de Lorica", "Sahagún", "Montelíbano", "Planeta Rica", "Tierralta", "Ciénaga de Oro", "Ayapel", "Chinú"],
  cundinamarca: ["Soacha", "Chía", "Zipaquirá", "Facatativá", "Fusagasugá", "Girardot", "Mosquera", "Madrid", "Funza", "Cajicá", "Sibaté", "Tocancipá", "Cota", "La Calera", "Sopó", "Tenjo", "Tabio", "Gachancipá", "Ubaté", "Villa de San Diego de Ubaté", "Villeta", "La Mesa", "Anapoima", "Ricaurte", "Tocaima", "Agua de Dios", "Pacho", "Guaduas", "Chocontá", "Silvania"],
  guainia: ["Inírida", "Puerto Inírida"],
  guaviare: ["San José del Guaviare"],
  huila: ["Neiva", "Pitalito", "Garzón", "La Plata", "Campoalegre", "Palermo Huila"],
  "la-guajira": ["Riohacha", "Maicao", "Uribia", "Manaure", "Fonseca", "San Juan del Cesar", "Villanueva Guajira", "Albania Guajira"],
  magdalena: ["Santa Marta", "Ciénaga", "Fundación", "El Banco", "Plato", "Zona Bananera", "Aracataca"],
  meta: ["Villavicencio", "Acacías", "Granada Meta", "Puerto López", "Puerto Gaitán", "Restrepo Meta", "Cumaral", "San Martín Meta"],
  narino: ["Pasto", "San Juan de Pasto", "Tumaco", "San Andrés de Tumaco", "Ipiales", "Túquerres", "La Unión Nariño", "Samaniego"],
  "norte-de-santander": ["Cúcuta", "San José de Cúcuta", "Ocaña", "Villa del Rosario", "Los Patios", "Pamplona", "Tibú", "El Zulia"],
  putumayo: ["Mocoa", "Puerto Asís", "Orito", "Valle del Guamuez", "La Hormiga", "Sibundoy", "Puerto Leguízamo"],
  quindio: ["Armenia", "Calarcá", "Montenegro", "La Tebaida", "Quimbaya", "Circasia", "Filandia", "Salento"],
  risaralda: ["Pereira", "Dosquebradas", "Santa Rosa de Cabal", "La Virginia", "Belén de Umbría"],
  "san-andres": ["San Andrés Isla", "Providencia", "Santa Catalina"],
  santander: ["Bucaramanga", "Floridablanca", "Girón", "Piedecuesta", "Barrancabermeja", "San Gil", "Socorro", "Málaga", "Barbosa Santander", "Vélez", "Lebrija", "Sabana de Torres"],
  sucre: ["Sincelejo", "Corozal", "Sampués", "San Marcos", "Tolú", "Santiago de Tolú", "Coveñas", "San Onofre", "Majagual"],
  tolima: ["Ibagué", "Espinal", "El Espinal", "Melgar", "Honda", "Chaparral", "Líbano", "Mariquita", "Flandes", "Purificación"],
  "valle-del-cauca": ["Cali", "Santiago de Cali", "Palmira", "Buenaventura", "Tuluá", "Cartago", "Buga", "Guadalajara de Buga", "Jamundí", "Yumbo", "Candelaria", "Florida Valle", "Pradera", "El Cerrito", "Zarzal", "Sevilla", "Roldanillo", "Dagua", "Caicedonia", "La Unión Valle", "Ginebra"],
  vaupes: ["Mitú"],
  vichada: ["Puerto Carreño", "La Primavera", "Cumaribo"],
};

function tablaDeNombres(...fuentes: Array<Partial<Record<ClaveDepartamento, string[]>>>): Map<string, ClaveDepartamento> {
  const tabla = new Map<string, ClaveDepartamento>();
  for (const d of DEPARTAMENTOS) tabla.set(limpiarTexto(d.nombre), d.clave);
  for (const fuente of fuentes) {
    for (const [clave, nombres] of Object.entries(fuente) as Array<[ClaveDepartamento, string[]]>) {
      for (const nombre of nombres) tabla.set(limpiarTexto(nombre), clave);
    }
  }
  return tabla;
}

const POR_NOMBRE_DE_DEPARTAMENTO = tablaDeNombres(OTROS_NOMBRES);
const POR_REGION_DE_META = tablaDeNombres(OTROS_NOMBRES, NOMBRES_DE_META);
const POR_CIUDAD = tablaDeNombres(CIUDADES);

/** El departamento por su nombre (o su clave): "Valle", "Chocó", "valle-del-cauca", "Bogotá D.C.". */
export function departamentoDeNombre(texto: string | null | undefined): ClaveDepartamento | null {
  if (esClaveDepartamento(texto)) return texto;
  const limpio = limpiarTexto(texto);
  return limpio ? POR_NOMBRE_DE_DEPARTAMENTO.get(limpio) ?? null : null;
}

/**
 * El departamento de una ciudad o municipio ("Cali", "Quibdó", "Cali, Valle"). Si el texto es el
 * nombre de un departamento, también sirve. Si viene con comas o guiones, prueba cada parte.
 * null = no se reconoce.
 */
export function departamentoDeCiudad(texto: string | null | undefined): ClaveDepartamento | null {
  const partes = [String(texto ?? ""), ...String(texto ?? "").split(/[,;/()-]/)];
  for (const parte of partes) {
    const limpio = limpiarTexto(parte);
    if (!limpio) continue;
    const clave = POR_CIUDAD.get(limpio) ?? POR_NOMBRE_DE_DEPARTAMENTO.get(limpio);
    if (clave) return clave;
  }
  return null;
}

/** El departamento de un nombre de región de Meta ("Valle del Cauca Department", "Bogota"). null = no es de Colombia o no se reconoce. */
export function departamentoDeRegionMeta(nombre: string | null | undefined): ClaveDepartamento | null {
  const limpio = limpiarTexto(nombre);
  return limpio ? POR_REGION_DE_META.get(limpio) ?? null : null;
}

/**
 * El departamento de un teléfono fijo por su indicativo (60X + 7 dígitos, con o sin 57). Casi todos
 * los indicativos cubren varios departamentos, así que solo se responde con el 601: Bogotá, o
 * Cundinamarca si el número local empieza por 8 (los municipios de la sabana). Es aproximado.
 * Celulares (3XX) y los demás indicativos: null, porque no se sabe.
 */
export function departamentoDeTelefono(tel: string | null | undefined): ClaveDepartamento | null {
  let digitos = String(tel ?? "").replace(/\D/g, "");
  if (digitos.length === 12 && digitos.startsWith("57")) digitos = digitos.slice(2);
  if (digitos.length !== 10 || !digitos.startsWith("601")) return null;
  return digitos[3] === "8" ? "cundinamarca" : "bogota";
}
