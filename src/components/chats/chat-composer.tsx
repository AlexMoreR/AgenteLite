"use client";

import { useMemo } from "react";
import { useFormStatus } from "react-dom";
import { Search, SendHorizonal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CHAT_COMPOSER_EMOJI_GROUPS,
  CHAT_COMPOSER_EMOJIS,
  CHAT_COMPOSER_CATEGORY_ORDER,
  CHAT_COMPOSER_CATEGORY_LABELS,
  CHAT_COMPOSER_CATEGORY_ICONS,
  normalizeComposerEmojiSearch,
  type ComposerEmoji,
  type ComposerEmojiTab,
} from "./chat-inbox-emojis";

export function ComposerSendButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="ghost"
      size="icon"
      disabled={pending}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--primary)] transition hover:bg-muted-foreground/20 disabled:cursor-not-allowed disabled:opacity-70 md:size-8"
      aria-label={pending ? "Enviando mensaje" : "Enviar mensaje"}
    >
      <SendHorizonal className={`size-6 ${pending ? "animate-pulse" : ""}`} />
    </Button>
  );
}

export type ComposerEmojiPickerProps = {
  query: string;
  activeTab: ComposerEmojiTab;
  recentEmojis: string[];
  onQueryChange: (value: string) => void;
  onActiveTabChange: (value: ComposerEmojiTab) => void;
  onSelectEmoji: (emoji: string) => void;
};

export function ComposerEmojiPicker({
  query,
  activeTab,
  recentEmojis,
  onQueryChange,
  onActiveTabChange,
  onSelectEmoji,
}: ComposerEmojiPickerProps) {
  const normalizedQuery = useMemo(() => normalizeComposerEmojiSearch(query), [query]);

  const recentEmojiItems = useMemo(() => {
    const mapped = recentEmojis
      .map((emoji) => CHAT_COMPOSER_EMOJIS.find((item) => item.emoji === emoji))
      .filter((item): item is ComposerEmoji => Boolean(item));

    if (!normalizedQuery) {
      return mapped;
    }

    return mapped.filter((item) => {
      const haystack = normalizeComposerEmojiSearch([item.label, item.category, ...item.keywords].join(" "));
      return haystack.includes(normalizedQuery) || item.emoji.includes(normalizedQuery);
    });
  }, [normalizedQuery, recentEmojis]);

  const visibleEmojiItems = useMemo(() => {
    let source: ComposerEmoji[];

    if (activeTab === "todos") {
      source = CHAT_COMPOSER_EMOJIS;
    } else if (activeTab === "recientes") {
      source = recentEmojiItems;
    } else {
      source = CHAT_COMPOSER_EMOJI_GROUPS[activeTab];
    }

    if (!normalizedQuery || activeTab === "recientes") {
      return source;
    }

    return source.filter((item) => {
      const haystack = normalizeComposerEmojiSearch([item.label, item.category, ...item.keywords].join(" "));
      return haystack.includes(normalizedQuery) || item.emoji.includes(normalizedQuery);
    });
  }, [activeTab, normalizedQuery, recentEmojiItems]);

  const emojiTabs: ComposerEmojiTab[] = ["todos", "recientes", ...CHAT_COMPOSER_CATEGORY_ORDER.slice(1)];

  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar emoticones"
            className="h-9 w-full rounded-2xl border border-border bg-muted pl-9 pr-10 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-[var(--primary)] focus:bg-background focus:ring-2 focus:ring-ring/50"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as ComposerEmojiTab)}>
          <TabsList className="flex h-auto w-full flex-wrap gap-1 rounded-2xl bg-muted p-1">
            {emojiTabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="group flex h-9 min-w-0 flex-1 items-center justify-center rounded-xl px-0 text-muted-foreground transition data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                title={CHAT_COMPOSER_CATEGORY_LABELS[tab]}
                aria-label={CHAT_COMPOSER_CATEGORY_LABELS[tab]}
              >
                {(() => {
                  const Icon = CHAT_COMPOSER_CATEGORY_ICONS[tab];

                  return <Icon className="h-4.5 w-4.5 transition-transform duration-150 group-data-[state=active]:scale-105" />;
                })()}
                <span className="sr-only">{CHAT_COMPOSER_CATEGORY_LABELS[tab]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="max-h-[17rem] overflow-y-auto pr-1">
        {activeTab === "recientes" && !recentEmojis.length ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
            Aquí aparecerán los últimos emoticones que uses.
          </div>
        ) : visibleEmojiItems.length ? (
          <div className="grid grid-cols-6 gap-0.5">
            {visibleEmojiItems.map((item) => (
              <button
                key={`${item.category}:${item.emoji}`}
                type="button"
                onClick={() => onSelectEmoji(item.emoji)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl text-[1.25rem] transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/50"
                aria-label={`Insertar ${item.label}`}
                title={item.label}
              >
                {item.emoji}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
            No encontramos emoticones para esa búsqueda.
          </div>
        )}
      </div>
    </div>
  );
}
