"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { useRefrescoDelCoordinador } from "../hooks/useRefrescoDelTablero";
import type { CargaVista, ItemDeFila, TareaEnVivo, VistaDelCoordinador } from "../services/coordinador-en-vivo";
import {
  DISCO_LIBRE_AMARILLO_GB,
  DISCO_LIBRE_ROJO_GB,
  LIMITE_AMARILLO,
  LIMITE_ROJO,
  duracionTexto,
  haceTexto,
  horaDeBogotaTexto,
  type Semaforo,
} from "../services/reglas-coordinador-en-vivo";
import { linkDeLaTarjetaEnPantalla } from "./DialogoDeTablero";

/*
  La pestaña "Coordinador en vivo" de Tablero IA (24-oct-2026). Solo lectura, sin botones que cambien nada.
  Se actualiza sola cada 12 s con la pestaña a la vista (useRefrescoDelCoordinador) y está pensada primero
  para el celular: una sola columna, lo más importante arriba (qué se construye, dónde, y si el PC está
  ahogado) y todo en palabras sencillas. Si el último latido tiene más de 2 minutos, arriba sale en rojo
  "Coordinador apagado o sin conexión" y los bloques de lo que vive en el PC se ven atenuados.
*/

const COLOR_DEL_SEMAFORO: Record<Semaforo, { punto: string; barra: string; texto: string }> = {
  verde: { punto: "bg-emerald-500", barra: "bg-emerald-500", texto: "El PC está bien" },
  amarillo: { punto: "bg-amber-500", barra: "bg-amber-500", texto: "El PC anda ocupado" },
  rojo: { punto: "bg-red-500", barra: "bg-red-500", texto: "El PC está ahogado" },
};

const colorDeLaBarra = (porciento: number): string =>
  porciento > LIMITE_ROJO ? "bg-red-500" : porciento >= LIMITE_AMARILLO ? "bg-amber-500" : "bg-emerald-500";

