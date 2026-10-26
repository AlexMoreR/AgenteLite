"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Check, ChevronRight, ExternalLink, Gauge, GitBranch, Loader2, RotateCcw, Rocket, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  aprobarTarjetaAction,
  cambiarRiesgoAction,
  cambiarZonasAction,
  marcarHechoAManoAction,
} from "@/app/actions/tableros-inteligentes-actions";
import {
  NOMBRE_DE_LA_ZONA,
  NOMBRE_DEL_REPO,
  esRepo,
  esZona,
  zonasQuePidenTuSi,
  type MomentoDeAprobacion,
} from "../services/reglas-trabajador";
import { dondeSeConstruyo, textoDeModelos } from "../services/modelos-del-coordinador";
import { resumenCorto } from "../services/resumen-corto";
import type { TarjetaVista } from "../services/tableros";

/*
  La parte de la ficha del Tablero IA que es del Coordinador (fase 2) y de las aprobaciones, en dos
  piezas (23-oct-2026, pedido de Alexander: la ficha tenía demasiado texto técnico):
  - TrabajoDeLaTarjeta (arriba): el repo, la zona protegida, un RESUMEN CORTO en lenguaje sencillo
    (services/resumen-corto.ts), el error si falló y el botón que toca según el estado.
  - DetallesTecnicos (abajo): el acordeón cerrado "Ver detalles" con el detalle completo, el plan, el
    resumen completo, los archivos tocados, el log de pruebas, la rama, el commit, la migración y lo que
    le pase la ficha (el historial de aprobaciones).
  Los botones según el estado y quién mira:
  - "Aprobar tarea" (POR_APROBAR) y "Aprobar plan" (PLAN_LISTO): quien puede aprobar.
  - "Sí, subir" (POR_REVISAR, con todo pasado): SOLO el dueño (SI_FINAL_SOLO_DUENO: el servidor rechaza a
    cualquier otro, ADMIN de plataforma incluido). Grande, arriba y con confirmación en la misma pantalla
    ("Se sube a producción. ¿Seguro?"), sin window.confirm. Con zona protegida también sale: la
    aprobación en pantalla es justo lo que esas zonas exigen. Desde el 21-oct-2026 lo normal es que suba
    sola (EN_CURSO -> SUBIENDO -> HECHO, con el link del commit); POR_REVISAR queda para las que tocan
    chats (el bot de ventas, Meta Ads y el libro V3 suben solos desde el 24-oct-2026, con vigilancia de
    30 minutos: "Subió sola (zona X) — vigilancia 30 min OK" o "Revertida: motivo") o lo que gasta plata
    en Meta Ads, y acá se dice cuál.
  - "Reintentar" (ERROR): con el plan que ya tiene (si tiene) o planeando de nuevo.
  - "Marcar hecho a mano" (ERROR, FALLIDO o POR_REVISAR, con repo): SOLO el dueño. Abre un panel con la
    nota (obligatoria) y el commit (opcional); el servidor revisa todo (puedeMarcarHechoAMano).
  - Quitar una zona protegida: solo el dueño.
  Los botones son una ayuda: el servidor vuelve a revisar todo (reglas-trabajador.ts). Cada aprobación
  queda en el historial con el nombre de quien aprobó y "pantalla".
*/

type Props = {
  tarjeta: TarjetaVista;
  /** El tipo de la tarjeta pide aprobación (y tiene estados). */
  pideAprobacion: boolean;
  /** Puede aprobar la tarea y el plan (dueño, ADMIN o aprobador; el alcance lo revisa el servidor). */
  puedeAprobar: boolean;
  /** Dueño del negocio: el sí final y quitar zonas protegidas. */
  esDueno: boolean;
  alCambiar: () => void;
};

const QUIEN_DEL_RIESGO: Record<string, string> = { CLAUDE: "Claude", TRABAJADOR: "el Coordinador", DUENO: "el dueño" };

/** "· Ver la sesión": el link de la sesión de Claude en la nube (ya validado: solo claude.ai/code/session_…). */
function EnlaceDeLaSesion({ link }: { link: string }) {
  return (
    <>
      {" · "}
      <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
        Ver la sesión
        <ExternalLink className="size-3" />
      </a>
    </>
  );
}

const BOTON = "h-11 w-full text-base";
const BOTON_GRANDE = "h-14 w-full text-lg font-semibold";

