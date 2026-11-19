// The verify gate, run before every commit:
//
//   node tools/verify.ts <snapshot.json> [<the kit's vendor/makefun-board.ts>]
//
// (a) runs main.ts twice into two fresh directories and requires byte-identical output;
// (b) holds that output to the seven rows of the house gate (RULES.txt, "The gate");
// (c) holds the farm plans to their own rules: no step shared between rows, every step naming its protocol,
//     no promise of an exit, and the right operation for four protocols a reviewer found wrong;
//     no promise of a gas token the model does not know, and no row the house rule's deductions set aside;
//     no universal exit timing in a delegation plan, and the USDC pause date in Noble's;
// (d) holds the hand-written dashboard source to 62,500 bytes and requires the dossier to show it whole.
// Prints one line per check and exits 1 on any failure.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from '../vendor/makefun-board.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const snapshotFile = process.argv[2];
const kitVendor = process.argv[3];
if (!snapshotFile || !existsSync(snapshotFile)) {
  process.stderr.write('usage: node tools/verify.ts <snapshot.json> [<kit vendor/makefun-board.ts>]\n');
  process.exit(2);
}

let failed = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failed++;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}\n`);
}

/** Every regular file under dir, as paths relative to it, sorted. */
function walk(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(dir, join(rel, e.name)) : [join(rel, e.name)]))
    .sort();
}

/** The pixel size of a whole PNG or JPEG, or null. */
function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.subarray(bytes.length - 8, bytes.length - 4).toString('latin1') === 'IEND') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    for (let at = 2; at + 9 < bytes.length; ) {
      const marker = bytes[at + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }
  return null;
}

// ---- (a) two runs, the same bytes
const runs = [mkdtempSync(join(tmpdir(), 'radar-a-')), mkdtempSync(join(tmpdir(), 'radar-b-'))];
for (const out of runs) execFileSync(process.execPath, [join(root, 'main.ts'), '--input', snapshotFile, '--output', out], { stdio: 'pipe' });
const [a, b] = runs as [string, string];
const filesA = walk(a);
const differing = filesA.filter((f) => !existsSync(join(b, f)) || !readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
check('two_runs_identical', filesA.join() === walk(b).join() && differing.length === 0, differing.length ? `differ: ${differing.join(', ')}` : `${filesA.length} files byte-identical across two runs`);

// ---- (b) the house gate's seven rows, on run a
const dash = walk(join(a, 'dashboard'));
const dashBytes = dash.reduce((n, f) => n + statSync(join(a, 'dashboard', f)).size, 0);
const badName = dash.find((f) => !f.split('/').every((part) => /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(part)));
// Stricter than the gate: no address anywhere in any dashboard file, not only in attributes and imports.
const networked = dash.find((f) => /\.(html|css|js|mjs|svg|json)$/.test(f) && /https?:\/\/|\/\/[a-z0-9-]+\.[a-z]{2,}\//i.test(readFileSync(join(a, 'dashboard', f), 'utf8')));
check(
  'dashboard_files',
  dash.includes('index.html') && dash.some((f) => f.endsWith('.css')) && dash.some((f) => f.endsWith('.js')) && dash.length <= 400 && dashBytes <= 4_194_304 && !badName && !networked,
  networked ? `${networked} names a network address` : badName ? `${badName} is not a plain name` : `${dash.length} files, ${dashBytes} bytes, no network address in any of them`,
);

const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8')) as { floor_usd: number; protocols: { slug: string; tvl_usd: number; mcap_usd: number | null; symbol: string | null; gecko_id: string | null; category: string | null }[]; watchlist: string[] };
const boardText = readFileSync(join(a, 'board.json'), 'utf8');
const rows = (JSON.parse(boardText) as { rows: { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }[] }).rows;
const known = new Set(snapshot.protocols.map((p) => p.slug));
const slugs = new Set(rows.map((r) => r.slug));
const whole = (n: unknown): boolean => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const badRow = rows.find((r) => !known.has(r.slug) || /\s/.test(r.slug) || !r.name || !whole(r.rank) || !whole(r.implied_value_usd) || r.implied_value_usd > 1e14 || !Array.isArray(r.farm_steps));
const values = new Set(rows.map((r) => r.implied_value_usd));
check(
  'board_file',
  rows.length >= 100 && rows.length <= 4000 && slugs.size === rows.length && !badRow && values.size > 1 && Buffer.byteLength(boardText) <= 8_388_608,
  badRow ? `bad row ${badRow.slug}` : `${rows.length} rows, ${slugs.size} distinct slugs all in the snapshot, ${values.size} distinct values, ${Buffer.byteLength(boardText)} bytes`,
);

const byRank = [...rows].sort((x, y) => x.rank - y.rank);
const rankBreak = byRank.findIndex((r, i) => r.rank !== i + 1 || (i > 0 && r.implied_value_usd > byRank[i - 1]!.implied_value_usd));
check('sorted_by_value', rankBreak < 0 && values.size > 1, rankBreak < 0 ? `ranks 1..${rows.length}, values from ${byRank[0]!.implied_value_usd} down to ${byRank[byRank.length - 1]!.implied_value_usd}` : `order breaks at position ${rankBreak + 1}`);

const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
check('coverage', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${snapshot.watchlist.length} of ${snapshot.watchlist.length} watchlist slugs on the board`);

