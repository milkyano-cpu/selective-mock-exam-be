import fp from "fastify-plugin";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

async function securityPlugin(fastify: FastifyInstance) {
  // Cookies — must run before jwt plugin so request.cookies is available
  await fastify.register(fastifyCookie);

  // CORS
  await fastify.register(fastifyCors, {
    origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  // Helmet (security headers)
  await fastify.register(fastifyHelmet);
}

export default fp(securityPlugin, {
  name: "security",
});
