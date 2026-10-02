import { organizationHandlers } from "@/lib/organizations/handlers";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { organizationId } = await params;
  return organizationHandlers.members(request, organizationId);
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { organizationId } = await params;
  return organizationHandlers.addMember(request, organizationId);
}