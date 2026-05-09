import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import {
  activateCountdown,
  createCountdown,
  deleteCountdown,
  getActiveCountdown,
  listCountdowns,
  updateCountdown,
} from "../../src/modules/countdowns/countdowns.service.js";
import * as countdownsController from "../../src/modules/countdowns/countdowns.controller.js";

const now = new Date("2026-05-08T00:00:00.000Z");
const future = new Date("2026-05-09T00:00:00.000Z");
const past = new Date("2026-05-07T00:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "countdown-1",
    title: "Selective Entry Exam",
    target_at: future,
    is_active: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function serialized(overrides: Record<string, unknown> = {}) {
  return {
    id: "countdown-1",
    title: "Selective Entry Exam",
    targetAt: future.toISOString(),
    isActive: false,
    isExpired: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function mockPrisma() {
  return {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (operations: unknown[]) => operations),
  };
}

function mockReply() {
  const reply = {
    status: jest.fn<(code: number) => typeof reply>(),
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.status.mockReturnValue(reply);
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

function mockRequest(prisma = mockPrisma(), overrides: Record<string, unknown> = {}) {
  return {
    query: { page: 1, limit: 20 },
    params: { id: "countdown-1" },
    body: { title: "Selective Entry Exam", targetAt: future.toISOString() },
    server: { prisma },
    ...overrides,
  };
}

describe("countdowns module", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("lists countdowns with pagination metadata", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([row()] as never)
      .mockResolvedValueOnce([{ total: 1n }] as never);

    const result = await listCountdowns(prisma as never, { page: 2, limit: 10 });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      data: [serialized()],
      meta: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it("keeps total pages at least one for empty countdown lists", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ total: 0 }] as never);

    const result = await listCountdowns(prisma as never, { page: 1, limit: 20 });

    expect(result.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
  });

  it("creates a countdown and trims the title", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([row({ title: "Trimmed title" })] as never);

    const result = await createCountdown(prisma as never, {
      title: "  Trimmed title  ",
      targetAt: future.toISOString(),
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual(serialized({ title: "Trimmed title" }));
  });

  it("rejects invalid create target dates", async () => {
    await expect(
      createCountdown(mockPrisma() as never, {
        title: "Invalid",
        targetAt: "not-a-date",
      })
    ).rejects.toMatchObject({ statusCode: 400, message: "Invalid target date" });
  });

  it("throws 500 when create returns no row", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    await expect(
      createCountdown(prisma as never, { title: "Missing row", targetAt: future.toISOString() })
    ).rejects.toMatchObject({ statusCode: 500, message: "Failed to create countdown" });
  });

  it("updates an existing countdown with provided fields", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([row()] as never)
      .mockResolvedValueOnce([row({ title: "Updated", target_at: future })] as never);

    const result = await updateCountdown(prisma as never, "countdown-1", {
      title: "  Updated  ",
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(result).toEqual(serialized({ title: "Updated" }));
  });

  it("throws 404 when updating a missing countdown", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    await expect(
      updateCountdown(prisma as never, "missing", { title: "Updated" })
    ).rejects.toMatchObject({ statusCode: 404, message: "Countdown not found" });
  });

  it("rejects invalid update target dates", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([row()] as never);

    await expect(
      updateCountdown(prisma as never, "countdown-1", { targetAt: "not-a-date" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Invalid target date" });
  });

  it("throws 500 when update returns no row", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([row()] as never).mockResolvedValueOnce([] as never);

    await expect(
      updateCountdown(prisma as never, "countdown-1", { title: "Updated" })
    ).rejects.toMatchObject({ statusCode: 500, message: "Failed to update countdown" });
  });

  it("activates a future countdown and deactivates others", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([row()] as never)
      .mockResolvedValueOnce([row({ is_active: true })] as never);

    const result = await activateCountdown(prisma as never, "countdown-1");

    expect(prisma.$transaction).toHaveBeenCalledWith([expect.any(Promise), expect.any(Promise)]);
    expect(result).toEqual(serialized({ isActive: true }));
  });

  it("rejects activation for missing or expired countdowns", async () => {
    const missingPrisma = mockPrisma();
    missingPrisma.$queryRaw.mockResolvedValueOnce([] as never);

    await expect(activateCountdown(missingPrisma as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Countdown not found",
    });

    const expiredPrisma = mockPrisma();
    expiredPrisma.$queryRaw.mockResolvedValueOnce([row({ target_at: past })] as never);

    await expect(activateCountdown(expiredPrisma as never, "expired")).rejects.toMatchObject({
      statusCode: 400,
      message: "Expired countdown cannot be activated",
    });
  });

  it("throws 404 if activated countdown disappears after transaction", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([row()] as never).mockResolvedValueOnce([] as never);

    await expect(activateCountdown(prisma as never, "countdown-1")).rejects.toMatchObject({
      statusCode: 404,
      message: "Countdown not found",
    });
  });

  it("deletes an existing countdown and rejects missing countdowns", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([row()] as never);

    await deleteCountdown(prisma as never, "countdown-1");
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

    const missingPrisma = mockPrisma();
    missingPrisma.$queryRaw.mockResolvedValueOnce([] as never);
    await expect(deleteCountdown(missingPrisma as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Countdown not found",
    });
  });

  it("returns the active countdown or null", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([row({ is_active: true })] as never);

    await expect(getActiveCountdown(prisma as never)).resolves.toEqual(
      serialized({ isActive: true })
    );

    const emptyPrisma = mockPrisma();
    emptyPrisma.$queryRaw.mockResolvedValueOnce([] as never);
    await expect(getActiveCountdown(emptyPrisma as never)).resolves.toBeNull();
  });

  it("sends controller responses for list/create/update/activate/delete", async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([row()] as never)
      .mockResolvedValueOnce([{ total: 1 }] as never)
      .mockResolvedValueOnce([row()] as never)
      .mockResolvedValueOnce([row()] as never)
      .mockResolvedValueOnce([row({ title: "Updated" })] as never)
      .mockResolvedValueOnce([row()] as never)
      .mockResolvedValueOnce([row({ is_active: true })] as never)
      .mockResolvedValueOnce([row()] as never);
    const request = mockRequest(prisma);
    const reply = mockReply();

    const listResponse = await countdownsController.listCountdownsHandler(request as never, reply as never);
    const createResponse = await countdownsController.createCountdownHandler(request as never, reply as never);
    const updateResponse = await countdownsController.updateCountdownHandler(
      { ...request, body: { title: "Updated" } } as never,
      reply as never
    );
    const activateResponse = await countdownsController.activateCountdownHandler(request as never, reply as never);
    const deleteResponse = await countdownsController.deleteCountdownHandler(request as never, reply as never);

    expect(listResponse).toMatchObject({ success: true, message: "Countdowns retrieved successfully" });
    expect(createResponse).toMatchObject({ success: true, message: "Countdown created successfully" });
    expect(updateResponse).toMatchObject({ success: true, message: "Countdown updated successfully" });
    expect(activateResponse).toMatchObject({ success: true, message: "Countdown activated successfully" });
    expect(deleteResponse).toEqual({ success: true, message: "Countdown deleted successfully" });
  });

  it("sends active countdown controller response for present and empty states", async () => {
    const activePrisma = mockPrisma();
    activePrisma.$queryRaw.mockResolvedValueOnce([row({ is_active: true })] as never);

    const activeResponse = await countdownsController.getActiveCountdownHandler(
      mockRequest(activePrisma) as never,
      mockReply() as never
    );

    expect(activeResponse).toMatchObject({
      success: true,
      message: "Active countdown retrieved successfully",
      data: expect.objectContaining({ id: "countdown-1" }),
    });

    const emptyPrisma = mockPrisma();
    emptyPrisma.$queryRaw.mockResolvedValueOnce([] as never);

    const emptyResponse = await countdownsController.getActiveCountdownHandler(
      mockRequest(emptyPrisma) as never,
      mockReply() as never
    );

    expect(emptyResponse).toEqual({
      success: true,
      message: "No active countdown available",
      data: null,
    });
  });
});
