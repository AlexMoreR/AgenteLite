import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * La tabla de revisiones del Agente de Sistemas: tarjeta, commit, resultado y el error exacto o el porqué.
 * Lee `meta.revisiones` del resumen que guardó el agente; lo que no viene se muestra como "—".
 */

export type Revision = { titulo: string; repo: string | null; commit: string | null; resultado: string; detalle: string | null };
export type Arreglo = { titulo: string; commit: string | null; creada: boolean };

const esObjeto = (valor: unknown): valor is Record<string, unknown> => Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

export function leerRevisionesDelResumen(meta: unknown): Revision[] {
  if (!esObjeto(meta) || !Array.isArray(meta.revisiones)) return [];
  return meta.revisiones.filter(esObjeto).map((r) => ({
    titulo: texto(r.titulo) ?? "(sin título)",
    repo: texto(r.repo),
    commit: texto(r.commit),
    resultado: texto(r.resultado) ?? "NO_SE_PUEDE_PROBAR",
    detalle: texto(r.detalle),
  }));
}

export function leerArreglosDelResumen(meta: unknown): Arreglo[] {
  if (!esObjeto(meta) || !Array.isArray(meta.arreglos)) return [];
  return meta.arreglos.filter(esObjeto).map((a) => ({ titulo: texto(a.titulo) ?? "(sin título)", commit: texto(a.commit), creada: a.creada === true }));
}

const ETIQUETA: Record<string, string> = { FUNCIONA: "Funciona", FALLA: "Falla", NO_SE_PUEDE_PROBAR: "No se puede probar" };

export function TablaDeRevisiones({ revisiones }: { revisiones: Revision[] }) {
  if (!revisiones.length) return <p className="text-sm text-muted-foreground">Este resumen no trae tarjetas revisadas.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tarjeta</TableHead>
          <TableHead>Commit</TableHead>
          <TableHead>Resultado</TableHead>
          <TableHead>Error o porqué</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {revisiones.map((revision, i) => (
          <TableRow key={`${revision.commit ?? revision.titulo}-${i}`}>
            <TableCell className="whitespace-normal text-xs">
              {revision.titulo}
              {revision.repo ? <span className="text-muted-foreground"> · {revision.repo}</span> : null}
            </TableCell>
            <TableCell className="font-mono text-xs">{revision.commit ? revision.commit.slice(0, 10) : "—"}</TableCell>
            <TableCell>
              <Badge variant={revision.resultado === "FALLA" ? "destructive" : revision.resultado === "FUNCIONA" ? "default" : "secondary"}>
                {ETIQUETA[revision.resultado] ?? revision.resultado}
              </Badge>
            </TableCell>
            <TableCell className="whitespace-normal text-xs text-muted-foreground">{revision.detalle ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
