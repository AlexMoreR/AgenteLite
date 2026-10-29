import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { META_RESPUESTA_BIENVENIDA, type RespuestaBienvenidaDelDia } from "@/features/agentes-de-area/dominio/reglas";

import { InterruptorDelAgente } from "./InterruptorDelAgente";
import { TablaDeCampanas } from "./TablaDeCampanas";
import { TablaDeRevisiones } from "./TablaDeRevisiones";

export type DatosDelPanel = {
  area: string;
  titulo: string;
  activo: boolean;
  fecha: string;
  resumen: {
    esPrueba: boolean;
    salioTarde: boolean;
    notaDeRetraso: string | null;
    texto: string | null;
    numeros: unknown;
    meta: unknown;
    subagentes: Record<string, unknown>;
    sugeridos: number;
    /** Solo sistemas: la línea (arriba), las revisiones por tarjeta y las tarjetas de arreglo viven en `meta`. */
    arreglos?: Array<{ titulo: string; estado: string }>;
    /** Solo marketing: la línea para Alexander y la recomendación (máximo una) con su dato. */
    linea?: string | null;
    recomendacion?: { accion: string; texto: string; dato: string } | null;
  } | null;
  envios: Array<{ id: string; tipo: string; destinatario: string | null; numero: string; estado: string; motivo: string | null; texto: string; hora: string }>;
  historial: Array<{ fecha: string; esPrueba: boolean; salioTarde: boolean; resumen: string | null }>;
  /** Solo ventas: la tasa de respuesta a la bienvenida de los últimos 14 días (null = no se pudo leer). */
  bienvenida?: RespuestaBienvenidaDelDia[] | null;
  /** Asesoras del equipo sin número en Mi empresa → Equipo: no les llega nada. */
  sinNumeroDeAvisos: string[];
};

const ETIQUETA_DE_ESTADO: Record<string, string> = {
  ENVIADO: "Salió",
  BLOQUEADO: "No se mandó",
  FALLIDO: "No salió",
  PENDIENTE: "En camino",
};

function aTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return valor;
  return JSON.stringify(valor, null, 2);
}

const porCiento = (valor: number | null) => (valor === null ? "sin dato" : `${valor.toLocaleString("es-CO")} %`);