export function TrabajoDeLaTarjeta({ tarjeta, pideAprobacion, puedeAprobar, esDueno, alCambiar }: Props) {
  const [ocupado, empezar] = useTransition();
  const [confirmarSubida, setConfirmarSubida] = useState(false);
  const [hechoAMano, setHechoAMano] = useState(false);
  const [nota, setNota] = useState("");
  const [commit, setCommit] = useState("");
  const resultado = tarjeta.resultado;
  const conZona = tarjeta.zonaProtegida.length > 0;
  // Bot de ventas, Meta Ads y libro V3 ya no piden el sí final (24-oct-2026): suben solas. Solo chats lo sigue pidiendo.
  const zonasQuePiden = zonasQuePidenTuSi(tarjeta.zonaProtegida);
  // Con zona protegida aprueba solo el dueño (lo dice el servidor; acá solo no se ofrece el botón).
  const puedeEstaTarjeta = puedeAprobar && (!conZona || esDueno);

  const aprobar = (momento: MomentoDeAprobacion, listo: string) => {
    const vistaEn = tarjeta.actualizadoEn;
    empezar(async () => {
      const respuesta = await aprobarTarjetaAction(tarjeta.id, momento, vistaEn);
      if (respuesta.ok) toast.success(listo);
      else toast.error(respuesta.error);
      setConfirmarSubida(false);
      alCambiar();
    });
  };

  const marcarHechoAMano = () => {
    const vistaEn = tarjeta.actualizadoEn;
    empezar(async () => {
      const respuesta = await marcarHechoAManoAction(tarjeta.id, nota, commit.trim() || undefined, vistaEn);
      if (respuesta.ok) {
        toast.success("Marcada hecha a mano");
        setHechoAMano(false);
        setNota("");
        setCommit("");
      } else toast.error(respuesta.error);
      alCambiar();
    });
  };

  const quitarZona = (zona: string) => {
    empezar(async () => {
      const respuesta = await cambiarZonasAction(
        tarjeta.id,
        tarjeta.zonaProtegida.filter((otra) => otra !== zona),
      );
      if (respuesta.ok) toast.success("Zona protegida quitada");
      else toast.error(respuesta.error);
      alCambiar();
    });
  };

  const cambiarRiesgo = (riesgo: "BAJO" | "ALTO") => {
    empezar(async () => {
      const respuesta = await cambiarRiesgoAction(tarjeta.id, riesgo);
      if (respuesta.ok) toast.success(riesgo === "BAJO" ? "Riesgo bajo" : "Riesgo alto");
      else toast.error(respuesta.error);
      alCambiar();
    });
  };

  if (!pideAprobacion) return null;

  const estado = tarjeta.estado;
  // Sin riesgo puesto cuenta como alto. Mientras el Coordinador la tiene no se cambia.
  const riesgoBajo = tarjeta.riesgo === "BAJO";
  const coordinadorLaTiene = estado === "PLANEANDO" || estado === "EN_CURSO" || estado === "SUBIENDO";
  const quienPusoElRiesgo = tarjeta.riesgoPor ? ` (lo puso ${QUIEN_DEL_RIESGO[tarjeta.riesgoPor] ?? tarjeta.riesgoPor})` : "";
  const textoDelRiesgo = tarjeta.riesgo
    ? `${riesgoBajo ? "Riesgo bajo" : "Riesgo alto"}${tarjeta.riesgoMotivo ? `: ${tarjeta.riesgoMotivo}` : ""}${quienPusoElRiesgo}`
    : "Riesgo alto: sin riesgo puesto, cuenta como alto.";
  const repo = tarjeta.repo && esRepo(tarjeta.repo) ? NOMBRE_DEL_REPO[tarjeta.repo] : tarjeta.repo;
  const resumen = resumenCorto({ resultadoResumen: resultado?.resumen, plan: tarjeta.plan, detalle: tarjeta.detalle });
  const modelosTexto = textoDeModelos(tarjeta.plan, resultado?.modelo);
  // "Construida en: aizen1 / la nube" y el link de la sesión (25-oct-2026).
  const donde = dondeSeConstruyo(estado, resultado);
  const espera = (texto: string) => (
    <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{texto}</p>
  );

  return (
    <div className="space-y-3">
      {repo || conZona ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {repo ? (
            <span className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
              <GitBranch className="size-3.5" />
              {repo}
            </span>
          ) : null}
          {tarjeta.repo ? (
            <span
              className={
                riesgoBajo
                  ? "flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
                  : "flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
              }
              title={textoDelRiesgo}
            >
              <Gauge className="size-3.5" />
              {riesgoBajo ? "Riesgo bajo" : "Riesgo alto"}
              {esDueno && !coordinadorLaTiene ? (
                <button
                  type="button"
                  className="-mr-1 rounded-full px-1.5 py-0.5 font-medium underline-offset-2 hover:underline"
                  onClick={() => cambiarRiesgo(riesgoBajo ? "ALTO" : "BAJO")}
                  disabled={ocupado}
                  aria-label={riesgoBajo ? "Cambiar el riesgo a alto" : "Cambiar el riesgo a bajo"}
                  title={riesgoBajo ? "Marcarla de riesgo alto: pedirá tu aprobación" : "Marcarla de riesgo bajo (solo si las reglas no ven riesgo alto)"}
                >
                  {riesgoBajo ? "Poner alto" : "Poner bajo"}
                </button>
              ) : null}
            </span>
          ) : null}
          {tarjeta.zonaProtegida.map((zona) => (
            <span
              key={zona}
              className="flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-100"
            >
              <ShieldAlert className="size-3.5" />
              {esZona(zona) ? NOMBRE_DE_LA_ZONA[zona] : zona}
              {esDueno ? (
                <button
                  type="button"
                  className="-mr-1 rounded-full p-0.5 hover:bg-red-100 dark:hover:bg-red-900"
                  onClick={() => quitarZona(zona)}
                  disabled={ocupado}
                  aria-label={`Quitar la zona protegida ${zona}`}
                  title="Quitar la zona protegida (solo el dueño)"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {tarjeta.repo ? <p className="text-xs text-muted-foreground">{textoDelRiesgo}</p> : null}

      {modelosTexto ? <p className="text-xs text-muted-foreground">{modelosTexto}</p> : null}

      {resumen ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {resumen.fuente === "resultado" ? "Qué hizo" : resumen.fuente === "plan" ? "Qué se cambia" : "De qué se trata"}
            {resultado && estado !== "ERROR" ? ` · ${resultado.paso ? "pasó todo" : "NO pasó"}` : ""}
          </p>
          <p className="text-base leading-relaxed">{resumen.texto}</p>
        </div>
      ) : null}

      {zonasQuePiden.length ? espera("Toca una zona protegida (chats): se aprueba solo en esta pantalla, y solo el dueño.") : null}
      {conZona && !zonasQuePiden.length
        ? espera("Zona protegida que sube sola: si compila y pasa las pruebas sube sin tu sí, y el Coordinador vigila 30 minutos. Lo que gasta plata en Meta Ads sí espera tu sí.")
        : null}
      {resultado?.subida?.resumenVigilancia ? (
        <p className="rounded-lg border border-primary/40 px-3 py-2 text-xs font-medium">{resultado.subida.resumenVigilancia}</p>
      ) : null}
      {estado === "ERROR" && resultado?.error?.motivo?.startsWith("Revertida:") ? (
        <p className="rounded-lg border border-destructive/40 px-3 py-2 text-xs font-medium">{resultado.error.motivo.split("\n")[0]}</p>
      ) : null}

      {estado === "POR_APROBAR" ? (
        puedeEstaTarjeta ? (
          <Button className={BOTON} onClick={() => aprobar("tarea", "Tarea aprobada")} disabled={ocupado}>
            {ocupado ? <Loader2 className="animate-spin" /> : <Check />}
            Aprobar tarea
          </Button>
        ) : (
          espera("Espera la aprobación del dueño.")
        )
      ) : null}

      {estado === "APROBADO" && tarjeta.repo ? espera("Aprobada: el Coordinador la toma en el próximo minuto y escribe el plan.") : null}
      {tarjeta.reparaciones > 0 && (estado === "APROBADO" || estado === "PLAN_APROBADO")
        ? espera(`Falló y está en reparación (${tarjeta.reparaciones} de 3): el Coordinador la toma enseguida con la causa y el error exacto.`)
        : null}
      {estado === "PLANEANDO" ? espera("El Coordinador está escribiendo el plan…") : null}
      {estado === "PLAN_APROBADO" ? espera("Plan aprobado: el Coordinador la toma en el próximo minuto y la construye.") : null}
      {estado === "EN_CURSO" && tarjeta.repo ? (
        donde?.lugar === "nube" ? (
          <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {donde.texto}
            {donde.link ? <EnlaceDeLaSesion link={donde.link} /> : null}
          </p>
        ) : (
          espera("El Coordinador la está construyendo y probando en su rama…")
        )
      ) : null}
      {donde && estado !== "EN_CURSO" ? (
        <p className="text-xs text-muted-foreground">
          {donde.texto}
          {donde.link ? <EnlaceDeLaSesion link={donde.link} /> : null}
        </p>
      ) : null}
      {estado === "SUBIENDO"
        ? espera(
            resultado?.subeSolo && !conZona
              ? "Pasó todo y sube solo: el Coordinador la sube a producción, espera el CI y comprueba la versión…"
              : "Subiendo a producción: el Coordinador espera el CI y comprueba la versión…",
          )
        : null}

      {estado === "PLAN_LISTO" ? (
        puedeEstaTarjeta ? (
          <Button className={BOTON} onClick={() => aprobar("plan", "Plan aprobado")} disabled={ocupado}>
            {ocupado ? <Loader2 className="animate-spin" /> : <Check />}
            Aprobar plan
          </Button>
        ) : (
          espera("El plan espera la aprobación del dueño (toca dinero de Gestión o gasto en Meta Ads, tiene zona protegida, o “Aprobar planes solo” está apagado).")
        )
      ) : null}

      {estado === "POR_REVISAR" && resultado?.paso === true
        ? espera(
            conZona
              ? `Espera tu sí porque toca ${tarjeta.zonaProtegida.map((zona) => (esZona(zona) ? NOMBRE_DE_LA_ZONA[zona] : zona)).join(", ")}: no sube sola.`
              : "Espera tu sí: el Coordinador no la subió solo (todavía no sube solo en este repositorio, o es de antes).",
          )
        : null}
      {estado === "POR_REVISAR" ? (
        resultado?.paso !== true ? (
          espera("El Coordinador no dijo que todo pasó: no se puede subir. Revisa el resultado en “Ver detalles”.")
        ) : !esDueno ? (
          espera("Lista en su rama: el sí final lo da solo el dueño.")
        ) : confirmarSubida ? (
          <div role="alertdialog" aria-label="Confirmar la subida a producción" className="space-y-3 rounded-lg border-2 border-primary p-3">
            <p className="text-base font-medium">Se sube a producción. ¿Seguro?</p>
            <div className="flex gap-2">
              <Button variant="outline" className="h-12 flex-1 text-base" onClick={() => setConfirmarSubida(false)} disabled={ocupado}>
                Cancelar
              </Button>
              <Button className="h-12 flex-1 text-base" onClick={() => aprobar("subir", "Sí final: se sube a producción")} disabled={ocupado}>
                {ocupado ? <Loader2 className="animate-spin" /> : <Rocket />}
                Confirmar
              </Button>
            </div>
          </div>
        ) : (
          <Button className={BOTON_GRANDE} onClick={() => setConfirmarSubida(true)} disabled={ocupado}>
            <Rocket className="size-5" />
            Sí, subir
          </Button>
        )
      ) : null}

      {estado === "ERROR" && puedeEstaTarjeta ? (
        <div className="space-y-2">
          <Button
            className={BOTON}
            variant="outline"
            onClick={() => (tarjeta.plan ? aprobar("plan", "Reintentando con el mismo plan") : aprobar("tarea", "Reintentando"))}
            disabled={ocupado}
          >
            {ocupado ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Reintentar
          </Button>
          {tarjeta.plan ? (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => aprobar("tarea", "Se planea de nuevo")} disabled={ocupado}>
              Planear de nuevo (descarta el plan)
            </Button>
          ) : null}
        </div>
      ) : null}

      {esDueno && tarjeta.repo && (estado === "ERROR" || estado === "FALLIDO" || estado === "POR_REVISAR") ? (
        hechoAMano ? (
          <div role="dialog" aria-label="Marcar hecho a mano" className="space-y-3 rounded-lg border-2 border-primary p-3">
            <p className="text-base font-medium">Marcar hecho a mano</p>
            <p className="text-xs text-muted-foreground">
              Para un cambio que ya se terminó por fuera del Coordinador. La tarjeta queda Hecha y sale de “Te toca a ti”; lo que dejó el
              Coordinador (plan, rama, error) se conserva.
              {estado === "POR_REVISAR" ? " Lo que hay en su rama no se va a subir." : ""}
            </p>
            <div className="space-y-1">
              <Label htmlFor={`nota-${tarjeta.id}`}>Qué se hizo (obligatorio)</Label>
              <Textarea
                id={`nota-${tarjeta.id}`}
                value={nota}
                maxLength={500}
                onChange={(evento) => setNota(evento.target.value)}
                placeholder="Ej.: Lo subió Claude Code a mano a aizen1"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`commit-${tarjeta.id}`}>Commit (opcional)</Label>
              <Input
                id={`commit-${tarjeta.id}`}
                value={commit}
                maxLength={300}
                onChange={(evento) => setCommit(evento.target.value)}
                placeholder="Código del cambio o link de GitHub"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="h-12 flex-1 text-base" onClick={() => setHechoAMano(false)} disabled={ocupado}>
                Cancelar
              </Button>
              <Button className="h-12 flex-1 text-base" onClick={marcarHechoAMano} disabled={ocupado || !nota.trim()}>
                {ocupado ? <Loader2 className="animate-spin" /> : <Check />}
                Marcar hecha
              </Button>
            </div>
          </div>
        ) : (
          <Button className={BOTON} variant="outline" onClick={() => setHechoAMano(true)} disabled={ocupado}>
            <Check />
            Marcar hecho a mano
          </Button>
        )
      ) : null}

      {estado === "ERROR" && resultado?.error?.motivo ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100">
          <p className="text-xs font-medium">Por qué está en ERROR{resultado.error.en ? ` (falló en ${resultado.error.en})` : ""}</p>
          <p className="mt-0.5 whitespace-pre-wrap">{resultado.error.motivo}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * El acordeón "Ver detalles" (cerrado por defecto) con todo lo técnico de la tarjeta. `children` va al
 * final (la ficha le pasa el historial). Si la tarjeta no pide aprobación solo muestra `children`.
 */
export function DetallesTecnicos({
  tarjeta,
  pideAprobacion,
  children,
}: {
  tarjeta: TarjetaVista;
  pideAprobacion: boolean;
  children?: ReactNode;
}) {
  const resultado = tarjeta.resultado;
  const detalle = tarjeta.detalle?.trim();
  const hay = Boolean(detalle || tarjeta.plan || resultado || tarjeta.resultado?.error?.motivo || children);
  if (!pideAprobacion || !hay) return <>{children}</>;

  return (
    <details className="group rounded-lg border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        Ver detalles
      </summary>
      <div className="space-y-4 border-t px-3 py-3 [overflow-wrap:anywhere]">
        {detalle ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Detalle de la tarjeta</p>
            <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">{detalle}</p>
          </div>
        ) : null}

        {tarjeta.plan ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Plan del Coordinador</p>
            <p className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-relaxed">{tarjeta.plan}</p>
          </div>
        ) : null}

        {resultado?.resumen ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Resultado · {resultado.paso ? "pasó todo" : "NO pasó"}
              {tarjeta.intentos > 1 ? ` · intento ${tarjeta.intentos}` : ""}
            </p>
            <p className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-relaxed">{resultado.resumen}</p>
            {resultado.pruebas ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Pruebas</p>
                <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs">
                  {resultado.pruebas}
                </p>
              </div>
            ) : null}
            {resultado.migracion ? <p className="text-xs text-muted-foreground">Migración: {resultado.migracion}</p> : null}
            {resultado.linkRama ? (
              <Button
                variant="outline"
                className="h-10 w-full justify-start"
                render={<a href={resultado.linkRama} target="_blank" rel="noopener noreferrer" />}
              >
                <ExternalLink />
                <span className="truncate">Ver la rama {resultado.rama ?? ""}</span>
              </Button>
            ) : resultado.rama ? (
              <p className="text-xs text-muted-foreground">Rama: {resultado.rama}</p>
            ) : null}
            {resultado.linkWorkflow ? (
              <Button
                variant="outline"
                className="h-10 w-full justify-start"
                render={<a href={resultado.linkWorkflow} target="_blank" rel="noopener noreferrer" />}
              >
                <ExternalLink />
                <span className="truncate">Ver workflow de GitHub Actions</span>
              </Button>
            ) : null}
            {resultado.subida?.commit && resultado.subida.linkCommit ? (
              <Button
                variant="outline"
                className="h-10 w-full justify-start"
                render={<a href={resultado.subida.linkCommit} target="_blank" rel="noopener noreferrer" />}
              >
                <ExternalLink />
                <span className="truncate">En producción: commit {resultado.subida.commit.slice(0, 10)}</span>
              </Button>
            ) : resultado.subida?.commit ? (
              <p className="text-xs text-muted-foreground">Subida: commit {resultado.subida.commit.slice(0, 10)}</p>
            ) : null}
          </div>
        ) : null}

        {resultado?.error?.motivo ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Error completo{resultado.error.en ? ` (en ${resultado.error.en})` : ""}</p>
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm">{resultado.error.motivo}</p>
          </div>
        ) : null}

        {children}
      </div>
    </details>
  );
}
