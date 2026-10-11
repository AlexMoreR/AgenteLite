import { PendientesDelCoachTemperatura } from "./temperatura";
import type { EstadoDeAccion, TarjetaDeAccion } from "../../dominio/acciones-de-hoy";
import { ChipDeEstado, Cifra, Desplegable, Etiqueta, FilaDeChat, NOMBRE_DEL_ESTADO } from "./piezas";

const EJES: Array<{ clave: "V" | "N" | "A" | "S" | "C"; nombre: string }> = [
  { clave: "V", nombre: "Velocidad" },
  { clave: "N", nombre: "Necesidad" },
  { clave: "A", nombre: "Avance" },
  { clave: "S", nombre: "Seguimiento" },
  { clave: "C", nombre: "Comunicación" },
];

const nota = (v: number | null | undefined) => (typeof v === "number" ? v.toFixed(1).replace(".", ",") : "—");

/** Accion del formulario de estado: la server action en la app, "#" en la vista previa. */
export type AccionDeEstado = ((formData: FormData) => void | Promise<void>) | string;

function BotonesDeEstado({
  dia,
  userId,
  actual,
  accion,
}: {
  dia: string;
  userId: string;
  actual: EstadoDeAccion;
  accion: AccionDeEstado;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Marcar estado">
      {(["pendiente", "en_progreso", "cumplido"] as const).map((estado) => (
        <form key={estado} action={accion}>
          <input type="hidden" name="dia" value={dia} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="estado" value={estado} />
          <button
            type="submit"
            aria-pressed={actual === estado}
            className={`min-h-11 w-full rounded-md border px-1 text-xs font-medium transition ${
              actual === estado
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-muted"
            }`}
          >
            {NOMBRE_DEL_ESTADO[estado]}
          </button>
        </form>
      ))}
    </div>
  );
}

/**
 * La tarjeta de UNA asesora: arriba lo que tiene que hacer hoy (accion, cifra y meta); abajo, en
 * desplegables, la evidencia, el por que y el diagnostico completo del Coach. Nada abierto a la vez.
 */