const lengths = rows.flatMap((r) => r.farm_steps.map((s) => s.trim().length));
const badPlan = rows.find((r) => r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600));
const distinctPlans = new Set(rows.map((r) => r.farm_steps.join('\n'))).size;
check('farm_steps', !badPlan, badPlan ? `bad plan on ${badPlan.slug}` : `every row has ${Math.min(...rows.map((r) => r.farm_steps.length))}-${Math.max(...rows.map((r) => r.farm_steps.length))} steps of ${Math.min(...lengths)}-${Math.max(...lengths)} characters; ${distinctPlans} distinct plans`);

const shots = readdirSync(join(a, 'screenshots')).filter((f) => !f.startsWith('.')).sort();
const shotNotes: string[] = [];
let shotsOk = shots.length >= 3 && shots.length <= 4;
for (const name of shots) {
  const bytes = readFileSync(join(a, 'screenshots', name));
  const size = imageSize(bytes);
  const long = size ? Math.max(size.width, size.height) : 0;
  const short = size ? Math.min(size.width, size.height) : 0;
  if (!size || bytes.length > 524_288 || long > 1440 || short < 800 || !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(name)) shotsOk = false;
  shotNotes.push(`${name} ${size ? `${size.width}x${size.height}` : 'not a whole PNG or JPEG'} ${bytes.length} bytes${bytes.length < 300_000 || bytes.length > 350_000 ? ' (outside the 300-350 KB target)' : ''}`);
}
check('screenshots', shotsOk, shotNotes.join('; ') || 'none');

const dossier = readFileSync(join(a, 'dossier.json'));
const rebuilt = Buffer.from(buildDossier(a, { text_max_bytes: 65_536 }));
const dossierText = (JSON.parse(dossier.toString('utf8')) as { text: string }).text;
const cut = /\[Cut at .*\]/.exec(dossierText);
check('dossier_matches', dossier.equals(rebuilt) && dossier.length <= 1_572_864, `${dossier.length} bytes (cap 1572864), rebuilt byte for byte: ${dossier.equals(rebuilt)}; text ${Buffer.byteLength(dossierText)} bytes${cut ? `; ${cut[0]}` : '; nothing cut'}`);

// ---- (c) the farm plans: specific to their row, honest about exits, right for the protocols a reviewer checked
const owners = new Map<string, Set<string>>();
for (const r of rows) for (const s of r.farm_steps) owners.set(s, (owners.get(s) ?? new Set()).add(r.slug));
const shared = [...owners].filter(([, set]) => set.size > 1);
const repeated = rows.find((r) => new Set(r.farm_steps).size !== r.farm_steps.length);
const unnamed = rows.find((r) => r.farm_steps.some((s) => !s.includes(r.name)));
check(
  'steps_unique',
  shared.length === 0 && !repeated && !unnamed,
  shared.length ? `${shared.length} step(s) appear in more than one row, e.g. "${shared[0]![0].slice(0, 60)}..." in ${[...shared[0]![1]].join(', ')}` : repeated ? `${repeated.slug} repeats a step` : unnamed ? `a step of ${unnamed.slug} does not name it` : `${owners.size} steps, none in more than one row, each naming its protocol`,
);

const planOf = (slug: string): string => (rows.find((r) => r.slug === slug)?.farm_steps ?? []).join('\n');
// [slug, what its plan must say, what it must not]
const OPERATIONS: [string, RegExp[], RegExp[]][] = [
  ['symbiotic', [/collateral/i, /withdrawal/i, /claim/i, /slash/i], [/borrow/i, /health factor/i, /APR/]],
  ['firelight', [/FXRP/, /stXRP/], [/USDC/, /stablecoin/i]],
  ['bittensor-dtao', [/TAO/, /alpha/, /user liquidity enabled/], [/stablecoin/i, /blue-chip/i]],
  ['lightning-network', [/Lightning wallet/, /channel/, /invoice/, /ppm/, /splicing out/], [/only as payments/]],
  ['b14g', [/Bitcoin timelock/, /unbonding/, /Before depositing/], [/epoch/i, /single collateral asset/]],
  ['noble', [/2027-01-12/, /Do not park USDC/, /bridge any USDC off Noble before 2027-01-12/, /Review the position before 2027-01-12/], [/leave a balance/, /review after 90 days/, /of capital at risk/]],
];
const wrongOps = OPERATIONS.flatMap(([slug, must, mustNot]) => {
  const plan = planOf(slug);
  if (!plan) return [`${slug} is not on the board`];
  return [...must.filter((re) => !re.test(plan)).map((re) => `${slug} lacks ${re}`), ...mustNot.filter((re) => re.test(plan)).map((re) => `${slug} still says ${re}`)];
});
check('plan_operations', wrongOps.length === 0, wrongOps.length ? wrongOps.join('; ') : OPERATIONS.map(([slug, must, mustNot]) => `${slug}: ${must.length} required, ${mustNot.length} barred`).join('; '));

