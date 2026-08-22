import Link from "next/link";
import { PhoneCall, Smartphone } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { WaCallsEstado } from "@/lib/wacalls";

/**
 * La línea de llamadas, junto a las conexiones de WhatsApp.
 *
 * No es un canal de chat y por eso no está en la misma lista, pero sí es una conexión: es un
 * WhatsApp vinculado por QR que puede estar conectado o caído. Tenerla acá evita que alguien
 * tenga que acordarse de una dirección aparte para saber si las llamadas funcionan.
 *
 * Se dibuja igual que la tarjeta de un canal —franja de estado a la izquierda, punto verde sobre
 * el ícono— para que se lea sin aprender nada nuevo.
 */
export function CallsConnectionCard({ estado }: { estado: WaCallsEstado }) {
  return (
    <Card className="relative overflow-hidden">
      <span
        className={`absolute inset-y-0 left-0 w-1 ${estado.conectado ? "bg-emerald-500" : "bg-muted-foreground/25"}`}
        aria-hidden="true"
      />
      <CardContent className="relative flex flex-row items-center justify-between gap-3 py-3.5 pl-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative shrink-0">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted text-sky-600 ring-1 ring-border">
              <PhoneCall className="size-5" />
            </span>
            <span
              className={`absolute right-0 bottom-0 size-3.5 rounded-full ring-2 ring-card ${
                estado.conectado ? "bg-emerald-500" : "bg-muted-foreground/40"
              }`}
              title={estado.conectado ? "Conectado" : "Desconectado"}
              aria-hidden="true"
            />
            <span className="sr-only">{estado.conectado ? "Conectado" : "Desconectado"}</span>
          </span>

          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-foreground">Llamadas</h2>
              <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                {estado.nombre ?? "WhatsApp"}
              </span>
            </div>
            {estado.numero ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Smartphone className="size-3 shrink-0" />
                <span className="tabular-nums">{estado.numero}</span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Sin número vinculado</span>
            )}
          </div>
        </div>

        {/* Link envolviendo al Button, no <Button asChild>: este Button es de Base UI y con
            asChild el build local pasa pero el de Docker falla. Ya nos costó un despliegue. */}
        <Link href="/cliente/llamadas?tab=marcador" className="shrink-0">
          <Button size="sm" variant="outline">
            Abrir marcador
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
