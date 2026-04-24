import type { FastifyInstance } from "fastify";
import { authRef } from "./auth.schema.js";
import { register, login, refresh, logout, changePassword, forgotPassword, resetPassword, validateResetToken } from "./auth.controller.js";

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

  fastify.post("/forgot-password", {
    config: {
      rateLimit: { max: 5, timeWindow: "15 minutes" },
    },
    schema: {
      body: authRef("forgotPasswordBodySchema"),
      response: { 200: authRef("forgotPasswordResponseSchema") },
    },
    handler: forgotPassword,
  });

  fastify.get("/validate-reset-token", {
    config: {
      rateLimit: { max: 30, timeWindow: "15 minutes" },
    },
    schema: {
      querystring: authRef("validateResetTokenQuerySchema"),
      response: { 200: authRef("validateResetTokenResponseSchema") },
    },
    handler: validateResetToken,
  });

  fastify.post("/reset-password", {
    config: {
      rateLimit: { max: 10, timeWindow: "15 minutes" },
    },
    schema: {
      body: authRef("resetPasswordBodySchema"),
      response: { 200: authRef("resetPasswordResponseSchema") },
    },
    handler: resetPassword,
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
