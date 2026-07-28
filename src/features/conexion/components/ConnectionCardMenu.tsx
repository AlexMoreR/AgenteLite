"use client";

import * as React from "react";
import { FiTrash2 } from "react-icons/fi";
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

export function ConnectionCardMenu({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [renameOpen, setRenameOpen] = React.useState(false);

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
          <form action={deleteConnectionChannelAction}>
            <input type="hidden" name="channelId" value={channelId} />
            <DropdownMenuItem variant="destructive" className="w-full" render={<button type="submit" />}>
              <FiTrash2 />
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
    </>
  );
}
