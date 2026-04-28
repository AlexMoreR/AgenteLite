import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const DEFAULT_NEW_LEAD_TAG_NAME = "Nuevo lead";
const DEFAULT_NEW_LEAD_TAG_SLUG = "nuevo-lead";
const DEFAULT_NEW_LEAD_TAG_COLOR = "#0f172a";

const DEFAULT_ACTIVE_LEAD_TAG_NAME = "Lead";
const DEFAULT_ACTIVE_LEAD_TAG_SLUG = "lead";
const DEFAULT_ACTIVE_LEAD_TAG_COLOR = "#2563eb";

async function ensureWorkspaceTag(input: {
  workspaceId: string;
  slug: string;
  name: string;
  color: string;
  syncExistingValues?: boolean;
}) {
  const existing = await prisma.tag.findFirst({
    where: {
      workspaceId: input.workspaceId,
      slug: input.slug,
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
  });

  if (existing) {
    if (input.syncExistingValues && (existing.name !== input.name || existing.color !== input.color)) {
      await prisma.tag.update({
        where: {
          id: existing.id,
        },
        data: {
          name: input.name,
          color: input.color,
          updatedAt: new Date(),
        },
      });
    }

    return existing;
  }

  return prisma.tag.create({
    data: {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      slug: input.slug,
      color: input.color,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
  });
}

async function assignTagToContact(input: { workspaceId: string; contactId: string; tagId: string }) {
  await prisma.contactTag.upsert({
    where: {
      contactId_tagId: {
        contactId: input.contactId,
        tagId: input.tagId,
      },
    },
    create: {
      contactId: input.contactId,
      tagId: input.tagId,
      workspaceId: input.workspaceId,
    },
    update: {},
  });
}

async function removeTagFromContact(input: { contactId: string; tagId: string }) {
  await prisma.contactTag.deleteMany({
    where: {
      contactId: input.contactId,
      tagId: input.tagId,
    },
  });
}

export async function syncLeadLifecycleForContact(input: {
  workspaceId: string;
  contactId: string;
  hasHistory: boolean;
  newLeadTagName?: string;
}) {
  const newLeadTag = await ensureWorkspaceTag({
    workspaceId: input.workspaceId,
    slug: DEFAULT_NEW_LEAD_TAG_SLUG,
    name: input.newLeadTagName?.trim() || DEFAULT_NEW_LEAD_TAG_NAME,
    color: DEFAULT_NEW_LEAD_TAG_COLOR,
    syncExistingValues: true,
  });

  const activeLeadTag = await ensureWorkspaceTag({
    workspaceId: input.workspaceId,
    slug: DEFAULT_ACTIVE_LEAD_TAG_SLUG,
    name: DEFAULT_ACTIVE_LEAD_TAG_NAME,
    color: DEFAULT_ACTIVE_LEAD_TAG_COLOR,
    syncExistingValues: false,
  });

  if (input.hasHistory) {
    await removeTagFromContact({
      contactId: input.contactId,
      tagId: newLeadTag.id,
    });
    await assignTagToContact({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      tagId: activeLeadTag.id,
    });

    return { state: "active" as const, tagId: activeLeadTag.id };
  }

  await removeTagFromContact({
    contactId: input.contactId,
    tagId: activeLeadTag.id,
  });
  await assignTagToContact({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    tagId: newLeadTag.id,
  });

  return { state: "new" as const, tagId: newLeadTag.id };
}

export async function ensureNewLeadTagForContact(input: {
  workspaceId: string;
  contactId: string;
  tagName?: string;
}) {
  return syncLeadLifecycleForContact({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    hasHistory: false,
    newLeadTagName: input.tagName,
  });
}
