import { NextRequest, NextResponse } from "next/server";
import { authRepository } from "@/lib/auth/auth-repository";
import { SESSION_COOKIE_NAME } from "@/lib/auth/auth-http";
import { getUserForSession } from "@/lib/auth/auth-service";

const protectedPaths = [
  "/dashboard",
  "/api/scans",
  "/api/assets",
  "/api/findings",
  "/api/alerts",
  "/api/reports",
  "/api/schedules",
];

export function isProtectedPath(pathname: string): boolean {
  return protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function createProxy(isValidSession: (token: string) => Promise<boolean>) {
  return async function proxy(request: NextRequest): Promise<NextResponse> {
    if (!isProtectedPath(request.nextUrl.pathname)) return NextResponse.next();
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    let valid = false;
    try {
      valid = token ? await isValidSession(token) : false;
    } catch {
      return NextResponse.json(
        { error: "auth_unavailable", message: "Authentication is temporarily unavailable." },
        { status: 503 },
      );
    }
    if (valid) return NextResponse.next();

    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "unauthorized", message: "Authentication is required." },
        { status: 401 },
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  };
}

export const proxy = createProxy(async (token) =>
  Boolean(await getUserForSession(token, authRepository)),
);

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};