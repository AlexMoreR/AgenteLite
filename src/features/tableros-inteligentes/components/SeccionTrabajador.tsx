"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Bot, Copy, KeyRound, Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  agregarAprobadorAction,
  cambiarAprobacionAutomaticaAction,
  cambiarAprobarPlanesSoloAction,
  cambiarAprobarTareasSoloAction,
  cambiarAvisosAlEquipoAction,
  crearClaveTrabajadorAction,
  panelTrabajadorAction,
  quitarAprobadorAction,
  revocarClaveTrabajadorAction,
  type PanelTrabajadorVista,
} from "@/app/actions/tableros-inteligentes-actions";

/*
  Sección "Coordinador" de la página de inicio de Tablero IA (solo el dueño o el ADMIN de la
  plataforma): la clave con que el Coordinador (el PC "aizen1") entra a la API, y quién más aprueba
  tarjetas. Antes era un panel lateral que se abría con el robot de la barra del diagrama.
  - Crear clave: se muestra UNA vez (se guarda solo su huella). Va en trabajador-tablero/config.local.json.
  - Revocar: el Coordinador deja de entrar al instante.
  - Último uso: la última vez que el Coordinador preguntó (pregunta cada minuto: si es viejo, está apagado).
  - Aprobadores: miembros del negocio con alcance SISTEMAS (Emanuel, prueba hasta el 29-nov-2026), DESARROLLO (aprueban la tarea y el plan de tarjetas
    con repo gestion/aizencrm) o TODO. El sí final (subir a producción) es siempre del dueño. Si la
    persona todavía no tiene usuario en el negocio, se agrega cuando lo tenga.
*/

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function SeccionTrabajador() {
  const [panel, setPanel] = useState<PanelTrabajadorVista | null>(null);
  const [ocupado, empezar] = useTransition();
  const [nombreClave, setNombreClave] = useState("aizen1");
  const [claveNueva, setClaveNueva] = useState<string | null>(null);
  const [candidato, setCandidato] = useState("");
  const [alcance, setAlcance] = useState<"DESARROLLO" | "TODO" | "SISTEMAS">("DESARROLLO");

  const cargar = useCallback(async () => {
    const respuesta = await panelTrabajadorAction();
    if (respuesta.ok) setPanel(respuesta.panel);
    else toast.error(respuesta.error);
  }, []);

  // Se lee al mostrarse (el estado se pone cuando llega la respuesta, no en el efecto).
  useEffect(() => {
    let vigente = true;
    void panelTrabajadorAction().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) setPanel(respuesta.panel);
      else toast.error(respuesta.error);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const hacer = (accion: () => Promise<{ ok: boolean; error?: string }>, listo: string) =>
    empezar(async () => {
      const respuesta = await accion();
      if (respuesta.ok) toast.success(listo);
      else toast.error(respuesta.error ?? "No se pudo");
      await cargar();
    });

  const crearClave = () =>
    empezar(async () => {
      const respuesta = await crearClaveTrabajadorAction(nombreClave);
      if (respuesta.ok) setClaveNueva(respuesta.clave);
      else toast.error(respuesta.error);
      await cargar();
    });

  const activas = panel?.claves.filter((clave) => !clave.revocadaEn) ?? [];

  return (
    <section aria-labelledby="titulo-trabajador" className="space-y-4">
      <div>
        <h2 id="titulo-trabajador" className="flex items-center gap-2 text-base font-semibold">
          <Bot className="size-5 text-muted-foreground" aria-hidden />
          Coordinador
        </h2>
        <p className="text-sm text-muted-foreground">
          El PC que ejecuta las tareas aprobadas con repo: escribe el plan, lo construye en una rama y, con tu sí final, lo sube.
        </p>
      </div>

      {!panel ? <Loader2 className="mx-auto animate-spin text-muted-foreground" aria-label="Cargando" /> : null}

      {panel ? (
        <label className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
          <Switch
            checked={panel.aprobacionAutomatica}
            disabled={ocupado || !panel.esDueno}
            onCheckedChange={(valor) =>
              hacer(
                () => cambiarAprobacionAutomaticaAction(Boolean(valor)),
                valor ? "Las tareas de bajo riesgo se aprueban solas" : "Todo vuelve a pedir tu aprobación",
              )
            }
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Aprobar solas las tareas de bajo riesgo</span>
            <span className="block text-xs text-muted-foreground">
              Las tareas sencillas, sin dinero, permisos, chats ni cambios que borren datos, arrancan sin pedirte permiso. Apagado, todo
              vuelve a pedir tu aprobación.
            </span>
            {!panel.esDueno ? (
              <span className="mt-1 block text-xs text-muted-foreground">Solo el dueño del negocio mueve este interruptor.</span>
            ) : null}
          </span>
        </label>
      ) : null}

      {panel ? (
        <label className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
          <Switch
            checked={panel.aprobarTareasSolo}
            disabled={ocupado || !panel.esDueno}
            onCheckedChange={(valor) =>
              hacer(
                () => cambiarAprobarTareasSoloAction(Boolean(valor)),
                valor ? "Las tareas arrancan solas" : "Las tareas vuelven a pedir tu sí (salvo las de bajo riesgo)",
              )
            }
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Aprobar tareas solo</span>
            <span className="block text-xs text-muted-foreground">
              Toda tarea con repo arranca sin esperarte. Solo te espera la que toca dinero de Gestión (abonos, saldos, nómina, comisiones,
              facturación, pagos) o puede subir presupuesto, activar campañas o crear gasto en Meta Ads. Apagado, solo se aprueban solas las
              de bajo riesgo y lo demás te espera.
            </span>
            {!panel.esDueno ? (
              <span className="mt-1 block text-xs text-muted-foreground">Solo el dueño del negocio mueve este interruptor.</span>
            ) : null}
          </span>
        </label>
      ) : null}

      {panel ? (
        <label className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
          <Switch
            checked={panel.aprobarPlanesSolo}
            disabled={ocupado || !panel.esDueno}
            onCheckedChange={(valor) =>
              hacer(
                () => cambiarAprobarPlanesSoloAction(Boolean(valor)),
                valor ? "Los planes pasan solos a construir" : "Los planes vuelven a pedir tu sí",
              )
            }
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Aprobar planes solo</span>
            <span className="block text-xs text-muted-foreground">
              Aprobada la tarea, el plan pasa solo a construir. Solo te espera el plan que toca dinero de Gestión o puede subir presupuesto,
              activar campañas o crear gasto en Meta Ads. Apagado, todos los planes piden tu sí.
            </span>
            {!panel.esDueno ? (
              <span className="mt-1 block text-xs text-muted-foreground">Solo el dueño del negocio mueve este interruptor.</span>
            ) : null}
          </span>
        </label>
      ) : null}

      {panel ? (
        <label className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
          <Switch
            checked={panel.avisosAlEquipo}
            disabled={ocupado || !panel.esDueno}
            onCheckedChange={(valor) =>
              hacer(
                () => cambiarAvisosAlEquipoAction(Boolean(valor)),
                valor ? "Avisos al equipo prendidos: lo ya asignado no se avisa" : "Avisos al equipo apagados",
              )
            }
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Avisos al equipo por WhatsApp</span>
            <span className="block text-xs text-muted-foreground">
              Avisa por WhatsApp (línea Admin) y en su página de alertas a la persona responsable: tarea asignada, urgente, cuando el
              Coordinador la necesita y recordatorio de 24 h. Solo a quien tenga número en Mi empresa → Equipo. De 9 p. m. a 7 a. m. solo
              lo urgente.
            </span>
            {panel.sinNumeroDeAvisos.length ? (
              <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                Sin número (no les llega nada): {panel.sinNumeroDeAvisos.join(", ")}.
              </span>
            ) : (
              <span className="mt-1 block text-xs text-muted-foreground">Todo el equipo tiene número cargado.</span>
            )}
            {!panel.esDueno ? (
              <span className="mt-1 block text-xs text-muted-foreground">Solo el dueño del negocio mueve este interruptor.</span>
            ) : null}
          </span>
        </label>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">Clave del Coordinador</p>
          {claveNueva ? (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
              <p className="font-medium">Cópiala ahora: no se vuelve a mostrar.</p>
              <p className="break-all rounded border bg-background px-2 py-1 font-mono text-xs">{claveNueva}</p>
              <p className="text-xs text-muted-foreground">Va en trabajador-tablero/config.local.json, en &quot;claveTrabajador&quot;.</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(claveNueva).then(() => toast.success("Copiada"));
                  }}
                >
                  <Copy />
                  Copiar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setClaveNueva(null)}>
                  Ya la guardé
                </Button>
              </div>
            </div>
          ) : null}
          {activas.map((clave) => (
            <div key={clave.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{clave.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  {clave.ultimoUsoEn ? `Último uso: ${CUANDO.format(new Date(clave.ultimoUsoEn))}` : "Todavía no se usó"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={ocupado}
                onClick={() => hacer(() => revocarClaveTrabajadorAction(clave.id), "Clave revocada")}
              >
                Revocar
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input value={nombreClave} onChange={(evento) => setNombreClave(evento.target.value)} placeholder="Nombre del PC" maxLength={60} />
            <Button onClick={crearClave} disabled={ocupado}>
              {ocupado ? <Loader2 className="animate-spin" /> : <Plus />}
              Crear clave
            </Button>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">Quién más aprueba</p>
          <p className="text-xs text-muted-foreground">
            Tú apruebas todo. Un aprobador DESARROLLO aprueba la tarea y el plan de tarjetas con repo (Gestión, AizenCRM). Un aprobador SISTEMAS (periodo de prueba hasta el 29-nov-2026) aprueba la tarea, el plan y el sí final de las tarjetas de Tecnología, menos las que tocan dinero o Meta Ads. El sí final
            para subir a producción es solo tuyo, salvo ese caso.
          </p>
          {panel?.aprobadores.map((aprobador) => (
            <div key={aprobador.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{aprobador.nombre}</p>
                <p className="text-xs text-muted-foreground">{aprobador.alcance}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={ocupado}
                aria-label={`Quitar a ${aprobador.nombre}`}
                onClick={() => hacer(() => quitarAprobadorAction(aprobador.id), "Aprobador quitado")}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {panel && panel.candidatos.length ? (
            <div className="flex flex-wrap gap-2">
              <NativeSelect value={candidato} onChange={(evento) => setCandidato(evento.target.value)} className="min-w-0 flex-1">
                <NativeSelectOption value="">Elegir persona…</NativeSelectOption>
                {panel.candidatos.map((persona) => (
                  <NativeSelectOption key={persona.userId} value={persona.userId}>
                    {persona.nombre}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect value={alcance} onChange={(evento) => setAlcance(evento.target.value === "TODO" ? "TODO" : evento.target.value === "SISTEMAS" ? "SISTEMAS" : "DESARROLLO")}>
                <NativeSelectOption value="DESARROLLO">Desarrollo</NativeSelectOption>
                <NativeSelectOption value="SISTEMAS">Sistemas (prueba)</NativeSelectOption>
                <NativeSelectOption value="TODO">Todo</NativeSelectOption>
              </NativeSelect>
              <Button
                variant="outline"
                disabled={ocupado || !candidato}
                onClick={() =>
                  hacer(async () => {
                    const respuesta = await agregarAprobadorAction(candidato, alcance);
                    if (respuesta.ok) setCandidato("");
                    return respuesta;
                  }, "Aprobador agregado")
                }
              >
                <UserPlus />
                Agregar
              </Button>
            </div>
          ) : panel ? (
            <p className="text-xs text-muted-foreground">No hay más miembros del negocio para agregar.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
