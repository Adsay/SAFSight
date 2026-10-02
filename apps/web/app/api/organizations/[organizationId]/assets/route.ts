import { assetHandlers } from "@/lib/assets/handlers";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { organizationId } = await params;
  return assetHandlers.list(request, organizationId);
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { organizationId } = await params;
  return assetHandlers.create(request, organizationId);
}