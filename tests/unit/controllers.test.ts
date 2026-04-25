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
  createPasswordResetToken: jest.fn(),
  validatePasswordResetToken: jest.fn(),
  consumePasswordResetToken: jest.fn(),
};

const emailMocks = {
  sendParentWelcomeEmail: jest.fn(),
  sendStudentWelcomeEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendStaffWelcomeEmail: jest.fn(),
};

const healthServiceMocks = {
  checkDbConnection: jest.fn(),
};

const usersServiceMocks = {
  getMyProfile: jest.fn(),
  getMyProfilePhotoAccess: jest.fn(),
  uploadMyProfilePhoto: jest.fn(),
};

const adminServiceMocks = {
  createStaffAccount: jest.fn(),
  listTutors: jest.fn(),
  getTutorById: jest.fn(),
  updateTutor: jest.fn(),
  updateTutorStatus: jest.fn(),
  deleteTutor: jest.fn(),
};

jest.unstable_mockModule("../../src/modules/auth/auth.service.js", () => authServiceMocks);
jest.unstable_mockModule("../../src/lib/email.js", () => emailMocks);
jest.unstable_mockModule("../../src/modules/health/health.service.js", () => healthServiceMocks);
jest.unstable_mockModule("../../src/modules/users/users.service.js", () => usersServiceMocks);
jest.unstable_mockModule("../../src/modules/admin/admin.service.js", () => adminServiceMocks);
jest.unstable_mockModule("../../src/config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    JWT_EXPIRES_IN: "15m",
    REFRESH_TOKEN_EXPIRES_IN: "7d",
    PASSWORD_RESET_EXPIRES_IN: "1h",
    APP_URL: "http://localhost:3000",
    API_PREFIX: "/api/v1",
  },
}));

const authController = await import("../../src/modules/auth/auth.controller.js");
const healthController = await import("../../src/modules/health/health.controller.js");
const usersController = await import("../../src/modules/users/users.controller.js");
const adminController = await import("../../src/modules/admin/admin.controller.js");

function mockReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    jwtSign: jest.fn().mockResolvedValue("signed-token" as never),
    setCookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  };
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    body: {},
    cookies: {} as Record<string, string>,
    user: { sub: "user-1", jti: "jti-1" },
    server: { prisma: {}, storage: {}, redis: {} },
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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

  it("logs in users, sets httpOnly cookies, and omits tokens from body", async () => {
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
    expect(reply.setCookie).toHaveBeenCalledWith(
      "access_token",
      "signed-token",
      expect.objectContaining({ httpOnly: true, path: "/" })
    );
    expect(reply.setCookie).toHaveBeenCalledWith(
      "refresh_token",
      "refresh-token",
      expect.objectContaining({ httpOnly: true, path: "/api/v1/auth/refresh" })
    );
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
        expiresIn: expect.any(String),
      },
    });
  });

  it("refreshes tokens from cookie, rotates both cookies, omits tokens from body", async () => {
    authServiceMocks.rotateRefreshToken.mockResolvedValue({
      newRefreshToken: "new-refresh-token",
      userId: "user-1",
    } as never);
    authServiceMocks.findUserById.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "STUDENT",
    } as never);

    const request = mockRequest({ cookies: { refresh_token: "refresh-token" } });
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
    expect(reply.setCookie).toHaveBeenCalledWith(
      "access_token",
      "signed-token",
      expect.objectContaining({ httpOnly: true, path: "/" })
    );
    expect(reply.setCookie).toHaveBeenCalledWith(
      "refresh_token",
      "new-refresh-token",
      expect.objectContaining({ httpOnly: true, path: "/api/v1/auth/refresh" })
    );
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Token refreshed successfully",
      data: {
        expiresIn: expect.any(String),
      },
    });
  });

  it("throws 401 when refresh token cookie is missing", async () => {
    const request = mockRequest({ cookies: {} });
    const reply = mockReply();

    await expect(
      authController.refresh(request as never, reply as never)
    ).rejects.toMatchObject({ statusCode: 401, message: "Refresh token missing" });

    expect(authServiceMocks.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it("logs out users and clears auth cookies", async () => {
    authServiceMocks.revokeSession.mockResolvedValue(undefined as never);
    const request = mockRequest();
    const reply = mockReply();

    await authController.logout(request as never, reply as never);

    expect(authServiceMocks.revokeSession).toHaveBeenCalledWith(request.server.prisma, "jti-1");
    expect(request.log.info).toHaveBeenCalledWith({ userId: "user-1" }, "User logged out");
    expect(reply.clearCookie).toHaveBeenCalledWith("access_token", { path: "/" });
    expect(reply.clearCookie).toHaveBeenCalledWith("refresh_token", {
      path: "/api/v1/auth/refresh",
    });
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

  it("returns health check data with 200 when DB connected", async () => {
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

  it("returns 503 when DB is disconnected", async () => {
    healthServiceMocks.checkDbConnection.mockResolvedValue("disconnected" as never);
    const request = mockRequest();
    const reply = mockReply();

    await healthController.healthCheck(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: "Service degraded",
      data: {
        status: "degraded",
        db: "disconnected",
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
      hasProfilePhoto: false,
      profilePhotoUpdatedAt: null,
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

  it("returns signed access data for the current profile photo", async () => {
    usersServiceMocks.getMyProfilePhotoAccess.mockResolvedValue({
      signedUrl: "https://signed.example.com/avatar",
      originalName: "avatar.png",
      mimeType: "image/png",
      size: 2048,
      updatedAt: new Date("2026-04-25T00:00:00.000Z"),
      expiresInSeconds: 900,
    } as never);

    const request = mockRequest();
    const reply = mockReply();

    await usersController.getMyProfilePhoto(request as never, reply as never);

    expect(usersServiceMocks.getMyProfilePhotoAccess).toHaveBeenCalledWith(
      request.server.prisma,
      request.server.storage,
      "user-1"
    );
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Profile photo retrieved successfully",
      data: {
        signedUrl: "https://signed.example.com/avatar",
        originalName: "avatar.png",
        mimeType: "image/png",
        size: 2048,
        updatedAt: "2026-04-25T00:00:00.000Z",
        expiresInSeconds: 900,
      },
    });
  });

  it("uploads current user profile photo and warns when previous cleanup fails", async () => {
    usersServiceMocks.uploadMyProfilePhoto.mockResolvedValue({
      signedUrl: "https://signed.example.com/new-avatar",
      originalName: "avatar.webp",
      mimeType: "image/webp",
      size: 4096,
      updatedAt: new Date("2026-04-25T01:00:00.000Z"),
      expiresInSeconds: 900,
      profilePhotoKey: "profile-photos/parent/user-1/avatar.webp",
      previousPhotoCleanupFailed: true,
    } as never);

    const request = mockRequest({
      file: jest.fn().mockResolvedValue({
        filename: "avatar.webp",
        mimetype: "image/webp",
        file: (async function* () {
          yield Buffer.from("avatar-bytes");
        })(),
      } as never),
    });
    const reply = mockReply();

    await usersController.uploadProfilePhoto(request as never, reply as never);

    expect(usersServiceMocks.uploadMyProfilePhoto).toHaveBeenCalledWith(
      request.server.prisma,
      request.server.storage,
      request.server.redis,
      request.log,
      "user-1",
      expect.objectContaining({
        originalName: "avatar.webp",
        mimeType: "image/webp",
        size: expect.any(Number),
        buffer: expect.any(Buffer),
      })
    );
    expect(request.log.warn).toHaveBeenCalledWith(
      {
        userId: "user-1",
        profilePhotoKey: "profile-photos/parent/user-1/avatar.webp",
      },
      "Previous profile photo cleanup failed after replacement"
    );
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Profile photo updated successfully",
      data: {
        signedUrl: "https://signed.example.com/new-avatar",
        originalName: "avatar.webp",
        mimeType: "image/webp",
        size: 4096,
        updatedAt: "2026-04-25T01:00:00.000Z",
        expiresInSeconds: 900,
        previousPhotoCleanupFailed: true,
      },
    });
  });

  it("sends password reset email for existing users and always returns 200", async () => {
    authServiceMocks.createPasswordResetToken.mockResolvedValue({
      token: "reset-token-123",
      fullName: "Jane Doe",
    } as never);
    emailMocks.sendPasswordResetEmail.mockResolvedValue({} as never);

    const request = mockRequest({ body: { email: "jane@example.com" } });
    const reply = mockReply();

    await authController.forgotPassword(request as never, reply as never);

    expect(authServiceMocks.createPasswordResetToken).toHaveBeenCalledWith(
      request.server.prisma,
      "jane@example.com",
      "1h"
    );
    expect(emailMocks.sendPasswordResetEmail).toHaveBeenCalledWith({
      to: "jane@example.com",
      fullName: "Jane Doe",
      resetLink: "http://localhost:3000/reset-password?token=reset-token-123",
      expiresInMinutes: 60,
    });
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "If that email is registered, a password reset link has been sent to your inbox.",
    });
  });

  it("returns 200 even for non-existent email on forgot-password", async () => {
    authServiceMocks.createPasswordResetToken.mockResolvedValue(null as never);

    const request = mockRequest({ body: { email: "unknown@example.com" } });
    const reply = mockReply();

    await authController.forgotPassword(request as never, reply as never);

    expect(emailMocks.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  it("logs failed password reset email delivery", async () => {
    authServiceMocks.createPasswordResetToken.mockResolvedValue({
      token: "reset-token-123",
      fullName: "Jane Doe",
    } as never);
    emailMocks.sendPasswordResetEmail.mockRejectedValue(new Error("Email failed") as never);

    const request = mockRequest({ body: { email: "jane@example.com" } });
    const reply = mockReply();

    await authController.forgotPassword(request as never, reply as never);

    expect(request.log.error).toHaveBeenCalledWith(
      { error: expect.any(Error), email: "jane@example.com" },
      "Failed to send password reset email"
    );
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  it("validates reset tokens", async () => {
    authServiceMocks.validatePasswordResetToken.mockResolvedValue(true as never);

    const request = mockRequest({ query: { token: "valid-token" } });
    const reply = mockReply();

    await authController.validateResetToken(request as never, reply as never);

    expect(authServiceMocks.validatePasswordResetToken).toHaveBeenCalledWith(
      request.server.prisma,
      "valid-token"
    );
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      data: { valid: true },
    });
  });

  it("resets password with valid token", async () => {
    authServiceMocks.consumePasswordResetToken.mockResolvedValue(undefined as never);

    const request = mockRequest({
      body: { token: "reset-token-123", newPassword: "NewPassword1!" },
    });
    const reply = mockReply();

    await authController.resetPassword(request as never, reply as never);

    expect(authServiceMocks.consumePasswordResetToken).toHaveBeenCalledWith(
      request.server.prisma,
      "reset-token-123",
      "NewPassword1!"
    );
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Password has been reset successfully. Please log in with your new password.",
    });
  });

  it("creates staff accounts and sends welcome email", async () => {
    adminServiceMocks.createStaffAccount.mockResolvedValue({
      user: {
        id: "tutor-1",
        email: "tutor@example.com",
        fullName: "John Tutor",
        role: "TUTOR",
        status: "ACTIVE",
      },
      password: "GeneratedPass1!",
      passwordGenerated: true,
    } as never);
    emailMocks.sendStaffWelcomeEmail.mockResolvedValue({} as never);

    const request = mockRequest({
      body: { role: "TUTOR", fullName: "John Tutor", email: "tutor@example.com" },
    });
    const reply = mockReply();

    await adminController.createStaff(request as never, reply as never);

    expect(adminServiceMocks.createStaffAccount).toHaveBeenCalledWith(
      request.server.prisma,
      request.body
    );
    expect(emailMocks.sendStaffWelcomeEmail).toHaveBeenCalledWith({
      to: "tutor@example.com",
      fullName: "John Tutor",
      role: "TUTOR",
      password: "GeneratedPass1!",
    });
    expect(reply.status).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "TUTOR account created and credentials emailed",
      data: {
        user: {
          id: "tutor-1",
          email: "tutor@example.com",
          fullName: "John Tutor",
          role: "TUTOR",
          status: "ACTIVE",
        },
        emailSent: true,
      },
    });
  });

  it("handles staff welcome email failure gracefully", async () => {
    adminServiceMocks.createStaffAccount.mockResolvedValue({
      user: {
        id: "tutor-1",
        email: "tutor@example.com",
        fullName: "John Tutor",
        role: "TUTOR",
        status: "ACTIVE",
      },
      password: "GeneratedPass1!",
      passwordGenerated: true,
    } as never);
    emailMocks.sendStaffWelcomeEmail.mockRejectedValue(new Error("Email failed") as never);

    const request = mockRequest({
      body: { role: "TUTOR", fullName: "John Tutor", email: "tutor@example.com" },
    });
    const reply = mockReply();

    await adminController.createStaff(request as never, reply as never);

    expect(request.log.error).toHaveBeenCalledWith(
      { error: expect.any(Error), target: "tutor@example.com" },
      "Failed to send staff welcome email"
    );
    expect(reply.status).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "TUTOR account created but welcome email delivery failed",
        data: expect.objectContaining({ emailSent: false }),
      })
    );
  });
});
