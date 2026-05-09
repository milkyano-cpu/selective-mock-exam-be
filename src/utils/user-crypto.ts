import { encryptField, decryptField, computeBlindIndex } from "./field-encryption.js";
import { normalizeEmail } from "./normalize.js";

/** Returns the HMAC blind index for an email address (normalized before hashing). */
export function emailToBlindIndex(email: string): string {
  return computeBlindIndex(normalizeEmail(email));
}

/**
 * Splits a fullName into lowercase words and returns their HMAC blind indexes.
 * Used to populate fullNameTokens for word-level search.
 */
export function fullNameToTokens(fullName: string): string[] {
  return fullName
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => computeBlindIndex(word));
}

type UserFieldInput = {
  email: string;
  fullName: string;
  phoneNumber?: string;
  address?: string;
};

type EncryptedUserFields = {
  email: string;          // HMAC blind index
  emailEncrypted: string; // AES-256-GCM encrypted actual email
  fullName: string;       // AES-256-GCM encrypted
  fullNameTokens: string[]; // word-level HMAC blind indexes
  phoneNumber?: string;   // AES-256-GCM encrypted if provided
  address?: string;       // AES-256-GCM encrypted if provided
};

/** Encrypts user PII fields into DB-ready values. */
export function encryptUserFields(input: UserFieldInput): EncryptedUserFields {
  const result: EncryptedUserFields = {
    email: emailToBlindIndex(input.email),
    emailEncrypted: encryptField(normalizeEmail(input.email)),
    fullName: encryptField(input.fullName),
    fullNameTokens: fullNameToTokens(input.fullName),
  };
  if (input.phoneNumber !== undefined) {
    result.phoneNumber = encryptField(input.phoneNumber);
  }
  if (input.address !== undefined) {
    result.address = encryptField(input.address);
  }
  return result;
}

type RawUserWithPII = {
  email: string;
  emailEncrypted: string;
  fullName: string;
  phoneNumber?: string | null;
  address?: string | null;
};

type DecryptedUser<T extends RawUserWithPII> = Omit<T, "emailEncrypted"> & {
  email: string;
  fullName: string;
};

/**
 * Decrypts PII fields in a raw DB row.
 * Replaces `email` (blind index) with the decrypted actual email.
 * Removes `emailEncrypted` from the returned object.
 */
export function decryptUser<T extends RawUserWithPII>(user: T): DecryptedUser<T> {
  const { emailEncrypted, ...rest } = user;
  return {
    ...rest,
    email: decryptField(emailEncrypted),
    fullName: decryptField(user.fullName),
    ...(user.phoneNumber != null ? { phoneNumber: decryptField(user.phoneNumber) } : {}),
    ...(user.address != null ? { address: decryptField(user.address) } : {}),
  } as DecryptedUser<T>;
}
