import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

async function tracePlugin(fastify: FastifyInstance) {
  fastify.addHook("onRequest", async (request, reply) => {
    reply.header("X-Trace-Id", request.id);
  });
}

export default fp(tracePlugin, { name: "trace" });
