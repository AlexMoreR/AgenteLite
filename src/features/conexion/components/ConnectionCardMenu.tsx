"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import { deleteConnectionChannelAction } from "@/app/actions/connection-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RenameChannelDialog, RenameChannelMenuItem } from "./RenameChannelMenuItem";
import { ChannelProviderDialog, ChannelProviderMenuItem } from "./ChannelProviderMenuItem";

export function ConnectionCardMenu({
  channelId,
  channelName,
  gatewayKind = "EVOLUTION_GO",
  gateways = [],
}: {
  channelId: string;
  channelName: string;
  /** Por que servidor sale hoy este canal. */
  gatewayKind?: string;
  gateways?: Array<{ id: string; kind: string; baseUrl: string }>;
}) {
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [proveedorOpen, setProveedorOpen] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="relative z-20"
          render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Acciones para ${channelName}`} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <RenameChannelMenuItem onSelect={() => setRenameOpen(true)} />
          {gateways.length > 0 ? (
            <ChannelProviderMenuItem onSelect={() => setProveedorOpen(true)} />
          ) : null}
          <form action={deleteConnectionChannelAction}>
            <input type="hidden" name="channelId" value={channelId} />
            <DropdownMenuItem variant="destructive" className="w-full" render={<button type="submit" />}>
              <Trash2 />
              Eliminar
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameChannelDialog
        channelId={channelId}
        currentName={channelName}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />

      <ChannelProviderDialog
        channelId={channelId}
        channelName={channelName}
        gatewayKind={gatewayKind}
        gateways={gateways}
        open={proveedorOpen}
        onOpenChange={setProveedorOpen}
      />
    </>
  );
}
