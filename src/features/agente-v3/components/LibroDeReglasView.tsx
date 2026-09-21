"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleDot, MessageSquare, Sparkles, TriangleAlert } from "lucide-react";

import { pesoDeLaRegla, type Accion, type LibroDeReglas, type ReglaV3 } from "../domain/reglas";

/**
 * El libro de reglas, para mirar.
 *
 * Esta pantalla NO edita: el libro se dicta hablando con Claude y acá se ve lo que quedó (Alex,
 * 21-sep-2026). Es la contrapartida del trato: si una máquina escribe las reglas del negocio,
 * tiene que haber un lugar donde el dueño las lea en su idioma y diga "esto no es lo que pedí".
 *
 * Se refresca sola cada pocos segundos: la idea es tenerla abierta al lado del chat y ver aparecer
 * cada regla mientras se dicta.
 */

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function comoSeLeeElDisparador(regla: ReglaV3): string {
  switch (regla.cuando.tipo) {
    case "frase":
      return `Si el cliente dice ${regla.cuando.frases.map((frase) => `«${frase}»`).join(" o ")}`;
    case "intencion":
      return `Si lo que pide encaja con: ${regla.cuando.descripcion}`;
    case "paso":
      return `Cuando viene hablando de ${regla.cuando.producto} y está en el paso ${regla.cuando.paso}`;
    case "sin_respuesta":
      return `Si pasan ${regla.cuando.minutos} minutos sin que conteste`;
    default:
      return "Siempre";
  }
}

function comoSeLeeLaCondicion(regla: ReglaV3): string | null {
  const soloSi = regla.soloSi;
  if (!soloSi) {
    return null;
  }
  const partes: string[] = [];
  if (soloSi.productoActivo === "ninguno") partes.push("todavía no eligió producto");
  else if (soloSi.productoActivo === "cualquiera") partes.push("ya está hablando de algún producto");
  else if (soloSi.productoActivo) partes.push(`está hablando de ${soloSi.productoActivo}`);
  if (soloSi.pasoActual) partes.push(`está en el paso ${soloSi.pasoActual}`);
  if (soloSi.noSiYaSeEnvio) partes.push(`no se le mandó todavía ${soloSi.noSiYaSeEnvio}`);
  if (soloSi.esPrimerMensaje === true) partes.push("es su primer mensaje");
  if (soloSi.esPrimerMensaje === false) partes.push("no es su primer mensaje");
  return partes.length ? `solo si ${partes.join(", y ")}` : null;
}

function comoSeLeeLaAccion(accion: Accion): string {
  switch (accion.tipo) {
    case "mensaje":
      return `Responde: «${accion.texto}»`;
    case "flujo":
      return `Envía ${accion.titulo ?? accion.flujoId}`;
    case "responder_con_ia":
      return `Contesta con IA, guiada por: ${accion.guia}`;
    case "activar_producto":
      return `Toma como producto de la charla: ${accion.nombre ?? accion.productoId}`;
    case "ir_al_paso":
      return `Pasa al paso ${accion.paso}`;
    case "cambiar_etapa_crm":
      return `Mueve la etapa a ${accion.etapa}`;
    case "avisar_asesor":
      return `Avisa a un asesor: ${accion.motivo}`;
    default:
      return "Pausa la IA";
  }
}

export function LibroDeReglasView({ libro, problemas }: { libro: LibroDeReglas; problemas: string[] }) {
  const router = useRouter();

  // Se refresca sola: la pantalla está pensada para quedar abierta mientras se dicta el libro.
  useEffect(() => {
    const reloj = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(reloj);
  }, [router]);

  // Se muestran en el ORDEN EN QUE MANDAN, no en el que se escribieron: es la única forma de
  // entender de un vistazo por qué gana una y no otra.
  const enOrden = [...libro.reglas]
    .map((regla, orden) => ({ regla, orden }))
    .sort((a, b) => pesoDeLaRegla(a.regla) - pesoDeLaRegla(b.regla) || a.orden - b.orden);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Agente V3 · Libro de reglas</h1>
        <p className="text-sm text-muted-foreground">
          Esto es lo que el agente hace, en orden de quién manda primero. Se escribe hablando con Claude;
          acá se mira. Todavía <b>no atiende clientes</b>: se prueba en el simulador.
        </p>
        <p className="text-[12px] text-muted-foreground">
          Versión {libro.version} · {libro.actualizadoEl.startsWith("1970") ? "sin cambios todavía" : `última edición ${CUANDO.format(new Date(libro.actualizadoEl))}`}
        </p>
      </div>

      <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MessageSquare className="size-4" /> Cómo habla el negocio
        </h2>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {libro.comoHablamos.trim() || "Todavía sin escribir. Contale a Claude qué vende el negocio y cómo querés que hable."}
        </p>
      </section>

      {problemas.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
            <TriangleAlert className="size-4" /> Para revisar
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-amber-900/90 dark:text-amber-100/90">
            {problemas.map((problema) => (
              <li key={problema}>{problema}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {enOrden.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-border p-8 text-center">
          <Sparkles className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">El libro está vacío</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Abrí Claude con el conector de AizenCRM y decile: <i>“empecemos el libro de reglas del V3”</i>.
            Te va a preguntar por el negocio y cada respuesta va a aparecer acá.
          </p>
        </section>
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Reglas ({enOrden.length})</h2>
          {enOrden.map(({ regla }, posicion) => (
            <article
              key={regla.id}
              className={`rounded-2xl border p-4 ${regla.activa ? "border-border bg-card" : "border-dashed border-border bg-muted/30"}`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {posicion + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    {regla.nombre}
                    {regla.activa ? null : <span className="ml-2 text-[11px] text-muted-foreground">(apagada)</span>}
                  </p>

                  <p className="text-[13px] text-muted-foreground">
                    <CircleDot className="mr-1 inline size-3" />
                    {comoSeLeeElDisparador(regla)}
                    {comoSeLeeLaCondicion(regla) ? `, ${comoSeLeeLaCondicion(regla)}` : ""}
                  </p>

                  <ul className="space-y-1">
                    {regla.entonces.map((accion, indice) => (
                      <li key={indice} className="flex items-start gap-1.5 text-[13px] text-foreground">
                        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">{comoSeLeeLaAccion(accion)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          ))}
          <p className="text-[12px] text-muted-foreground">
            Van en orden de quién manda: lo más específico primero. Si dos encajan con el mismo mensaje, gana
            la de arriba.
          </p>
        </section>
      )}
    </div>
  );
}
