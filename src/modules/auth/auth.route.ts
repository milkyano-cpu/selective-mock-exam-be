import type { FastifyInstance } from "fastify";
import { authRef } from "./auth.schema.js";
import { register, login, refresh, logout, changePassword } from "./auth.controller.js";

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/register", {
    config: {
      rateLimit: { max: 10, timeWindow: "1 minute" },
    },
    schema: {
      body: authRef("registerBodySchema"),
      response: { 201: authRef("registerResponseSchema") },
    },
    handler: register,
  });

  fastify.post("/login", {
    config: {
      rateLimit: { max: 20, timeWindow: "1 minute" },
    },
    schema: {
      body: authRef("loginBodySchema"),
      response: { 200: authRef("loginResponseSchema") },
    },
    handler: login,
  });

  fastify.post("/refresh", {
    config: {
      rateLimit: { max: 20, timeWindow: "1 minute" },
    },
    schema: {
      body: authRef("refreshBodySchema"),
      response: { 200: authRef("refreshResponseSchema") },
    },
    handler: refresh,
  });

  fastify.post("/logout", {
    schema: {
      response: { 200: authRef("logoutResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: logout,
  });

  fastify.post("/change-password", {
    config: {
      rateLimit: { max: 10, timeWindow: "15 minutes" },
    },
    schema: {
      body: authRef("changePasswordBodySchema"),
      response: { 200: authRef("changePasswordResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: changePassword,
  });
}
