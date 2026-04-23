import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const authServiceMocks = {
  registerParentWithStudents: jest.fn(),
  loginUser: jest.fn(),
  findUserById: jest.fn(),
  invalidatePreviousSessions: jest.fn(),
  createRefreshToken: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeSession: jest.fn(),
  changeUserPassword: jest.fn(),
};

const emailMocks = {
  sendParentWelcomeEmail: jest.fn(),
  sendStudentWelcomeEmail: jest.fn(),
};

const healthServiceMocks = {
  checkDbConnection: jest.fn(),
};

const usersServiceMocks = {
  getMyProfile: jest.fn(),
};

jest.unstable_mockModule("../../src/modules/auth/auth.service.js", () => authServiceMocks);
jest.unstable_mockModule("../../src/lib/email.js", () => emailMocks);
jest.unstable_mockModule("../../src/modules/health/health.service.js", () => healthServiceMocks);
jest.unstable_mockModule("../../src/modules/users/users.service.js", () => usersServiceMocks);

const authController = await import("../../src/modules/auth/auth.controller.js");
const healthController = await import("../../src/modules/health/health.controller.js");
const usersController = await import("../../src/modules/users/users.controller.js");

function mockReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    jwtSign: jest.fn().mockResolvedValue("signed-token" as never),
  };
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    body: {},
    user: { sub: "user-1", jti: "jti-1" },
    server: { prisma: {} },
    log: { info: jest.fn(), error: jest.fn() },
    ...overrides,
  };
}

