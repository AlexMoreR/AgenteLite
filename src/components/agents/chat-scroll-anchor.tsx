"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

type ChatScrollAnchorProps = {
  dependencyKey: string;
  behavior?: "bottom" | "preserve";
};

function getScrollCacheKey(dependencyKey: string) {
  const conversationId = dependencyKey.split(":")[0]?.trim() || "";
  return conversationId ? `aglite:chat-scroll:${conversationId}` : "";
}

export function ChatScrollAnchor({ dependencyKey, behavior = "bottom" }: ChatScrollAnchorProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const messagesScroll = anchor?.closest(".chat-messages-scroll") as HTMLElement | null;

    if (!messagesScroll) {
      return;
    }

    if (behavior === "preserve") {
      const cacheKey = getScrollCacheKey(dependencyKey);
      if (!cacheKey) {
        return;
      }

      const cachedRaw = window.sessionStorage.getItem(cacheKey);
      if (!cachedRaw) {
        return;
      }

      try {
        const cached = JSON.parse(cachedRaw) as { scrollTop?: number; scrollHeight?: number } | null;
        const previousScrollTop = typeof cached?.scrollTop === "number" ? cached.scrollTop : null;
        const previousScrollHeight = typeof cached?.scrollHeight === "number" ? cached.scrollHeight : null;

        if (previousScrollTop === null || previousScrollHeight === null) {
          return;
        }

        const nextScrollTop = previousScrollTop + (messagesScroll.scrollHeight - previousScrollHeight);
        messagesScroll.scrollTop = Math.max(0, nextScrollTop);
      } catch {
        // Ignore malformed cached scroll state.
      }

      return;
    }

    messagesScroll.scrollTo({ top: messagesScroll.scrollHeight, behavior: "smooth" });
  }, [behavior, dependencyKey]);

  useEffect(() => {
    const anchor = anchorRef.current;
    const messagesScroll = anchor?.closest(".chat-messages-scroll") as HTMLElement | null;

    return () => {
      if (behavior !== "preserve") {
        return;
      }

      if (!messagesScroll) {
        return;
      }

      const cacheKey = getScrollCacheKey(dependencyKey);
      if (!cacheKey) {
        return;
      }

      try {
        window.sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            scrollTop: messagesScroll.scrollTop,
            scrollHeight: messagesScroll.scrollHeight,
          }),
        );
      } catch {
        // Ignore storage failures so scroll preservation never breaks the chat.
      }
    };
  }, [behavior, dependencyKey]);

  return <div ref={anchorRef} aria-hidden="true" />;
}
