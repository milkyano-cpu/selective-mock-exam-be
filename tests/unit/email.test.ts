import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// Mock Resend module before importing email
const sendMock = jest.fn().mockResolvedValue({ id: "email-1" });
const ResendMock = jest.fn().mockImplementation(() => ({
  emails: { send: sendMock },
}));

await jest.unstable_mockModule("resend", () => ({
  Resend: ResendMock,
}));

// Import email module after mock is set up
const email = await import("../../src/lib/email.js");

describe("email library", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it("sends escaped parent welcome emails", async () => {
    await email.sendParentWelcomeEmail({
      to: "parent@example.com",
      fullName: "Jane <Doe>",
      password: `Pass&"word'1!`,
      studentNames: ["Alex <Doe>", "Sam & Doe"],
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Aspire <noreply@example.com>",
        to: "parent@example.com",
        subject: expect.stringContaining("Aspire Selective Entry Preparation"),
        html: expect.stringContaining("Jane &lt;Doe&gt;"),
      })
    );
    const html = sendMock.mock.calls[0]![0].html;
    expect(html).toContain("Alex &lt;Doe&gt;");
    expect(html).toContain("Sam &amp; Doe");
    expect(html).toContain("Pass&amp;&quot;word&#039;1!");
  });

  it("sends escaped student welcome emails", async () => {
    await email.sendStudentWelcomeEmail({
      to: "student@example.com",
      fullName: "Alex <Doe>",
      password: "StudentPass1!",
      parentName: "Jane & Doe",
    });

    expect(sendMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: "Aspire <noreply@example.com>",
        to: "student@example.com",
        subject: expect.stringContaining("Aspire Selective Entry Preparation"),
        html: expect.stringContaining("Alex &lt;Doe&gt;"),
      })
    );
    const html = sendMock.mock.calls[0]![0].html;
    expect(html).toContain("Jane &amp; Doe");
    expect(html).toContain("StudentPass1!");
  });
});
