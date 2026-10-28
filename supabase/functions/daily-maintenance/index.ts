// Backend-only scheduler endpoint. Neither secret belongs in VITE_* settings.
async function sameSecret(actual: string,expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left,right] = await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(actual)),crypto.subtle.digest('SHA-256',encoder.encode(expected))]);
  const a = new Uint8Array(left),b = new Uint8Array(right);
  let mismatch = 0;
  for (let index = 0;index < a.length;index++) mismatch |= a[index]^b[index];
  return mismatch === 0;
}
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed',{ status:405,headers:{ Allow:'POST' } });
  const secret = Deno.env.get('DAILY_MAINTENANCE_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),url = Deno.env.get('SUPABASE_URL');
  if (!secret || secret.length < 32 || !serviceKey || !url) return Response.json({ error:'Scheduler configuration is incomplete' },{ status:503 });
  if (!await sameSecret(request.headers.get('x-maintenance-secret') ?? '',secret)) return Response.json({ error:'Unauthorized' },{ status:401 });
  try {
    const response = await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/job_daily_maintenance',{
      method:'POST',headers:{ apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json','Content-Profile':'api','Accept-Profile':'api' },body:'{}',signal:AbortSignal.timeout(30000)
    });
    if (!response.ok) return Response.json({ error:'Daily maintenance failed',status:response.status },{ status:502 });
    return Response.json({ result:await response.json() });
  } catch { return Response.json({ error:'Daily maintenance unavailable' },{ status:502 }); }
});
