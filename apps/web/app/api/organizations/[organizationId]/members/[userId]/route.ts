import { organizationHandlers } from "@/lib/organizations/handlers";

type RouteContext = { params: Promise<{ organizationId: string; userId: string }> };

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  const { organizationId, userId } = await params;
  return organizationHandlers.changeMemberRole(request, organizationId, userId);
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
  const { organizationId, userId } = await params;
  return organizationHandlers.removeMember(request, organizationId, userId);
}