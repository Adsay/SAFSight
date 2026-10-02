import { authRepository } from "./auth-repository";
import { createAuthHandlers } from "./auth-http";

export const authHandlers = createAuthHandlers(authRepository);