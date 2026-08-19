"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, MessageSquare, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveProductMatchAction } from "@/app/actions/product-playbook-actions";

type TipoDeRegla = "frase" | "anuncio";

/**
 * Como se reconoce este producto en una conversacion.
 *
 * Antes esto dependia de que el agente hubiera marcado el producto al responder. Medido contra
 * produccion, eso dejaba afuera casi la mitad de las conversaciones: las que atiende una persona
 * —con la IA en pausa el agente nunca corre— y son justo las mas avanzadas.
 *
 * EN LISTA y no en dos campos separados por comas. El formato viejo era un renglon como
 * "camilla, combo de estetica, combo completo para esteticas": para sacar UNA regla habia que
 * editar el texto sin comerse una coma, y una coma de mas creaba una regla vacia que no reconocia
 * nada y no se veia por ningun lado. En lista, cada regla es una fila que se borra con un toque.
 */
export function ProductMatchForm({
  productId,
  keywords,
  adTitles,
}: {
  productId: string;
  keywords: string[];
  adTitles: string[];
}) {
  const router = useRouter();
  const [palabras, setPalabras] = useState<string[]>(keywords);
  const [anuncios, setAnuncios] = useState<string[]>(adTitles);
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const [tipo, setTipo] = useState<TipoDeRegla>("frase");
  const [texto, setTexto] = useState("");

  useEffect(() => {
    if (abierto) {
      setTipo("frase");
      setTexto("");
    }
  }, [abierto]);

  /**
   * Guarda la lista COMPLETA, no la regla suelta.
   *
   * La accion del servidor reemplaza las dos listas de una, asi que agregar y borrar tienen que
   * mandar el estado final. Mandar solo lo nuevo borraria todo lo demas.
   */
  const guardar = async (nuevasPalabras: string[], nuevosAnuncios: string[], aviso: string) => {
    setOcupado(true);
    try {
      const result = await saveProductMatchAction({
        productId,
        keywords: nuevasPalabras,
        adTitles: nuevosAnuncios,
      });
      if (result?.error) {
        toast.error(result.error);
        return false;
      }
      setPalabras(nuevasPalabras);
      setAnuncios(nuevosAnuncios);
      toast.success(aviso);
      router.refresh();
      return true;
    } catch {
      toast.error("No se pudo guardar. Recargá la página e intentá de nuevo.");
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const agregar = async () => {
    const limpio = texto.trim();
    if (!limpio) {
      return;
    }

    // Sin repetidas: dos veces la misma frase no reconoce mejor, solo ensucia la lista.
    const yaEsta = (tipo === "frase" ? palabras : anuncios).some(
      (item) => item.toLowerCase() === limpio.toLowerCase(),
    );
    if (yaEsta) {
      toast.error("Esa regla ya está en la lista");
      return;
    }

    const salio =
      tipo === "frase"
        ? await guardar([...palabras, limpio], anuncios, "Regla agregada")
        : await guardar(palabras, [...anuncios, limpio], "Regla agregada");

    if (salio) {
      setAbierto(false);
    }
  };

  const borrar = async (valor: string, deTipo: TipoDeRegla) => {
    if (deTipo === "frase") {
      await guardar(
        palabras.filter((item) => item !== valor),
        anuncios,
        "Regla quitada",
      );
      return;
    }
    await guardar(
      palabras,
      anuncios.filter((item) => item !== valor),
      "Regla quitada",
    );
  };

  const filas = [
    ...palabras.map((valor) => ({ valor, tipo: "frase" as const })),
    ...anuncios.map((valor) => ({ valor, tipo: "anuncio" as const })),
  ];

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Cómo se reconoce</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setAbierto(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar regla
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {filas.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Sin reglas: este producto solo se reconoce si el agente lo marca al responder.
          </p>
        ) : (
          <ul className="divide-y">
            {filas.map((fila) => (
              <li key={fila.tipo + "-" + fila.valor} className="flex items-center gap-3 py-2">
                {/* El icono dice de que tipo es la regla sin gastar una columna de texto: una
                    frase que dice el cliente, o el titulo de un anuncio. */}
                <span
                  className="shrink-0 text-muted-foreground"
                  title={fila.tipo === "frase" ? "Si el cliente dice" : "Si vino de este anuncio"}
                >
                  {fila.tipo === "frase" ? (
                    <MessageSquare className="size-4" />
                  ) : (
                    <Megaphone className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {fila.valor}
                </span>
                <button
                  type="button"
                  title={"Quitar " + fila.valor}
                  disabled={ocupado}
                  onClick={() => void borrar(fila.valor, fila.tipo)}
                  className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* Montado solo mientras esta abierto: un modal que queda puesto y apagado puede dejar su
          fondo tapando la pantalla y comiendose los clicks. */}
      {abierto ? (
        <Dialog open onOpenChange={(estado) => !estado && setAbierto(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader className="text-left">
              <DialogTitle className="text-sm">Nueva regla</DialogTitle>
              <DialogDescription className="sr-only">
                Agregar una frase del cliente o un título de anuncio que identifique este producto.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Cuándo aplica</Label>
                <NativeSelect
                  value={tipo}
                  onChange={(evento) => setTipo(evento.target.value as TipoDeRegla)}
                >
                  <NativeSelectOption value="frase">Si el cliente dice…</NativeSelectOption>
                  <NativeSelectOption value="anuncio">Si vino de este anuncio…</NativeSelectOption>
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">
                  {tipo === "frase" ? "La frase" : "El título del anuncio"}
                </Label>
                <Input
                  value={texto}
                  onChange={(evento) => setTexto(evento.target.value)}
                  placeholder={
                    tipo === "frase" ? "combo de estética" : "Combo Completo para Estéticas"
                  }
                  onKeyDown={(evento) => {
                    if (evento.key === "Enter") {
                      evento.preventDefault();
                      void agregar();
                    }
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  Alcanza con una parte. No distingue mayúsculas ni tildes.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAbierto(false)}
                disabled={ocupado}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void agregar()}
                disabled={ocupado || !texto.trim()}
              >
                {ocupado ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}
