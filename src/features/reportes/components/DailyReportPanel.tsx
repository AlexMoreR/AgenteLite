"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FiCalendar, FiEye, FiMoreVertical, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import { toast } from "sonner";

import {
  deleteDailyReportAction,
  generateDailyReportNowAction,
  updateReportConfigAction,
} from "@/app/actions/report-actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { DailyReportListItem } from "@/features/reportes/services/getDailyReports";

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const SENTIMENT_FACE: Record<string, string> = { SAD: "😞", NEUTRAL: "😐", HAPPY: "😀" };

export function DailyReportPanel({
  enabled: initialEnabled,
  recipients: initialRecipients,
  reports,
}: {
  enabled: boolean;
  recipients: string[];
  reports: DailyReportListItem[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [recipients, setRecipients] = useState<string[]>(initialRecipients);
  const [draft, setDraft] = useState("");
  const [isSaving, startSaving] = useTransition();
  const [isGenerating, startGenerating] = useTransition();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => new Date());
  const [isDeleting, startDeleting] = useTransition();

  const addRecipient = () => {
    const value = draft.replace(/[^\d]/g, "");
    if (value.length < 7) {
      toast.error("Ingresa un número válido (con código de país, solo dígitos).");
      return;
    }
    if (recipients.includes(value)) {
      setDraft("");
      return;
    }
    if (recipients.length >= 10) {
      toast.error("Máximo 10 números.");
      return;
    }
    setRecipients((current) => [...current, value]);
    setDraft("");
  };

  const removeRecipient = (value: string) => setRecipients((current) => current.filter((n) => n !== value));

  const handleSave = () => {
    startSaving(async () => {
      const result = await updateReportConfigAction({ recipients, enabled });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Configuración guardada");
      router.refresh();
    });
  };

  const handleGenerateNow = () => {
    if (!selectedDate) {
      toast.error("Selecciona un día");
      return;
    }
    startGenerating(async () => {
      const result = await generateDailyReportNowAction({ date: toYmd(selectedDate) });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setGenerateOpen(false);
      toast.success(
        result.delivered ? `Reporte generado y enviado a ${result.delivered} número(s)` : "Reporte generado",
      );
      router.refresh();
    });
  };

  const handleDelete = (reportId: string) => {
    startDeleting(async () => {
      const result = await deleteDailyReportAction({ reportId });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Reporte eliminado");
      router.refresh();
    });
  };

  return (
    <div className="space-y-5 pt-4">
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Reporte diario automático</p>
              <p className="text-xs text-muted-foreground">
                Cada día a las 11:59 PM (Colombia) generamos el reporte y lo enviamos por WhatsApp.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={(value) => setEnabled(Boolean(value))} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Números que reciben el reporte</p>
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addRecipient();
                  }
                }}
                placeholder="Ej: 573001234567"
                inputMode="numeric"
              />
              <Button type="button" variant="outline" onClick={addRecipient}>
                <FiPlus />
                Añadir
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recipients.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aún no has agregado números.</p>
              ) : (
                recipients.map((number) => (
                  <span
                    key={number}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
                  >
                    {number}
                    <button
                      type="button"
                      onClick={() => removeRecipient(number)}
                      aria-label={`Quitar ${number}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <FiX className="size-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Guardando…" : "Guardar configuración"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSelectedDate(new Date());
                setGenerateOpen(true);
              }}
            >
              <FiCalendar />
              Generar ahora
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="sm:max-w-fit">
          <DialogHeader>
            <DialogTitle>Generar reporte</DialogTitle>
            <DialogDescription>Elige el día del que quieres generar el reporte.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={{ after: new Date() }}
              defaultMonth={selectedDate}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setGenerateOpen(false)} disabled={isGenerating}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleGenerateNow} disabled={isGenerating || !selectedDate}>
              {isGenerating ? "Generando…" : "Generar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Reportes creados</p>
        {reports.length === 0 ? (
          <Card className="border border-dashed">
            <CardContent className="text-sm text-muted-foreground">
              Aún no hay reportes. Usa “Generar ahora” o espera al reporte automático de las 11:59 PM.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {reports.map((report) => (
              <Card key={report.id} className="py-3">
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-2xl" role="img" aria-label={report.sentiment}>
                      {SENTIMENT_FACE[report.sentiment] ?? "😐"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {new Date(report.reportDate).toLocaleDateString("es-CO", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {report.inboundCount} mensajes · {report.newContacts} nuevos · {report.wonCount} ganados ·{" "}
                        {report.lostCount} perdidos
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button asChild variant="outline" size="sm">
                      <a href={`/reportes/${report.shareToken}`} target="_blank" rel="noopener noreferrer">
                        <FiEye />
                        Ver
                      </a>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Acciones del reporte" />
                        }
                      >
                        <FiMoreVertical />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={isDeleting}
                          onClick={() => handleDelete(report.id)}
                        >
                          <FiTrash2 />
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
