"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, MessageCircleQuestion, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCrmStageMeta } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";
import { listPlaybookScriptsAction, type PlaybookScriptItem } from "@/app/actions/playbook-actions";

// Quita tildes y mayusculas para que buscar "caro" encuentre "Está caro".
function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * "Qué decir ahora": abre mostrando el guion de la etapa de ESTE cliente (sin buscar nada) y
 * debajo las respuestas a objeciones, con un buscador. Un toque INSERTA el texto en el
 * compositor — no lo envía — para poder ajustarlo antes de mandarlo.
 */
export function PlaybookPanelDialog({
  open,
  onClose,
  onSelect,
  stage,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
  stage?: string | null;
}) {
  const [scripts, setScripts] = useState<PlaybookScriptItem[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setSearch("");
    listPlaybookScriptsAction({ onlyActive: true })
      .then((result) => {
        if (!cancelled) setScripts(result.items);
      })
      .catch(() => {
        if (!cancelled) setScripts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const stageMeta = stage ? getCrmStageMeta(stage as CrmStage) : null;

  const stageScripts = useMemo(
    () => (scripts ?? []).filter((item) => item.kind === "STAGE" && item.stage === stage),
    [scripts, stage],
  );

  const objections = useMemo(() => {
    const all = (scripts ?? []).filter((item) => item.kind === "OBJECTION");
    const term = normalize(search.trim());
    if (!term) {
      return all;
    }
    return all.filter((item) =>
      normalize(`${item.title} ${item.keywords ?? ""} ${item.content}`).includes(term),
    );
  }, [scripts, search]);

  const renderScript = (script: PlaybookScriptItem) => (
    <button
      key={script.id}
      type="button"
      onClick={() => {
        onSelect(script.content);
        onClose();
      }}
      className="w-full rounded-xl border border-border px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-muted"
    >
      <p className="text-[13px] font-medium text-foreground">{script.title}</p>
      <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[12px] leading-snug text-muted-foreground">
        {script.content}
      </p>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] w-[min(94vw,32rem)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            Qué decir ahora
            {stageMeta ? (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${stageMeta.backgroundClassName} ${stageMeta.borderClassName} ${stageMeta.accentClassName}`}
              >
                {stageMeta.label}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {scripts === null ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Cargando guiones…</p>
        ) : scripts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Todavía no hay guiones cargados. Se cargan en CRM → Guiones.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Guion de la etapa del cliente: lo primero que ve, sin buscar. */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" />
                Para esta etapa
              </div>
              {stageScripts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                  Sin guion para esta etapa.
                </p>
              ) : (
                <div className="space-y-2">{stageScripts.map(renderScript)}</div>
              )}
            </div>

            {/* Objeciones: aparecen siempre, porque llegan en cualquier momento del chat. */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <MessageCircleQuestion className="h-3.5 w-3.5" />
                Si te dice…
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar objeción: caro, lo pienso, envío…"
                  className="pl-8"
                />
              </div>
              {objections.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Sin resultados.</p>
              ) : (
                <div className="space-y-2">{objections.map(renderScript)}</div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