/** La tasa de respuesta a la bienvenida: el día que se mira por línea y por anuncio, y la línea de 14 días. */
function TarjetaDeBienvenida({ serie }: { serie: RespuestaBienvenidaDelDia[] | null | undefined }) {
  const dia = serie?.length ? serie[serie.length - 1] : null;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Tasa de respuesta a la bienvenida</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!serie || !dia ? (
          <p className="text-muted-foreground">Sin dato: no se pudo leer.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              De los leads que entraron ese día (sin importar a qué etapa pasaron), cuántos mandaron al menos un mensaje más después del primero. Meta:{" "}
              {META_RESPUESTA_BIENVENIDA} %. Solo lectura.
            </p>
            <p className="font-medium">
              {dia.fecha}: {porCiento(dia.respondieronPorCiento)} ({dia.respondieron} de {dia.leads}) · en menos de 2 h: {porCiento(dia.menosDe2hPorCiento)}{" "}
              {dia.cumpleMeta === null ? null : <Badge variant={dia.cumpleMeta ? "default" : "secondary"}>{dia.cumpleMeta ? "Cumple la meta" : "Bajo la meta"}</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              Contestaron la bienvenida: {dia.respondieronLaBienvenida} · Recuperados por seguimiento: {dia.recuperados} (15 min: {dia.recuperadosPorSeguimiento.min15}, 1 hora:{" "}
              {dia.recuperadosPorSeguimiento.hora1}, 1 día: {dia.recuperadosPorSeguimiento.dia1}
              {dia.recuperadosPorSeguimiento.otro ? `, otro: ${dia.recuperadosPorSeguimiento.otro}` : ""}) · Nunca respondieron: {dia.nuncaRespondieron}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Bloque titulo="Por línea">
                {dia.porLinea.length === 0 ? <p className="text-xs text-muted-foreground">Sin dato.</p> : null}
                {dia.porLinea.map((fila) => (
                  <p key={fila.linea} className="text-xs">
                    <span className="font-medium">{fila.linea}</span>: {porCiento(fila.respondieronPorCiento)} ({fila.respondieron} de {fila.leads}) · &lt; 2 h: {porCiento(fila.menosDe2hPorCiento)}
                  </p>
                ))}
              </Bloque>
              <Bloque titulo="Por anuncio">
                {dia.porAnuncio.length === 0 ? <p className="text-xs text-muted-foreground">Sin dato.</p> : null}
                {dia.porAnuncio.map((fila) => (
                  <p key={fila.anuncioId ?? "sin-anuncio"} className="text-xs">
                    <span className="font-medium">{fila.anuncio}</span>: {porCiento(fila.respondieronPorCiento)} ({fila.respondieron} de {fila.leads}) · &lt; 2 h: {porCiento(fila.menosDe2hPorCiento)}
                  </p>
                ))}
              </Bloque>
            </div>
            <Bloque titulo="Últimos 14 días">
              <div className="space-y-0.5 text-xs">
                {serie.map((fila) => (
                  <p key={fila.fecha} className="flex flex-wrap gap-x-2">
                    <span className="w-24 font-medium">{fila.fecha}</span>
                    <span className="w-20">{porCiento(fila.respondieronPorCiento)}</span>
                    <span className="w-20 text-muted-foreground">&lt; 2 h: {porCiento(fila.menosDe2hPorCiento)}</span>
                    <span className="text-muted-foreground">{fila.leads} leads</span>
                  </p>
                ))}
              </div>
            </Bloque>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{titulo}</p>
      {children}
    </div>
  );
}

/** La sección del agente de un área: interruptor, resumen de hoy, subagentes, mensajes e historial. */
export function PanelAgenteDeArea({ datos }: { datos: DatosDelPanel }) {
  const { resumen } = datos;
  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>{datos.titulo}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {datos.area === "sistemas" ? (
            <p className="text-muted-foreground">
              Corre en aizen1 todos los días a las 6:30 a. m. (lunes a sábado) y solo LEE: abre en producción lo que se subió, revisa los registros, la salud del
              trabajador y los respaldos; nunca modifica código, hace deploy, aprueba ni cambia tarjetas. No manda WhatsApp: su línea va dentro del mensaje de
              las 7:30 solo con el interruptor prendido, y solo prendido crea la tarjeta de arreglo POR_APROBAR en el tablero de Emanuel (apagado queda escrita
              como «se crearía»). Si aizen1 está apagado, no hay resumen.
            </p>
          ) : datos.area === "marketing" ? (
            <p className="text-muted-foreground">
              Corre en aizen1 todos los días a las 6:45 a. m. (lunes a sábado), antes del Agente de Ventas. Solo LEE Meta Ads: nunca pausa, prende,
              edita presupuestos ni crea anuncios; las decisiones las toma Alexander. No manda WhatsApp: su línea va dentro del mensaje de las 7:30.
              Con el interruptor apagado se genera el resumen, pero la línea no sale en ese mensaje. Si aizen1 está apagado, no hay resumen.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Corre en aizen1 todos los días a las 7:00 a. m. (lunes a sábado). El CRM solo da los datos, manda los WhatsApp internos que el agente pide y
              muestra el resumen. Nunca le escribe a un cliente. Si aizen1 está apagado, no hay resumen.
            </p>
          )}
          <InterruptorDelAgente area={datos.area} activo={datos.activo} />
          {datos.sinNumeroDeAvisos.length ? (
            <p className="rounded-md border border-amber-500/60 bg-amber-500/5 px-3 py-2 text-xs">
              Sin número de avisos (Mi empresa → Equipo): {datos.sinNumeroDeAvisos.join(", ")}. A ellas no les llega nada.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>
            Resumen de {datos.fecha}{" "}
            {resumen?.esPrueba ? <Badge variant="secondary">Prueba</Badge> : null}{" "}
            {resumen?.salioTarde ? <Badge variant="destructive">Salió tarde</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {resumen ? (
            <>
              {resumen.notaDeRetraso ? <p className="text-xs text-muted-foreground">{resumen.notaDeRetraso}</p> : null}
              {resumen.linea ? <p className="font-medium">{resumen.linea}</p> : null}
              {resumen.recomendacion ? (
                <p className="rounded-md border border-border px-3 py-2 text-xs">
                  <span className="font-semibold uppercase">{resumen.recomendacion.accion}:</span> {resumen.recomendacion.texto}{" "}
                  <span className="text-muted-foreground">Dato: {resumen.recomendacion.dato}</span>
                </p>
              ) : null}
              {datos.area === "sistemas" ? (
                <>
                  <Bloque titulo="Revisiones de producción">
                    <TablaDeRevisiones meta={resumen.meta} />
                  </Bloque>
                  {resumen.arreglos?.length ? (
                    <Bloque titulo="Tarjetas de arreglo (POR_APROBAR)">
                      <ul className="list-disc space-y-1 pl-4 text-xs">
                        {resumen.arreglos.map((arreglo) => (
                          <li key={arreglo.titulo}>
                            {arreglo.titulo} <span className="text-muted-foreground">— {arreglo.estado === "creada" ? "creada" : "se crearía (interruptor apagado o prueba)"}</span>
                          </li>
                        ))}
                      </ul>
                    </Bloque>
                  ) : null}
                </>
              ) : null}
              {datos.area === "marketing" ? (
                <Bloque titulo="Por campaña y por anuncio">
                  <TablaDeCampanas numeros={resumen.numeros} />
                </Bloque>
              ) : null}
              {resumen.texto ? <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{resumen.texto}</pre> : null}
              {resumen.numeros && datos.area === "ventas" ? (
                <Bloque titulo="Números de ayer">
                  <pre className="whitespace-pre-wrap text-xs text-foreground">{aTexto(resumen.numeros)}</pre>
                </Bloque>
              ) : null}
              {resumen.meta && datos.area !== "sistemas" ? (
                <Bloque titulo="Meta de hoy">
                  <pre className="whitespace-pre-wrap text-xs text-foreground">{aTexto(resumen.meta)}</pre>
                </Bloque>
              ) : null}
              {datos.area === "ventas" ? <p className="text-xs text-muted-foreground">Clientes sugeridos guardados para medir mañana: {resumen.sugeridos}.</p> : null}
            </>
          ) : (
            <p className="text-muted-foreground">Todavía no hay resumen de este día.</p>
          )}
        </CardContent>
      </Card>

      {datos.area === "ventas" ? <TarjetaDeBienvenida serie={datos.bienvenida} /> : null}

      {resumen && Object.keys(resumen.subagentes).length ? (
        Object.entries(resumen.subagentes).map(([nombre, entrega]) => (
          <Card size="sm" key={nombre}>
            <CardHeader>
              <CardTitle>Subagente: {nombre}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{aTexto(entrega)}</pre>
            </CardContent>
          </Card>
        ))
      ) : (
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">Ningún subagente ha entregado nada este día.</p>
          </CardContent>
        </Card>
      )}

      {datos.area !== "ventas" ? null : (
      <Card size="sm">
        <CardHeader>
          <CardTitle>Mensajes del día</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {datos.envios.length === 0 ? <p className="text-sm text-muted-foreground">No se ha pedido ningún mensaje.</p> : null}
          {datos.envios.map((envio) => (
            <details key={envio.id} className="rounded-md border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{envio.destinatario ?? envio.numero}</span>{" "}
                <span className="text-muted-foreground">
                  · {envio.tipo === "ALEXANDER" ? "Alexander" : "asesora"} · {envio.hora} ·{" "}
                </span>
                <Badge variant={envio.estado === "ENVIADO" ? "default" : "secondary"}>{ETIQUETA_DE_ESTADO[envio.estado] ?? envio.estado}</Badge>
                {envio.motivo ? <span className="text-xs text-muted-foreground"> {envio.motivo}</span> : null}
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground">{envio.texto}</pre>
            </details>
          ))}
        </CardContent>
      </Card>
      )}

      <Card size="sm">
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {datos.historial.length === 0 ? <p className="text-muted-foreground">Sin días guardados.</p> : null}
          {datos.historial.map((dia) => (
            <p key={dia.fecha}>
              <span className="font-medium">{dia.fecha}</span>
              {dia.esPrueba ? " · prueba" : ""}
              {dia.salioTarde ? " · salió tarde" : ""}
              {dia.resumen ? <span className="text-muted-foreground"> — {dia.resumen.split("\n")[0].slice(0, 140)}</span> : null}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
