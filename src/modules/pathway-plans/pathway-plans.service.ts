import type { PrismaClient, Prisma } from "@prisma/client";
import { createHttpError } from "../../utils/http-error.js";
import { assertParentOwnsStudent } from "../../utils/authz.js";
import { isUniqueConstraintError } from "../../utils/prisma-errors.js";
import { decryptField } from "../../utils/field-encryption.js";
import { createNotification } from "../../lib/notify.js";
import { createPathway } from "../pathways/pathways.service.js";
import type {
  ListPlansQuery,
  CreatePlanInput,
  UpdatePlanInput,
  AddPlanPathwayInput,
} from "./pathway-plans.schema.js";

type Actor = { sub: string; role: string };

// ── SELECT shapes ────────────────────────────────────────────────────────────

// Pull each plan with the data needed to compute progress + subjects.
const PLAN_WITH_PROGRESS_SELECT = {
  id: true,
  name: true,
  tutorId: true,
  studentId: true,
  dueDate: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, fullName: true } },
  tutor: { select: { id: true, fullName: true } },
  pathways: {
    select: {
      id: true,
      subjectId: true,
      thresholdCorrect: true,
      studentId: true,
      tutorId: true,
      createdAt: true,
      updatedAt: true,
      subject: { select: { id: true, name: true } },
      nodes: {
        select: {
          id: true,
          progress: {
            select: { studentId: true, completedAt: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

type PlanWithProgress = Prisma.PathwayPlanGetPayload<{
  select: typeof PLAN_WITH_PROGRESS_SELECT;
}>;

// ── Progress computation ─────────────────────────────────────────────────────

/**
 * A node counts as completed when the plan's student has a progress row with a
 * non-null completedAt. Progress rows are per-student, so we filter by the
 * plan's studentId rather than trusting `progress[0]`.
 */
function isNodeCompleted(
  node: PlanWithProgress["pathways"][number]["nodes"][number],
  studentId: string
): boolean {
  return node.progress.some(
    (p) => p.studentId === studentId && p.completedAt !== null
  );
}

function summarisePlan(plan: PlanWithProgress) {
  let totalNodes = 0;
  let completedNodes = 0;

  const pathways = plan.pathways.map((pathway) => {
    const nodeCount = pathway.nodes.length;
    const completedNodeCount = pathway.nodes.filter((node) =>
      isNodeCompleted(node, plan.studentId)
    ).length;

    totalNodes += nodeCount;
    completedNodes += completedNodeCount;

    return {
      id: pathway.id,
      subjectId: pathway.subjectId,
      thresholdCorrect: pathway.thresholdCorrect,
      subject: pathway.subject,
      nodeCount,
      completedNodeCount,
    };
  });

  // A plan with no nodes is not "complete" — there's nothing mastered yet.
  const isComplete = totalNodes > 0 && completedNodes === totalNodes;
  const progressPercent =
    totalNodes === 0 ? 0 : Math.round((completedNodes / totalNodes) * 100);

  const subjects = plan.pathways.map((p) => p.subject);

  return { pathways, subjects, totalNodes, completedNodes, isComplete, progressPercent };
}

function formatPlanBase(plan: PlanWithProgress) {
  const summary = summarisePlan(plan);
  return {
    id: plan.id,
    name: plan.name,
    tutorId: plan.tutorId,
    studentId: plan.studentId,
    // Decrypt names so tutor/parent/student views can show who's involved.
    studentName: plan.student ? decryptField(plan.student.fullName).trim() : null,
    tutorName: plan.tutor ? decryptField(plan.tutor.fullName).trim() : null,
    dueDate: plan.dueDate?.toISOString() ?? null,
    completedAt: plan.completedAt?.toISOString() ?? null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    subjects: summary.subjects,
    totalNodes: summary.totalNodes,
    completedNodes: summary.completedNodes,
    progressPercent: summary.progressPercent,
    isComplete: summary.isComplete,
  };
}

function formatPlanListItem(plan: PlanWithProgress) {
  return formatPlanBase(plan);
}

function formatPlanDetail(plan: PlanWithProgress) {
  const summary = summarisePlan(plan);
  return {
    ...formatPlanBase(plan),
    pathways: summary.pathways,
  };
}

// ── Access control ───────────────────────────────────────────────────────────

async function loadPlanForAccess(prisma: PrismaClient, planId: string) {
  const plan = await prisma.pathwayPlan.findUnique({
    where: { id: planId },
    select: { id: true, tutorId: true, studentId: true },
  });
  if (!plan) throw createHttpError(404, "Pathway plan not found");
  return plan;
}

export async function assertCanAccessPlan(
  prisma: PrismaClient,
  actor: Actor,
  plan: { tutorId: string; studentId: string }
) {
  if (actor.role === "ADMIN") return;
  if (actor.role === "TUTOR" && plan.tutorId === actor.sub) return;
  if (actor.role === "STUDENT" && plan.studentId === actor.sub) return;
  if (actor.role === "PARENT") {
    await assertParentOwnsStudent(prisma, actor.sub, plan.studentId);
    return;
  }
  throw createHttpError(403, "You do not have access to this plan");
}

export async function assertOwnsPlan(
  prisma: PrismaClient,
  actor: Actor,
  planId: string
) {
  const plan = await loadPlanForAccess(prisma, planId);
  if (actor.role !== "ADMIN" && plan.tutorId !== actor.sub) {
    throw createHttpError(403, "You do not own this pathway plan");
  }
  return plan;
}

// ── createPlan ───────────────────────────────────────────────────────────────

export async function createPlan(
  prisma: PrismaClient,
  tutorId: string,
  input: CreatePlanInput
) {
  const student = await prisma.user.findUnique({
    where: { id: input.studentId },
    select: { id: true, role: true },
  });
  if (!student || student.role !== "STUDENT") {
    throw createHttpError(404, "Student not found");
  }

  const created = await prisma.pathwayPlan.create({
    data: {
      name: input.name,
      tutorId,
      studentId: input.studentId,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    },
    select: PLAN_WITH_PROGRESS_SELECT,
  });

  void createNotification(prisma, {
    userId: input.studentId,
    type: "PATHWAY_PLAN_ASSIGNED",
    title: "New Learning Plan Assigned",
    message: `Your tutor has created a new learning plan: ${input.name}`,
    data: { planId: created.id, planName: created.name },
  });

  return formatPlanListItem(created);
}

// ── listPlans ────────────────────────────────────────────────────────────────

export async function listPlans(
  prisma: PrismaClient,
  actor: Actor,
  query: ListPlansQuery
) {
  const where: Prisma.PathwayPlanWhereInput = {};

  if (actor.role === "TUTOR") {
    where.tutorId = actor.sub;
    if (query.studentId) where.studentId = query.studentId;
  } else if (actor.role === "STUDENT") {
    where.studentId = actor.sub;
  } else if (actor.role === "PARENT") {
    // Parent may only see plans for children they are linked to.
    if (query.studentId) {
      await assertParentOwnsStudent(prisma, actor.sub, query.studentId);
      where.studentId = query.studentId;
    } else {
      const relations = await prisma.parentStudentRelation.findMany({
        where: { parentId: actor.sub },
        select: { studentId: true },
      });
      where.studentId = { in: relations.map((r) => r.studentId) };
    }
  } else if (actor.role === "ADMIN") {
    if (query.studentId) where.studentId = query.studentId;
  }

  const skip = (query.page - 1) * query.limit;

  const [plans, total] = await Promise.all([
    prisma.pathwayPlan.findMany({
      where,
      select: PLAN_WITH_PROGRESS_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.limit,
    }),
    prisma.pathwayPlan.count({ where }),
  ]);

  return {
    data: plans.map(formatPlanListItem),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

// ── getPlan ──────────────────────────────────────────────────────────────────

export async function getPlan(prisma: PrismaClient, planId: string) {
  const plan = await prisma.pathwayPlan.findUnique({
    where: { id: planId },
    select: PLAN_WITH_PROGRESS_SELECT,
  });
  if (!plan) throw createHttpError(404, "Pathway plan not found");

  const detail = formatPlanDetail(plan);

  // Auto-complete detection: persist completedAt the first time everything is done.
  if (detail.isComplete && plan.completedAt === null) {
    const now = new Date();
    await prisma.pathwayPlan.update({
      where: { id: planId },
      data: { completedAt: now },
    });
    detail.completedAt = now.toISOString();

    void createNotification(prisma, {
      userId: plan.studentId,
      type: "PATHWAY_PLAN_COMPLETED",
      title: "Plan Complete!",
      message: `You've mastered every topic in "${plan.name}". Outstanding work!`,
      data: { planId: plan.id, planName: plan.name },
    });
  }

  return detail;
}

// ── updatePlan ───────────────────────────────────────────────────────────────

export async function updatePlan(
  prisma: PrismaClient,
  planId: string,
  input: UpdatePlanInput
) {
  const data: Prisma.PathwayPlanUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.dueDate !== undefined) {
    data.dueDate = input.dueDate === null ? null : new Date(input.dueDate);
  }

  await prisma.pathwayPlan.update({
    where: { id: planId },
    data,
  });

  const plan = await prisma.pathwayPlan.findUnique({
    where: { id: planId },
    select: PLAN_WITH_PROGRESS_SELECT,
  });
  if (!plan) throw createHttpError(404, "Pathway plan not found");

  return formatPlanListItem(plan);
}

// ── deletePlan ───────────────────────────────────────────────────────────────

export async function deletePlan(prisma: PrismaClient, planId: string) {
  // Cascade (defined in the schema) removes pathways → nodes → progress/questions.
  await prisma.pathwayPlan.delete({ where: { id: planId } });
}

// ── addPathwayToPlan ─────────────────────────────────────────────────────────

export async function addPathwayToPlan(
  prisma: PrismaClient,
  actor: Actor,
  planId: string,
  input: AddPlanPathwayInput
) {
  // Delegates to the pathways module so node + progress seeding stays in one place.
  try {
    const pathway = await createPathway(prisma, actor, {
      planId,
      subjectId: input.subjectId,
      thresholdCorrect: input.thresholdCorrect,
    });

    return {
      id: pathway.id,
      planId: pathway.planId,
      studentId: pathway.studentId,
      subjectId: pathway.subjectId,
      tutorId: pathway.tutorId,
      thresholdCorrect: pathway.thresholdCorrect,
      nodeCount: pathway.nodeCount,
      subject: pathway.subject,
      createdAt: pathway.createdAt,
      updatedAt: pathway.updatedAt,
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "A pathway for this subject already exists in this plan");
    }
    throw error;
  }
}

// ── removePathwayFromPlan ────────────────────────────────────────────────────

export async function removePathwayFromPlan(
  prisma: PrismaClient,
  planId: string,
  pathwayId: string
) {
  const pathway = await prisma.studentPathway.findFirst({
    where: { id: pathwayId, planId },
    select: { id: true },
  });
  if (!pathway) throw createHttpError(404, "Pathway not found in this plan");

  // Cascade removes nodes → progress/questions.
  await prisma.studentPathway.delete({ where: { id: pathwayId } });
}

// ── notifyOverduePlans ───────────────────────────────────────────────────────

/**
 * Notify students whose learning plan is past its due date but not yet complete.
 *
 * Overdue is a time-based event (no user action triggers it), so this is run by
 * a scheduled job. It is idempotent: a student gets at most one PATHWAY_OVERDUE
 * notification per plan, ever — we skip any plan that already has one. Completed
 * plans never qualify (completedAt must be null). Re-opening a plan keeps the
 * old notification, so a plan won't re-notify unless its previous overdue
 * notification is removed.
 *
 * Returns the number of notifications sent (useful for logging).
 */
export async function notifyOverduePlans(prisma: PrismaClient): Promise<number> {
  const now = new Date();

  const overduePlans = await prisma.pathwayPlan.findMany({
    where: {
      dueDate: { not: null, lt: now },
      completedAt: null,
    },
    select: { id: true, name: true, studentId: true },
  });

  if (overduePlans.length === 0) return 0;

  // One notification per plan, ever: collect the plans we've already flagged.
  const studentIds = Array.from(new Set(overduePlans.map((p) => p.studentId)));
  const existing = await prisma.notification.findMany({
    where: { type: "PATHWAY_OVERDUE", userId: { in: studentIds } },
    select: { data: true },
  });
  const alreadyNotified = new Set(
    existing
      .map((n) => (n.data as { planId?: string } | null)?.planId)
      .filter((id): id is string => Boolean(id))
  );

  let sent = 0;
  for (const plan of overduePlans) {
    if (alreadyNotified.has(plan.id)) continue;

    await createNotification(prisma, {
      userId: plan.studentId,
      type: "PATHWAY_OVERDUE",
      title: "Learning Plan Overdue",
      message: `Your learning plan "${plan.name}" is past its due date. Jump back in to catch up.`,
      data: { planId: plan.id, planName: plan.name },
    });
    sent += 1;
  }

  return sent;
}
