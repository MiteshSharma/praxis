import PgBoss from 'pg-boss';

const BACKEND = 'http://localhost:3000';
const WORKER_HEALTH = 'http://localhost:3101';
const SANDBOX_WORKER = 'http://localhost:8787';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://praxis:praxis@localhost:5433/praxis';

let failed = false;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failed = true;
    console.log(`  FAIL ${name}`, detail ?? '');
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main() {
  console.log('Phase 0 smoke test\n');

  try {
    const cp = (await getJson(`${BACKEND}/health`)) as { status?: string };
    check('control-plane /health', cp.status === 'ok', cp);
  } catch (err) {
    check('control-plane /health', false, err);
  }

  try {
    const wk = (await getJson(`${WORKER_HEALTH}/health`)) as { status?: string };
    check('worker /health', wk.status === 'ok', wk);
  } catch (err) {
    check('worker /health', false, err);
  }

  try {
    const sb = (await getJson(`${SANDBOX_WORKER}/health`)) as { status?: string };
    check('sandbox-worker /health', sb.status === 'ok', sb);
  } catch (err) {
    check('sandbox-worker /health', false, err);
  }

  try {
    const rpcRes = await fetch(`${BACKEND}/rpc/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const body = (await rpcRes.json()) as { ok?: boolean; json?: { ok?: boolean } };
    const ok = body?.ok ?? body?.json?.ok;
    check('oRPC router.health', rpcRes.ok && ok === true, body);
  } catch (err) {
    check('oRPC router.health', false, err);
  }

  try {
    const spec = (await getJson(`${BACKEND}/openapi.json`)) as {
      openapi?: string;
      paths?: Record<string, unknown>;
    };
    const hasHealth = !!spec.paths && Object.keys(spec.paths).some((p) => p.includes('health'));
    check('openapi.json contains health procedure', !!spec.openapi && hasHealth);
  } catch (err) {
    check('openapi.json', false, err);
  }

  try {
    const boss = new PgBoss(DATABASE_URL);
    await boss.start();
    await boss.createQueue('hello');
    const id = await boss.send('hello', { from: 'smoke', at: Date.now() });
    console.log(`  ->   enqueued hello job ${id}`);
    await new Promise((r) => setTimeout(r, 2000));
    await boss.stop({ graceful: true });
    check('pg-boss hello round-trip', !!id);
  } catch (err) {
    check('pg-boss hello round-trip', false, err);
  }

  if (failed) {
    console.log('\nsmoke test FAILED');
    process.exit(1);
  }
  console.log('\nsmoke test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
