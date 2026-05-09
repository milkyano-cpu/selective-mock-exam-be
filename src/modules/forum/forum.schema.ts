import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Shared enums ──────────────────────────────────────────────────────────────

const forumSegmentEnum = z.enum(["STUDENT", "PARENT"]);
const forumStatusEnum = z.enum(["ACTIVE", "FLAGGED", "UNDER_REVIEW", "REJECTED"]);
const flagReasonEnum = z.enum(["INAPPROPRIATE", "SPAM", "OFF_TOPIC", "MISINFORMATION", "OTHER"]);
const flagStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED"]);
const warningLevelEnum = z.enum(["WARNING", "SUSPEND"]);

// ── Request schemas ───────────────────────────────────────────────────────────

export const createThreadBodySchema = z.object({
  title: z.string().trim().min(5).max(200),
  content: z.string().trim().min(10).max(5000),
  isAnonymous: z.boolean().default(false),
});

export const createPostBodySchema = z.object({
  content: z.string().trim().min(1).max(5000),
  isAnonymous: z.boolean().default(false),
});

export const flagPostBodySchema = z.object({
  reason: flagReasonEnum,
  note: z.string().trim().max(500).optional(),
});

export const listThreadsQuerySchema = z.object({
  segment: forumSegmentEnum,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: forumStatusEnum.optional(),
});

export const createThreadQuerySchema = z.object({
  segment: forumSegmentEnum,
});

export const listPostsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const adminListFlagsQuerySchema = z.object({
  status: flagStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const adminReviewFlagBodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
});

export const adminWarnUserBodySchema = z.object({
  level: warningLevelEnum,
  reason: z.string().trim().min(5).max(500),
});

export const adminListWarningsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const adminPinThreadBodySchema = z.object({
  isPinned: z.boolean(),
});

export const adminLockThreadBodySchema = z.object({
  isLocked: z.boolean(),
});

export const adminBannedWordBodySchema = z.object({
  word: z.string().trim().min(2).max(100).toLowerCase(),
});

export const forumThreadParamSchema = z.object({
  id: z.string().uuid(),
});

export const forumPostParamSchema = z.object({
  postId: z.string().uuid(),
});

export const forumFlagParamSchema = z.object({
  flagId: z.string().uuid(),
});

export const forumUserParamSchema = z.object({
  userId: z.string().uuid(),
});

export const forumBannedWordParamSchema = z.object({
  wordId: z.string().uuid(),
});

// ── Response schemas ──────────────────────────────────────────────────────────

const authorSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
});

const forumPostSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  author: authorSchema.nullable(), // null when anonymous
  isAnonymous: z.boolean(),
  content: z.string(),
  status: forumStatusEnum,
  flagCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const forumThreadSummarySchema = z.object({
  id: z.string(),
  segment: forumSegmentEnum,
  title: z.string(),
  author: authorSchema.nullable(),
  isAnonymous: z.boolean(),
  isPinned: z.boolean(),
  isLocked: z.boolean(),
  postCount: z.number(),
  lastPostAt: z.string().nullable(),
  status: forumStatusEnum,
  createdAt: z.string(),
});

const forumThreadDetailSchema = forumThreadSummarySchema.extend({
  posts: z.array(forumPostSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const forumFlagSchema = z.object({
  id: z.string(),
  postId: z.string(),
  postContent: z.string(),
  reporter: authorSchema,
  reason: flagReasonEnum,
  note: z.string().nullable(),
  status: flagStatusEnum,
  createdAt: z.string(),
});

const forumWarningSchema = z.object({
  id: z.string(),
  user: authorSchema,
  admin: authorSchema,
  level: warningLevelEnum,
  reason: z.string(),
  createdAt: z.string(),
});

const forumBannedWordSchema = z.object({
  id: z.string(),
  word: z.string(),
  createdAt: z.string(),
});

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateThreadBody = z.infer<typeof createThreadBodySchema>;
export type CreatePostBody = z.infer<typeof createPostBodySchema>;
export type FlagPostBody = z.infer<typeof flagPostBodySchema>;
export type ListThreadsQuery = z.infer<typeof listThreadsQuerySchema>;
export type CreateThreadQuery = z.infer<typeof createThreadQuerySchema>;
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;
export type AdminListFlagsQuery = z.infer<typeof adminListFlagsQuerySchema>;
export type AdminReviewFlagBody = z.infer<typeof adminReviewFlagBodySchema>;
export type AdminWarnUserBody = z.infer<typeof adminWarnUserBodySchema>;
export type AdminListWarningsQuery = z.infer<typeof adminListWarningsQuerySchema>;
export type AdminPinThreadBody = z.infer<typeof adminPinThreadBodySchema>;
export type AdminLockThreadBody = z.infer<typeof adminLockThreadBodySchema>;
export type AdminBannedWordBody = z.infer<typeof adminBannedWordBodySchema>;

// ── buildJsonSchemas ──────────────────────────────────────────────────────────

export const { schemas: forumSchemas, $ref: forumRef } = buildJsonSchemas(
  {
    createThreadBodySchema,
    createPostBodySchema,
    flagPostBodySchema,
    listThreadsQuerySchema,
    createThreadQuerySchema,
    listPostsQuerySchema,
    adminListFlagsQuerySchema,
    adminReviewFlagBodySchema,
    adminWarnUserBodySchema,
    adminListWarningsQuerySchema,
    adminPinThreadBodySchema,
    adminLockThreadBodySchema,
    adminBannedWordBodySchema,
    forumThreadParamSchema,
    forumPostParamSchema,
    forumFlagParamSchema,
    forumUserParamSchema,
    forumBannedWordParamSchema,
    forumPostSchema,
    forumThreadSummarySchema,
    forumThreadDetailSchema,
    forumFlagSchema,
    forumWarningSchema,
    forumBannedWordSchema,
  }
);
