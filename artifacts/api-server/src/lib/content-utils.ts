import { createHash } from "node:crypto";

/** Стабильный хэш текста — для защиты от повторной публикации. Чистая функция. */
export function contentHash(text: string): string {
  return createHash("sha1")
    .update(text.replace(/\s+/g, " ").trim().toLowerCase())
    .digest("hex");
}
