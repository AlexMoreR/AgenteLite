"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, ExternalLink, FileText, Folder, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buscarEnElCerebroAction, leerDocumentoAction, sincronizarAhoraAction } from "@/app/actions/cerebro-actions";
import type { DocumentoLeido, FilaDelCerebro } from "../services/consultas";
import type { NodoDelArbol, PedazoDelCerebro } from "../services/reglas";

type Nodo = NodoDelArbol<FilaDelCerebro>;

type Props = {
  arbol: Nodo[];
  ultimaSincronizacion: string | null;
  cambios: Array<{ id: string; quienNombre: string; origen: string; nombreDocumento: string; accion: string; creadoEn: string }>;
};

const FECHA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
const DESDE: Record<string, string> = { MCP: "Claude", PANTALLA: "la pantalla", TABLERO: "el tablero" };

function Rama({ nodo, nivel, abierto, alElegir }: { nodo: Nodo; nivel: number; abierto: string | null; alElegir: (nodo: Nodo) => void }) {
  const [desplegada, setDesplegada] = useState(nivel === 0);
  const sangria = { paddingLeft: `${nivel * 14 + 8}px` };
  if (nodo.esCarpeta) {
    return (
      <li>
        <button type="button" style={sangria} onClick={() => setDesplegada(!desplegada)} className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-muted">
          {desplegada ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{nodo.nombre}</span>
        </button>
        {desplegada ? (
          <ul>
            {nodo.hijos.map((hijo) => (
              <Rama key={hijo.driveId} nodo={hijo} nivel={nivel + 1} abierto={abierto} alElegir={alElegir} />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        style={sangria}
        onClick={() => alElegir(nodo)}
        className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-muted ${abierto === nodo.driveId ? "bg-muted font-medium" : ""}`}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{nodo.nombre}</span>
      </button>
    </li>
  );
}

/** El árbol del cerebro, el visor de documentos, el buscador y el botón "Sincronizar ahora". */
export function CerebroPantalla({ arbol, ultimaSincronizacion, cambios }: Props) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [abierto, setAbierto] = useState<DocumentoLeido | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<PedazoDelCerebro[] | null>(null);

  const abrir = async (driveId: string, nombre: string) => {
    setAbriendo(driveId);
    const respuesta = await leerDocumentoAction(driveId);
    setAbriendo(null);
    if (respuesta.ok) setAbierto(respuesta.documento);
    else toast.error(`${nombre}: ${respuesta.error}`);
  };

  const sincronizar = () =>
    empezar(async () => {
      const respuesta = await sincronizarAhoraAction();
      if (respuesta.ok) {
        const r = respuesta.resultado;
        toast.success(`Sincronizado: ${r.nuevos} nuevos, ${r.cambiados} cambiados, ${r.ausentes} que ya no están en el Drive.`);
        router.refresh();
      } else toast.error(respuesta.error);
    });

  const buscar = () =>
    empezar(async () => {
      if (!consulta.trim()) {
        setResultados(null);
        return;
      }
      const respuesta = await buscarEnElCerebroAction(consulta);
      if (respuesta.ok) setResultados(respuesta.resultados);
      else toast.error(respuesta.error);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(evento) => {
            evento.preventDefault();
            buscar();
          }}
        >
          <Input className="h-10 max-w-md md:h-9" placeholder="Buscar en el cerebro (ej. contraentrega)" value={consulta} onChange={(e) => setConsulta(e.target.value)} />
          <Button type="submit" variant="outline" disabled={pendiente}>
            <Search />
            Buscar
          </Button>
        </form>
        <span className="text-xs text-muted-foreground">
          {ultimaSincronizacion ? `Última sincronización: ${FECHA.format(new Date(ultimaSincronizacion))}` : "Todavía no se ha sincronizado"}
        </span>
        <Button onClick={sincronizar} disabled={pendiente}>
          {pendiente ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Sincronizar ahora
        </Button>
      </div>

      {resultados ? (
        <div className="space-y-1.5 rounded-xl border bg-card p-3">
          <p className="text-sm font-medium">{resultados.length ? `${resultados.length} resultado(s)` : "No hay nada con esas palabras."}</p>
          {resultados.map((resultado) => (
            <button
              key={resultado.driveId}
              type="button"
              onClick={() => void abrir(resultado.driveId, resultado.nombre)}
              className="block w-full rounded-lg border px-3 py-2 text-left hover:bg-muted"
            >
              <span className="text-sm font-medium">{resultado.ruta}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{resultado.fragmento}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
        <nav className="max-h-[70dvh] overflow-y-auto rounded-xl border bg-card p-2">
          {arbol.length ? (
            <ul>
              {arbol.map((nodo) => (
                <Rama key={nodo.driveId} nodo={nodo} nivel={0} abierto={abierto?.driveId ?? abriendo} alElegir={(n) => void abrir(n.driveId, n.nombre)} />
              ))}
            </ul>
          ) : (
            <p className="p-3 text-sm text-muted-foreground">La carpeta está vacía o todavía no se sincroniza. Pulsa &quot;Sincronizar ahora&quot;.</p>
          )}
        </nav>

        <article className="min-h-40 rounded-xl border bg-card p-4">
          {abriendo ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Abriendo…
            </p>
          ) : abierto ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{abierto.ruta}</h2>
                  <p className="text-xs text-muted-foreground">
                    {abierto.modificadoEnDrive ? `Última modificación en el Drive: ${FECHA.format(new Date(abierto.modificadoEnDrive))}` : "Sin fecha de modificación"}
                    {abierto.leidoDe === "copia" ? " · copia de la última sincronización" : " · leído ahora del Drive"}
                  </p>
                </div>
                {abierto.linkDrive ? (
                  <Button variant="outline" size="sm" render={<a href={abierto.linkDrive} target="_blank" rel="noopener noreferrer" />}>
                    <ExternalLink />
                    Abrir en Drive
                  </Button>
                ) : null}
              </div>
              {abierto.explicacion ? <p className="text-xs text-destructive">{abierto.explicacion}</p> : null}
              {!abierto.enDrive ? <p className="text-xs text-destructive">Ya no está en el Drive: esta es la última copia.</p> : null}
              {abierto.texto === null ? (
                <p className="text-sm text-muted-foreground">Este tipo de archivo (PDF, imagen…) no se lee por dentro: ábrelo en Drive.</p>
              ) : (
                <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed">{abierto.texto}</pre>
              )}
              {abierto.textoTruncado ? <p className="text-xs text-muted-foreground">El texto es muy largo: aquí se muestra el comienzo. Ábrelo en Drive para verlo completo.</p> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Elige un documento del árbol para leerlo.</p>
          )}
        </article>
      </div>

      {cambios.length ? (
        <section className="space-y-1.5">
          <h3 className="text-sm font-medium">Últimos cambios escritos en el cerebro</h3>
          <ul className="space-y-1">
            {cambios.map((cambio) => (
              <li key={cambio.id} className="rounded-lg border px-3 py-1.5 text-xs">
                <span className="font-medium">{cambio.quienNombre}</span> · {cambio.accion} · {cambio.nombreDocumento}
                <span className="text-muted-foreground"> · {FECHA.format(new Date(cambio.creadoEn))} · desde {DESDE[cambio.origen] ?? cambio.origen}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
