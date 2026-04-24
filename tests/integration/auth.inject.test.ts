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

    // First login — returns httpOnly cookies, no tokens in body
    const firstLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: parentEmail, password: parentPassword },
    });
    expect(firstLogin.statusCode).toBe(200);

    const firstBody = firstLogin.json();
    expect(firstBody.data).not.toHaveProperty("accessToken");
    expect(firstBody.data).not.toHaveProperty("refreshToken");

    const firstAccessCookie = firstLogin.cookies.find((c) => c.name === "access_token");
    const firstRefreshCookie = firstLogin.cookies.find((c) => c.name === "refresh_token");
    expect(firstAccessCookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(firstRefreshCookie).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
      path: "/api/v1/auth/refresh",
    });

    // Second login — invalidates first session
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: parentEmail, password: parentPassword },
    });
    expect(secondLogin.statusCode).toBe(200);

    const secondAccessCookie = secondLogin.cookies.find((c) => c.name === "access_token");
    const secondRefreshCookie = secondLogin.cookies.find((c) => c.name === "refresh_token");
    expect(secondAccessCookie).toBeDefined();
    expect(secondRefreshCookie).toBeDefined();

    // Old session cookie should now be rejected (DB session revoked)
    const oldSessionProfile = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      cookies: { access_token: firstAccessCookie!.value },
    });
    expect(oldSessionProfile.statusCode).toBe(401);

    // New session cookie should work
    const activeProfile = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      cookies: { access_token: secondAccessCookie!.value },
    });
    expect(activeProfile.statusCode).toBe(200);

    // Refresh using refresh_token cookie
    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { refresh_token: secondRefreshCookie!.value },
    });
    expect(refreshResponse.statusCode).toBe(200);

    const refreshBody = refreshResponse.json();
    expect(refreshBody.data).not.toHaveProperty("accessToken");
    expect(refreshBody.data).not.toHaveProperty("refreshToken");

    const newAccessCookie = refreshResponse.cookies.find((c) => c.name === "access_token");
    const newRefreshCookie = refreshResponse.cookies.find((c) => c.name === "refresh_token");
    expect(newAccessCookie).toBeDefined();
    expect(newRefreshCookie).toBeDefined();

    // Reuse of old refresh token must be rejected
    const reusedRefresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { refresh_token: secondRefreshCookie!.value },
    });
    expect(reusedRefresh.statusCode).toBe(401);

    // Logout using new access token cookie
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: { access_token: newAccessCookie!.value },
    });
    expect(logout.statusCode).toBe(200);

    // Verify both cookies are cleared in the logout response
    const clearedAccessCookie = logout.cookies.find((c) => c.name === "access_token");
    const clearedRefreshCookie = logout.cookies.find((c) => c.name === "refresh_token");
    expect(clearedAccessCookie?.value).toBe("");
    expect(clearedRefreshCookie?.value).toBe("");

    // After logout, the access token is revoked in DB — should return 401
    const loggedOutProfile = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      cookies: { access_token: newAccessCookie!.value },
    });
    expect(loggedOutProfile.statusCode).toBe(401);
  });
});
