"use client";

import { useState } from "react";
import { Bot, CalendarClock, CheckCircle2, Lock, MoreVertical, Phone, Sparkles, Timer, UserPlus, Workflow } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Datos inventados: nada sale de la base.
const CONTACTO = "Cliente de ejemplo";
const ASESORA = "Ingrid";
const PROXIMO_SEGUIMIENTO = "hoy 4:30 p. m.";

function iniciales(nombre: string) {
  return nombre
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Menú de «Próximo seguimiento»: lo usan las dos vistas. */
function MenuDeSeguimiento({ celular }: { celular: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <CalendarClock className="size-3.5 shrink-0" />
          <span className={celular ? "truncate" : undefined}>Próximo seguimiento: {PROXIMO_SEGUIMIENTO}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        {/* onClick y no onSelect: el menú es de Base UI y onSelect no se dispara. */}
        <DropdownMenuItem onClick={() => undefined}>Pausar</DropdownMenuItem>
        <DropdownMenuItem onClick={() => undefined}>Cambiar hora</DropdownMenuItem>
        <DropdownMenuItem onClick={() => undefined}>Cancelar</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Cabecera del chat. Recibe por props si hay asesora y si hay seguimiento.
 * Con `celular`: de la asesora solo sale la foto, y Llamar y Resolver pasan al menú de tres puntos.
 */
function CabeceraDelChat({
  conAsesora,
  conSeguimiento,
  celular = false,
}: {
  conAsesora: boolean;
  conSeguimiento: boolean;
  celular?: boolean;
}) {
  const [asignada, setAsignada] = useState(conAsesora);

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar>
          <AvatarFallback>{iniciales(CONTACTO)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{CONTACTO}</p>
          {conSeguimiento ? <MenuDeSeguimiento celular={celular} /> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {celular ? null : (
          <Button variant="ghost" size="icon" aria-label="Llamar">
            <Phone className="size-4" />
          </Button>
        )}
        {asignada ? (
          <div className="flex items-center gap-1.5" title={ASESORA} aria-label={`Asesora: ${ASESORA}`}>
            <Avatar size="sm">
              <AvatarFallback>{iniciales(ASESORA)}</AvatarFallback>
            </Avatar>
            {celular ? null : <span className="text-sm">{ASESORA}</span>}
          </div>
        ) : (
          <div className={celular ? "flex flex-col items-end gap-1" : "flex items-center gap-2"}>
            <Badge variant="outline">Sin asignar</Badge>
            <Button size="sm" variant="outline" onClick={() => setAsignada(true)}>
              <UserPlus />
              Tomarlo
            </Button>
          </div>
        )}
        {celular ? null : <Button size="sm">Resolver</Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Más opciones">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {celular ? (
              <>
                <DropdownMenuItem onClick={() => undefined} className="gap-2">
                  <Phone className="size-3.5" />
                  Llamar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => undefined} className="gap-2">
                  <CheckCircle2 className="size-3.5" />
                  Resolver
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem onClick={() => undefined} className="gap-2">
              <Workflow className="size-3.5" />
              Etapa
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => undefined} className="gap-2">
              <Bot className="size-3.5" />
              Interruptor de IA
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => undefined} className="gap-2">
              <Sparkles className="size-3.5" />
              Seguimientos automáticos
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => undefined} className="gap-2">
              <Lock className="size-3.5" />
              Candado
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => undefined} className="gap-2">
              <Timer className="size-3.5" />
              Posponer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Franja del agente sobre una caja de escribir de muestra. Solo cambia lo que se ve. */
function FranjaDelAgente({ celular = false }: { celular?: boolean }) {
  const [pausado, setPausado] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <span className={celular ? "flex min-w-0 items-center gap-2 text-xs" : "flex items-center gap-2 text-sm"}>
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          {pausado ? "Agente pausado" : "El agente está atendiendo este chat"}
        </span>
        {pausado ? (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setPausado(false)}>
            Devolverle el chat
          </Button>
        ) : (
          <Button size="sm" className="shrink-0" onClick={() => setPausado(true)}>
            Tomar control
          </Button>
        )}
      </div>
      <div className="p-3">
        <Textarea
          rows={2}
          aria-label="Caja de escribir de muestra"
          placeholder="Escribe aquí (de muestra, no se envía)"
          onChange={() => setPausado(true)}
        />
      </div>
    </div>
  );
}

function Estado({ titulo, celular = false, children }: { titulo: string; celular?: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className={celular ? "px-2" : undefined}>{children}</CardContent>
    </Card>
  );
}

function Casos({ celular }: { celular: boolean }) {
  return (
    <div className="space-y-4">
      <Estado celular={celular} titulo="Cabecera limpia (con asesora y seguimiento)">
        <CabeceraDelChat conAsesora conSeguimiento celular={celular} />
      </Estado>
      <Estado celular={celular} titulo="Asesor sin asignar">
        <CabeceraDelChat conAsesora={false} conSeguimiento celular={celular} />
      </Estado>
      <Estado celular={celular} titulo="Sin seguimiento (no sale la línea)">
        <CabeceraDelChat conAsesora conSeguimiento={false} celular={celular} />
      </Estado>
      <Estado celular={celular} titulo="Franja del agente (escribe o toca el botón)">
        <FranjaDelAgente celular={celular} />
      </Estado>
    </div>
  );
}

export function MaquetaCabecera() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
      <section className="min-w-0 space-y-2">
        <h2 className="text-sm font-semibold">Computador</h2>
        <Casos celular={false} />
      </section>
      <section className="min-w-0 space-y-2">
        <h2 className="text-sm font-semibold">Celular (390 px)</h2>
        <div className="w-[390px] max-w-full rounded-[2rem] border-4 border-border bg-background p-3">
          <Casos celular />
        </div>
      </section>
    </div>
  );
}
