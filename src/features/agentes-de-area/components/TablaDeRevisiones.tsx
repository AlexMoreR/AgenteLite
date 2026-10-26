import { Badge } from "@/components/ui/badge";

/**
 * La tabla de revisiones del Agente de Sistemas: una fila por tarjeta HECHO con su commit, el resultado
 * (FUNCIONA / FALLA / NO SE PUEDE PROBAR) y el error exacto o el porqué. Lee `meta.revisiones` del resumen que guardó el agente.
 */

export type FilaDeRevision = { titulo: string; repo: string | null; commit: string | null; resultado: string; detalle: string | null };

const esObjeto = (valor: unknown): valor is Record<string, unknown> => Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
const texto = (valor: unknown): string | null => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

/** Saca las revisiones de `meta` (el objeto que guardó el agente). Lista vacía si no hay. */
export function leerRevisiones(meta: unknown): FilaDeRevision[] {
  if (!esObjeto(meta) || !Array.isArray(meta.revisiones)) return [];
  const filas: FilaDeRevision[] = [];
  for (const crudo of meta.revisiones) {
    if (!esObjeto(crudo)) continue;
    const titulo = texto(crudo.titulo);
    if (!titulo) continue;
    filas.push({ titulo, repo: texto(crudo.repo), commit: texto(crudo.commit), resultado: texto(crudo.resultado) ?? "—", detalle: texto(crudo.detalle) });
  }
  return filas;
}

const VARIANTE: Record<string, "default" | "destructive" | "secondary"> = { FUNCIONA: "default", FALLA: "destructive", "NO SE PUEDE PROBAR": "secondary" };

export function TablaDeRevisiones({ meta }: { meta: unknown }) {
  const filas = leerRevisiones(meta);
  if (!filas.length) return <p className="text-sm text-muted-foreground">Este resumen no trae revisiones: no quedó ninguna tarjeta HECHO en las últimas 24 horas.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Tarjeta</th>
            <th className="px-2 font-medium">Commit</th>
            <th className="px-2 font-medium">Resultado</th>
            <th className="pl-2 font-medium">Error o porqué</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, indice) => (
            <tr key={`${fila.titulo}-${indice}`} className="border-b border-border/50 align-top">
              <td className="py-1 pr-3 font-medium">
                {fila.titulo}
                {fila.repo ? <span className="text-muted-foreground"> · {fila.repo}</span> : null}
              </td>
              <td className="px-2 font-mono">{fila.commit ? fila.commit.slice(0, 8) : "—"}</td>
              <td className="px-2">
                <Badge variant={VARIANTE[fila.resultado] ?? "secondary"}>{fila.resultado}</Badge>
              </td>
              <td className="whitespace-pre-wrap pl-2 text-muted-foreground">{fila.detalle ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
