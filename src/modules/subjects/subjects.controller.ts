import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  SubjectParams,
  CreateSubjectInput,
  UpdateSubjectInput,
  ListSubjectsQuery,
  TopicParams,
  CreateTopicInput,
  UpdateTopicInput,
  ListTopicsQuery,
} from "./subjects.schema.js";
import {
  listSubjects as listSubjectsService,
  getSubjectById,
  createSubject as createSubjectService,
  updateSubject as updateSubjectService,
  deleteSubject as deleteSubjectService,
  listTopics as listTopicsService,
  getTopicById,
  createTopic as createTopicService,
  updateTopic as updateTopicService,
  deleteTopic as deleteTopicService,
} from "./subjects.service.js";

// ── Subject handlers ────────────────────────────────────────

export async function listSubjects(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as ListSubjectsQuery;
  const result = await listSubjectsService(request.server.prisma, query);

  return reply.send({
    success: true,
    message: "Subjects retrieved successfully",
    ...result,
  });
}

export async function getSubject(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { subjectId } = request.params as SubjectParams;
  const subject = await getSubjectById(request.server.prisma, subjectId);

  return reply.send({
    success: true,
    message: "Subject retrieved successfully",
    data: subject,
  });
}

export async function createSubject(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as CreateSubjectInput;
  const subject = await createSubjectService(request.server.prisma, body);

  request.log.info(
    { subjectId: subject.id, createdBy: request.user.sub },
    "Subject created"
  );

  return reply.status(201).send({
    success: true,
    message: "Subject created successfully",
    data: subject,
  });
}

export async function updateSubject(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { subjectId } = request.params as SubjectParams;
  const body = request.body as UpdateSubjectInput;
  const subject = await updateSubjectService(
    request.server.prisma,
    subjectId,
    body
  );

  request.log.info(
    { subjectId, updatedBy: request.user.sub },
    "Subject updated"
  );

  return reply.send({
    success: true,
    message: "Subject updated successfully",
    data: subject,
  });
}

export async function deleteSubject(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { subjectId } = request.params as SubjectParams;
  await deleteSubjectService(request.server.prisma, subjectId);

  request.log.info(
    { subjectId, deletedBy: request.user.sub },
    "Subject deleted"
  );

  return reply.send({
    success: true,
    message: "Subject deleted successfully",
  });
}

// ── Topic handlers ──────────────────────────────────────────

export async function listTopics(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { subjectId } = request.params as SubjectParams;
  const query = request.query as ListTopicsQuery;
  const result = await listTopicsService(
    request.server.prisma,
    subjectId,
    query
  );

  return reply.send({
    success: true,
    message: "Topics retrieved successfully",
    ...result,
  });
}

export async function getTopic(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { subjectId, topicId } = request.params as TopicParams;
  const topic = await getTopicById(request.server.prisma, subjectId, topicId);

  return reply.send({
    success: true,
    message: "Topic retrieved successfully",
    data: topic,
  });
}

export async function createTopic(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { subjectId } = request.params as SubjectParams;
  const body = request.body as CreateTopicInput;
  const topic = await createTopicService(
    request.server.prisma,
    subjectId,
    body
  );

  request.log.info(
    { topicId: topic.id, subjectId, createdBy: request.user.sub },
    "Topic created"
  );

  return reply.status(201).send({
    success: true,
    message: "Topic created successfully",
    data: topic,
  });
}

export async function updateTopic(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { subjectId, topicId } = request.params as TopicParams;
  const body = request.body as UpdateTopicInput;
  const topic = await updateTopicService(
    request.server.prisma,
    subjectId,
    topicId,
    body
  );

  request.log.info(
    { topicId, subjectId, updatedBy: request.user.sub },
    "Topic updated"
  );

  return reply.send({
    success: true,
    message: "Topic updated successfully",
    data: topic,
  });
}

export async function deleteTopic(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { subjectId, topicId } = request.params as TopicParams;
  await deleteTopicService(request.server.prisma, subjectId, topicId);

  request.log.info(
    { topicId, subjectId, deletedBy: request.user.sub },
    "Topic deleted"
  );

  return reply.send({
    success: true,
    message: "Topic deleted successfully",
  });
}
