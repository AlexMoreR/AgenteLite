"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, GitBranch, Loader2, RotateCcw, Rocket, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { aprobarTarjetaAction, cambiarZonasAction } from "@/app/actions/tableros-inteligentes-actions";
import {
  NOMBRE_DE_LA_ZONA,
  NOMBRE_DEL_REPO,
  esRepo,
  esZona,
  type MomentoDeAprobacion,
} from "../services/reglas-trabajador";
import type { TarjetaVista } from "../services/tableros";

/*
  La parte de la ficha del Tablero IA que es del TRABAJADOR (fase 2) y de las aprobaciones: el repo,
  la zona protegida, el plan, el resultado (resumen, pruebas, pasó sí/no, link de la rama, el error) y
  los botones según el estado y quién mira:
  - "Aprobar tarea" (POR_APROBAR) y "Aprobar plan" (PLAN_LISTO): quien puede aprobar.
  - "Sí, subir a producción" (POR_REVISAR, con todo pasado): SOLO el dueño, con confirmación. Desde el
    21-oct-2026 lo normal es que suba sola (EN_CURSO -> SUBIENDO -> HECHO, con el link del commit);
    POR_REVISAR queda para las que tocan una zona protegida (chats, agentes, libro V3, Meta Ads) y
    acá se dice cuál.
  - "Reintentar" (ERROR): con el plan que ya tiene (si tiene) o planeando de nuevo.
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

const BOTON = "h-11 w-full text-base";

export function TrabajoDeLaTarjeta({ tarjeta, pideAprobacion, puedeAprobar, esDueno, alCambiar }: Props) {
  const [ocupado, empezar] = useTransition();
  const [confirmarSubida, setConfirmarSubida] = useState(false);
  const resultado = tarjeta.resultado;
  const conZona = tarjeta.zonaProtegida.length > 0;
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

  if (!pideAprobacion) return null;

  const estado = tarjeta.estado;
  const repo = tarjeta.repo && esRepo(tarjeta.repo) ? NOMBRE_DEL_REPO[tarjeta.repo] : tarjeta.repo;
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
      {conZona ? espera("Toca una zona protegida: se aprueba solo en esta pantalla, y solo el dueño.") : null}

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

      {estado === "APROBADO" && tarjeta.repo ? espera("Aprobada: el trabajador la toma en el próximo minuto y escribe el plan.") : null}
      {estado === "PLANEANDO" ? espera("El trabajador está escribiendo el plan…") : null}
      {estado === "PLAN_APROBADO" ? espera("Plan aprobado: el trabajador la toma en el próximo minuto y la construye.") : null}
      {estado === "EN_CURSO" && tarjeta.repo ? espera("El trabajador la está construyendo y probando en su rama…") : null}
      {estado === "SUBIENDO"
        ? espera(
            resultado?.subeSolo && !conZona
              ? "Pasó todo y sube solo: el trabajador la sube a producción, espera el CI y comprueba la versión…"
              : "Subiendo a producción: el trabajador espera el CI y comprueba la versión…",
          )
        : null}

      {estado === "PLAN_LISTO" ? (
        puedeEstaTarjeta ? (
          <Button className={BOTON} onClick={() => aprobar("plan", "Plan aprobado")} disabled={ocupado}>
            {ocupado ? <Loader2 className="animate-spin" /> : <Check />}
            Aprobar plan
          </Button>
        ) : (
          espera("El plan espera la aprobación del dueño.")
        )
      ) : null}

      {estado === "POR_REVISAR" && resultado?.paso === true
        ? espera(
            conZona
              ? `Espera tu sí porque toca ${tarjeta.zonaProtegida.map((zona) => (esZona(zona) ? NOMBRE_DE_LA_ZONA[zona] : zona)).join(", ")}: no sube sola.`
              : "Espera tu sí: el trabajador no la subió solo (todavía no sube solo en este repositorio, o es de antes).",
          )
        : null}
      {estado === "POR_REVISAR" ? (
        esDueno && resultado?.paso === true ? (
          <Button className={BOTON} onClick={() => setConfirmarSubida(true)} disabled={ocupado}>
            <Rocket />
            Sí, subir a producción
          </Button>
        ) : resultado?.paso !== true ? (
          espera("El trabajador no dijo que todo pasó: no se puede subir. Revisa el resultado.")
        ) : (
          espera("Lista en su rama: el sí final lo da solo el dueño.")
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

      {estado === "ERROR" && resultado?.error?.motivo ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100">
          <p className="text-xs font-medium">Falló{resultado.error.en ? ` (en ${resultado.error.en})` : ""}</p>
          <p className="mt-0.5 whitespace-pre-wrap">{resultado.error.motivo}</p>
        </div>
      ) : null}

      {tarjeta.plan ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Plan del trabajador</p>
          <p className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-relaxed">{tarjeta.plan}</p>
        </div>
      ) : null}

      {resultado?.resumen ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Resultado · {resultado.paso ? "pasó todo" : "NO pasó"}
            {tarjeta.intentos > 1 ? ` · intento ${tarjeta.intentos}` : ""}
          </p>
          <p className="whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-relaxed">{resultado.resumen}</p>
          {resultado.pruebas ? (
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs">
              {resultado.pruebas}
            </p>
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

      <Dialog open={confirmarSubida} onOpenChange={setConfirmarSubida}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Subir a producción?</DialogTitle>
            <DialogDescription>
              “{tarjeta.titulo}” se sube a main{repo ? ` de ${repo}` : ""} y se despliega solo. El trabajador vuelve a probar
              todo antes de subir y, si algo falla, no sube y queda en Error.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={() => aprobar("subir", "Sí final: se sube a producción")} disabled={ocupado}>
              {ocupado ? <Loader2 className="animate-spin" /> : <Rocket />}
              Sí, subir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
