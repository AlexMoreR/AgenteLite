"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { Copy, LoaderCircle, MessageSquareText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  createQuickReplyAction,
  deleteQuickReplyAction,
  getQuickRepliesAction,
  updateQuickReplyAction,
  type QuickReplyAsesora,
  type QuickReplyItem,
} from "@/app/actions/chats-actions";

type Props = {
  open: boolean;
  onClose: () => void;
  // Inserta el contenido elegido en el cuadro de mensaje (no envía).
  onSelect: (content: string) => void;
};

// Mismos valores que FILTRO_TODAS / FILTRO_SIN_REPARTIR de src/lib/respuestas-rapidas.ts (ese archivo usa
// Prisma y no se importa en el navegador).
const FILTRO_TODAS = "todas";
const FILTRO_SIN_REPARTIR = "sin_repartir";

/*
  Lo ultimo que se trajo por filtro, guardado 60 s en el navegador.

  La lista se pedia cada vez que se abria la ventana y cada vez que se cambiaba el filtro: una server
  action que va en fila detras de las del chat abierto, con su espera, para algo que cambia muy poco.
  Con menos de 60 s se muestra lo guardado y no se pregunta; mas viejo, se muestra al instante y se
  vuelve a pedir por detras (si ese pedido falla, sale el aviso de error como siempre).

  Crear, editar o borrar una respuesta borra lo guardado: despues de tocarlas nunca se ve la lista
  vieja. Lo que cambie otra persona en otra pestaña puede tardar hasta 60 s en verse.
*/
const VIDA_DE_LA_LISTA_MS = 60_000;
type ListaGuardada = { items: QuickReplyItem[]; esJefe: boolean; asesoras: QuickReplyAsesora[]; en: number };
const listaPorFiltro = new Map<string, ListaGuardada>();
// Sube con cada cambio: un pedido que salio antes de crear/editar/borrar no guarda su respuesta.
let versionDeLaLista = 0;

function olvidarListasGuardadas() {
  listaPorFiltro.clear();
  versionDeLaLista += 1;
}

