"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock3, FileStack, Loader2, Plus, RefreshCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type TemplateItem = {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  bodyText: string | null;
  buttons: string[];
};

type TemplatesResponse = {
  ok: boolean;
  error?: string;
  templates?: TemplateItem[];
};

const statusStyles: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  APPROVED: { label: "Aprobada", className: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  PENDING: { label: "En revision", className: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock3 },
  REJECTED: { label: "Rechazada", className: "bg-red-50 text-red-700 border-red-200", icon: XCircle },
};

function TemplateStatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] ?? {
    label: status,
    className: "bg-slate-50 text-slate-600 border-slate-200",
    icon: Clock3,
  };
  const Icon = style.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {style.label}
    </span>
  );
}

export function OfficialApiTemplatesWorkspace() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [name, setName] = useState("");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [language, setLanguage] = useState("es");
  const [bodyText, setBodyText] = useState("");
  const [addYesNoButtons, setAddYesNoButtons] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitOk, setSubmitOk] = useState("");

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/cliente/api-oficial/plantillas", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as TemplatesResponse | null;
      if (!response.ok || !payload?.ok) {
        setLoadError(payload?.error || "No se pudieron cargar las plantillas.");
        setTemplates([]);
        return;
      }
      setTemplates(payload.templates ?? []);
    } catch {
      setLoadError("No se pudieron cargar las plantillas.");
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    setSubmitOk("");

    try {
      const response = await fetch("/api/cliente/api-oficial/plantillas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, language, bodyText, addYesNoButtons }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok: boolean; error?: string; template?: { name: string; status: string } }
        | null;

      if (!response.ok || !payload?.ok) {
        setSubmitError(payload?.error || "Meta no acepto la plantilla.");
        return;
      }

      setSubmitOk(
        `Plantilla "${payload.template?.name}" enviada a Meta (estado: ${payload.template?.status ?? "PENDING"}).`,
      );
      setName("");
      setBodyText("");
      setAddYesNoButtons(false);
      await loadTemplates();
    } catch {
      setSubmitError("No se pudo crear la plantilla.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <FileStack className="h-5 w-5 text-[var(--primary)]" />
              Plantillas de mensajes
            </CardTitle>
            <CardDescription>
              Plantillas de tu cuenta de WhatsApp Business (WABA), sincronizadas desde Meta.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadTemplates()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Actualizar
          </Button>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
          ) : loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando plantillas desde Meta...
            </div>
          ) : templates.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Aun no hay plantillas en esta WABA. Crea la primera con el formulario.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {templates.map((template) => (
                <li key={template.id || template.name} className="flex flex-col gap-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">{template.name}</span>
                    <TemplateStatusBadge status={template.status} />
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">
                      {template.category}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">
                      {template.language}
                    </span>
                  </div>
                  {template.bodyText ? (
                    <p className="line-clamp-2 text-sm text-slate-500">{template.bodyText}</p>
                  ) : null}
                  {template.buttons.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {template.buttons.map((button) => (
                        <span
                          key={button}
                          className="rounded-lg border border-slate-200 px-2 py-0.5 text-xs text-slate-600"
                        >
                          {button}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-[var(--primary)]" />
            Nueva plantilla
          </CardTitle>
          <CardDescription>
            Se envia a Meta para aprobacion. Una vez aprobada podras usarla para iniciar conversaciones fuera de la
            ventana de 24 horas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="space-y-1.5">
              <Label htmlFor="template-name">Nombre</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="confirmacion_ticket"
                required
              />
              <p className="text-xs text-slate-500">Se normaliza a minusculas con guiones bajos (formato de Meta).</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="template-category">Categoria</Label>
                <select
                  id="template-category"
                  className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as "UTILITY" | "MARKETING")}
                >
                  <option value="UTILITY">Utilidad</option>
                  <option value="MARKETING">Marketing</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="template-language">Idioma</Label>
                <select
                  id="template-language"
                  className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  <option value="es">Espanol</option>
                  <option value="es_CO">Espanol (Colombia)</option>
                  <option value="es_MX">Espanol (Mexico)</option>
                  <option value="en_US">Ingles (EE. UU.)</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="template-body">Contenido del mensaje</Label>
              <Textarea
                id="template-body"
                value={bodyText}
                onChange={(event) => setBodyText(event.target.value)}
                placeholder="Hola, tu ticket fue creado. Deseas confirmar la visita?"
                rows={4}
                required
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={addYesNoButtons}
                onChange={(event) => setAddYesNoButtons(event.target.checked)}
              />
              Agregar botones de respuesta rapida &quot;Si&quot; / &quot;No&quot;
            </label>

            {submitError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>
            ) : null}
            {submitOk ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {submitOk}
              </p>
            ) : null}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Crear plantilla en Meta
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
