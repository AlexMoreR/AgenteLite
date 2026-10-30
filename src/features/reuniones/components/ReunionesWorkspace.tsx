"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EstadoReunion } from "@prisma/client";
import { Copy, Loader2, MessageCircle, Plus, Search, Trash2, Video } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { borrarReunionAction, crearReunionAction } from "@/app/actions/reuniones-actions";
import { ESTADOS_EN_CURSO, ESTADOS_PARA_ENTRAR, NOMBRE_DEL_ESTADO } from "@/features/reuniones/estados";
import { SalasDeReuniones, type SalaDeLaPantalla, type UsuarioDelNegocio } from "@/features/reuniones/components/SalasDeReuniones";

export type ReunionDeLaPantalla = {
  id: string;
  titulo: string;
  codigo: string;
  origen: string;
  sinGrabar: boolean;
  estado: EstadoReunion;
  aviso: string | null;
  motivoError: string | null;
  creada: string;
  creadaPor: string | null;
  participantes: number;
  resumen: string | null;
  /** El nombre de su sala fija, o null si es suelta («Sin sala»). */
  sala: string | null;
  /** El servidor igual lo revisa: esto solo muestra u oculta el botón. */
  puedeBorrar: boolean;
};

/** Pide confirmación y borra una reunión sin grabación. */
export function BotonBorrar({ reunionId, despues }: { reunionId: string; despues?: () => void }) {
  const router = useRouter();
  const [borrando, startBorrar] = useTransition();
  const borrar = () => {
    if (!window.confirm("¿Borrar esta reunión? No se puede deshacer.")) {
      return;
    }
    startBorrar(async () => {
      const resultado = await borrarReunionAction(reunionId);
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Reunión borrada");
      despues?.();
      router.refresh();
    });
  };
  return (
    <Button size="sm" variant="outline" onClick={borrar} disabled={borrando}>
      {borrando ? <Loader2 className="animate-spin" /> : <Trash2 />}
      Borrar
    </Button>
  );
}


/** El color de cada estado: rojo en vivo y en error, gris lo que espera, normal lo que está listo. */
export function EtiquetaDeEstado({ estado, sinGrabar = false }: { estado: EstadoReunion; sinGrabar?: boolean }) {
  const variante = estado === "ERROR" || estado === "EN_VIVO" ? "destructive" : estado === "LISTA" ? "default" : "secondary";
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={variante} className="gap-1">
        {ESTADOS_EN_CURSO.includes(estado) && estado !== "EN_VIVO" ? <Loader2 className="animate-spin" /> : null}
        {estado === "EN_VIVO" ? "●" : null}
        {NOMBRE_DEL_ESTADO[estado]}
      </Badge>
      {sinGrabar ? <Badge variant="outline">Sin grabar</Badge> : null}
    </span>
  );
}

export function linkDeLaReunion(codigo: string) {
  return `${window.location.origin}/reunion/${codigo}`;
}

