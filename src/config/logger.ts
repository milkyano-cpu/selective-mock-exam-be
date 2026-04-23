import pino from "pino";
import { env } from "./env.js";

const transport =
  env.NODE_ENV === "development"
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
        },
      })
    : undefined;

export const logger = pino(
  {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "body.password",
        "body.oldPassword",
        "body.newPassword",
      ],
      censor: "[REDACTED]",
    },
  },
  transport
);
