"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ImageIcon, Palette, Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generarMiniaturaDeImagen } from "@/lib/miniatura-de-imagen";
import type { TipoMaterialDeColor } from "@/lib/carta-de-colores";
import {
  crearColorAction,
  crearMaterialAction,
  editarColorAction,
  ocultarColorAction,
  rehacerImagenAction,
  type ColorDeLaCarta,
  type MaterialDeLaCarta,
  type ResultadoCarta,
} from "@/app/actions/carta-de-colores-actions";

/*
  Pantalla de la carta de colores (parte 3 de «Carta de colores digital dentro del CRM»).

  Una pestaña por material. Cada una muestra las imágenes ya armadas (las que se mandan en el chat) y
  la lista de colores. Solo con `puedeEditar` salen los botones; igual el servidor revisa el permiso en
  cada acción. La foto se achica y se pasa a JPG en el aparato antes de subirla.
*/

// Lado de la foto achicada: sobra para el cuadro de la carta y queda muy por debajo de los 3 MB de la ruta.
const LADO_FOTO = 800;
const ERROR_RED = "No se pudo guardar. Revisa la conexión e intenta de nuevo.";

type EditorDeColor = {
  id?: string;
  materialId: string;
  codigo: string;
  nombre: string;
  orden: string;
  fotoUrl: string | null;
  archivo: File | null;
  vistaPrevia: string | null;
};

type EditorDeMaterial = { nombre: string; tipo: TipoMaterialDeColor };

async function subirFoto(file: File): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const jpg = await generarMiniaturaDeImagen(file, LADO_FOTO);
  if (!jpg) return { ok: false, error: "No se pudo leer esa foto. Prueba con otra foto JPG o PNG." };

  const formData = new FormData();
  formData.append("file", jpg);
  try {
    const respuesta = await fetch("/api/cliente/carta-de-colores/foto", { method: "POST", body: formData });
    const datos = (await respuesta.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
    if (!respuesta.ok || !datos?.ok || !datos.url) {
      return { ok: false, error: datos?.error ?? "No se pudo subir la foto. Intenta de nuevo." };
    }
    return { ok: true, url: datos.url };
  } catch {
    return { ok: false, error: "No se pudo subir la foto. Revisa la conexión e intenta de nuevo." };
  }
}

/** Muestra el resultado de una acción. Devuelve true si salió bien. */
function avisar(resultado: ResultadoCarta, exito: string): boolean {
  if (!resultado.ok) {
    toast.error(resultado.error);
    return false;
  }
  if (resultado.aviso) toast.warning(resultado.aviso);
  else toast.success(exito);
  return true;
}

