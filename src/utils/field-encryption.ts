import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getEncryptionKey(): Buffer {
  return Buffer.from(env.FIELD_ENCRYPTION_KEY, "hex");
}

function getBlindIndexKey(): Buffer {
  return Buffer.from(env.BLIND_INDEX_KEY, "hex");
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Returns a base64-encoded string in the format: iv:authTag:ciphertext
 */
export function encryptField(value: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

/**
 * Decrypts a value previously encrypted by encryptField.
 */
export function decryptField(encoded: string): string {
  const key = getEncryptionKey();
  const parts = encoded.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted field format");
  const [ivB64, tagB64, cipherB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(cipherB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Invalid encrypted field: wrong iv or tag length");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Computes a deterministic HMAC-SHA256 blind index for use as a DB lookup key.
 * The returned value is a 64-char lowercase hex string.
 */
export function computeBlindIndex(value: string): string {
  return createHmac("sha256", getBlindIndexKey()).update(value).digest("hex");
}