function Bloque({ titulo, id, atenuado = false, children }: { titulo: string; id: string; atenuado?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`space-y-2 ${atenuado ? "opacity-60" : ""}`}>
      <h2 id={id} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Barra({ nombre, valor, porciento, color }: { nombre: string; valor: string; porciento: number | null; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{nombre}</span>
        <span className="font-medium tabular-nums">{valor}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="presentation">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, Math.min(100, porciento ?? 0))}%` }} />
      </div>
    </div>
  );
}

function FichaDeTarea({ tarea, ahora }: { tarea: TareaEnVivo; ahora: number }) {
  const empezo = tarea.inicioEn ? haceTexto(ahora - Date.parse(tarea.inicioEn)) : null;
  return (
    <li className="space-y-2 rounded-xl border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={linkDeLaTarjetaEnPantalla(tarea.tarjetaId)}
          className="line-clamp-2 text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={tarea.titulo}
        >
          {tarea.titulo}
        </Link>
        <span className="shrink-0 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">{tarea.etapaTexto}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="rounded-full border px-2 py-0.5">En {tarea.lugarTexto}</span>
        {tarea.modeloTexto ? <span className="rounded-full border px-2 py-0.5">{tarea.modeloTexto}</span> : null}
        <span className="rounded-full border px-2 py-0.5">{tarea.enQueVa}</span>
        {empezo ? <span className="rounded-full border px-2 py-0.5">Empezó {empezo}</span> : null}
      </div>
      {tarea.linkSesion || tarea.linkWorkflow ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {tarea.linkSesion ? (
            <a href={tarea.linkSesion} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
              Ver la sesión <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
          {tarea.linkWorkflow ? (
            <a href={tarea.linkWorkflow} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
              Ver el workflow <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function CargaDeAizen1({ carga }: { carga: CargaVista }) {
  const semaforo = carga.semaforo;
  const color = semaforo ? COLOR_DEL_SEMAFORO[semaforo] : null;
  const memoria =
    carga.memoriaUsadaGb !== null && carga.memoriaTotalGb !== null
      ? `${carga.memoriaUsadaGb} / ${carga.memoriaTotalGb} GB`
      : carga.memoriaPorciento !== null
        ? `${carga.memoriaPorciento} %`
        : "—";
  const memoriaPorciento =
    carga.memoriaPorciento ?? (carga.memoriaUsadaGb !== null && carga.memoriaTotalGb ? Math.round((100 * carga.memoriaUsadaGb) / carga.memoriaTotalGb) : null);
  const discoPoco =carga.discoLibreGb !== null && carga.discoLibreGb < DISCO_LIBRE_AMARILLO_GB;
  return (
    <div className="space-y-3 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className={`size-4 shrink-0 rounded-full ${color?.punto ?? "bg-muted-foreground"}`} aria-hidden />
        <span className="text-sm font-semibold">{color?.texto ?? "Sin datos de carga"}</span>
      </div>
      {carga.cpu !== null ? <Barra nombre="Procesador" valor={`${carga.cpu} %`} porciento={carga.cpu} color={colorDeLaBarra(carga.cpu)} /> : null}
      {memoriaPorciento !== null ? <Barra nombre="Memoria" valor={memoria} porciento={memoriaPorciento} color={colorDeLaBarra(memoriaPorciento)} /> : null}
      {carga.discoLibreGb !== null ? (
        <Barra
          nombre="Disco libre"
          valor={`${carga.discoLibreGb} GB`}
          porciento={carga.discoTotalGb ? (100 * carga.discoLibreGb) / carga.discoTotalGb : null}
          color={carga.discoLibreGb < DISCO_LIBRE_ROJO_GB ? "bg-red-500" : discoPoco ? "bg-amber-500" : "bg-emerald-500"}
        />
      ) : null}
      {carga.esperandoPc ? (
        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-sm font-medium">
          Esperando a que el PC se desocupe{carga.motivoEspera ? ` (${carga.motivoEspera})` : ""}
        </p>
      ) : null}
    </div>
  );
}

function ListaDeFila({ items }: { items: ItemDeFila[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, indice) => (
        <li key={item.tarjetaId} className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          {item.motivo === null ? <span className="mt-px w-5 shrink-0 text-muted-foreground tabular-nums">{indice + 1}.</span> : null}
          <span className="min-w-0">
            <Link href={linkDeLaTarjetaEnPantalla(item.tarjetaId)} className="line-clamp-2 font-medium hover:underline" title={item.titulo}>
              {item.titulo}
            </Link>
            {item.motivo ? <span className="block text-xs text-muted-foreground">{item.motivo}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Contenido({ vista, ahora }: { vista: VistaDelCoordinador; ahora: number }) {
  const apagado = !vista.enLinea;
  const hora = horaDeBogotaTexto(vista.ultimoLatidoEn);
  const { hoy, fila, uso } = vista;
  return (
    <div className="space-y-6">
      {apagado ? (
        <div role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3">
          <p className="text-base font-semibold text-red-600 dark:text-red-400">Coordinador apagado o sin conexión</p>
          <p className="text-sm text-muted-foreground">
            {vista.ultimoLatidoEn ? `Último latido a las ${hora} (${haceTexto(ahora - Date.parse(vista.ultimoLatidoEn))}). Lo de abajo es el último dato conocido.` : "Todavía no ha mandado ningún latido."}
          </p>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-2.5 rounded-full bg-emerald-500" aria-hidden />
          Coordinador en línea{vista.nombre ? ` (${vista.nombre})` : ""}
        </p>
      )}

      <Bloque titulo="Ahora mismo" id="cev-ahora" atenuado={apagado}>
        {vista.tareas.length ? (
          <ul className="space-y-2">
            {vista.tareas.map((tarea) => (
              <FichaDeTarea key={tarea.tarjetaId} tarea={tarea} ahora={ahora} />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">No hay ninguna tarea en marcha.</p>
        )}
      </Bloque>

      <Bloque titulo="Carga de aizen1" id="cev-carga" atenuado={apagado}>
        {vista.carga ? <CargaDeAizen1 carga={vista.carga} /> : <p className="text-sm text-muted-foreground">Sin datos todavía.</p>}
      </Bloque>

      <Bloque titulo="Fila" id="cev-fila">
        {fila.siguientes.length ? <ListaDeFila items={fila.siguientes} /> : <p className="text-sm text-muted-foreground">No hay nada esperando su turno.</p>}
        {fila.bloqueadas.length ? (
          <div className="space-y-1.5 pt-1">
            <h3 className="text-xs font-medium text-muted-foreground">Bloqueadas</h3>
            <ListaDeFila items={fila.bloqueadas} />
          </div>
        ) : null}
      </Bloque>

      <Bloque titulo="Hoy" id="cev-hoy">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { nombre: "Terminadas", valor: hoy.terminadas },
            { nombre: "Falladas", valor: hoy.falladas },
            { nombre: "Reparadas", valor: hoy.reparadas },
          ].map(({ nombre, valor }) => (
            <div key={nombre} className="rounded-xl border bg-card px-2 py-2">
              <p className="text-xl font-semibold tabular-nums">{valor}</p>
              <p className="text-xs text-muted-foreground">{nombre}</p>
            </div>
          ))}
        </div>
        {hoy.trabajos.length ? (
          <ul className="space-y-1.5">
            {hoy.trabajos.map((trabajo) => (
              <li key={trabajo.tarjetaId} className="flex items-start justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
                <Link href={linkDeLaTarjetaEnPantalla(trabajo.tarjetaId)} className="line-clamp-2 min-w-0 hover:underline" title={trabajo.titulo}>
                  {trabajo.resultado === "terminada" ? "✅" : "❌"} {trabajo.titulo}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {duracionTexto(trabajo.duracionMinutos)}
                  {trabajo.reparaciones ? ` · ${trabajo.reparaciones} rep.` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Bloque>

      <Bloque titulo="Uso de Claude" id="cev-uso" atenuado={apagado}>
        <p className={`rounded-xl border px-3 py-2 text-sm ${uso.limiteAlcanzado ? "border-amber-500/50 bg-amber-500/10 font-medium" : "bg-card"}`}>{uso.texto}</p>
      </Bloque>
    </div>
  );
}

export function CoordinadorEnVivo() {
  const { vista, error } = useRefrescoDelCoordinador(true);
  const [ahora, setAhora] = useState(() => Date.now());
  // El "hace 14 min" se renueva solo cada 20 s (no hace falta preguntar al servidor para eso).
  useEffect(() => {
    const reloj = window.setInterval(() => setAhora(Date.now()), 20_000);
    return () => window.clearInterval(reloj);
  }, []);

  return (
    <section aria-labelledby="titulo-coordinador" className="space-y-4">
      <div>
        <h1 id="titulo-coordinador" className="text-lg font-semibold">
          Coordinador en vivo
        </h1>
        <p className="text-sm text-muted-foreground">Cómo trabaja el Coordinador ahora. Se actualiza solo; aquí no hay nada que aprobar.</p>
      </div>
      {error ? (
        <p role="status" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
          No se pudo actualizar{vista ? ": se ve lo último que llegó." : "."}
        </p>
      ) : null}
      {vista ? <Contenido vista={vista} ahora={ahora} /> : error ? null : <p className="text-sm text-muted-foreground">Cargando…</p>}
    </section>
  );
}
