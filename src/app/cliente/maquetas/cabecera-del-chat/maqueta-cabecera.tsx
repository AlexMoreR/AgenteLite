"use client";

import { useState } from "react";
import { Bot, CalendarClock, Lock, MoreVertical, Phone, Sparkles, Timer, UserPlus, Workflow } from "lucide-react";

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

/** Cabecera del chat. Recibe por props si hay asesora y si hay seguimiento. */
function CabeceraDelChat({ conAsesora, conSeguimiento }: { conAsesora: boolean; conSeguimiento: boolean }) {
  const [asignada, setAsignada] = useState(conAsesora);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar>
          <AvatarFallback>{iniciales(CONTACTO)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{CONTACTO}</p>
          {conSeguimiento ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <CalendarClock className="size-3.5" />
                  Próximo seguimiento: {PROXIMO_SEGUIMIENTO}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-40">
                {/* onClick y no onSelect: el menú es de Base UI y onSelect no se dispara. */}
                <DropdownMenuItem onClick={() => undefined}>Pausar</DropdownMenuItem>
                <DropdownMenuItem onClick={() => undefined}>Cambiar hora</DropdownMenuItem>
                <DropdownMenuItem onClick={() => undefined}>Cancelar</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Llamar">
          <Phone className="size-4" />
        </Button>
        {asignada ? (
          <div className="flex items-center gap-1.5">
            <Avatar size="sm">
              <AvatarFallback>{iniciales(ASESORA)}</AvatarFallback>
            </Avatar>
            <span className="text-sm">{ASESORA}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Badge variant="outline">Sin asignar</Badge>
            <Button size="sm" variant="outline" onClick={() => setAsignada(true)}>
              <UserPlus />
              Tomarlo
            </Button>
          </div>
        )}
        <Button size="sm">Resolver</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Más opciones">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
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
function FranjaDelAgente() {
  const [pausado, setPausado] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/50 px-3 py-2">
        <span className="flex items-center gap-2 text-sm">
          <Bot className="size-4 text-muted-foreground" />
          {pausado ? "Agente pausado" : "El agente está atendiendo este chat"}
        </span>
        {pausado ? (
          <Button size="sm" variant="outline" onClick={() => setPausado(false)}>
            Devolverle el chat
          </Button>
        ) : (
          <Button size="sm" onClick={() => setPausado(true)}>
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

function Estado({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function MaquetaCabecera() {
  return (
    <div className="space-y-4">
      <Estado titulo="Cabecera limpia (con asesora y seguimiento)">
        <CabeceraDelChat conAsesora conSeguimiento />
      </Estado>
      <Estado titulo="Asesor sin asignar">
        <CabeceraDelChat conAsesora={false} conSeguimiento />
      </Estado>
      <Estado titulo="Sin seguimiento (no sale la línea)">
        <CabeceraDelChat conAsesora conSeguimiento={false} />
      </Estado>
      <Estado titulo="Franja del agente (escribe o toca el botón)">
        <FranjaDelAgente />
      </Estado>
    </div>
  );
}
