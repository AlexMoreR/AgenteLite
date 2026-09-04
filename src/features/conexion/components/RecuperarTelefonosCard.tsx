"use client";

import * as React from "react";
import { LoaderCircle, PhoneOutgoing } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Recuperar el telefono de los leads que entraron con un LID.
 *
 * WhatsApp entrega muchos leads con un identificador interno (@lid) en vez del numero, asi que en
 * la ficha quedan 14 o 15 digitos y no se les puede llamar. Medido el 4-sep-2026: 64 de los 121
 * leads de la semana. El gateway no sabe quien esta detras en el primer mensaje -nadie lo conoce
 * todavia- pero si un rato despues: de los 20 mas recientes, al volver a preguntar se resolvieron
 * los 20.
 *
 * Por eso hay un boton y no un arreglo automatico en el momento: lo que faltaba era volver a
 * preguntar mas tarde.
 *
 * Va por tandas y encadenadas desde aca: cada contacto es una consulta al gateway, y saturarlo ya
 * nos dejo una vez sin poder enviar mensajes. El servidor decide el tamaño de la tanda; esto solo
 * insiste hasta que no queden.
 */
export function RecuperarTelefonosCard() {
  const [trabajando, setTrabajando] = React.useState(false);
  const [avance, setAvance] = React.useState<{ resueltos: number; restantes: number } | null>(null);

  const recuperar = async () => {
    setTrabajando(true);
    setAvance(null);
    let resueltos = 0;
    let unidos = 0;

    try {
      // Un tope de vueltas para no quedar dando vueltas si el servidor deja de avanzar.
      for (let vuelta = 0; vuelta < 40; vuelta += 1) {
        const respuesta = await fetch("/api/cliente/conexion/evolution/lid-backfill?limit=25", {
          method: "POST",
        });
        const datos = (await respuesta.json().catch(() => null)) as
          | {
              ok?: boolean;
              error?: string;
              revisados?: number;
              resueltos?: number;
              unidos?: number;
              restantes?: number;
            }
          | null;

        if (!datos?.ok) {
          toast.error(datos?.error || "No se pudieron recuperar los telefonos.");
          return;
        }

        resueltos += datos.resueltos ?? 0;
        unidos += datos.unidos ?? 0;
        setAvance({ resueltos, restantes: datos.restantes ?? 0 });

        // Sin candidatos en la tanda no hay nada mas que hacer, aunque "restantes" diga otra cosa.
        if (!datos.revisados || !datos.restantes) {
          break;
        }
      }

      toast.success(
        resueltos > 0
          ? `Se recuperaron ${resueltos} telefono${resueltos === 1 ? "" : "s"}${
              unidos > 0 ? `, y ${unidos} ficha${unidos === 1 ? "" : "s"} repetida${unidos === 1 ? "" : "s"} se unieron` : ""
            }.`
          : "No habia telefonos nuevos para recuperar.",
      );
    } catch {
      toast.error("No se pudieron recuperar los telefonos.");
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-2">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <PhoneOutgoing className="size-4 text-primary" />
          <span>Recuperar telefonos</span>
        </p>
        <p className="text-[12px] leading-4 text-muted-foreground">
          Los leads que llegan sin numero -en la ficha se ve un codigo largo- no se pueden llamar.
          Aca se le vuelve a preguntar a WhatsApp quien esta detras, que un rato despues si lo sabe.
        </p>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={trabajando}
          onClick={() => void recuperar()}
        >
          {trabajando ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              {avance
                ? `Recuperados ${avance.resueltos}, faltan ${avance.restantes}`
                : "Buscando..."}
            </>
          ) : (
            "Recuperar telefonos"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
