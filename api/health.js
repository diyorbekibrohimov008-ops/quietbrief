export function GET() {
  return Response.json({
    ok: true,
    service: 'quietbrief',
    architecture: 'local-first-on-device',
    timestamp: new Date().toISOString(),
  });
}
