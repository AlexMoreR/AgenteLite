# Chats Performance Map

This note summarizes how the chats inbox currently behaves so we keep the fast path stable.

## What is cached

- Conversation history in the client cache:
  - [`src/components/chats/chat-history-cache.ts`](../src/components/chats/chat-history-cache.ts)
- Conversation selection warmup:
  - [`src/components/chats/chat-conversation-warmup.ts`](../src/components/chats/chat-conversation-warmup.ts)
- Short-lived official API list cache:
  - [`src/features/official-api/services/getOfficialApiChatsData.ts`](../src/features/official-api/services/getOfficialApiChatsData.ts)

## What is rendered immediately

- The inbox shell and the selected chat layout:
  - [`src/app/cliente/chats/page.tsx`](../src/app/cliente/chats/page.tsx)
  - [`src/app/cliente/chats/loading.tsx`](../src/app/cliente/chats/loading.tsx)
- The conversation list:
  - [`src/components/chats/conversation-list.tsx`](../src/components/chats/conversation-list.tsx)
- The selected conversation preview and cached snapshots:
  - [`src/components/chats/shared-inbox.tsx`](../src/components/chats/shared-inbox.tsx)

## What stays live

- Active chat refresh:
  - [`src/components/chats/chats-realtime-sync.tsx`](../src/components/chats/chats-realtime-sync.tsx)
- Chat auto-refresh fallback:
  - [`src/components/agents/chats-auto-refresh.tsx`](../src/components/agents/chats-auto-refresh.tsx)
- Server endpoints that hydrate the live chat:
  - [`src/app/api/cliente/chats/live/route.ts`](../src/app/api/cliente/chats/live/route.ts)
  - [`src/app/api/cliente/chats/summary/route.ts`](../src/app/api/cliente/chats/summary/route.ts)

## Current rules

- Prefer cache for the chat the user already opened.
- Use `/api/cliente/chats/live` only for the selected agent conversation and scroll pagination.
- Avoid duplicate refreshes for the same active agent chat when websocket realtime is already connected.
- Keep the left list light:
  - fewer rows on the initial load,
  - aggregated unread counts,
  - batch-based last-message lookup.

## Safety notes

- Do not move webhook logic here.
- Do not reintroduce per-row message queries in the inbox page unless the UI needs them.
- If a change affects selection, history cache, or realtime, validate with a production build.