/** "Copiar" y "Enviar por WhatsApp" (wa.me: lo manda quien lo toca, no usa las líneas del CRM). */
export function CompartirLink({ codigo, titulo }: { codigo: string; titulo: string }) {
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(linkDeLaReunion(codigo));
      toast.success("Link copiado");
    } catch {
      toast.error("No se pudo copiar. Mantén apretado el link para copiarlo.");
    }
  };
  const whatsapp = () => {
    const texto = `Te invito a la reunión "${titulo}". Entra desde aquí, sin instalar nada: ${linkDeLaReunion(codigo)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" onClick={copiar}>
        <Copy /> Copiar
      </Button>
      <Button size="sm" variant="outline" onClick={whatsapp}>
        <MessageCircle /> Enviar por WhatsApp
      </Button>
      <Button size="sm" render={<Link href={`/reunion/${codigo}`} target="_blank" />}>
        <Video /> Entrar
      </Button>
    </div>
  );
}

/**
 * Arriba las salas fijas de cada área; abajo «Sin sala», las reuniones sueltas (y las de antes de las
 * salas) con «Nueva reunión» para las de una sola vez. Al buscar se busca en todas y cada resultado
 * dice su sala.
 */
export function ReunionesWorkspace({
  reuniones: reunionesLeidas,
  salas,
  usuarios,
  puedeAdministrarSalas,
  buscado,
  videoListo,
  hayClaveDeOpenAI,
}: {
  /** null: no se pudieron leer. */
  reuniones: ReunionDeLaPantalla[] | null;
  /** null: no se pudieron leer. */
  salas: SalaDeLaPantalla[] | null;
  usuarios: UsuarioDelNegocio[];
  puedeAdministrarSalas: boolean;
  buscado: string;
  videoListo: boolean;
  hayClaveDeOpenAI: boolean;
}) {
  const reuniones = reunionesLeidas ?? [];
  const router = useRouter();
  const [titulo, setTitulo] = useState("");
  const [sinGrabar, setSinGrabar] = useState(false);
  const [texto, setTexto] = useState(buscado);
  const [creando, startCrear] = useTransition();
  const [nueva, setNueva] = useState<{ codigo: string; titulo: string } | null>(null);

  // Mientras algo está en vivo o en la cola (o una sala tiene su reunión abierta), la lista se pone al día sola.
  const hayEnCurso = reuniones.some((reunion) => ESTADOS_EN_CURSO.includes(reunion.estado)) || Boolean(salas?.some((sala) => sala.abierta));
  useEffect(() => {
    if (!hayEnCurso) {
      return;
    }
    const reloj = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 15_000);
    return () => window.clearInterval(reloj);
  }, [hayEnCurso, router]);

  const crear = () => {
    startCrear(async () => {
      const resultado = await crearReunionAction(titulo, sinGrabar);
      if (resultado.error || !resultado.codigo) {
        toast.error(resultado.error ?? "No se pudo crear la reunión.");
        return;
      }
      setNueva({ codigo: resultado.codigo, titulo: titulo.trim() || "la reunión" });
      setTitulo("");
      setSinGrabar(false);
      router.refresh();
    });
  };

  const buscar = (evento: React.FormEvent) => {
    evento.preventDefault();
    const q = texto.trim();
    router.push(q ? `/cliente/reuniones?q=${encodeURIComponent(q)}` : "/cliente/reuniones");
  };

  return (
    <section className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
      {!videoListo ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          La videollamada todavía no está configurada en el servidor (faltan las variables LIVEKIT_*).
        </p>
      ) : null}
      {!hayClaveDeOpenAI ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Falta la clave de OpenAI: las reuniones quedan &quot;En cola&quot; hasta que se ponga.
        </p>
      ) : null}

      <form onSubmit={buscar} className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          placeholder="Buscar en títulos, transcripciones y actas"
          className="pl-8"
        />
      </form>

      {!buscado ? <SalasDeReuniones salas={salas} usuarios={usuarios} puedeAdministrar={puedeAdministrarSalas} /> : null}

      {buscado ? (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Resultados de «{buscado}»</h2>
          <Button size="sm" variant="ghost" render={<Link href="/cliente/reuniones" />}>
            Ver las salas
          </Button>
        </div>
      ) : (
        <div className="space-y-0.5 pt-2">
          <h2 className="text-sm font-semibold text-foreground">Sin sala</h2>
          <p className="text-xs text-muted-foreground">Reuniones de una sola vez y las de antes de las salas.</p>
        </div>
      )}

      {!buscado ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={titulo}
              onChange={(evento) => setTitulo(evento.target.value)}
              placeholder="Título (opcional)"
              maxLength={120}
              className="sm:flex-1"
            />
            <div className="flex gap-2">
              <Button onClick={crear} disabled={creando || !videoListo} className="flex-1 sm:flex-none">
                {creando ? <Loader2 className="animate-spin" /> : <Plus />}
                Nueva reunión
              </Button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sinGrabar} onChange={(evento) => setSinGrabar(evento.target.checked)} className="size-4" />
            Sin grabar
            <span className="text-xs text-muted-foreground">(no se graba, no se transcribe y no hay acta)</span>
          </label>

          {nueva ? (
            <div className="space-y-2 rounded-xl border border-border bg-card px-3 py-3">
              <p className="text-sm font-medium">Reunión creada. Comparte el link:</p>
              <p className="truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">{linkDeLaReunion(nueva.codigo)}</p>
              <CompartirLink codigo={nueva.codigo} titulo={nueva.titulo} />
            </div>
          ) : null}
        </>
      ) : null}

      {reunionesLeidas === null ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No se pudieron cargar las reuniones. Recarga la página.
        </p>
      ) : reuniones.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center">
          <Video className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">{buscado ? "No hay reuniones con ese texto" : "Todavía no hay reuniones sin sala"}</p>
          {!buscado ? (
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Para una reunión de una sola vez, crea una y comparte el link: se entra desde el celular o el PC sin instalar
              nada. Se graba, se pasa a texto y queda el acta.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {reuniones.map((reunion) => (
            <div key={reunion.id} className="space-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <Link href={`/cliente/reuniones/${reunion.id}`} className="block min-w-0">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{reunion.titulo}</span>
                  <EtiquetaDeEstado estado={reunion.estado} sinGrabar={reunion.sinGrabar} />
                </div>
                <span className="block text-xs text-muted-foreground">
                  {buscado ? `${reunion.sala ?? "Sin sala"} · ` : ""}
                  {formatearFecha(reunion.creada)}
                  {reunion.origen === "SUBIDA" ? " · Audio subido" : ` · ${reunion.participantes} ${reunion.participantes === 1 ? "persona" : "personas"}`}
                  {reunion.creadaPor ? ` · ${reunion.creadaPor}` : ""}
                </span>
                {reunion.aviso ? <span className="block text-xs text-amber-600">{reunion.aviso}</span> : null}
                {reunion.estado === "ERROR" && reunion.motivoError ? (
                  <span className="block truncate text-xs text-destructive">{reunion.motivoError}</span>
                ) : null}
                {reunion.resumen ? <span className="mt-1 line-clamp-2 block text-xs text-foreground/80">{reunion.resumen}</span> : null}
              </Link>
              {(reunion.origen === "VIVO" && ESTADOS_PARA_ENTRAR.includes(reunion.estado)) || reunion.puedeBorrar ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {reunion.origen === "VIVO" && ESTADOS_PARA_ENTRAR.includes(reunion.estado) ? (
                    <CompartirLink codigo={reunion.codigo} titulo={reunion.titulo} />
                  ) : null}
                  {reunion.puedeBorrar ? <BotonBorrar reunionId={reunion.id} /> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function formatearFecha(iso: string) {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Bogota",
  }).format(new Date(iso));
}
