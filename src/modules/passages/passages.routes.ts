import type { FastifyInstance } from "fastify";
import { passageRef } from "./passages.schema.js";
import {
  createPassageHandler,
  listPassagesHandler,
  getPassageByIdHandler,
  updatePassageHandler,
  deletePassageHandler,
  importPassagesHandler,
} from "./passages.controller.js";

export async function passageRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.post(
    "/import",
    {
      schema: {
        tags: ["Passages"],
        summary: "Bulk import passages from CSV",
        consumes: ["multipart/form-data"],
        response: { 200: passageRef("importPassagesResponseSchema") },
      },
    },
    importPassagesHandler,
  );

  app.get(
    "/",
    {
      schema: {
        tags: ["Passages"],
        querystring: passageRef("listPassagesQuerySchema"),
        response: { 200: passageRef("paginatedPassagesResponseSchema") },
      },
    },
    listPassagesHandler,
  );

  app.post(
    "/",
    {
      schema: {
        tags: ["Passages"],
        body: passageRef("createPassageBodySchema"),
        response: { 201: passageRef("singlePassageResponseSchema") },
      },
    },
    createPassageHandler,
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["Passages"],
        params: passageRef("passageIdParamSchema"),
        response: { 200: passageRef("singlePassageResponseSchema") },
      },
    },
    getPassageByIdHandler,
  );

  app.patch(
    "/:id",
    {
      schema: {
        tags: ["Passages"],
        params: passageRef("passageIdParamSchema"),
        body: passageRef("updatePassageBodySchema"),
        response: { 200: passageRef("singlePassageResponseSchema") },
      },
    },
    updatePassageHandler,
  );

  app.delete(
    "/:id",
    {
      schema: {
        tags: ["Passages"],
        params: passageRef("passageIdParamSchema"),
        response: { 200: passageRef("deletePassageResponseSchema") },
      },
    },
    deletePassageHandler,
  );
}