const EXIT_CLAIM = /exit cleanly|clean exit|cleanly|exits? eas/i;
const exitClaims = rows.filter((r) => r.farm_steps.some((s) => EXIT_CLAIM.test(s)));
const lendingOnly = rows.filter((r) => !/lend|cdp/i.test(String((r as { category?: string | null }).category ?? '')) && r.farm_steps.some((s) => /borrow|health factor/i.test(s)));
check('no_exit_claim', exitClaims.length === 0 && lendingOnly.length === 0, exitClaims.length ? `${exitClaims.length} row(s) promise an exit, e.g. ${exitClaims[0]!.slug}` : lendingOnly.length ? `borrowing prescribed outside a lending category: ${lendingOnly.map((r) => r.slug).join(', ')}` : `no row promises an exit; ${rows.filter((r) => r.farm_steps.some((s) => /withdrawable liquidity or utilisation/.test(s))).length} rows tell the reader to check withdrawable liquidity; borrowing only in lending and CDP categories`);

// A delegation plan names no universal exit timing: it tells the reader to read the lock before depositing and wait it out.
const delegation = rows.filter((r) => /collateral market|restak/i.test(String((r as { category?: string | null }).category ?? '')));
const epochClaim = rows.filter((r) => r.farm_steps.some((s) => /next epoch|epoch to end|two epochs/i.test(s)));
const noLockCheck = delegation.filter((r) => !r.farm_steps.some((s) => /Before depositing, read how long .* locks an exit/.test(s) && /wait out/.test(s)));
check('no_epoch_exit', delegation.length > 0 && epochClaim.length === 0 && noLockCheck.length === 0, epochClaim.length ? `a next-epoch withdrawal is asserted by: ${epochClaim.map((r) => r.slug).join(', ')}` : noLockCheck.length ? `no lock check before depositing in: ${noLockCheck.map((r) => r.slug).join(', ')}` : `no step of ${rows.length} rows asserts a next-epoch withdrawal; ${delegation.length} delegation plans (${delegation.map((r) => r.slug).join(', ')}) say to read the lock before depositing and wait it out`);

const noGas = rows.filter((r) => r.farm_steps.some((s) => /its gas token/.test(s)));
check('no_gas_fallback', noGas.length === 0, noGas.length ? `${noGas.length} row(s) fall back to "its gas token": ${noGas.map((r) => r.slug).join(', ')}` : `no step of ${rows.length} rows says "its gas token": every first chain names the token that pays its fees`);

// Outside the watchlist a ranked row sits under the floor, records no token, and shares no brand with a protocol that does.
const watch = new Set(snapshot.watchlist);
const record = new Map(snapshot.protocols.map((p) => [p.slug, p]));
const hasToken = (p: { mcap_usd: number | null; symbol: string | null; gecko_id: string | null }): boolean => p.mcap_usd !== null || p.symbol !== null || p.gecko_id !== null;
const brands = new Set(snapshot.protocols.filter(hasToken).map((p) => p.slug.split('-')[0]!).filter((b) => b.length >= 3));
// Restaking joins the house rule's custody categories: the same product class as Liquid Restaking.
const CUSTODY = ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'CEX', 'Liquid Restaking', 'Liquid Staking', 'Restaked BTC', 'Restaking', 'Stablecoin Wrapper'];
const leaked = rows.filter((r) => !watch.has(r.slug) && (record.get(r.slug)!.tvl_usd >= snapshot.floor_usd || hasToken(record.get(r.slug)!) || brands.has(r.slug.split('-')[0]!) || CUSTODY.includes(String(record.get(r.slug)!.category))));
check('pre_token_only', leaked.length === 0, leaked.length ? `ranked against the house rule's deductions: ${leaked.map((r) => r.slug).join(', ')}` : `${rows.length - snapshot.watchlist.length} rows outside the watchlist: each under the ${snapshot.floor_usd} floor, recording no token, sharing no brand with a protocol that records one, in no custody category (Restaking included)`);

// ---- (d) the hand-written source fits the dossier whole, and the vendored library is the kit's
const authored = readdirSync(join(root, 'dashboard')).filter((f) => !f.startsWith('.')).sort();
const authoredBytes = authored.reduce((n, f) => n + statSync(join(root, 'dashboard', f)).size, 0);
const shownWhole = authored.every((f) => dossierText.includes(`### ${f}\n`) && dossierText.includes(readFileSync(join(root, 'dashboard', f), 'utf8')));
check('source_budget', authoredBytes <= 62_500 && shownWhole, `${authored.join(' + ')} = ${authoredBytes} bytes (budget 62500); every file whole in the dossier: ${shownWhole}`);
if (kitVendor) check('vendor_identical', readFileSync(join(root, 'vendor', 'makefun-board.ts')).equals(readFileSync(kitVendor)), 'vendor/makefun-board.ts is byte for byte the kit\'s');

for (const out of runs) rmSync(out, { recursive: true, force: true });
process.stdout.write(failed ? `verify: ${failed} check(s) FAILED\n` : 'verify: all checks passed\n');
process.exit(failed ? 1 : 0);
