import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { pgCode, type Env } from "./db.ts";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: ContentfulStatusCode = 400,
  ) {
    super(code);
  }
}

/** Throwing an ApiError inside a transaction undoes everything it had done. */
export function guarded(fn: (c: Context<Env>) => Promise<Response>) {
  return async (c: Context<Env>) => {
    try {
      return await fn(c);
    } catch (e) {
      if (e instanceof ApiError) return c.json({ error: e.code }, e.status);
      if (pgCode(e) === "23503") return c.json({ error: "unknown_reference" }, 400);
      if (pgCode(e) === "23505") return c.json({ error: "duplicate_invoice" }, 409);
      throw e;
    }
  };
}

const uuid = z.string().uuid();
export function idParam(c: Context<Env>) {
  const id = uuid.safeParse(c.req.param("id"));
  if (!id.success) throw new ApiError("not_found", 404);
  return id.data;
}

export async function parse<T extends z.ZodTypeAny>(c: Context<Env>, schema: T): Promise<z.output<T>> {
  const body = schema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new ApiError(body.error.issues[0]?.message ?? "invalid");
  return body.data;
}

export const PAGE_SIZE = 50;
export function pageOf(c: Context<Env>) {
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  return { page, offset: (page - 1) * PAGE_SIZE };
}
