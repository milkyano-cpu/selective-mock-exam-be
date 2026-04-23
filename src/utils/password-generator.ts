import { randomInt } from "crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";   // No I, O
const LOWER = "abcdefghijkmnopqrstuvwxyz";   // No l
const DIGITS = "23456789";                   // No 0, 1
const SYMBOLS = "!@#$%^&*";

const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function pick(chars: string): string {
  return chars[randomInt(chars.length)]!;
}

// Generates a 12-character password with at least one of each class.
// Excludes ambiguous characters (0, O, 1, I, l) for readability in emails.
export function generatePassword(): string {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: 8 }, () => pick(ALL));
  const all = [...required, ...rest];

  // Fisher-Yates shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [all[i], all[j]] = [all[j]!, all[i]!];
  }

  return all.join("");
}
