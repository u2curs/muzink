export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ time: Date.now() });
}
