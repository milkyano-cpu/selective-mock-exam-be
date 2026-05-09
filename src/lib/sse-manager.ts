import type { FastifyReply } from "fastify";

type Client = FastifyReply;

const clients = new Map<string, Set<Client>>();

export function addSseClient(userId: string, reply: Client): void {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId)!.add(reply);
}

export function removeSseClient(userId: string, reply: Client): void {
  const userClients = clients.get(userId);
  if (!userClients) return;
  userClients.delete(reply);
  if (userClients.size === 0) {
    clients.delete(userId);
  }
}

export function sendSseToUser(
  userId: string,
  event: string,
  data: unknown
): void {
  const userClients = clients.get(userId);
  if (!userClients || userClients.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const reply of userClients) {
    try {
      reply.raw.write(payload);
    } catch {
      userClients.delete(reply);
    }
  }
}

export function sendSseBroadcast(
  userIds: string[],
  event: string,
  data: unknown
): void {
  for (const userId of userIds) {
    sendSseToUser(userId, event, data);
  }
}
