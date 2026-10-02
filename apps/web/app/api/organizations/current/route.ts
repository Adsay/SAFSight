import { organizationHandlers } from "@/lib/organizations/handlers";

export const GET = organizationHandlers.current;
export const PUT = organizationHandlers.setCurrent;
export const DELETE = organizationHandlers.clearCurrent;