export function CartaDeColoresWorkspace({
  materiales,
  puedeEditar,
}: {
  materiales: MaterialDeLaCarta[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [elegido, setElegido] = useState<string | null>(materiales[0]?.id ?? null);
  const [editorColor, setEditorColor] = useState<EditorDeColor | null>(null);
  const [editorMaterial, setEditorMaterial] = useState<EditorDeMaterial | null>(null);
  const inputFoto = useRef<HTMLInputElement>(null);

  const pestana = materiales.some((material) => material.id === elegido) ? elegido : (materiales[0]?.id ?? null);

  // La vista previa de la foto elegida es un objeto del navegador: se suelta al cambiarla o al cerrar.
  const vistaPrevia = editorColor?.vistaPrevia ?? null;
  useEffect(() => {
    return () => {
      if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
    };
  }, [vistaPrevia]);

  const abrirNuevoColor = (materialId: string) =>
    setEditorColor({ materialId, codigo: "", nombre: "", orden: "", fotoUrl: null, archivo: null, vistaPrevia: null });

  const abrirEdicion = (materialId: string, color: ColorDeLaCarta) =>
    setEditorColor({
      id: color.id,
      materialId,
      codigo: color.codigo,
      nombre: color.nombre,
      orden: String(color.orden),
      fotoUrl: color.fotoUrl,
      archivo: null,
      vistaPrevia: null,
    });

  const elegirFoto = (file: File | undefined) => {
    if (!file || !editorColor) return;
    setEditorColor({ ...editorColor, archivo: file, vistaPrevia: URL.createObjectURL(file) });
  };

  const guardarColor = () => {
    if (!editorColor) return;
    const editor = editorColor;
    startTransition(async () => {
      try {
        let fotoUrl = editor.fotoUrl;
        if (editor.archivo) {
          const subida = await subirFoto(editor.archivo);
          if (!subida.ok) {
            toast.error(subida.error);
            return;
          }
          fotoUrl = subida.url;
        }

        const resultado = editor.id
          ? await editarColorAction({
              id: editor.id,
              codigo: editor.codigo,
              nombre: editor.nombre,
              fotoUrl,
              orden: Number(editor.orden),
            })
          : await crearColorAction({
              materialId: editor.materialId,
              codigo: editor.codigo,
              nombre: editor.nombre,
              fotoUrl,
            });
        if (!avisar(resultado, editor.id ? "Color guardado" : "Color agregado")) return;
        setEditorColor(null);
        router.refresh();
      } catch {
        toast.error(ERROR_RED);
      }
    });
  };

  const cambiarOculto = (color: ColorDeLaCarta) => {
    startTransition(async () => {
      try {
        const resultado = await ocultarColorAction(color.id, !color.oculto);
        if (!avisar(resultado, color.oculto ? "El color vuelve a salir en la carta" : "Color oculto de la carta")) return;
        router.refresh();
      } catch {
        toast.error(ERROR_RED);
      }
    });
  };

  const rehacerImagen = (materialId: string) => {
    startTransition(async () => {
      try {
        const resultado = await rehacerImagenAction(materialId);
        if (!avisar(resultado, "Imagen de la carta rehecha")) return;
        router.refresh();
      } catch {
        toast.error(ERROR_RED);
      }
    });
  };

  const guardarMaterial = () => {
    if (!editorMaterial) return;
    const editor = editorMaterial;
    startTransition(async () => {
      try {
        const resultado = await crearMaterialAction({ nombre: editor.nombre, tipo: editor.tipo });
        if (!avisar(resultado, "Material agregado")) return;
        if (resultado.ok) setElegido(resultado.datos.id);
        setEditorMaterial(null);
        router.refresh();
      } catch {
        toast.error(ERROR_RED);
      }
    });
  };

  const fotoDelEditor = editorColor?.vistaPrevia ?? editorColor?.fotoUrl ?? null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-semibold">Carta de colores</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            {puedeEditar
              ? "Los colores de cada material. Las imágenes de abajo son las que se mandan en el chat."
              : "Los colores de cada material y las imágenes que se mandan en el chat. Solo para ver."}
          </p>
        </div>
        {puedeEditar ? (
          <Button variant="outline" size="sm" onClick={() => setEditorMaterial({ nombre: "", tipo: "CUERO" })}>
            <Plus className="h-3.5 w-3.5" /> Agregar material
          </Button>
        ) : null}
      </div>

      {materiales.length === 0 || !pestana ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          Aún no hay materiales en la carta.
        </p>
      ) : (
        <Tabs value={pestana} onValueChange={(valor) => setElegido(String(valor))}>
          <div className="max-w-full overflow-x-auto">
            <TabsList>
              {materiales.map((material) => (
                <TabsTrigger key={material.id} value={material.id} className="flex-none px-3">
                  {material.nombre}
                  <span className="text-muted-foreground">{material.colores.length}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {materiales.map((material) => (
            <TabsContent key={material.id} value={material.id} className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      Vista previa
                      <Badge variant="secondary">{material.tipo === "TELA" ? "Tela" : "Cuero"}</Badge>
                    </CardTitle>
                    {puedeEditar ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => rehacerImagen(material.id)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Rehacer imagen
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent>
                  {material.imagenesUrl.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      Todavía no hay imagen: se arma sola cuando el material tiene colores visibles.
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {material.imagenesUrl.map((url, indice) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg border border-border"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Carta de ${material.nombre}, imagen ${indice + 1}`}
                            className="h-auto w-full"
                            loading="lazy"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      Colores
                      <span className="text-muted-foreground">{material.colores.length}</span>
                    </CardTitle>
                    {puedeEditar ? (
                      <Button variant="outline" size="sm" onClick={() => abrirNuevoColor(material.id)}>
                        <Plus className="h-3.5 w-3.5" /> Agregar color
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {material.colores.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      Aún no hay colores cargados
                    </p>
                  ) : (
                    material.colores.map((color) => (
                      <div
                        key={color.id}
                        className={`flex items-center gap-3 rounded-lg border border-border px-3 py-2 ${color.oculto ? "opacity-60" : ""}`}
                      >
                        {color.fotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={color.fotoUrl}
                            alt={`Color ${color.codigo}`}
                            className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold text-foreground">{color.codigo}</span>
                            <span className="truncate text-sm text-foreground/80">{color.nombre}</span>
                            {color.oculto ? <Badge variant="outline">Oculto</Badge> : null}
                          </div>
                          <p className="text-[11px] text-muted-foreground">Orden {color.orden}</p>
                        </div>
                        {puedeEditar ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Editar color ${color.codigo}`}
                              title="Editar"
                              disabled={isPending}
                              onClick={() => abrirEdicion(material.id, color)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={color.oculto ? `Mostrar color ${color.codigo}` : `Ocultar color ${color.codigo}`}
                              title={color.oculto ? "Mostrar" : "Ocultar"}
                              disabled={isPending}
                              onClick={() => cambiarOculto(color)}
                            >
                              {color.oculto ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Agregar o editar un color */}
      <Dialog open={Boolean(editorColor)} onOpenChange={(abierto) => (!abierto && !isPending ? setEditorColor(null) : undefined)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editorColor?.id ? "Editar color" : "Agregar color"}</DialogTitle>
            <DialogDescription>
              El código es lo que el cliente escribe en el chat para elegir el color.
            </DialogDescription>
          </DialogHeader>

          {editorColor ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="carta-codigo">Código</Label>
                  <Input
                    id="carta-codigo"
                    value={editorColor.codigo}
                    onChange={(event) => setEditorColor({ ...editorColor, codigo: event.target.value })}
                    placeholder="Ej. 12"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="carta-nombre">Nombre</Label>
                  <Input
                    id="carta-nombre"
                    value={editorColor.nombre}
                    onChange={(event) => setEditorColor({ ...editorColor, nombre: event.target.value })}
                    placeholder="Ej. Café"
                  />
                </div>
              </div>

              {editorColor.id ? (
                <div className="space-y-1">
                  <Label htmlFor="carta-orden">Orden en la carta</Label>
                  <Input
                    id="carta-orden"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={editorColor.orden}
                    onChange={(event) => setEditorColor({ ...editorColor, orden: event.target.value })}
                  />
                </div>
              ) : null}

              <div className="space-y-1">
                <Label>Foto</Label>
                <div className="flex items-center gap-3">
                  {fotoDelEditor ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fotoDelEditor}
                      alt="Foto del color"
                      className="h-16 w-16 shrink-0 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => inputFoto.current?.click()}
                    >
                      {fotoDelEditor ? "Cambiar foto" : "Elegir foto"}
                    </Button>
                    {fotoDelEditor ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={() => setEditorColor({ ...editorColor, fotoUrl: null, archivo: null, vistaPrevia: null })}
                      >
                        Quitar
                      </Button>
                    ) : null}
                  </div>
                  <input
                    ref={inputFoto}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      elegirFoto(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorColor(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={guardarColor} disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agregar un material */}
      <Dialog
        open={Boolean(editorMaterial)}
        onOpenChange={(abierto) => (!abierto && !isPending ? setEditorMaterial(null) : undefined)}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle>Agregar material</DialogTitle>
            <DialogDescription>Sale como una pestaña nueva, sin colores.</DialogDescription>
          </DialogHeader>

          {editorMaterial ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="carta-material">Nombre</Label>
                <Input
                  id="carta-material"
                  value={editorMaterial.nombre}
                  onChange={(event) => setEditorMaterial({ ...editorMaterial, nombre: event.target.value })}
                  placeholder="Ej. Lino"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="carta-tipo">Tipo</Label>
                <NativeSelect
                  id="carta-tipo"
                  value={editorMaterial.tipo}
                  onChange={(event) =>
                    setEditorMaterial({ ...editorMaterial, tipo: event.target.value as TipoMaterialDeColor })
                  }
                >
                  <NativeSelectOption value="CUERO">Cuero</NativeSelectOption>
                  <NativeSelectOption value="TELA">Tela</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorMaterial(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={guardarMaterial} disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
