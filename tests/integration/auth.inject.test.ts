import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

const emailMocks = {
  sendParentWelcomeEmail: jest.fn().mockResolvedValue({}),
  sendStudentWelcomeEmail: jest.fn().mockResolvedValue({}),
};

jest.unstable_mockModule("../../src/lib/email.js", () => emailMocks);

const describeIfIntegration =
  process.env["RUN_INTEGRATION_TESTS"] === "true" ? describe : describe.skip;

describeIfIntegration("auth routes via app.inject", () => {
  let app: FastifyInstance;

  const suffix = Date.now();
  const parentEmail = `parent.${suffix}@example.com`;
  const studentEmail = `student.${suffix}@example.com`;
  const secondStudentEmail = `student2.${suffix}@example.com`;
  const emails = [parentEmail, studentEmail, secondStudentEmail];

  async function cleanup() {
    await app.prisma.refreshToken.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    const users = await app.prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, role: true },
    });
    await app.prisma.parentStudentRelation.deleteMany({
      where: {
        OR: [
          { parentId: { in: users.map((user) => user.id) } },
          { studentId: { in: users.map((user) => user.id) } },
        ],
      },
    });
    await app.prisma.user.deleteMany({ where: { email: { in: emails } } });
  }

  beforeAll(async () => {
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it("registers parent/students and emails generated credentials", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        parent: {
          fullName: "Jane Doe",
          email: ` ${parentEmail.toUpperCase()} `,
          phoneNumber: "+61412345678",
          address: "123 Main Street",
        },
        students: [
          {
            fullName: "Alex Doe",
            email: studentEmail,
            gender: "MALE",
            yearLevel: "Year 7",
            schoolName: "Melbourne High School",
          },
          {
            fullName: "Sam Doe",
            email: secondStudentEmail,
            gender: "FEMALE",
            yearLevel: "Year 5",
            schoolName: "Melbourne Girls School",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        parent: { email: parentEmail },
        students: [{ email: studentEmail }, { email: secondStudentEmail }],
      },
    });
    expect(emailMocks.sendParentWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: parentEmail, password: expect.any(String) })
    );
    expect(emailMocks.sendStudentWelcomeEmail).toHaveBeenCalledTimes(2);
  });

  it("enforces single-device sessions, refresh reuse rejection, logout, and /users/me auth", async () => {
    const parentPassword =
      emailMocks.sendParentWelcomeEmail.mock.calls[0]?.[0].password;
    expect(parentPassword).toEqual(expect.any(String));

    const firstLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: parentEmail, password: parentPassword },
    });
    const firstBody = firstLogin.json();
    expect(firstLogin.statusCode).toBe(200);

    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: parentEmail, password: parentPassword },
    });
    const secondBody = secondLogin.json();
    expect(secondLogin.statusCode).toBe(200);

    const oldSessionProfile = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${firstBody.data.accessToken}` },
    });
    expect(oldSessionProfile.statusCode).toBe(401);

    const activeProfile = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${secondBody.data.accessToken}` },
    });
    expect(activeProfile.statusCode).toBe(200);

    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: secondBody.data.refreshToken },
    });
    const refreshBody = refresh.json();
    expect(refresh.statusCode).toBe(200);

    const reusedRefresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: secondBody.data.refreshToken },
    });
    expect(reusedRefresh.statusCode).toBe(401);

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${refreshBody.data.accessToken}` },
    });
    expect(logout.statusCode).toBe(200);

    const loggedOutProfile = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${refreshBody.data.accessToken}` },
    });
    expect(loggedOutProfile.statusCode).toBe(401);
  });
});