// Cada asesora ve y maneja solo sus respuestas. El dueño y los administradores (esJefe) ven todas, con el
// nombre de la dueña, un filtro, casillas para crear una copia por asesora, cambio de dueña y "Duplicar".
// El servidor impone las reglas (src/lib/respuestas-rapidas.ts): esta ventana solo las refleja.
export function QuickRepliesDialog({ open, onClose, onSelect }: Props) {
  const [items, setItems] = useState<QuickReplyItem[]>([]);
  const [esJefe, setEsJefe] = useState(false);
  const [asesoras, setAsesoras] = useState<QuickReplyAsesora[]>([]);
  const [filtro, setFiltro] = useState(FILTRO_TODAS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "form">("list");
  // Editar y duplicar usan estados aparte: duplicar NUNCA guarda sobre la original.
  const [editing, setEditing] = useState<QuickReplyItem | null>(null);
  const [duplicando, setDuplicando] = useState<{ title: string; content: string } | null>(null);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [duenaEditada, setDuenaEditada] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const activas = asesoras.filter((asesora) => asesora.activa);
  const retiradas = asesoras.filter((asesora) => !asesora.activa);

  // Carga robusta: SIEMPRE termina (loaded=true) aunque la acción falle o lance. Antes, si
  // getQuickRepliesAction lanzaba (o había un bache), no había catch y el diálogo giraba para
  // siempre sin reintentar. Ahora, ante error, se muestra un aviso con botón de reintento.
  const refresh = useCallback(async (filtroPedido: string) => {
    setLoadError(null);
    const version = versionDeLaLista;
    try {
      const result = await getQuickRepliesAction(filtroPedido);
      if (result.error) {
        listaPorFiltro.delete(filtroPedido);
        setLoadError(result.error);
        setItems([]);
      } else {
        const guardada: ListaGuardada = {
          items: result.items ?? [],
          esJefe: Boolean(result.esJefe),
          asesoras: result.asesoras ?? [],
          en: Date.now(),
        };
        if (version === versionDeLaLista) {
          listaPorFiltro.set(filtroPedido, guardada);
        }
        setItems(guardada.items);
        setEsJefe(guardada.esJefe);
        setAsesoras(guardada.asesoras);
      }
    } catch {
      listaPorFiltro.delete(filtroPedido);
      setLoadError("No se pudieron cargar las respuestas rápidas.");
      setItems([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    const guardada = listaPorFiltro.get(filtro);
    if (guardada) {
      // Al instante con lo guardado. Si ya paso un minuto, ademas se pide de nuevo por detras.
      setItems(guardada.items);
      setEsJefe(guardada.esJefe);
      setAsesoras(guardada.asesoras);
      setLoaded(true);
      if (Date.now() - guardada.en < VIDA_DE_LA_LISTA_MS) return;
    } else {
      setLoaded(false);
    }
    void refresh(filtro);
  }, [open, filtro, refresh]);

  const volverALaLista = useCallback(() => {
    setMode("list");
    setEditing(null);
    setDuplicando(null);
    setMarcadas([]);
    setFormError(null);
  }, []);

  const abrirCrear = useCallback(
    (base: { title: string; content: string } | null) => {
      setEditing(null);
      setDuplicando(base);
      // Al crear desde el filtro de una asesora activa, queda marcada; al duplicar, ninguna (es "para otra").
      setMarcadas(!base && activas.some((asesora) => asesora.id === filtro) ? [filtro] : []);
      setFormError(null);
      setMode("form");
    },
    [activas, filtro],
  );

  const abrirEditar = useCallback((item: QuickReplyItem) => {
    setEditing(item);
    setDuplicando(null);
    // La lista arranca en la dueña ACTUAL (también una retirada o "Sin repartir"): guardar solo el título no la cambia.
    setDuenaEditada(item.duenaId ?? "");
    setFormError(null);
    setMode("form");
  }, []);

  const handleSave = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const editingId = editing?.id ?? null;
      if (esJefe) {
        if (editingId) {
          formData.set("duenaId", duenaEditada);
        } else {
          if (!marcadas.length) {
            setFormError("Marca al menos una asesora.");
            return;
          }
          for (const id of marcadas) formData.append("duenaIds", id);
        }
      }
      setFormError(null);
      startTransition(async () => {
        try {
          const result = editingId
            ? await updateQuickReplyAction(editingId, formData)
            : await createQuickReplyAction({}, formData);
          if (result?.error) {
            setFormError(result.error);
            return;
          }
        } catch {
          // Pudo haberse guardado igual: lo guardado ya no sirve.
          olvidarListasGuardadas();
          setFormError("No se pudo guardar la respuesta rápida. Intenta de nuevo.");
          return;
        }
        olvidarListasGuardadas();
        await refresh(filtro);
        volverALaLista();
      });
    },
    [duenaEditada, editing, esJefe, filtro, marcadas, refresh, volverALaLista],
  );

  const handleDelete = useCallback((id: string) => {
    startTransition(async () => {
      try {
        const result = await deleteQuickReplyAction(id);
        if (result?.error) {
          toast.error(result.error);
          return;
        }
      } catch {
        olvidarListasGuardadas();
        toast.error("No se pudo eliminar la respuesta rápida. Intenta de nuevo.");
        return;
      }
      olvidarListasGuardadas();
      setItems((prev) => prev.filter((item) => item.id !== id));
    });
  }, []);

  const alternarMarcada = (id: string, marcada: boolean) =>
    setMarcadas((prev) => (marcada ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));

  // Dueña actual que ya no está entre las activas (retirada): se muestra en la lista para no perderla.
  const duenaRetiradaDelEditado =
    editing?.duenaId && !activas.some((asesora) => asesora.id === editing.duenaId)
      ? { id: editing.duenaId, nombre: editing.duenaNombre ?? "Sin nombre" }
      : null;

  const valoresDelFormulario = editing ?? duplicando;
  const conFiltro = esJefe && filtro !== FILTRO_TODAS;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          volverALaLista();
        }
      }}
    >
      <DialogContent className="w-[min(94vw,30rem)] max-w-none gap-0 overflow-hidden border border-border bg-popover p-0 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.45)]">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="text-sm">
            {mode === "list" ? "Respuestas rápidas" : editing ? "Editar respuesta rápida" : "Crear respuesta rápida"}
          </DialogTitle>
        </DialogHeader>

        {mode === "list" ? (
          <>
            {esJefe ? (
              <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
                <label htmlFor="filtro-respuestas-rapidas" className="shrink-0 text-[12px] font-medium text-muted-foreground">
                  Ver
                </label>
                <NativeSelect
                  id="filtro-respuestas-rapidas"
                  size="sm"
                  className="w-full"
                  value={filtro}
                  onChange={(event) => setFiltro(event.target.value)}
                  disabled={busy}
                >
                  <NativeSelectOption value={FILTRO_TODAS}>Todas</NativeSelectOption>
                  <NativeSelectOption value={FILTRO_SIN_REPARTIR}>Sin repartir</NativeSelectOption>
                  {activas.map((asesora) => (
                    <NativeSelectOption key={asesora.id} value={asesora.id}>
                      {asesora.nombre}
                    </NativeSelectOption>
                  ))}
                  {retiradas.map((asesora) => (
                    <NativeSelectOption key={asesora.id} value={asesora.id}>
                      {asesora.nombre} (retirada)
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            ) : null}

            <div className="max-h-[50vh] min-h-0 overflow-y-auto px-3 py-2">
              {!loaded ? (
                <div className="flex justify-center py-8">
                  <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-foreground">{loadError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoaded(false);
                      void refresh(filtro);
                    }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
                  >
                    Reintentar
                  </button>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <MessageSquareText className="h-5 w-5" />
                  </span>
                  {conFiltro ? (
                    <>
                      <p className="text-sm font-medium text-foreground">No hay respuestas en este filtro</p>
                      <p className="text-xs text-muted-foreground">Elige otro en «Ver» o crea una nueva.</p>
                    </>
                  ) : esJefe ? (
                    <>
                      <p className="text-sm font-medium text-foreground">Aún no hay respuestas rápidas</p>
                      <p className="text-xs text-muted-foreground">Crea la primera y elige a qué asesoras les queda.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-foreground">Aún no tienes respuestas rápidas</p>
                      <p className="text-xs text-muted-foreground">
                        Crea la tuya para reutilizar mensajes frecuentes. Solo tú las ves.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="group flex items-start gap-1 rounded-xl border border-transparent p-1 transition hover:border-border hover:bg-muted/60"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(item.content);
                          onClose();
                        }}
                        className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition"
                        title="Insertar en el mensaje"
                      >
                        <p className="truncate text-[13px] font-medium text-foreground">{item.title}</p>
                        <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{item.content}</p>
                        {esJefe ? (
                          <Badge variant={item.duenaId ? "secondary" : "outline"} className="mt-1 max-w-full">
                            <span className="truncate">{item.duenaId ? item.duenaNombre ?? "Sin nombre" : "Sin repartir"}</span>
                          </Badge>
                        ) : null}
                      </button>
                      {esJefe ? (
                        <button
                          type="button"
                          onClick={() => abrirCrear({ title: item.title, content: item.content })}
                          disabled={busy}
                          className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                          aria-label={`Duplicar ${item.title} para otra asesora`}
                          title="Duplicar para otra"
                        >
                          <Copy className="size-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => abrirEditar(item)}
                        disabled={busy}
                        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                        aria-label={`Editar ${item.title}`}
                        title="Editar"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        disabled={busy}
                        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        aria-label={`Eliminar ${item.title}`}
                        title="Eliminar"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-border p-3">
              <button
                type="button"
                onClick={() => abrirCrear(null)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-3 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Crear respuesta rápida
              </button>
            </div>
          </>
        ) : (
          <form
            // La llave reinicia los campos al pasar de editar a duplicar o crear.
            key={editing ? `editar-${editing.id}` : duplicando ? "duplicar" : "crear"}
            onSubmit={handleSave}
            className="max-h-[80vh] space-y-3 overflow-y-auto px-5 py-4"
          >
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Título</label>
              <input
                name="title"
                autoFocus
                defaultValue={valoresDelFormulario?.title ?? ""}
                placeholder="Ej. Saludo inicial"
                maxLength={80}
                className="h-9 w-full rounded-[12px] border border-border bg-background px-3 text-[13px] text-foreground outline-none transition focus:border-[var(--primary)]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Mensaje</label>
              <textarea
                name="content"
                rows={4}
                defaultValue={valoresDelFormulario?.content ?? ""}
                placeholder="Escribe el mensaje que se insertará en el chat…"
                maxLength={2000}
                className="w-full resize-none rounded-[12px] border border-border bg-background px-3 py-2 text-[13px] leading-snug text-foreground outline-none transition focus:border-[var(--primary)]"
              />
            </div>

            {esJefe && editing ? (
              <div className="space-y-1.5">
                <label htmlFor="duena-respuesta-rapida" className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Asesora
                </label>
                <NativeSelect
                  id="duena-respuesta-rapida"
                  className="w-full"
                  value={duenaEditada}
                  onChange={(event) => setDuenaEditada(event.target.value)}
                >
                  {!editing.duenaId ? <NativeSelectOption value="">Sin repartir</NativeSelectOption> : null}
                  {duenaRetiradaDelEditado ? (
                    <NativeSelectOption value={duenaRetiradaDelEditado.id}>
                      {duenaRetiradaDelEditado.nombre} (retirada)
                    </NativeSelectOption>
                  ) : null}
                  {activas.map((asesora) => (
                    <NativeSelectOption key={asesora.id} value={asesora.id}>
                      {asesora.nombre}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            ) : null}

            {esJefe && !editing ? (
              <fieldset className="space-y-1.5">
                <legend className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Para qué asesoras
                </legend>
                <p className="text-[11px] text-muted-foreground">Se crea una copia para cada asesora marcada.</p>
                {activas.length ? (
                  // Desplazamiento propio: con muchas asesoras el botón Crear sigue a la vista en el celular.
                  <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-[12px] border border-border p-1.5">
                    {activas.map((asesora) => (
                      <label
                        key={asesora.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-foreground transition hover:bg-muted"
                      >
                        <Checkbox
                          checked={marcadas.includes(asesora.id)}
                          onCheckedChange={(checked) => alternarMarcada(asesora.id, Boolean(checked))}
                        />
                        <span className="truncate">{asesora.nombre}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No hay asesoras activas en el negocio.</p>
                )}
              </fieldset>
            ) : null}

            {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={volverALaLista}
                className="h-9 flex-1 rounded-[10px] border border-border text-[13px] text-muted-foreground transition hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--primary)] text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {editing ? "Guardar cambios" : esJefe && marcadas.length > 1 ? `Crear ${marcadas.length}` : "Crear"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
