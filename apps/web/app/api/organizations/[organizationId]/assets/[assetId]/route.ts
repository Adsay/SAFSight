import { assetHandlers } from "@/lib/assets/handlers";

type RouteContext = { params: Promise<{ organizationId: string; assetId: string }> };

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { organizationId, assetId } = await params;
  return assetHandlers.get(request, organizationId, assetId);
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  const { organizationId, assetId } = await params;
  return assetHandlers.update(request, organizationId, assetId);
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
  const { organizationId, assetId } = await params;
  return assetHandlers.delete(request, organizationId, assetId);
}