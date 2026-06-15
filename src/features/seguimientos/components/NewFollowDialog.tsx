"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileUp,
  Image as ImageIcon,
  LoaderCircle,
  PlusCircle,
  Trash2,
  X,
} from "lucide-react";
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
  updateFollowRuleAction,
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

type SourceType = "FLOW" | "PRODUCT" | "TAG" | "CRM_STAGE" | "MANUAL" | "AGENT_NODE";
type FollowMessageType = "TEXT" | "AUDIO" | "IMAGE" | "VIDEO" | "DOC";
type FollowTimeType = "MINUTES" | "HOURS" | "DAYS";

export type EditFollowRule = {
  id: string;
  name: string;
  channelId: string | null;
  sourceType: SourceType;
  sourceId: string | null;
  timeType: FollowTimeType;
  timeValue: number;
  messageType: FollowMessageType;
  content: string | null;
  mediaUrl: string | null;
  cancelOnActivity: boolean;
  isActive: boolean;
  actions: Array<{
    messageType: FollowMessageType;
    content: string | null;
    mediaUrl: string | null;
  }>;
};

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
  mode?: "create" | "edit";
  editRule?: EditFollowRule | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

type FollowActionDraft = {
  id: string;
  order: number;
  messageType: FollowMessageType;
  content: string;
  mediaUrl: string;
  mediaFileName: string;
  mediaUploadError: string;
  isUploadingMedia: boolean;
  mediaDragActive: boolean;
};

