/**
 * La tabla del Agente de Marketing: por campaña y por anuncio. Lee lo que el agente guardó en `numeros`
 * ({ campanas: [{ campana, gasto, ..., anuncios: [...] }], sin_anuncio_de_origen_pct }). Si falta un dato, muestra "—":
 * nunca inventa un costo por venta que no se pudo cruzar.
 */
type Fila = {
  campana?: string;
  anuncio?: string;
  gasto?: number | null;
  conversaciones?: number | null;
  costo_por_conversacion?: number | null;
  tibio_o_caliente?: number | null;
  ventas?: number | null;
  costo_por_venta?: number | null;
  frecuencia?: number | null;
  anuncios?: Fila[];
};

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const numero = (v: unknown, decimales = 0) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("es-CO", { maximumFractionDigits: decimales, minimumFractionDigits: decimales })
    : "—";
const dinero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `$${numero(v)}` : "—");

function Celdas({ f, nombre, sangria }: { f: Fila; nombre: string; sangria: boolean }) {
  return (
    <tr className={sangria ? "text-muted-foreground" : "font-medium"}>
      <td className={`py-1 pr-3 ${sangria ? "pl-4" : ""}`}>{nombre}</td>
      <td className="px-2 text-right">{dinero(f.gasto)}</td>
      <td className="px-2 text-right">{numero(f.conversaciones)}</td>
      <td className="px-2 text-right">{dinero(f.costo_por_conversacion)}</td>
      <td className="px-2 text-right">{numero(f.tibio_o_caliente)}</td>
      <td className="px-2 text-right">{numero(f.ventas)}</td>
      <td className="px-2 text-right">{dinero(f.costo_por_venta)}</td>
      <td className="pl-2 text-right">{numero(f.frecuencia, 1)}</td>
    </tr>
  );
}

export function TablaDeCampanas({ numeros }: { numeros: unknown }) {
  const campanas = esObjeto(numeros) && Array.isArray(numeros.campanas) ? (numeros.campanas as Fila[]) : [];
  const sinOrigen = esObjeto(numeros) && typeof numeros.sin_anuncio_de_origen_pct === "number" ? numeros.sin_anuncio_de_origen_pct : null;
  if (!campanas.length) return <p className="text-sm text-muted-foreground">Sin tabla de campañas todavía.</p>;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-1 pr-3 text-left font-normal">Campaña / anuncio</th>
              <th className="px-2 text-right font-normal">Gasto</th>
              <th className="px-2 text-right font-normal">Conversaciones</th>
              <th className="px-2 text-right font-normal">Costo por conversación</th>
              <th className="px-2 text-right font-normal">Tibio/Caliente</th>
              <th className="px-2 text-right font-normal">Ventas</th>
              <th className="px-2 text-right font-normal">Costo por venta</th>
              <th className="pl-2 text-right font-normal">Frecuencia</th>
            </tr>
          </thead>
          <tbody>
            {campanas.flatMap((c, i) => [
              <Celdas key={`c${i}`} f={c} nombre={c.campana ?? "Campaña"} sangria={false} />,
              ...(c.anuncios ?? []).map((a, j) => <Celdas key={`c${i}a${j}`} f={a} nombre={a.anuncio ?? "Anuncio"} sangria />),
            ])}
          </tbody>
        </table>
      </div>
      {sinOrigen !== null ? (
        <p className={`text-xs ${sinOrigen >= 30 ? "text-amber-600" : "text-muted-foreground"}`}>
          {numero(sinOrigen, 1)} % de las conversaciones no tienen anuncio de origen: su costo por venta no se puede cruzar.
        </p>
      ) : null}
    </div>
  );
}
