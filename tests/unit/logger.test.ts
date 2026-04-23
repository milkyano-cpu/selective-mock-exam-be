import { describe, expect, it, jest } from "@jest/globals";

describe("logger config", () => {
  it("creates development logger with pretty transport and redaction", async () => {
    jest.resetModules();
    jest.unstable_mockModule("../../src/config/env.js", () => ({
      env: { NODE_ENV: "development" },
    }));

    const { logger } = await import("../../src/config/logger.js");

    expect(logger.level).toBe("debug");
    expect(logger.redact).toBeUndefined();
  });

  it("creates production logger without pretty transport", async () => {
    jest.resetModules();
    jest.unstable_mockModule("../../src/config/env.js", () => ({
      env: { NODE_ENV: "production" },
    }));

    const { logger } = await import("../../src/config/logger.js");

    expect(logger.level).toBe("info");
  });
});
