import { NextResponse, type NextRequest } from "next/server";

// Optional password for the whole app. Required before you can connect Instagram / TikTok.
// Set APP_PASSWORD (any username works). Unset = open, as before.
export function middleware(req: NextRequest) {
  const pass = process.env.APP_PASSWORD;
  if (!pass) return NextResponse.next();
  // Public report pages (/p/<id>) are meant to be shared; they only show scans you turned public.
  if (req.nextUrl.pathname.startsWith("/p/")) return NextResponse.next();
  // Terms and Privacy must be public: TikTok, Google and Meta reviewers open them without a password.
  if (req.nextUrl.pathname === "/terms" || req.nextUrl.pathname === "/privacy") return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (given.length === pass.length) {
        let diff = 0;
        for (let i = 0; i < pass.length; i++) diff |= given.charCodeAt(i) ^ pass.charCodeAt(i);
        if (diff === 0) return NextResponse.next();
      }
    } catch {
      // fall through to the challenge
    }
  }
  return new NextResponse("Password required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Ingredient Scanner", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
