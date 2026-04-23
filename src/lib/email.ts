import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = new Resend(env.RESEND_API_KEY);

interface WelcomeParentParams {
  to: string;
  fullName: string;
  password: string;
  studentNames: string[];
}

interface WelcomeStudentParams {
  to: string;
  fullName: string;
  password: string;
  parentName: string;
}

export async function sendParentWelcomeEmail(params: WelcomeParentParams) {
  const studentList = params.studentNames.map((n) => `<li>${escapeHtml(n)}</li>`).join("");

  return resend.emails.send({
    from: env.EMAIL_FROM,
    to: params.to,
    subject: `Welcome to ${env.APP_NAME} — Your account credentials`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to ${env.APP_NAME}, ${escapeHtml(params.fullName)}</h2>
        <p>Your parent account has been created successfully. You also registered the following student(s):</p>
        <ul>${studentList}</ul>
        <p>Each student has been sent their own login credentials separately.</p>
        <h3>Your login credentials</h3>
        <p>
          <strong>Email:</strong> ${escapeHtml(params.to)}<br>
          <strong>Password:</strong> <code style="background:#f4f4f4;padding:4px 8px;border-radius:4px;">${escapeHtml(params.password)}</code>
        </p>
        <p>
          <a href="${env.APP_LOGIN_URL}" style="background:#2563eb;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;">Login to ${env.APP_NAME}</a>
        </p>
        <p style="color:#666;font-size:13px;">For security, please change your password after the first login.</p>
      </div>
    `,
  });
}

export async function sendStudentWelcomeEmail(params: WelcomeStudentParams) {
  return resend.emails.send({
    from: env.EMAIL_FROM,
    to: params.to,
    subject: `Welcome to ${env.APP_NAME} — Your account credentials`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to ${env.APP_NAME}, ${escapeHtml(params.fullName)}</h2>
        <p>An account has been created for you by your parent <strong>${escapeHtml(params.parentName)}</strong>.</p>
        <h3>Your login credentials</h3>
        <p>
          <strong>Email:</strong> ${escapeHtml(params.to)}<br>
          <strong>Password:</strong> <code style="background:#f4f4f4;padding:4px 8px;border-radius:4px;">${escapeHtml(params.password)}</code>
        </p>
        <p>
          <a href="${env.APP_LOGIN_URL}" style="background:#2563eb;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;">Login to ${env.APP_NAME}</a>
        </p>
        <p style="color:#666;font-size:13px;">For security, please change your password after the first login.</p>
      </div>
    `,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
