/*
  UNIR LAS PISTAS DE UNA REUNIÓN por la hora.

  Cada persona tiene su pista (o varias, si se cayó y volvió: una por cada vez que publicó el
  micrófono). Cada frase trae su hora DENTRO de la pista; con la hora en que empezó la pista se
  pasa a la hora DENTRO de la reunión, y así se ordenan todas juntas con el nombre de quien habló.

  Sin dependencias: lo prueba scripts/check-reuniones-unir-pistas.mjs.
*/

export type FraseDePista = { inicioMs: number; finMs: number; texto: string };

export type PistaParaUnir = {
  nombre: string;
  /** Cuándo empezó la grabación de esta pista (null en un audio subido: empieza con la reunión). */
  empiezaEn: Date | string | null;
  frases: FraseDePista[];
};

export type FraseDeReunion = { inicioMs: number; finMs: number; nombre: string; texto: string };

/** Dos frases seguidas de la misma persona con menos de esto entre ellas se juntan en una. */
const PAUSA_PARA_JUNTAR_MS = 1500;

const aMs = (fecha: Date | string | null) => (fecha === null ? null : new Date(fecha).getTime());

export function unirPistas(pistas: PistaParaUnir[], inicioDeLaReunion?: Date | string | null): FraseDeReunion[] {
  const inicios = pistas.map((pista) => aMs(pista.empiezaEn)).filter((ms): ms is number => ms !== null && Number.isFinite(ms));
  const cero = aMs(inicioDeLaReunion ?? null) ?? (inicios.length ? Math.min(...inicios) : 0);

  const todas: FraseDeReunion[] = [];
  for (const pista of pistas) {
    const desfase = Math.max(0, (aMs(pista.empiezaEn) ?? cero) - cero);
    for (const frase of pista.frases) {
      const texto = frase.texto.trim();
      if (!texto) {
        continue;
      }
      todas.push({ inicioMs: frase.inicioMs + desfase, finMs: frase.finMs + desfase, nombre: pista.nombre, texto });
    }
  }
  todas.sort((a, b) => a.inicioMs - b.inicioMs || a.finMs - b.finMs || a.nombre.localeCompare(b.nombre));

  const unidas: FraseDeReunion[] = [];
  for (const frase of todas) {
    const anterior = unidas.at(-1);
    if (anterior && anterior.nombre === frase.nombre && frase.inicioMs - anterior.finMs <= PAUSA_PARA_JUNTAR_MS) {
      anterior.texto = `${anterior.texto} ${frase.texto}`;
      anterior.finMs = Math.max(anterior.finMs, frase.finMs);
      continue;
    }
    unidas.push({ ...frase });
  }
  return unidas;
}

/** 83_000 -> "01:23"; con horas, "1:02:03". */
export function horaDeLaFrase(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  const dos = (n: number) => String(n).padStart(2, "0");
  return horas ? `${horas}:${dos(minutos)}:${dos(segundos)}` : `${dos(minutos)}:${dos(segundos)}`;
}

/** La transcripción en texto: "[01:23] Ana: hola". La lee el acta y la búsqueda. */
export function transcripcionEnTexto(frases: FraseDeReunion[]): string {
  return frases.map((frase) => `[${horaDeLaFrase(frase.inicioMs)}] ${frase.nombre}: ${frase.texto}`).join("\n");
}
