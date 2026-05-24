import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { aiRubricRef } from "./ai-rubrics.schema.js";
import {
  createAiRubricHandler,
  deactivateAiRubricHandler,
  getAiRubricHandler,
  importAiRubricsHandler,
  listAiRubricsHandler,
  updateAiRubricHandler,
  createCriterionHandler,
  updateCriterionHandler,
  deleteCriterionHandler,
  importCriteriaCsvHandler,
  createBandHandler,
  updateBandHandler,
  deleteBandHandler,
  importBandsCsvHandler,
  createCalibrationNoteHandler,
  updateCalibrationNoteHandler,
  deleteCalibrationNoteHandler,
  importCalibrationNotesCsvHandler,
} from "./ai-rubrics.controller.js";

export async function aiRubricRoutes(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      tags: ["AI Rubrics"],
      querystring: aiRubricRef("listAiRubricsQuerySchema"),
      response: { 200: aiRubricRef("paginatedAiRubricsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: listAiRubricsHandler,
  });

  fastify.post("/import", {
    schema: {
      tags: ["AI Rubrics"],
      summary: "Import aiRubrics from a CSV file",
      consumes: ["multipart/form-data"],
      response: { 200: aiRubricRef("importAiRubricsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: importAiRubricsHandler,
  });

  fastify.post("/", {
    schema: {
      tags: ["AI Rubrics"],
      body: aiRubricRef("createAiRubricBodySchema"),
      response: { 201: aiRubricRef("singleAiRubricResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: createAiRubricHandler,
  });

  fastify.get("/:id", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("aiRubricIdParamSchema"),
      response: { 200: aiRubricRef("singleAiRubricResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: getAiRubricHandler,
  });

  fastify.patch("/:id", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("aiRubricIdParamSchema"),
      body: aiRubricRef("updateAiRubricBodySchema"),
      response: { 200: aiRubricRef("singleAiRubricResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: updateAiRubricHandler,
  });

  fastify.delete("/:id", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("aiRubricIdParamSchema"),
      response: { 200: aiRubricRef("actionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: deactivateAiRubricHandler,
  });

  // ── Criteria (per-rubric CRUD + CSV import) ─────────────────────────────

  fastify.post("/:rubricId/criteria", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("rubricIdOnlyParamsSchema"),
      body: aiRubricRef("aiRubricCriterionInputSchema"),
      response: { 201: aiRubricRef("singleCriterionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: createCriterionHandler,
  });

  fastify.patch("/:rubricId/criteria/:childId", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("rubricChildParamsSchema"),
      body: aiRubricRef("updateCriterionInputSchema"),
      response: { 200: aiRubricRef("singleCriterionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: updateCriterionHandler,
  });

  fastify.delete("/:rubricId/criteria/:childId", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("rubricChildParamsSchema"),
      response: { 200: aiRubricRef("actionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: deleteCriterionHandler,
  });

  fastify.post("/import/criteria", {
    schema: {
      tags: ["AI Rubrics"],
      summary: "Import criteria CSV (multi-rubric via RubricID column)",
      consumes: ["multipart/form-data"],
      response: { 200: aiRubricRef("importAiRubricsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: importCriteriaCsvHandler,
  });

  // ── Band Descriptors ────────────────────────────────────────────────────

  fastify.post("/:rubricId/bands", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("rubricIdOnlyParamsSchema"),
      body: aiRubricRef("aiRubricBandDescriptorInputSchema"),
      response: { 201: aiRubricRef("singleBandResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: createBandHandler,
  });

  fastify.patch("/:rubricId/bands/:childId", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("rubricChildParamsSchema"),
      body: aiRubricRef("updateBandInputSchema"),
      response: { 200: aiRubricRef("singleBandResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: updateBandHandler,
  });

  fastify.delete("/:rubricId/bands/:childId", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("rubricChildParamsSchema"),
      response: { 200: aiRubricRef("actionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: deleteBandHandler,
  });

  fastify.post("/import/bands", {
    schema: {
      tags: ["AI Rubrics"],
      summary: "Import band descriptors CSV (multi-rubric via RubricID column)",
      consumes: ["multipart/form-data"],
      response: { 200: aiRubricRef("importAiRubricsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: importBandsCsvHandler,
  });

  // ── Calibration Notes ───────────────────────────────────────────────────

  fastify.post("/:rubricId/calibration-notes", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("rubricIdOnlyParamsSchema"),
      body: aiRubricRef("aiCalibrationNoteInputSchema"),
      response: { 201: aiRubricRef("singleCalibrationNoteResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: createCalibrationNoteHandler,
  });

  fastify.patch("/:rubricId/calibration-notes/:childId", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("rubricChildParamsSchema"),
      body: aiRubricRef("updateCalibrationNoteInputSchema"),
      response: { 200: aiRubricRef("singleCalibrationNoteResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: updateCalibrationNoteHandler,
  });

  fastify.delete("/:rubricId/calibration-notes/:childId", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("rubricChildParamsSchema"),
      response: { 200: aiRubricRef("actionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: deleteCalibrationNoteHandler,
  });

  fastify.post("/import/calibration-notes", {
    schema: {
      tags: ["AI Rubrics"],
      summary: "Import calibration notes CSV (multi-rubric via RubricID column)",
      consumes: ["multipart/form-data"],
      response: { 200: aiRubricRef("importAiRubricsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: importCalibrationNotesCsvHandler,
  });
}