describe("controllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("registers parent and students, logs failed emails, and redacts passwords from response", async () => {
    authServiceMocks.registerParentWithStudents.mockResolvedValue({
      parent: {
        id: "parent-1",
        email: "parent@example.com",
        fullName: "Jane Doe",
        password: "ParentPass1!",
      },
      students: [
        {
          id: "student-1",
          email: "student@example.com",
          fullName: "Alex Doe",
          password: "StudentPass1!",
        },
      ],
    } as never);
    emailMocks.sendParentWelcomeEmail.mockResolvedValue({} as never);
    emailMocks.sendStudentWelcomeEmail.mockRejectedValue(new Error("Email failed") as never);

    const request = mockRequest({ body: { parent: {}, students: [] } });
    const reply = mockReply();

    await authController.register(request as never, reply as never);

    expect(authServiceMocks.registerParentWithStudents).toHaveBeenCalledWith(
      request.server.prisma,
      request.body
    );
    expect(emailMocks.sendParentWelcomeEmail).toHaveBeenCalledWith({
      to: "parent@example.com",
      fullName: "Jane Doe",
      password: "ParentPass1!",
      studentNames: ["Alex Doe"],
    });
    expect(emailMocks.sendStudentWelcomeEmail).toHaveBeenCalledWith({
      to: "student@example.com",
      fullName: "Alex Doe",
      password: "StudentPass1!",
      parentName: "Jane Doe",
    });
    expect(request.log.error).toHaveBeenCalledWith(
      { error: expect.any(Error), target: "student@example.com" },
      "Failed to send welcome email"
    );
    expect(reply.status).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Registration successful. Login credentials have been emailed to all accounts.",
      data: {
        parent: { id: "parent-1", email: "parent@example.com", fullName: "Jane Doe" },
        students: [{ id: "student-1", email: "student@example.com", fullName: "Alex Doe" }],
      },
    });
  });

  it("logs failed parent welcome emails with parent target", async () => {
    authServiceMocks.registerParentWithStudents.mockResolvedValue({
      parent: {
        id: "parent-1",
        email: "parent@example.com",
        fullName: "Jane Doe",
        password: "ParentPass1!",
      },
      students: [],
    } as never);
    emailMocks.sendParentWelcomeEmail.mockRejectedValue(new Error("Parent email failed") as never);

    const request = mockRequest({ body: { parent: {}, students: [] } });
    const reply = mockReply();

    await authController.register(request as never, reply as never);

    expect(request.log.error).toHaveBeenCalledWith(
      { error: expect.any(Error), target: "parent@example.com" },
      "Failed to send welcome email"
    );
  });

  it("logs in users and issues token pairs", async () => {
    authServiceMocks.loginUser.mockResolvedValue({
      id: "user-1",
      email: "parent@example.com",
      fullName: "Jane Doe",
      role: "PARENT",
      status: "ACTIVE",
    } as never);
    authServiceMocks.invalidatePreviousSessions.mockResolvedValue(undefined as never);
    authServiceMocks.createRefreshToken.mockResolvedValue("refresh-token" as never);

    const request = mockRequest({
      body: { email: " PARENT@Example.com ", password: "Password1!" },
    });
    const reply = mockReply();

    await authController.login(request as never, reply as never);

    expect(request.log.info).toHaveBeenCalledWith(
      { email: "parent@example.com" },
      "Login attempt"
    );
    expect(authServiceMocks.invalidatePreviousSessions).toHaveBeenCalledWith(
      request.server.prisma,
      "user-1"
    );
    expect(reply.jwtSign).toHaveBeenCalledWith({
      sub: "user-1",
      email: "parent@example.com",
      role: "PARENT",
      jti: expect.any(String),
    });
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: "user-1",
          email: "parent@example.com",
          fullName: "Jane Doe",
          role: "PARENT",
          status: "ACTIVE",
        },
        accessToken: "signed-token",
        refreshToken: "refresh-token",
        expiresIn: expect.any(String),
      },
    });
  });

  it("refreshes tokens", async () => {
    authServiceMocks.rotateRefreshToken.mockResolvedValue({
      newRefreshToken: "new-refresh-token",
      userId: "user-1",
    } as never);
    authServiceMocks.findUserById.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "STUDENT",
    } as never);

    const request = mockRequest({ body: { refreshToken: "refresh-token" } });
    const reply = mockReply();

    await authController.refresh(request as never, reply as never);

    expect(authServiceMocks.rotateRefreshToken).toHaveBeenCalledWith(
      request.server.prisma,
      "refresh-token",
      expect.any(String),
      expect.any(String)
    );
    expect(reply.jwtSign).toHaveBeenCalledWith({
      sub: "user-1",
      email: "user@example.com",
      role: "STUDENT",
      jti: expect.any(String),
    });
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Token refreshed successfully",
      data: {
        accessToken: "signed-token",
        refreshToken: "new-refresh-token",
        expiresIn: expect.any(String),
      },
    });
  });

  it("logs out users", async () => {
    authServiceMocks.revokeSession.mockResolvedValue(undefined as never);
    const request = mockRequest();
    const reply = mockReply();

    await authController.logout(request as never, reply as never);

    expect(authServiceMocks.revokeSession).toHaveBeenCalledWith(request.server.prisma, "jti-1");
    expect(request.log.info).toHaveBeenCalledWith({ userId: "user-1" }, "User logged out");
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Logged out successfully",
    });
  });

  it("changes password", async () => {
    authServiceMocks.changeUserPassword.mockResolvedValue(undefined as never);
    const request = mockRequest({
      body: { oldPassword: "OldPassword1!", newPassword: "NewPassword1!" },
    });
    const reply = mockReply();

    await authController.changePassword(request as never, reply as never);

    expect(authServiceMocks.changeUserPassword).toHaveBeenCalledWith(
      request.server.prisma,
      "user-1",
      request.body,
      "jti-1"
    );
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Password changed successfully. Other active sessions have been logged out.",
    });
  });

  it("returns health check data", async () => {
    healthServiceMocks.checkDbConnection.mockResolvedValue("connected" as never);
    const request = mockRequest();
    const reply = mockReply();

    await healthController.healthCheck(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Aspire API is running",
      data: {
        status: "ok",
        db: "connected",
        uptime: expect.any(Number),
        timestamp: expect.any(String),
        environment: expect.any(String),
      },
    });
  });

  it("returns development as health environment fallback", async () => {
    const originalNodeEnv = process.env["NODE_ENV"];
    delete process.env["NODE_ENV"];
    healthServiceMocks.checkDbConnection.mockResolvedValue("connected" as never);
    const request = mockRequest();
    const reply = mockReply();

    try {
      await healthController.healthCheck(request as never, reply as never);
    } finally {
      process.env["NODE_ENV"] = originalNodeEnv;
    }

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ environment: "development" }),
      })
    );
  });

  it("returns authenticated profile data", async () => {
    const profile = {
      id: "user-1",
      email: "user@example.com",
      fullName: "Jane Doe",
      role: "PARENT",
      status: "ACTIVE",
    };
    usersServiceMocks.getMyProfile.mockResolvedValue(profile as never);
    const request = mockRequest();
    const reply = mockReply();

    await usersController.getMe(request as never, reply as never);

    expect(usersServiceMocks.getMyProfile).toHaveBeenCalledWith(request.server.prisma, "user-1");
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Profile retrieved successfully",
      data: profile,
    });
  });
});
