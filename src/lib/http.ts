import { NextResponse } from "next/server";

export type Ctx = { params: Promise<{ id: string }> };

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The [id] route param, validated as a UUID. */
export async function paramId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new HttpError("Not found.", 404);
  return id;
}

/** Wraps a route so every failure comes back as JSON, never an empty 500. */
export function handler(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      console.error(err);
      const status = err instanceof HttpError ? err.status : 500;
      return json({ error: err instanceof Error ? err.message : "Unexpected server error." }, status);
    }
  };
}
