/**
 * La tabla por campaña y por anuncio del Agente de Marketing. Lee `numeros.campanas` del resumen que guardó el
 * agente; lo que no viene o no es un número se muestra como "—" (nunca se inventa un costo por venta).
 */

type Fila = {
  nombre: string;
  gasto: number | null;
  conversaciones: number | null;
  costoPorConversacion: number | null;
  tibioCaliente: number | null;
  ventas: number | null;
  costoPorVenta: number | null;
  frecuencia: number | null;
  anuncios: Fila[];
};

const esObjeto = (valor: unknown): valor is Record<string, unknown> => Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
const aNumero = (valor: unknown): number | null => (typeof valor === "number" && Number.isFinite(valor) ? valor : null);

function leerFila(crudo: unknown, nivel: number): Fila | null {
  if (!esObjeto(crudo)) return null;
  const nombre = typeof crudo.nombre === "string" && crudo.nombre.trim() ? crudo.nombre.trim() : null;
  if (!nombre) return null;
  const anuncios = nivel === 0 && Array.isArray(crudo.anuncios) ? crudo.anuncios.map((anuncio) => leerFila(anuncio, 1)).filter((fila): fila is Fila => fila !== null) : [];
  return {
    nombre,
    gasto: aNumero(crudo.gasto),
    conversaciones: aNumero(crudo.conversaciones),
    costoPorConversacion: aNumero(crudo.costoPorConversacion),
    tibioCaliente: aNumero(crudo.tibioCaliente),
    ventas: aNumero(crudo.ventas),
    costoPorVenta: aNumero(crudo.costoPorVenta),
    frecuencia: aNumero(crudo.frecuencia),
    anuncios,
  };
}

/** Saca las campañas de `numeros` (el objeto libre que guardó el agente). Lista vacía si no hay tabla. */
export function leerTablaDeCampanas(numeros: unknown): Fila[] {
  if (!esObjeto(numeros) || !Array.isArray(numeros.campanas)) return [];
  return numeros.campanas.map((campana) => leerFila(campana, 0)).filter((fila): fila is Fila => fila !== null);
}

const dinero = (valor: number | null) => (valor === null ? "—" : `$${Math.round(valor).toLocaleString("es-CO")}`);
const cifra = (valor: number | null, decimales = 0) => (valor === null ? "—" : valor.toLocaleString("es-CO", { maximumFractionDigits: decimales }));

function Celdas({ fila, sangria }: { fila: Fila; sangria: boolean }) {
  return (
    <tr className={sangria ? "text-muted-foreground" : "font-medium"}>
      <td className={`py-1 pr-3 ${sangria ? "pl-4" : ""}`}>{fila.nombre}</td>
      <td className="px-2 text-right">{dinero(fila.gasto)}</td>
      <td className="px-2 text-right">{cifra(fila.conversaciones)}</td>
      <td className="px-2 text-right">{dinero(fila.costoPorConversacion)}</td>
      <td className="px-2 text-right">{cifra(fila.tibioCaliente)}</td>
      <td className="px-2 text-right">{cifra(fila.ventas)}</td>
      <td className="px-2 text-right">{dinero(fila.costoPorVenta)}</td>
      <td className="pl-2 text-right">{cifra(fila.frecuencia, 1)}</td>
    </tr>
  );
}

export function TablaDeCampanas({ numeros }: { numeros: unknown }) {
  const campanas = leerTablaDeCampanas(numeros);
  if (!campanas.length) return <p className="text-sm text-muted-foreground">Este resumen no trae tabla por campaña.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Campaña / anuncio</th>
            <th className="px-2 text-right font-medium">Gasto</th>
            <th className="px-2 text-right font-medium">Conversaciones</th>
            <th className="px-2 text-right font-medium">Costo por conv.</th>
            <th className="px-2 text-right font-medium">Tibio/Caliente</th>
            <th className="px-2 text-right font-medium">Ventas</th>
            <th className="px-2 text-right font-medium">Costo por venta</th>
            <th className="pl-2 text-right font-medium">Frecuencia</th>
          </tr>
        </thead>
        <tbody>
          {campanas.map((campana) => [
            <Celdas key={campana.nombre} fila={campana} sangria={false} />,
            ...campana.anuncios.map((anuncio) => <Celdas key={`${campana.nombre}/${anuncio.nombre}`} fila={anuncio} sangria />),
          ])}
        </tbody>
      </table>
    </div>
  );
}