function createFollowActionId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `follow-action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createFollowActionDraft(order: number, messageType: FollowMessageType = "TEXT"): FollowActionDraft {
  return {
    id: createFollowActionId(),
    order,
    messageType,
    content: "",
    mediaUrl: "",
    mediaFileName: "",
    mediaUploadError: "",
    isUploadingMedia: false,
    mediaDragActive: false,
  };
}

function buildSubmitFollowActions(actions: FollowActionDraft[]) {
  return actions.map((action, index) => ({
    order: index + 1,
    messageType: action.messageType,
    content: action.content.trim(),
    mediaUrl: action.mediaUrl.trim(),
  }));
}

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
  channels,
  contacts,
  sourceOptions,
  crmStages,
  mode = "create",
  editRule = null,
  open: openProp,
  onOpenChange,
}: NewFollowDialogProps) {
  const isEdit = mode === "edit";
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) {
      onOpenChange(next);
    } else {
      setInternalOpen(next);
    }
  };
  const [step, setStep] = useState<"intro" | "rule">("intro");
  const [ruleName, setRuleName] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [ruleSourceType, setRuleSourceType] = useState<SourceType>("MANUAL");
  const [ruleSourceValue, setRuleSourceValue] = useState<SelectOption | null>(
    null,
  );
  const [ruleTimeType, setRuleTimeType] = useState<FollowTimeType>("MINUTES");
  const [ruleTimeValue, setRuleTimeValue] = useState("1");
  const [ruleCancelOnActivity, setRuleCancelOnActivity] = useState(true);
  const [ruleIsActive, setRuleIsActive] = useState(true);
  const [followActions, setFollowActions] = useState<FollowActionDraft[]>(() => [
    createFollowActionDraft(1),
  ]);
  const actionInputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const [actionState, formAction, pending] = useActionState(
    isEdit ? updateFollowRuleAction : createFollowRuleAction,
    initialActionState,
  );

  // En modo edición, precargar el formulario con los datos de la regla al abrir.
  useEffect(() => {
    if (!open || !isEdit || !editRule) {
      return;
    }

    setStep("rule");
    setRuleName(editRule.name);
    setSelectedChannelId(editRule.channelId ?? "");
    setRuleSourceType(editRule.sourceType);

    const options = sourceOptionsForType(
      editRule.sourceType,
      sourceOptions,
      crmStages,
      contacts,
    );
    const matchedSource = editRule.sourceId
      ? options.find((option) => option.value === editRule.sourceId) ?? {
          value: editRule.sourceId,
          label: editRule.sourceId,
        }
      : null;
    setRuleSourceValue(matchedSource);
    setRuleTimeType(editRule.timeType);
    setRuleTimeValue(String(editRule.timeValue));
    setRuleCancelOnActivity(editRule.cancelOnActivity);
    setRuleIsActive(editRule.isActive);

    const sourceActions = editRule.actions.length
      ? editRule.actions
      : [
          {
            messageType: editRule.messageType,
            content: editRule.content,
            mediaUrl: editRule.mediaUrl,
          },
        ];
    setFollowActions(
      sourceActions.map((action, index) => {
        const mediaUrl = action.mediaUrl ?? "";
        return {
          ...createFollowActionDraft(index + 1, action.messageType),
          content: action.content ?? "",
          mediaUrl,
          mediaFileName: mediaUrl ? mediaUrl.split("/").pop() ?? "" : "",
        };
      }),
    );
    // editRule mantiene identidad estable mientras el diálogo está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, editRule]);

  const ruleSourceOptions = useMemo(
    () =>
      sourceOptionsForType(ruleSourceType, sourceOptions, crmStages, contacts),
    [contacts, crmStages, ruleSourceType, sourceOptions],
  );

  const ruleSourceLabelText = sourceLabel(ruleSourceType);
  const ruleSourcePlaceholderText = sourcePlaceholder(ruleSourceType);
  const ruleSourceEmptyText = sourceEmptyText(ruleSourceType);
  const isManualFollow = ruleSourceType === "MANUAL";
  const stepTitle = isEdit
    ? "Editar regla"
    : isManualFollow
      ? "Programar seguimiento"
      : "Crear regla";

  const serializedFollowActions = useMemo(
    () => buildSubmitFollowActions(followActions),
    [followActions],
  );
  const primaryFollowAction = serializedFollowActions[0] ?? {
    order: 1,
    messageType: "TEXT" as FollowMessageType,
    content: "",
    mediaUrl: "",
  };

  const followActionsHavePendingUpload = followActions.some(
    (action) => action.isUploadingMedia,
  );
  const followActionsAreComplete = followActions.every((action) => {
    if (action.mediaUploadError.trim()) {
      return false;
    }

    if (action.isUploadingMedia) {
      return false;
    }

    if (action.messageType === "TEXT") {
      return action.content.trim().length > 0;
    }

    return action.mediaUrl.trim().length > 0;
  });

  function resetFollowActions() {
    setFollowActions([createFollowActionDraft(1)]);
    actionInputRefs.current = new Map();
  }

  function updateFollowAction(
    actionId: string,
    updater: (action: FollowActionDraft) => FollowActionDraft,
  ) {
    setFollowActions((current) =>
      current.map((action) => (action.id === actionId ? updater(action) : action)),
    );
  }

  function setFollowActionMessageType(
    actionId: string,
    messageType: FollowMessageType,
  ) {
    updateFollowAction(actionId, (action) => ({
      ...action,
      messageType,
      mediaUrl: "",
      mediaFileName: "",
      mediaUploadError: "",
      isUploadingMedia: false,
      mediaDragActive: false,
    }));
  }

  function clearFollowActionMedia(actionId: string) {
    updateFollowAction(actionId, (action) => ({
      ...action,
      mediaUrl: "",
      mediaFileName: "",
      mediaUploadError: "",
      isUploadingMedia: false,
      mediaDragActive: false,
    }));
  }

  async function uploadFollowMedia(actionId: string, file: File) {
    const currentAction = followActions.find((action) => action.id === actionId);
    if (!currentAction || currentAction.messageType === "TEXT") {
      return;
    }

    if (!isAllowedFollowMediaFile(file, currentAction.messageType as Exclude<FollowMessageType, "TEXT">)) {
      updateFollowAction(actionId, (action) => ({
        ...action,
        mediaUploadError: "El archivo no coincide con el tipo de mensaje seleccionado.",
      }));
      return;
    }

    updateFollowAction(actionId, (action) => ({
      ...action,
      isUploadingMedia: true,
      mediaUploadError: "",
    }));

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

      updateFollowAction(actionId, (action) => ({
        ...action,
        mediaUrl: payload.url || "",
        mediaFileName: payload.fileName || file.name,
        mediaUploadError: "",
        isUploadingMedia: false,
        mediaDragActive: false,
      }));
      toast.success("Archivo subido");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo subir el archivo.";
      updateFollowAction(actionId, (action) => ({
        ...action,
        mediaUploadError: message,
        mediaUrl: "",
        mediaFileName: "",
        isUploadingMedia: false,
        mediaDragActive: false,
      }));
      toast.error("Error al subir el archivo", {
        description: message,
      });
    }
  }

  function handleFollowMediaInputChange(
    actionId: string,
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }

    void uploadFollowMedia(actionId, file);
  }

  function handleFollowMediaDrop(actionId: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    updateFollowAction(actionId, (action) => ({
      ...action,
      mediaDragActive: false,
    }));

    const action = followActions.find((item) => item.id === actionId);
    if (!action || action.messageType !== "IMAGE") {
      return;
    }

    const file = Array.from(event.dataTransfer.files).find((candidate) =>
      candidate.type.startsWith("image/"),
    );

    if (!file) {
      return;
    }

    void uploadFollowMedia(actionId, file);
  }

  function addFollowAction() {
    setFollowActions((current) => [
      ...current,
      createFollowActionDraft(current.length + 1),
    ]);
  }

  function removeFollowAction(actionId: string) {
    setFollowActions((current) => {
      if (current.length <= 1) {
        return current;
      }

      return current
        .filter((action) => action.id !== actionId)
        .map((action, index) => ({ ...action, order: index + 1 }));
    });
    actionInputRefs.current.delete(actionId);
  }

  function moveFollowAction(actionId: string, direction: -1 | 1) {
    setFollowActions((current) => {
      const index = current.findIndex((action) => action.id === actionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next.map((action, order) => ({ ...action, order: order + 1 }));
    });
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
          setRuleTimeType("MINUTES");
          setRuleTimeValue("1");
          setRuleCancelOnActivity(true);
          setRuleIsActive(true);
          resetFollowActions();
        }
      }}
    >
      {isEdit ? null : (
        <DialogTrigger render={<Button type="button">Nuevo</Button>} />
      )}

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
                {isEdit && editRule ? (
                  <>
                    <input
                      type="hidden"
                      name="followRuleId"
                      value={editRule.id}
                    />
                    <input
                      type="hidden"
                      name="isActive"
                      value={ruleIsActive ? "true" : "false"}
                    />
                  </>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
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
                        {isEdit ? null : (
                          <NativeSelectOption value="MANUAL">Manual</NativeSelectOption>
                        )}
                        <NativeSelectOption value="FLOW">Flujo</NativeSelectOption>
                        <NativeSelectOption value="PRODUCT">Producto</NativeSelectOption>
                        <NativeSelectOption value="TAG">Tag</NativeSelectOption>
                        <NativeSelectOption value="CRM_STAGE">CRM</NativeSelectOption>
                        <NativeSelectOption value="AGENT_NODE">Agente V2</NativeSelectOption>
                      </NativeSelect>
                    </Field>

                    {ruleSourceType === "AGENT_NODE" ? (
                      <Field>
                        <FieldLabel>Uso</FieldLabel>
                        <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
                          Plantilla para nodos de <strong>Agente V2</strong>. No se dispara
                          sola: la agenda el nodo Seguimiento cuando el lead llega a su etapa.
                        </p>
                      </Field>
                    ) : (
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
                    )}

                    <Field>
                      <FieldLabel htmlFor="quick-rule-time-type">Tipo de tiempo</FieldLabel>
                      <NativeSelect
                        id="quick-rule-time-type"
                        name="timeType"
                        value={ruleTimeType}
                        onChange={(event) =>
                          setRuleTimeType(event.target.value as FollowTimeType)
                        }
                      >
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
                        value={ruleTimeValue}
                        onChange={(event) => setRuleTimeValue(event.target.value)}
                      />
                    </Field>
                  </div>

                  <input
                    type="hidden"
                    name="messageType"
                    value={primaryFollowAction.messageType}
                  />
                  <input type="hidden" name="content" value={primaryFollowAction.content} />
                  <input type="hidden" name="mediaUrl" value={primaryFollowAction.mediaUrl} />
                  <input
                    type="hidden"
                    name="actions"
                    value={JSON.stringify(serializedFollowActions)}
                  />

                  <div className="mt-4 grid gap-3">
                    {followActions.map((action, index) => {
                      const isTextAction = action.messageType === "TEXT";
                      const isFirstAction = index === 0;

                      return (
                        <Card key={action.id} className="border border-slate-200 py-0 shadow-none">
                          <CardContent className="p-3">
                            <FieldGroup className="gap-2">
                              <div className="flex items-center gap-2">
                                <Field className="flex-1">
                                  <Select
                                    value={action.messageType}
                                    onValueChange={(value) => {
                                      setFollowActionMessageType(
                                        action.id,
                                        value as FollowMessageType,
                                      );
                                    }}
                                  >
                                    <SelectTrigger
                                      id={`quick-rule-message-type-${action.id}`}
                                      aria-label="Tipo de mensaje"
                                    >
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
                                </Field>
                                <div className="flex shrink-0 items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => moveFollowAction(action.id, -1)}
                                    disabled={isFirstAction}
                                    aria-label="Subir acción"
                                  >
                                    <ArrowUp data-icon="inline-start" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => moveFollowAction(action.id, 1)}
                                    disabled={index === followActions.length - 1}
                                    aria-label="Bajar acción"
                                  >
                                    <ArrowDown data-icon="inline-start" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => removeFollowAction(action.id)}
                                    disabled={followActions.length === 1}
                                    aria-label="Eliminar acción"
                                  >
                                    <Trash2 data-icon="inline-start" />
                                  </Button>
                                </div>
                              </div>

                              <div
                                className={
                                  isTextAction
                                    ? "grid gap-4"
                                    : "grid gap-0 sm:grid-cols-2 sm:gap-2"
                                }
                              >
                                <Field className={isTextAction ? "sm:col-span-2" : ""}>
                                  <Textarea
                                    id={`quick-rule-content-${action.id}`}
                                    rows={4}
                                    placeholder={
                                      isTextAction
                                        ? "Hola, seguimos atentos a tu caso..."
                                        : "Ingresa tu mensaje aqui"
                                    }
                                    value={action.content}
                                    onChange={(event) =>
                                      updateFollowAction(action.id, (current) => ({
                                        ...current,
                                        content: event.target.value,
                                      }))
                                    }
                                    required={isTextAction}
                                  />
                                </Field>

                                {!isTextAction ? (
                                  <Field>
                                    <div
                                      className={
                                        action.messageType === "IMAGE"
                                          ? `rounded-lg border border-dashed px-3 py-1 ${
                                              action.mediaDragActive
                                                ? "border-primary bg-muted/40"
                                                : ""
                                            }`
                                          : "rounded-lg border border-dashed px-3 py-1"
                                      }
                                      onDragOver={(event) => {
                                        if (action.messageType !== "IMAGE") {
                                          return;
                                        }
                                        event.preventDefault();
                                        updateFollowAction(action.id, (current) => ({
                                          ...current,
                                          mediaDragActive: true,
                                        }));
                                      }}
                                      onDragLeave={(event) => {
                                        if (action.messageType !== "IMAGE") {
                                          return;
                                        }
                                        event.preventDefault();
                                        updateFollowAction(action.id, (current) => ({
                                          ...current,
                                          mediaDragActive: false,
                                        }));
                                      }}
                                      onDrop={(event) => handleFollowMediaDrop(action.id, event)}
                                    >
                                      <input
                                        ref={(node) => {
                                          if (node) {
                                            actionInputRefs.current.set(action.id, node);
                                            return;
                                          }

                                          actionInputRefs.current.delete(action.id);
                                        }}
                                        id={`quick-rule-media-upload-${action.id}`}
                                        type="file"
                                        accept={
                                          followMediaAcceptMap[
                                            action.messageType as Exclude<FollowMessageType, "TEXT">
                                          ]
                                        }
                                        className="hidden"
                                        onChange={(event) => handleFollowMediaInputChange(action.id, event)}
                                      />

                                      <div className="flex items-center gap-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          onClick={() =>
                                            actionInputRefs.current.get(action.id)?.click()
                                          }
                                          disabled={action.isUploadingMedia}
                                        >
                                          {action.isUploadingMedia ? (
                                            <LoaderCircle className="animate-spin" />
                                          ) : action.messageType === "IMAGE" ? (
                                            <ImageIcon />
                                          ) : (
                                            <FileUp />
                                          )}
                                          {action.mediaUrl ? "Cambiar archivo" : "Subir archivo"}
                                        </Button>

                                        {action.mediaUrl ? (
                                          <>
                                            <span className="truncate text-xs text-muted-foreground">
                                              {action.mediaFileName || action.mediaUrl}
                                            </span>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon-sm"
                                              onClick={() => clearFollowActionMedia(action.id)}
                                              aria-label="Quitar archivo"
                                            >
                                              <X />
                                            </Button>
                                          </>
                                        ) : null}
                                      </div>

                                      <p className="mt-2 text-xs text-muted-foreground">
                                        {followMediaHelperText(
                                          action.messageType as Exclude<FollowMessageType, "TEXT">,
                                        )}
                                      </p>

                                      {action.mediaUrl && action.messageType === "IMAGE" ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={action.mediaUrl}
                                          alt={action.mediaFileName || "Vista previa"}
                                          className="mt-3 max-h-40 rounded-md object-contain"
                                        />
                                      ) : null}

                                      {action.mediaUploadError ? (
                                        <p className="mt-2 text-xs text-destructive">
                                          {action.mediaUploadError}
                                        </p>
                                      ) : null}
                                    </div>
                                  </Field>
                                ) : null}
                              </div>
                            </FieldGroup>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  <Button type="button" className="self-center my-2" onClick={addFollowAction}>
                    <PlusCircle data-icon="inline-start" />
                    Añadir Acción
                  </Button>

                  <Field orientation="horizontal" className="mt-2">
                    <Checkbox
                      id="cancelOnActivity"
                      name="cancelOnActivity"
                      checked={ruleCancelOnActivity}
                      onCheckedChange={(checked) =>
                        setRuleCancelOnActivity(checked === true)
                      }
                    />
                    <FieldLabel htmlFor="cancelOnActivity" className="font-normal">
                      Cancelar por actividad
                    </FieldLabel>
                  </Field>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => (isEdit ? setOpen(false) : setStep("intro"))}
                  >
                    {isEdit ? "Cancelar" : "Volver"}
                  </Button>
                  <Button
                    type="submit"
                    disabled={pending || followActionsHavePendingUpload || !followActionsAreComplete}
                  >
                    {pending
                      ? "Guardando..."
                      : isEdit
                        ? "Actualizar regla"
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
