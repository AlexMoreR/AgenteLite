"use client";

import { useMemo, useState } from "react";
import { Check, Copy, PhoneOff, Send, TrendingUp, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ResumenDiaData } from "@/features/llamadas/services/getResumenDia";

function formatDate(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit" }).format(date);
}

/**
 * Arma el texto del informe tal como se va a leer en WhatsApp.
 *
 * Se manda por wa.me (elige el chat y toca enviar) en vez de enviarlo el servidor: no hace falta
 * configurar destinatarios ni tocar el motor de envíos, y ella ve el mensaje antes de mandarlo.
 */
function buildReportText(data: ResumenDiaData, quotes: string, notes: string) {
  const lines: string[] = [];
  lines.push(`*Informe del día — ${data.advisorName}*`);
  lines.push(data.dateLabel);
  lines.push("");

  lines.push(`*Leads nuevos:* ${data.newLeads.total}`);
  for (const origin of data.newLeads.byOrigin) {
    lines.push(`  • ${origin.origin}: ${origin.count}`);
  }
  lines.push("");

  lines.push(`*Llamadas:* ${data.calls.total}`);
  lines.push(`  • Contestaron: ${data.calls.answered}`);
  lines.push(`  • No contestaron: ${data.calls.noAnswer}`);
  lines.push(`  • Con próximo contacto agendado: ${data.calls.scheduled}`);
  lines.push("");

  if (data.calls.items.length > 0) {
    lines.push("*Detalle de llamadas:*");
    for (const call of data.calls.items) {
      const parts = [`${call.name} (${call.phoneNumber})`, `— ${call.resultLabel}`];
      if (call.summary) parts.push(`: ${call.summary}`);
      if (call.lostReasonLabel) parts.push(`[motivo: ${call.lostReasonLabel}]`);
      if (call.nextContactAt) parts.push(`→ vuelve a llamar el ${formatDate(call.nextContactAt)}`);
      lines.push(`  • ${parts.join(" ")}`);
    }
    lines.push("");
  }

  const quotesNumber = quotes.trim();
  lines.push(`*Cotizaciones enviadas:* ${quotesNumber || "0"}`);
  lines.push("");

  lines.push(`*Ventas cerradas:* ${data.sales.length}`);
  for (const sale of data.sales) {
    lines.push(`  • ${sale.name} (${sale.phoneNumber})`);
  }

  if (notes.trim()) {
    lines.push("");
    lines.push(`*Notas:* ${notes.trim()}`);
  }

  return lines.join("\n");
}

export function ResumenDiaView({ data }: { data: ResumenDiaData }) {
  const [quotes, setQuotes] = useState("");
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);

  const reportText = useMemo(() => buildReportText(data, quotes, notes), [data, quotes, notes]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      toast.success("Informe copiado");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
      <div>
        <h2 className="text-base font-semibold">Resumen del día</h2>
        <p className="text-xs text-muted-foreground">
          {data.dateLabel} · {data.advisorName}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserPlus className="h-3.5 w-3.5" /> Leads nuevos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{data.newLeads.total}</p>
            <div className="mt-1 space-y-0.5">
              {data.newLeads.byOrigin.map((origin) => (
                <p key={origin.origin} className="text-xs text-muted-foreground">
                  {origin.origin}: <span className="text-foreground">{origin.count}</span>
                </p>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PhoneOff className="h-3.5 w-3.5" /> Llamadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{data.calls.total}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Contestaron: <span className="text-foreground">{data.calls.answered}</span> · No:{" "}
              <span className="text-foreground">{data.calls.noAnswer}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Agendadas: <span className="text-foreground">{data.calls.scheduled}</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Ventas cerradas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{data.sales.length}</p>
            {data.sales.slice(0, 3).map((sale) => (
              <p key={sale.phoneNumber} className="truncate text-xs text-muted-foreground">
                {sale.name}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Lo único que no sale de los datos: lo carga la asesora. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Para completar a mano</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="quotes">Cotizaciones enviadas</Label>
            <Input
              id="quotes"
              inputMode="numeric"
              value={quotes}
              onChange={(event) => setQuotes(event.target.value)}
              placeholder="Ej. 4"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Algo para contarle al jefe"
            />
          </div>
        </CardContent>
      </Card>

      {/* Detalle de cada llamada: nombre, teléfono y qué pasó. */}
      {data.calls.items.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Detalle de llamadas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data.calls.items.map((call, index) => (
              <div key={`${call.phoneNumber}:${index}`} className="rounded-lg border border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">{call.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{call.phoneNumber}</span>
                </div>
                <p className="text-xs text-foreground/70">{call.resultLabel}</p>
                {call.summary ? <p className="text-xs text-muted-foreground">{call.summary}</p> : null}
                {call.nextContactAt ? (
                  <p className="text-[11px] text-muted-foreground">
                    Vuelve a llamar el {formatDate(call.nextContactAt)}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Vista previa exacta de lo que se va a enviar. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Así se va a enviar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={reportText} readOnly rows={12} className="font-mono text-[12px]" />
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(reportText)}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1"
            >
              <Button className="w-full gap-1.5">
                <Send className="h-4 w-4" /> Enviar por WhatsApp
              </Button>
            </a>
            <Button variant="outline" onClick={handleCopy} className="gap-1.5">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Al tocar “Enviar por WhatsApp” se abre WhatsApp con el informe escrito: elegís el chat y
            tocás enviar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
