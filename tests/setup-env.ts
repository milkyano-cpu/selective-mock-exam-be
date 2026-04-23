process.env["NODE_ENV"] = process.env["NODE_ENV"] ?? "test";
process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgresql://user:pass@localhost:5432/aspire";
process.env["DIRECT_URL"] =
  process.env["DIRECT_URL"] ?? "postgresql://user:pass@localhost:5432/aspire";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["JWT_SECRET"] =
  process.env["JWT_SECRET"] ?? "test-secret-that-is-at-least-32-characters";
process.env["JWT_EXPIRES_IN"] = process.env["JWT_EXPIRES_IN"] ?? "15m";
process.env["REFRESH_TOKEN_EXPIRES_IN"] =
  process.env["REFRESH_TOKEN_EXPIRES_IN"] ?? "7d";
process.env["RESEND_API_KEY"] = process.env["RESEND_API_KEY"] ?? "re_test_key";
process.env["EMAIL_FROM"] =
  process.env["EMAIL_FROM"] ?? "Aspire <noreply@example.com>";
process.env["APP_LOGIN_URL"] =
  process.env["APP_LOGIN_URL"] ?? "http://localhost:3000/login";
process.env["CORS_ORIGIN"] =
  process.env["CORS_ORIGIN"] ?? "http://localhost:3000";
process.env["APP_NAME"] =
  process.env["APP_NAME"] ?? "Aspire Selective Entry Preparation";
process.env["API_PREFIX"] = process.env["API_PREFIX"] ?? "/api/v1";
