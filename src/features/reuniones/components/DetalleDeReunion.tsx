"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EstadoReunion } from "@prisma/client";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { reintentarReunionAction } from "@/app/actions/reuniones-actions";
import { ESTADOS_EN_CURSO, ESTADOS_PARA_ENTRAR } from "@/features/reuniones/estados";
import type { Acta } from "@/features/reuniones/servicios/hacer-acta";
import type { FraseDeReunion } from "@/features/reuniones/servicios/unir-pistas";
import { BotonBorrar, CompartirLink, EtiquetaDeEstado, formatearFecha } from "@/features/reuniones/components/ReunionesWorkspace";

type Detalle = {
  id: string;
  titulo: string;
  codigo: string;
  origen: string;
  sinGrabar: boolean;
  estado: EstadoReunion;
  aviso: string | null;
  motivoError: string | null;
  creada: string;
  empezoEn: string | null;
  terminoEn: string | null;
  creadaPor: string | null;
  participantes: Array<{ id: string; nombre: string; entroEn: string; salioEn: string | null }>;
  pistas: Array<{ id: string; nombre: string; estado: string; empiezaEn: string | null; link: string | null }>;
  frases: FraseDeReunion[];
  acta: Acta | null;
  puedeBorrar: boolean;
};

const ESTADO_DE_LA_PISTA: Record<string, string> = {
  GRABANDO: "Grabando",
  LISTA: "Grabada",
  TRANSCRITA: "Transcrita",
  ERROR: "No se grabó",
};

/** Lo mismo que horaDeLaFrase del servidor (unir-pistas.ts), sin traer ese archivo al navegador. */
function hora(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const horas = Math.floor(total / 3600);
  const dos = (n: number) => String(n).padStart(2, "0");
  const resto = `${dos(Math.floor((total % 3600) / 60))}:${dos(total % 60)}`;
  return horas ? `${horas}:${resto}` : resto;
}

function Lista({ titulo, items }: { titulo: string; items: string[] }) {
  if (!items.length) {
    return null;
  }
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {items.map((item, indice) => (
          <li key={indice}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function DetalleDeReunion({ reunion }: { reunion: Detalle }) {
  const router = useRouter();
  const [reintentando, startReintentar] = useTransition();

  // Mientras está en vivo o en la cola, el detalle se pone al día solo.
  const enCurso = ESTADOS_EN_CURSO.includes(reunion.estado);
  useEffect(() => {
    if (!enCurso) {
      return;
    }
    const reloj = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 15_000);
    return () => window.clearInterval(reloj);
  }, [enCurso, router]);

  const reintentar = () => {
    startReintentar(async () => {
      const resultado = await reintentarReunionAction(reunion.id);
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Vuelve a la cola.");
      router.refresh();
    });
  };

  return (
    <section className="mx-auto w-full max-w-3xl space-y-5 px-4 py-5">
      <div className="space-y-1">
        <Link href="/cliente/reuniones" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Reuniones
        </Link>
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-lg font-semibold">{reunion.titulo}</h1>
          <EtiquetaDeEstado estado={reunion.estado} sinGrabar={reunion.sinGrabar} />
        </div>
        <p className="text-xs text-muted-foreground">
          {formatearFecha(reunion.empezoEn ?? reunion.creada)}
          {reunion.terminoEn ? ` – ${formatearFecha(reunion.terminoEn)}` : ""}
          {reunion.creadaPor ? ` · ${reunion.creadaPor}` : ""}
          {reunion.origen === "SUBIDA" ? " · Audio subido (no se separa quién habló)" : ""}
        </p>
        {reunion.aviso ? <p className="text-xs text-amber-600">{reunion.aviso}</p> : null}
      </div>

      {reunion.origen === "VIVO" && ESTADOS_PARA_ENTRAR.includes(reunion.estado) ? (
        <CompartirLink codigo={reunion.codigo} titulo={reunion.titulo} />
      ) : null}

      {reunion.puedeBorrar ? <BotonBorrar reunionId={reunion.id} despues={() => router.push("/cliente/reuniones")} /> : null}

      {reunion.estado === "ERROR" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="min-w-0 flex-1 text-sm text-destructive">{reunion.motivoError ?? "Falló la transcripción."}</p>
          <Button size="sm" variant="outline" onClick={reintentar} disabled={reintentando}>
            {reintentando ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Reintentar
          </Button>
        </div>
      ) : null}

      {reunion.participantes.length ? (
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Quiénes entraron</h2>
          <p className="text-sm text-muted-foreground">{reunion.participantes.map((participante) => participante.nombre).join(", ")}</p>
        </div>
      ) : null}

      {reunion.sinGrabar ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">Esta reunión no se grabó.</p>
      ) : null}

      {reunion.pistas.length ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Pistas de audio</h2>
          {reunion.pistas.map((pista) => (
            <div key={pista.id} className="space-y-1 rounded-lg border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{pista.nombre}</span>
                {pista.empiezaEn ? ` · desde ${formatearFecha(pista.empiezaEn)}` : ""} · {ESTADO_DE_LA_PISTA[pista.estado] ?? pista.estado}
              </p>
              {pista.link ? <audio controls preload="none" src={pista.link} className="h-9 w-full" /> : null}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Los links de los audios vencen en 1 hora: recarga la página para escucharlos después.</p>
        </div>
      ) : null}

      {reunion.acta ? (
        <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-3">
          <h2 className="text-base font-semibold">Acta</h2>
          {reunion.acta.resumen ? <p className="text-sm">{reunion.acta.resumen}</p> : null}
          <Lista titulo="Decisiones" items={reunion.acta.decisiones} />
          <Lista
            titulo="Tareas"
            items={reunion.acta.tareas.map((tarea) => `${tarea.tarea} — ${tarea.responsable} · ${tarea.fecha}`)}
          />
          <Lista titulo="Mejoras en ventas" items={reunion.acta.mejorasEnVentas} />
          <Lista titulo="Qué puede mejorar Alexander como dueño" items={reunion.acta.mejorasDelDueno} />
        </div>
      ) : null}

      {reunion.frases.length ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Transcripción</h2>
          <div className="space-y-1.5">
            {reunion.frases.map((frase, indice) => (
              <p key={indice} className="text-sm">
                <span className="mr-1.5 font-mono text-xs text-muted-foreground">{hora(frase.inicioMs)}</span>
                <span className="font-semibold">{frase.nombre}:</span> {frase.texto}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
