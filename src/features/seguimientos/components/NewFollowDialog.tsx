"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Image as ImageIcon, LoaderCircle, PlusCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createFollowRuleAction,
  type CreateFollowRuleActionState,
} from "@/app/actions/follow-actions";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SelectOption = {
  value: string;
  label: string;
  color?: string;
};

type SourceGroup = {
  label: string;
  options: SelectOption[];
};

type SourceType = "FLOW" | "PRODUCT" | "TAG" | "CRM_STAGE" | "MANUAL";
type FollowMessageType = "TEXT" | "AUDIO" | "IMAGE" | "VIDEO" | "DOC";

type MediaUploadResponse = {
  ok?: boolean;
  url?: string;
  relativeUrl?: string;
  fileName?: string;
  error?: string;
};

type NewFollowDialogProps = {
  workspaceName: string;
  channels: SelectOption[];
  contacts: SelectOption[];
  sourceOptions: SourceGroup[];
  crmStages: SelectOption[];
};

function sourceOptionsForType(
  sourceType: SourceType,
  sourceOptions: SourceGroup[],
  crmStages: SelectOption[],
  contacts: SelectOption[],
) {
  if (sourceType === "MANUAL") return contacts;
  if (sourceType === "FLOW") return sourceOptions[0]?.options ?? [];
  if (sourceType === "PRODUCT") return sourceOptions[1]?.options ?? [];
  if (sourceType === "TAG") return sourceOptions[2]?.options ?? [];
  if (sourceType === "CRM_STAGE") return crmStages;
  return [];
}

function sourcePlaceholder(sourceType: SourceType) {
  if (sourceType === "MANUAL") return "Buscar contacto";
  if (sourceType === "FLOW") return "Buscar flujo";
  if (sourceType === "PRODUCT") return "Buscar producto";
  if (sourceType === "TAG") return "Buscar tag";
  return "Buscar estado";
}

function sourceLabel(sourceType: SourceType) {
  if (sourceType === "MANUAL") return "Contacto";
  if (sourceType === "FLOW") return "Flujo";
  if (sourceType === "PRODUCT") return "Producto";
  if (sourceType === "TAG") return "Tag";
  return "Estado CRM";
}

function sourceEmptyText(sourceType: SourceType) {
  if (sourceType === "MANUAL") return "No hay contactos disponibles.";
  if (sourceType === "FLOW") return "No hay flujos disponibles.";
  if (sourceType === "PRODUCT") return "No hay productos disponibles.";
  if (sourceType === "TAG") return "No hay tags disponibles.";
  return "No hay estados CRM disponibles.";
}

function followMediaHelperText(messageType: Exclude<FollowMessageType, "TEXT">) {
  if (messageType === "IMAGE") {
    return "Arrastra y suelta la imagen";
  }

  if (messageType === "AUDIO") {
    return "Sube un archivo de audio";
  }

  if (messageType === "VIDEO") {
    return "Sube un archivo de video";
  }

  return "Sube un documento";
}

const followMediaUploadEndpoint = "/api/cliente/seguimientos/upload-media";
const followMediaAcceptMap: Record<Exclude<FollowMessageType, "TEXT">, string> = {
  AUDIO: "audio/*",
  IMAGE: "image/*",
  VIDEO: "video/*",
  DOC: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain",
};

function isAllowedFollowMediaFile(file: File, messageType: Exclude<FollowMessageType, "TEXT">) {
  if (messageType === "IMAGE") {
    return file.type.startsWith("image/");
  }

  if (messageType === "AUDIO") {
    return file.type.startsWith("audio/");
  }

  if (messageType === "VIDEO") {
    return file.type.startsWith("video/");
  }

  if (messageType === "DOC") {
    const allowedDocMimeTypes = new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ]);

    return allowedDocMimeTypes.has(file.type);
  }

  return false;
}

const initialActionState: CreateFollowRuleActionState = {
  error: "",
};