export function TarjetaDeAccionCoach({
  tarjeta,
  dia,
  rotuloDelDia,
  accionDeEstado,
}: {
  tarjeta: TarjetaDeAccion;
  /** Dia del informe (para guardar el estado). */
  dia: string;
  /** "Ayer" o "10-oct". */
  rotuloDelDia: string;
  /** Sin accion (asesora que no es la de la tarjeta): no se muestran los botones. */
  accionDeEstado?: AccionDeEstado;
}) {
  const t = tarjeta;
  const operativos = t.errores.filter((e) => e.operativo);
  const suyos = t.errores.filter((e) => !e.operativo);
  const m = t.diagnostico.metricas;

  return (
    <article
      data-testid="tarjeta-accion"
      data-asesora={t.nombre}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-tight text-foreground">{t.nombre}</h3>
        <ChipDeEstado estado={t.estado.valor} />
      </header>

      {t.habilidad ? (
        <>
          <div className="space-y-1">
            <p className="text-lg font-semibold leading-snug text-foreground">{t.habilidad.nombre}</p>
            <p className="text-xs leading-snug text-muted-foreground">{t.porQue}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {t.situacion ? <Cifra rotulo={rotuloDelDia} valor={t.situacion.valor} detalle={t.situacion.texto} /> : null}
            {t.meta ? <Cifra rotulo="Meta hoy" valor={t.meta.texto} detalle={t.situacion?.texto} resaltada /> : null}
          </div>

          {t.queHacerHoy ? (
            <section className="space-y-0.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Qué hacer diferente hoy</h4>
              <p className="text-sm leading-snug text-foreground">{t.queHacerHoy}</p>
            </section>
          ) : null}
          {t.accion ? (
            <section className="space-y-0.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Acción</h4>
              <p className="text-sm leading-snug text-foreground">{t.accion}</p>
            </section>
          ) : null}
        </>
      ) : null}

      {t.faltantes.length ? (
        <ul className="space-y-1 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          {t.faltantes.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2">
        {t.habilidad ? (
          <Desplegable testId="ver-evidencia" titulo={<>Ver evidencia ({t.evidencia.length} chat{t.evidencia.length === 1 ? "" : "s"})</>}>
            {t.evidencia.length ? (
              <ul className="space-y-2">
                {t.evidencia.map((e, i) => (
                  <FilaDeChat
                    key={`${e.ref}-${i}`}
                    chat={e}
                    texto={e.texto}
                    etiquetas={e.operativo ? <Etiqueta tono="aviso">Posible problema operativo</Etiqueta> : null}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">El Coach no guardó chats de evidencia.</p>
            )}
            {t.mensajeModelo ? (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mensaje modelo</p>
                <p className="whitespace-pre-line rounded-md border border-border bg-background px-3 py-2 text-sm">{t.mensajeModelo}</p>
              </div>
            ) : null}
          </Desplegable>
        ) : null}

        {t.habilidad ? (
          <Desplegable testId="por-que" titulo="Por qué esta habilidad">
            <ol className="space-y-2">
              {t.cadena.map((p, i) => (
                <li key={p.paso} className="flex gap-2 text-sm">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{p.titulo}: </span>
                    <span className="text-muted-foreground">{p.texto}</span>
                  </span>
                </li>
              ))}
            </ol>
            {t.explicacion.ranking.length ? (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Impacto de cada habilidad</p>
                <ul className="space-y-0.5 text-sm">
                  {t.explicacion.ranking.map((r) => (
                    <li key={r.nombre} className="flex justify-between gap-2 border-b border-border py-1 last:border-0">
                      <span>{r.nombre}</span>
                      <span className="tabular-nums text-muted-foreground">{r.impacto.toString().replace(".", ",")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t.meta?.deDonde} La eligió el código del Coach con los conteos del día, no la IA · redacción:{" "}
              {t.explicacion.redactadoPor === "ia" ? "IA" : "plantilla"}.
              {t.explicacion.incluyeErrorDelEquipo ? " Incluye un error que también tuvo el equipo." : ""}
            </p>
            <p className="text-xs text-muted-foreground">{t.estado.detalle}</p>
          </Desplegable>
        ) : null}

        <Desplegable testId="diagnostico" titulo="Diagnóstico completo del día">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">Puntaje del día</span>
            <span className="text-sm">
              <span className="text-lg font-semibold tabular-nums">{nota(t.diagnostico.puntaje)}</span>/10
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center sm:grid-cols-5">
            {EJES.map((eje) => (
              <div key={eje.clave} className="rounded-md bg-muted px-1 py-1.5">
                <div className="truncate text-[10px] text-muted-foreground">{eje.nombre}</div>
                <div className="text-sm font-semibold tabular-nums">{nota(t.diagnostico.ejes?.[eje.clave])}</div>
              </div>
            ))}
          </div>
          {m ? (
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <li>{m.chats} chats juzgados</li>
              <li>{m.chatsQuietos} quietos</li>
              <li>{m.demoras} demoras</li>
              <li>{m.sinRespuesta} sin respuesta</li>
              <li>1.ª respuesta: {m.primeraRespuestaMedianaMin === null ? "—" : `${m.primeraRespuestaMedianaMin} min`}</li>
              <li>{m.cotizaciones} con cotización</li>
              <li>{m.ganados} ganados</li>
              <li>{m.atribucionIncierta} atribución incierta</li>
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Sin métricas guardadas.</p>
          )}
          {t.diagnostico.loQueHizoBien ? (
            <p className="text-sm">
              <span className="font-medium">Lo que hizo bien: </span>
              {t.diagnostico.loQueHizoBien}
            </p>
          ) : null}

          <Desplegable titulo={`Aciertos (${t.aciertos.length})`}>
            {t.aciertos.length ? (
              <ul className="space-y-2">
                {t.aciertos.map((a, i) => (
                  <FilaDeChat key={`${a.ref}-${i}`} chat={a} texto={a.texto} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin aciertos guardados.</p>
            )}
          </Desplegable>

          <Desplegable titulo={`Errores de la asesora (${suyos.length})`}>
            {suyos.length ? (
              <ul className="space-y-2">
                {suyos.map((e, i) => (
                  <FilaDeChat key={`${e.ref}-${e.tipo}-${i}`} chat={e} texto={e.texto} etiquetas={<Etiqueta>{e.tipoNombre}</Etiqueta>} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin errores detectados.</p>
            )}
          </Desplegable>

          {operativos.length ? (
            <Desplegable titulo={`Movidos al Supervisor (${operativos.length})`}>
              <p className="text-xs text-muted-foreground">
                El Coach los guardó en esta asesora, pero el texto apunta al sistema o a la operación. No cambian su habilidad ni
                sus conteos.
              </p>
              <ul className="space-y-2">
                {operativos.map((e, i) => (
                  <FilaDeChat
                    key={`${e.ref}-${e.tipo}-op-${i}`}
                    chat={e}
                    texto={e.texto}
                    etiquetas={
                      <>
                        <Etiqueta>{e.tipoNombre}</Etiqueta>
                        <Etiqueta tono="aviso">{e.dudoso ? "Operativo · revisar" : "Operativo"}</Etiqueta>
                      </>
                    }
                    extra={e.regla ? <p className="text-[11px] text-muted-foreground">Regla: {e.regla}</p> : null}
                  />
                ))}
              </ul>
            </Desplegable>
          ) : null}

          <Desplegable titulo={`Pendientes para hoy (${t.pendientes.length})`}>
            {t.pendientes.length ? (
              <ul className="space-y-2">
                {t.pendientes.map((p, i) => (
                  <FilaDeChat
                    key={`${p.ref}-${i}`}
                    chat={p}
                    texto={p.porque}
                    etiquetas={
                      <>
                        <PendientesDelCoachTemperatura temperatura={p.temperatura} />
                        {p.urgente ? <Etiqueta tono="peligro">Sin respuesta</Etiqueta> : null}
                        {p.operativo ? <Etiqueta tono="aviso">Causa operativa</Etiqueta> : null}
                      </>
                    }
                    extra={
                      p.siguienteMensaje ? (
                        <p className="rounded-md bg-muted px-2 py-1.5 text-sm text-foreground">
                          <span className="text-xs text-muted-foreground">Sugerido: </span>
                          {p.siguienteMensaje}
                        </p>
                      ) : null
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin pendientes: no quedaron clientes calientes ni tibios.</p>
            )}
          </Desplegable>
        </Desplegable>
      </div>

      {accionDeEstado && t.habilidad ? (
        <div className="space-y-1">
          <BotonesDeEstado dia={dia} userId={t.userId} actual={t.estado.valor} accion={accionDeEstado} />
          {t.estado.origen === "automatico" ? <p className="text-[11px] text-muted-foreground">{t.estado.detalle}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
