"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, MessageCircleQuestion, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CRM_STAGE_ORDER, getCrmStageMeta } from "../domain/crm-config";
import type { CrmStage } from "../types";
import {
  deletePlaybookScriptAction,
  savePlaybookScriptAction,
  type PlaybookScriptItem,
} from "@/app/actions/playbook-actions";

// Etapas donde tiene sentido tener un guion de venta. Ganado/Perdido quedan afuera: ahí ya no
// hay que decir nada para avanzar la venta.
const SCRIPT_STAGES: CrmStage[] = CRM_STAGE_ORDER.filter(
  (stage) => stage !== "GANADO" && stage !== "PERDIDO",
);

type EditorState = {
  id?: string;
  kind: "STAGE" | "OBJECTION";
  stage: CrmStage;
  title: string;
  content: string;
  keywords: string;
};

const emptyEditor = (kind: "STAGE" | "OBJECTION", stage: CrmStage = "NUEVO"): EditorState => ({
  kind,
  stage,
  title: "",
  content: "",
  keywords: "",
});

export function PlaybookScriptsWorkspace({ scripts }: { scripts: PlaybookScriptItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<EditorState | null>(null);

  const byStage = useMemo(() => {
    const map = new Map<string, PlaybookScriptItem[]>();
    for (const script of scripts.filter((item) => item.kind === "STAGE")) {
      const key = script.stage ?? "NUEVO";
      map.set(key, [...(map.get(key) ?? []), script]);
    }
    return map;
  }, [scripts]);

  const objections = useMemo(() => scripts.filter((item) => item.kind === "OBJECTION"), [scripts]);

  const handleSave = useCallback(() => {
    if (!editor) return;
    startTransition(async () => {
      const result = await savePlaybookScriptAction({
        id: editor.id,
        kind: editor.kind,
        stage: editor.kind === "STAGE" ? editor.stage : null,
        title: editor.title,
        content: editor.content,
        keywords: editor.kind === "OBJECTION" ? editor.keywords : null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Guion guardado");
      setEditor(null);
      router.refresh();
    });
  }, [editor, router]);

  const handleDelete = useCallback(
    (id: string) => {
      startTransition(async () => {
        const result = await deletePlaybookScriptAction(id);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success("Guion eliminado");
        router.refresh();
      });
    },
    [router],
  );

  const renderScriptRow = (script: PlaybookScriptItem) => (
    <div key={script.id} className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{script.title}</p>
          {script.keywords ? (
            <p className="truncate text-[11px] text-muted-foreground">Busca por: {script.keywords}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Editar"
            onClick={() =>
              setEditor({
                id: script.id,
                kind: script.kind,
                stage: (script.stage as CrmStage) ?? "NUEVO",
                title: script.title,
                content: script.content,
                keywords: script.keywords ?? "",
              })
            }
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-rose-600"
            aria-label="Eliminar"
            onClick={() => handleDelete(script.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-foreground/75">{script.content}</p>
    </div>
  );

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Guiones por etapa */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Qué decir en cada etapa</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {SCRIPT_STAGES.map((stage) => {
            const meta = getCrmStageMeta(stage);
            const items = byStage.get(stage) ?? [];
            return (
              <Card key={stage}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.backgroundClassName} ${meta.borderClassName} ${meta.accentClassName}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-muted-foreground">{items.length}</span>
                    </CardTitle>
                    <Button variant="outline" size="sm" onClick={() => setEditor(emptyEditor("STAGE", stage))}>
                      <Plus className="h-3.5 w-3.5" /> Agregar
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {items.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                      Sin guion todavía.
                    </p>
                  ) : (
                    items.map(renderScriptRow)
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Objeciones */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageCircleQuestion className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Respuestas a objeciones</h2>
            <Badge variant="secondary">{objections.length}</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditor(emptyEditor("OBJECTION"))}>
            <Plus className="h-3.5 w-3.5" /> Agregar objeción
          </Button>
        </div>

        <Card>
          <CardContent className="space-y-2 pt-4">
            {objections.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                Sin objeciones cargadas. Ej: “está caro”, “lo tengo que pensar”, “no tengo plata”.
              </p>
            ) : (
              objections.map(renderScriptRow)
            )}
          </CardContent>
        </Card>
      </div>

      {/* Editor */}
      <Dialog open={Boolean(editor)} onOpenChange={(next) => (!next ? setEditor(null) : undefined)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Editar guion" : "Nuevo guion"}</DialogTitle>
            <DialogDescription>
              {editor?.kind === "OBJECTION"
                ? "Qué contestar cuando el cliente pone esta objeción."
                : "Qué decir cuando el cliente está en esta etapa."}
            </DialogDescription>
          </DialogHeader>

          {editor ? (
            <div className="space-y-3">
              {editor.kind === "STAGE" ? (
                <div className="space-y-1">
                  <Label>Etapa</Label>
                  <NativeSelect
                    value={editor.stage}
                    onChange={(event) => setEditor({ ...editor, stage: event.target.value as CrmStage })}
                  >
                    {SCRIPT_STAGES.map((stage) => (
                      <NativeSelectOption key={stage} value={stage}>
                        {getCrmStageMeta(stage).label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}

              <div className="space-y-1">
                <Label>Título (para reconocerlo rápido)</Label>
                <Input
                  value={editor.title}
                  onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                  placeholder={editor.kind === "OBJECTION" ? "Ej. Está caro" : "Ej. Primer contacto"}
                />
              </div>

              {editor.kind === "OBJECTION" ? (
                <div className="space-y-1">
                  <Label>Palabras para buscarlo</Label>
                  <Input
                    value={editor.keywords}
                    onChange={(event) => setEditor({ ...editor, keywords: event.target.value })}
                    placeholder="caro, precio, costoso, descuento"
                  />
                </div>
              ) : null}

              <div className="space-y-1">
                <Label>Texto</Label>
                <Textarea
                  value={editor.content}
                  onChange={(event) => setEditor({ ...editor, content: event.target.value })}
                  rows={7}
                  placeholder="Escribí el mensaje tal como querés que salga…"
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
