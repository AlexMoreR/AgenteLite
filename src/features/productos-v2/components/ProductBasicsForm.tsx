"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check, FileText, Package, ShoppingCart, Tag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveProductBasicsAction } from "@/app/actions/product-playbook-actions";

/**
 * Lo basico del producto: tipo, nombre, descripcion y precio.
 *
 * Editable desde aca y no solo desde el panel de administrador: ahi el formulario pide codigo,
 * costo, margen, categoria, proveedor e imagenes, y pedir doce campos para corregir una
 * descripcion hace que nadie la corrija.
 *
 * El TIPO no es un campo guardado: sale de si hay precio. Elegir "Catálogo" es, literalmente,
 * dejar el producto sin precio — por eso al elegirlo el campo de precio desaparece en vez de
 * quedar ahi mintiendo que se va a guardar.
 */
export function ProductBasicsForm({
  productId,
  name,
  description,
  price,
  sells,
}: {
  productId: string;
  name: string;
  description: string;
  price: number | null;
  sells: boolean;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(name);
  const [descripcion, setDescripcion] = useState(description);
  const [precio, setPrecio] = useState(price ? String(price) : "");
  const [vende, setVende] = useState(sells);
  const [ocupado, setOcupado] = useState(false);

  // Al cambiar de producto sin salir de la pantalla, los campos tienen que traer los del nuevo.
  useEffect(() => {
    setNombre(name);
    setDescripcion(description);
    setPrecio(price ? String(price) : "");
    setVende(sells);
  }, [productId, name, description, price, sells]);

  const precioNumero = Number(precio.replace(/[^\d]/g, ""));
  const guardadoIgual =
    nombre.trim() === name.trim() &&
    descripcion.trim() === description.trim() &&
    vende === sells &&
    (vende ? precioNumero === (price ?? 0) : !sells);

  const guardar = async () => {
    if (!nombre.trim()) {
      toast.error("El nombre no puede quedar vacío");
      return;
    }
    setOcupado(true);
    try {
      const result = await saveProductBasicsAction({
        productId,
        name: nombre,
        description: descripcion,
        // Catálogo = sin precio. Es la unica forma de guardar ese tipo, porque el tipo no existe
        // como campo.
        price: vende ? precioNumero : null,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Producto guardado");
      router.refresh();
    } catch {
      toast.error("No se pudo guardar. Recargá la página e intentá de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>
            <Tag className="size-4 text-muted-foreground" />
            Tipo
          </Label>
          {/* Vende / Catalogo: en fila tambien en el celular, porque son dos palabras. */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { valor: true, titulo: "Vende", icono: ShoppingCart },
              { valor: false, titulo: "Catálogo", icono: FileText },
            ].map((opcion) => (
              <button
                key={opcion.titulo}
                type="button"
                onClick={() => setVende(opcion.valor)}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  vende === opcion.valor
                    ? "border-primary bg-primary/5 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                <opcion.icono className="h-4 w-4 shrink-0" />
                <span className="truncate">{opcion.titulo}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div className="space-y-1.5">
            <Label htmlFor="pv2-nombre">
              <Package className="size-4 text-muted-foreground" />
              Nombre
            </Label>
            <Input
              id="pv2-nombre"
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              placeholder="Ej. Combo de camillas"
            />
          </div>

          {vende ? (
            <div className="space-y-1.5">
              <Label htmlFor="pv2-precio">
                <Banknote className="size-4 text-muted-foreground" />
                Precio
              </Label>
              <Input
                id="pv2-precio"
                inputMode="numeric"
                value={precio}
                onChange={(evento) => setPrecio(evento.target.value.replace(/[^\d]/g, ""))}
                placeholder="989000"
              />
            </div>
          ) : null}
        </div>

        {/*
          La descripcion no es adorno: el motor la usa para reconocer el producto en un mensaje.
          Un producto sin descripcion queda dependiendo solo del nombre, y ahi es donde se
          confunden dos combos que comparten palabras.
        */}
        <div className="space-y-1.5">
          <Label htmlFor="pv2-descripcion">
            <FileText className="size-4 text-muted-foreground" />
            Descripción
          </Label>
          <Textarea
            id="pv2-descripcion"
            rows={4}
            value={descripcion}
            onChange={(evento) => setDescripcion(evento.target.value)}
            placeholder="Qué incluye y para quién es"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={() => void guardar()} disabled={ocupado}>
            {ocupado ? "Guardando…" : "Guardar producto"}
          </Button>
          {guardadoIgual ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Guardado
            </span>
          ) : (
            <span className="text-xs text-amber-700 dark:text-amber-300">Sin guardar</span>
          )}
        </div>

        {!vende && sells ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            Al guardar como Catálogo se borra el precio.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
