import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authRepository } from "./auth-repository";
import { getUserForSession, type UserProfile } from "./auth-service";
import { getSessionToken, SESSION_COOKIE_NAME } from "./auth-http";

export async function getCurrentUser(): Promise<UserProfile | null> {
  const cookieStore = await cookies();
  return getUserForSession(cookieStore.get(SESSION_COOKIE_NAME)?.value, authRepository);
}

export async function getRequestUser(request: Request): Promise<UserProfile | null> {
  return getUserForSession(getSessionToken(request), authRepository);
}

export async function requireCurrentUser(): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRequestUser(request: Request): Promise<UserProfile | null> {
  return getRequestUser(request);
}