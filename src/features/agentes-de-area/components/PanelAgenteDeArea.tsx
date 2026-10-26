import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { InterruptorDelAgente } from "./InterruptorDelAgente";

type Envio = { id: string; nombre: string | null; numero: string; tipo: string; estado: string; motivo: string | null; texto: string };
type Dia = {
  fecha: string;
  esPrueba: boolean;
  salioTarde: boolean;
  notaTarde: string | null;
  numeros: unknown;
  meta: unknown;
  subagentes: unknown;
  sugeridos: unknown;
  textoAlexander: string | null;
};
type Historial = { fecha: string; esPrueba: boolean; salioTarde: boolean; enviados: number; bloqueados: number };

const NOMBRE_DE_SUBAGENTE: Record<string, string> = {
  cerrador: "Cerrador",
  cobrador: "Cobrador",
  "analista-de-perdidos": "Analista de perdidos",
};

const ETIQUETA_DE_ESTADO: Record<string, string> = {
  ENVIADO: "Salió",
  ENVIANDO: "En camino",
  BLOQUEADO: "No se mandó",
  FALLO: "No salió",
};

function Contenido({ valor }: { valor: unknown }) {
  if (valor === null || valor === undefined || valor === "") return <p className="text-sm text-muted-foreground">Sin datos.</p>;
  if (typeof valor === "string") return <p className="whitespace-pre-wrap text-sm">{valor}</p>;
  return <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">{JSON.stringify(valor, null, 2)}</pre>;
}

/** La pantalla "Agente de Ventas": interruptor, resumen de hoy, un bloque por subagente, mensajes e historial. */
export function PanelAgenteDeArea({
  titulo,
  activo,
  puedeCambiar,
  dia,
  envios,
  historial,
  sinNumero,
}: {
  titulo: string;
  activo: boolean;
  puedeCambiar: boolean;
  dia: Dia | null;
  envios: Envio[];
  historial: Historial[];
  sinNumero: string[];
}) {
  const subagentes = dia?.subagentes && typeof dia.subagentes === "object" ? Object.entries(dia.subagentes as Record<string, unknown>) : [];
  const sugeridos = Array.isArray(dia?.sugeridos) ? dia.sugeridos.length : 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{titulo}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InterruptorDelAgente activo={activo} puedeCambiar={puedeCambiar} />
          <p className="text-xs text-muted-foreground">
            Corre en aizen1 a las 7:00 (lunes a sábado). Si aizen1 está apagado, no hay resumen. Nunca le escribe a un cliente.
          </p>
          {sinNumero.length ? (
            <p className="text-xs text-amber-600">Sin número de avisos (no les llegará nada): {sinNumero.join(", ")}.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Resumen {dia ? dia.fecha : "de hoy"}
            {dia?.esPrueba ? <Badge variant="outline">Corrida de prueba</Badge> : null}
            {dia?.salioTarde ? <Badge variant="outline">Salió tarde{dia.notaTarde ? `: ${dia.notaTarde}` : ""}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!dia ? (
            <p className="text-sm text-muted-foreground">Todavía no hay ningún resumen guardado.</p>
          ) : (
            <>
              <div>
                <h3 className="mb-1 text-sm font-medium">Números de ayer</h3>
                <Contenido valor={dia.numeros} />
              </div>
              <div>
                <h3 className="mb-1 text-sm font-medium">Meta de hoy</h3>
                <Contenido valor={dia.meta} />
              </div>
              <div>
                <h3 className="mb-1 text-sm font-medium">Mensaje de las 7:30 para Alexander</h3>
                <Contenido valor={dia.textoAlexander} />
              </div>
              <p className="text-xs text-muted-foreground">Clientes sugeridos a las asesoras hoy: {sugeridos}.</p>
            </>
          )}
        </CardContent>
      </Card>

      {subagentes.map(([nombre, entrega]) => (
        <Card key={nombre}>
          <CardHeader>
            <CardTitle>Subagente: {NOMBRE_DE_SUBAGENTE[nombre] ?? nombre}</CardTitle>
          </CardHeader>
          <CardContent>
            <Contenido valor={entrega} />
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Mensajes de hoy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!envios.length ? <p className="text-sm text-muted-foreground">No se ha pedido ningún mensaje.</p> : null}
          {envios.map((e) => (
            <div key={e.id} className="rounded-md border border-border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{e.nombre ?? `…${e.numero.slice(-4)}`}</span>
                <Badge variant="outline">{e.tipo === "ALEXANDER" ? "Alexander" : "Asesora"}</Badge>
                <Badge variant={e.estado === "ENVIADO" ? "default" : "outline"}>{ETIQUETA_DE_ESTADO[e.estado] ?? e.estado}</Badge>
                {e.motivo ? <span className="text-xs text-muted-foreground">{e.motivo}</span> : null}
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{e.texto}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {!historial.length ? <p className="text-sm text-muted-foreground">Sin días guardados.</p> : null}
          {historial.map((h) => (
            <div key={h.fecha} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{h.fecha}</span>
              {h.esPrueba ? <Badge variant="outline">Prueba</Badge> : null}
              {h.salioTarde ? <Badge variant="outline">Salió tarde</Badge> : null}
              <span className="text-xs text-muted-foreground">
                {h.enviados} salieron · {h.bloqueados} no se mandaron
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