export function NewFollowDialog({
  workspaceName,
  channels,
  contacts,
  sourceOptions,
  crmStages,
}: NewFollowDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"intro" | "rule">("intro");
  const [ruleName, setRuleName] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [ruleSourceType, setRuleSourceType] = useState<SourceType>("MANUAL");
  const [ruleSourceValue, setRuleSourceValue] = useState<SelectOption | null>(
    null,
  );
  const [ruleMessageType, setRuleMessageType] =
    useState<FollowMessageType>("TEXT");
  const [ruleContent, setRuleContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFileName, setMediaFileName] = useState("");
  const [mediaUploadError, setMediaUploadError] = useState("");
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [mediaDragActive, setMediaDragActive] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [actionState, formAction, pending] = useActionState(
    createFollowRuleAction,
    initialActionState,
  );

  const ruleSourceOptions = useMemo(
    () =>
      sourceOptionsForType(ruleSourceType, sourceOptions, crmStages, contacts),
    [contacts, crmStages, ruleSourceType, sourceOptions],
  );

  const ruleSourceLabelText = sourceLabel(ruleSourceType);
  const ruleSourcePlaceholderText = sourcePlaceholder(ruleSourceType);
  const ruleSourceEmptyText = sourceEmptyText(ruleSourceType);
  const isManualFollow = ruleSourceType === "MANUAL";
  const isTextMessage =
    ruleMessageType === "TEXT" || ruleMessageType.toUpperCase() === "TEXT";
  const isMultimediaMessage = !isTextMessage;
  const stepTitle = isManualFollow ? "Programar seguimiento" : "Crear regla";
  const stepDescription = isManualFollow
    ? `Programa un seguimiento para ${workspaceName}.`
    : `Configura la automatizacion reutilizable para ${workspaceName}.`;

  function resetMediaUploadState() {
    setMediaUrl("");
    setMediaFileName("");
    setMediaUploadError("");
    setIsUploadingMedia(false);
    setMediaDragActive(false);
    if (mediaInputRef.current) {
      mediaInputRef.current.value = "";
    }
  }

  async function uploadFollowMedia(file: File) {
    if (!isMultimediaMessage) {
      return;
    }

    if (!isAllowedFollowMediaFile(file, ruleMessageType as Exclude<FollowMessageType, "TEXT">)) {
      setMediaUploadError("El archivo no coincide con el tipo de mensaje seleccionado.");
      return;
    }

    setIsUploadingMedia(true);
    setMediaUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(followMediaUploadEndpoint, {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as MediaUploadResponse | null;
      if (!response.ok || !payload?.ok || !payload.url) {
        throw new Error(payload?.error || "No se pudo subir el archivo.");
      }

      setMediaUrl(payload.url);
      setMediaFileName(payload.fileName || file.name);
      toast.success("Archivo subido");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo subir el archivo.";
      setMediaUploadError(message);
      setMediaUrl("");
      setMediaFileName("");
      toast.error("Error al subir el archivo", {
        description: message,
      });
    } finally {
      setIsUploadingMedia(false);
    }
  }

  function handleFollowMediaInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }

    void uploadFollowMedia(file);
  }

  function handleFollowMediaDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setMediaDragActive(false);
    if (!isMultimediaMessage || ruleMessageType !== "IMAGE") {
      return;
    }

    const file = Array.from(event.dataTransfer.files).find((candidate) =>
      candidate.type.startsWith("image/"),
    );

    if (!file) {
      return;
    }

    void uploadFollowMedia(file);
  }

  useEffect(() => {
    if ("success" in actionState && actionState.success) {
      toast.success(actionState.message);
      window.setTimeout(() => {
        setOpen(false);
      }, 0);
      return;
    }

    if ("error" in actionState && actionState.error) {
      toast.error(actionState.error);
    }
  }, [actionState]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setStep("intro");
          setRuleName("");
          setSelectedChannelId("");
          setRuleSourceType("MANUAL");
          setRuleSourceValue(null);
          setRuleMessageType("TEXT");
          setRuleContent("");
          resetMediaUploadState();
        }
      }}
    >
      <DialogTrigger render={<Button type="button">Nuevo</Button>} />

      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {step === "intro" ? (
          <>
            <DialogHeader>
              <DialogTitle className="inline-flex items-center gap-2">
                <PlusCircle className="h-4 w-4 text-[var(--primary)]" />
                Nuevo seguimiento
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-4">
              <Field>
                <FieldLabel>Nombre</FieldLabel>
                <Input
                  id="new-follow-name"
                  value={ruleName}
                  onChange={(event) => setRuleName(event.target.value)}
                  placeholder="Seguimiento post demo"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="new-follow-channel">Canal</FieldLabel>
                <NativeSelect
                  id="new-follow-channel"
                  value={selectedChannelId}
                  onChange={(event) => setSelectedChannelId(event.target.value)}
                >
                  <NativeSelectOption value="">
                    Canal por defecto
                  </NativeSelectOption>
                  {channels.map((channel) => (
                    <NativeSelectOption
                      key={channel.value}
                      value={channel.value}
                    >
                      {channel.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!ruleName.trim()) {
                    return;
                  }
                  setStep("rule");
                }}
              >
                Crear
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === "rule" ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <DialogHeader>
                <DialogTitle>{stepTitle}</DialogTitle>
              </DialogHeader>

              <form action={formAction} className="flex min-h-0 flex-1 flex-col">
                <input type="hidden" name="name" value={ruleName} />
                <input type="hidden" name="channelId" value={selectedChannelId} />
                <input
                  type="hidden"
                  name="sourceId"
                  value={ruleSourceValue?.value ?? ""}
                />

                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>Origen</FieldLabel>
                      <NativeSelect
                        id="quick-rule-source-type"
                        name="sourceType"
                        value={ruleSourceType}
                        onChange={(event) => {
                          const nextType = event.target.value as SourceType;
                          setRuleSourceType(nextType);
                          setRuleSourceValue(null);
                        }}
                      >
                        <NativeSelectOption value="MANUAL">Manual</NativeSelectOption>
                        <NativeSelectOption value="FLOW">Flujo</NativeSelectOption>
                        <NativeSelectOption value="PRODUCT">Producto</NativeSelectOption>
                        <NativeSelectOption value="TAG">Tag</NativeSelectOption>
                        <NativeSelectOption value="CRM_STAGE">CRM</NativeSelectOption>
                      </NativeSelect>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="quick-rule-source-id">
                        {ruleSourceLabelText}
                      </FieldLabel>
                      <Combobox
                        key={ruleSourceType}
                        items={ruleSourceOptions}
                        autoHighlight
                        value={ruleSourceValue}
                        onValueChange={(option) => setRuleSourceValue(option)}
                        itemToStringLabel={(option) => option.label}
                        itemToStringValue={(option) => option.value}
                      >
                        <ComboboxInput
                          id="quick-rule-source-id"
                          placeholder={ruleSourcePlaceholderText}
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>{ruleSourceEmptyText}</ComboboxEmpty>
                          <ComboboxList>
                            {(option) => (
                              <ComboboxItem key={option.value} value={option}>
                                <span className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "size-2.5 shrink-0 rounded-full",
                                      ruleSourceType === "TAG" ||
                                        ruleSourceType === "CRM_STAGE"
                                        ? "opacity-100"
                                        : "bg-slate-300",
                                    )}
                                    style={
                                      (ruleSourceType === "TAG" ||
                                        ruleSourceType === "CRM_STAGE") &&
                                      option.color
                                        ? { backgroundColor: option.color }
                                        : undefined
                                    }
                                  />
                                  <span className="truncate">{option.label}</span>
                                </span>
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="quick-rule-time-type">Tipo de tiempo</FieldLabel>
                      <NativeSelect id="quick-rule-time-type" name="timeType">
                        <NativeSelectOption value="MINUTES">Minutos</NativeSelectOption>
                        <NativeSelectOption value="HOURS">Horas</NativeSelectOption>
                        <NativeSelectOption value="DAYS">Dias</NativeSelectOption>
                      </NativeSelect>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="quick-rule-time-value">Tiempo</FieldLabel>
                      <Input
                        id="quick-rule-time-value"
                        name="timeValue"
                        type="number"
                        min={1}
                        defaultValue={1}
                      />
                    </Field>
                  </div>
                  
                  <FieldLabel className="py-2">Acciones</FieldLabel>
                  

                  <Card   >
                    <CardContent>
                      <FieldGroup className="gap-2">
                        <Field>
                          <Select
                            value={ruleMessageType}
                            onValueChange={(value) => {
                              setRuleMessageType(value as FollowMessageType);
                              resetMediaUploadState();
                            }}
                          >
                            <SelectTrigger id="quick-rule-message-type" aria-label="Tipo de mensaje">
                              <SelectValue placeholder="Texto" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="TEXT">Texto</SelectItem>
                              <SelectItem value="AUDIO">Audio</SelectItem>
                              <SelectItem value="IMAGE">Imagen</SelectItem>
                              <SelectItem value="VIDEO">Video</SelectItem>
                              <SelectItem value="DOC">Documento</SelectItem>
                            </SelectContent>
                          </Select>
                          <input type="hidden" name="messageType" value={ruleMessageType} />
                        </Field>

                        <div className={isMultimediaMessage ? "grid gap-0 sm:grid-cols-2 sm:gap-2" : "grid gap-4"}>
                          <Field className={isMultimediaMessage ? "" : "sm:col-span-2"}>
                            <Textarea
                              id="quick-rule-content"
                              name="content"
                              rows={4}
                              placeholder={
                                isTextMessage
                                  ? "Hola, seguimos atentos a tu caso..."
                                  : "Ingresa tu mensaje aqui"
                              }
                              value={ruleContent}
                              onChange={(event) => setRuleContent(event.target.value)}
                              required={isTextMessage}
                            />
                          </Field>

                          {isMultimediaMessage ? (
                            <Field>
                              <div
                                className={
                                  ruleMessageType === "IMAGE"
                                    ? `rounded-lg border border-dashed px-3 py-1 ${mediaDragActive ? "border-primary bg-muted/40" : ""}`
                                    : "rounded-lg border border-dashed px-3 py-1"
                                }
                                onDragOver={(event) => {
                                  if (ruleMessageType !== "IMAGE") {
                                    return;
                                  }
                                  event.preventDefault();
                                  setMediaDragActive(true);
                                }}
                                onDragLeave={(event) => {
                                  if (ruleMessageType !== "IMAGE") {
                                    return;
                                  }
                                  event.preventDefault();
                                  setMediaDragActive(false);
                                }}
                                onDrop={handleFollowMediaDrop}
                              >
                                <input
                                  ref={mediaInputRef}
                                  id="quick-rule-media-upload"
                                  type="file"
                                  accept={followMediaAcceptMap[ruleMessageType as Exclude<FollowMessageType, "TEXT">]}
                                  className="hidden"
                                  onChange={handleFollowMediaInputChange}
                                />

                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => mediaInputRef.current?.click()}
                                    disabled={isUploadingMedia}
                                  >
                                    {isUploadingMedia ? <LoaderCircle className="animate-spin" /> : ruleMessageType === "IMAGE" ? <ImageIcon /> : <FileUp />}
                                    {mediaUrl ? "Cambiar archivo" : "Subir archivo"}
                                  </Button>

                                  {mediaUrl ? (
                                    <>
                                      <span className="text-xs text-muted-foreground truncate">
                                        {mediaFileName || mediaUrl}
                                      </span>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={resetMediaUploadState}
                                        aria-label="Quitar archivo"
                                      >
                                        <X />
                                      </Button>
                                    </>
                                  ) : null}
                                </div>

                                <p className="mt-2 text-xs text-muted-foreground">
                                  {followMediaHelperText(ruleMessageType as Exclude<FollowMessageType, "TEXT">)}
                                </p>

                                {mediaUrl && ruleMessageType === "IMAGE" ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={mediaUrl}
                                    alt={mediaFileName || "Vista previa"}
                                    className="mt-3 max-h-40 rounded-md object-contain"
                                  />
                                ) : null}

                                {mediaUploadError ? (
                                  <p className="mt-2 text-xs text-destructive">{mediaUploadError}</p>
                                ) : null}
                              </div>
                            </Field>
                          ) : (
                            <input type="hidden" name="mediaUrl" value="" />
                          )}
                        </div>

                      </FieldGroup>
                    </CardContent>
                  </Card>

                  <Button type="button" className="self-center my-2">
                    <PlusCircle data-icon="inline-start" />
                    Añadir Acción
                  </Button>

                  <Field orientation="horizontal" className="mt-2">
                    <Checkbox
                      id="cancelOnActivity"
                      name="cancelOnActivity"
                      defaultChecked
                    />
                    <FieldLabel htmlFor="cancelOnActivity" className="font-normal">
                      Cancelar por actividad
                    </FieldLabel>
                  </Field>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setStep("intro")}>
                    Volver
                  </Button>
                  <Button
                    type="submit"
                    disabled={pending || isUploadingMedia || (isMultimediaMessage && !mediaUrl)}
                  >
                    {pending
                      ? "Guardando..."
                      : isManualFollow
                        ? "Programar seguimiento"
                        : "Guardar regla"}
                  </Button>
                </DialogFooter>
              </form>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
