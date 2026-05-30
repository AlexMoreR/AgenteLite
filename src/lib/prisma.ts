import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const connectionString = process.env.DATABASE_URL;

function hasFollowDelegates(client: PrismaClient) {
  return "followRule" in client && "follow" in client;
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg(new Pool({ connectionString })),
    log: ["error", "warn"],
  });
}

function resolvePrismaClient() {
  const existingClient = globalForPrisma.prisma;

  if (existingClient && hasFollowDelegates(existingClient)) {
    return existingClient;
  }

  const client = createPrismaClient();
  globalForPrisma.prisma = client;

  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = resolvePrismaClient();
    const value = Reflect.get(client as object, property, client);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
  set(_target, property, value) {
    const client = resolvePrismaClient();
    Reflect.set(client, property, value, client);
    return true;
  },
  has(_target, property) {
    const client = resolvePrismaClient();
    return Reflect.has(client, property);
  },
  ownKeys() {
    const client = resolvePrismaClient();
    return Reflect.ownKeys(client);
  },
  getOwnPropertyDescriptor(_target, property) {
    const client = resolvePrismaClient();
    return Object.getOwnPropertyDescriptor(client, property);
  },
}) as PrismaClient;
