// The board's assembly: the sealed snapshot in, board.json and the page's data file out.
//
// The model itself (comparables, implied value, farm plans) lives in dashboard/radar-model.js, a plain
// script the page also loads, so the program that writes the board and the page that explains it run the
// same functions. This file reads and checks the snapshot, shapes the model's rows into board.json, and
// holds the board to the house gate before anything is written.

import RadarModel from '../dashboard/radar-model.js';

/** One protocol of the snapshot: exactly the ten fields the sealed input carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The working behind one implied value, as radar-model.js's working() returns it. */
export interface Working {
  multiple: number;
  low: number;
  high: number;
  basis: 'category' | 'global';
  comps: number;
  size: number;
  momentum: number;
  maturity: number;
  breadth: number;
  age_days: number | null;
}

/** A ranked row as the model returns it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  model: Working;
}

/** A protocol the board does not rank, and the set that says why. */
export interface AsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  symbol: string | null;
  set: 'priced' | 'ticker' | 'product' | 'family' | 'parent';
  /** A priced row: the TVL of every record that carries its token, and how many records that is. */
  token_tvl_usd?: number;
  ledgers?: number;
  /** A family row: the protocol whose recorded token names the brand. */
  kin?: string;
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  total: number;
  counts: { priced: number; ticker: number; product: number; family: number; parent: number; candidate: number };
  constants: Record<string, unknown>;
  comparables: Record<string, unknown>;
  rows: RadarRow[];
  aside: AsideRow[];
}

/** A row of board.json: the gate's five fields, then what the page and a reader need. */
export interface BoardRow extends RadarRow {
  farm_steps: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const orNull = <T>(v: unknown, is: (x: unknown) => x is T): T | null => (is(v) ? v : null);

/** The snapshot from its JSON text, every protocol reduced to the ten fields with the types the README states. */
export function parseSnapshot(text: string): Snapshot {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot is not JSON');
  }
  const d = doc as Partial<Snapshot> | null;
  if (d === null || typeof d !== 'object' || !Array.isArray(d.protocols) || !Array.isArray(d.watchlist)) {
    throw new SnapshotError('the snapshot carries no protocols or no watchlist');
  }
  if (!isString(d.as_of) || !/^\d{4}-\d{2}-\d{2}$/.test(d.as_of)) throw new SnapshotError('the snapshot carries no as_of date');
  const protocols: Protocol[] = [];
  for (const raw of d.protocols as unknown[]) {
    const p = raw as Record<string, unknown>;
    if (p === null || typeof p !== 'object' || !isString(p.slug) || !isString(p.name) || !isNumber(p.tvl_usd)) continue;
    protocols.push({
      slug: p.slug,
      name: p.name,
      category: orNull(p.category, isString),
      chains: Array.isArray(p.chains) ? p.chains.filter(isString) : [],
      tvl_usd: p.tvl_usd,
      change_7d: orNull(p.change_7d, isNumber),
      mcap_usd: orNull(p.mcap_usd, isNumber),
      listed_at: orNull(p.listed_at, isString),
      gecko_id: orNull(p.gecko_id, isString),
      symbol: orNull(p.symbol, isString),
    });
  }
  return {
    as_of: d.as_of,
    source: isString(d.source) ? d.source : '',
    floor_usd: isNumber(d.floor_usd) ? d.floor_usd : 0,
    protocols,
    watchlist: d.watchlist.filter(isString),
  };
}

/** The radar the model builds from the snapshot. */
export function buildRadar(snapshot: Snapshot): Radar {
  return RadarModel.buildRadar(snapshot) as Radar;
}

/** One sentence on the model, carried at the top of board.json. */
export function methodNote(radar: Radar): string {
  const c = radar.comparables as { n: number; global: { median: number }; elasticity: number };
  return (
    `Implied launch value = TVL x the market-cap/TVL multiple of the protocol's category (median of the ${c.n} tokens in the snapshot that trade, each on the TVL summed over its records, ` +
    `shrunk toward the global median ${c.global.median}) x bounded factors for size (elasticity ${c.elasticity}), 7-day TVL momentum, days listed with no token, and chain breadth. ` +
    `The board ranks the ${radar.counts.candidate} protocols that record no token; ${radar.counts.priced} priced, ${radar.counts.ticker} with a ticker on record, ${radar.counts.product} exchange, bridge, wrapped, staked, restaking or versioned products, ` +
    `${radar.counts.family} sharing a brand with a protocol that records a token and ${radar.counts.parent} at or above the watchlist's floor yet left off it by the house rule are set aside.`
  );
}

/** The board's rows: the model's rows, each with its farm plan as the strings the gate reads. */
export function boardRows(radar: Radar): BoardRow[] {
  return radar.rows.map((row) => ({
    ...row,
    farm_steps: (RadarModel.farmPlan(row, radar.as_of) as { action: string; cost: string; time: string }[]).map((s) => RadarModel.stepText(s) as string),
  }));
}

/**
 * Why the gate would refuse this board, or null: rows 100..4000, each slug one of the snapshot's and
 * once, ranks exactly 1..N, values positive, whole, not rising with rank and not all the same, the whole
 * watchlist covered, and 3..12 farm steps of 20..600 characters each.
 */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    const r = byRank[i]!;
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `ranks are not exactly 1..${rows.length} (${r.slug} holds ${r.rank})`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug}: implied value ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `${r.slug}: implied value rises at rank ${r.rank}`;
    if (r.name.trim() === '') return `${r.slug}: empty name`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const step of r.farm_steps) {
      const n = step.trim().length;
      if (n < 20 || n > 600) return `${r.slug}: a farm step of ${n} characters`;
    }
  }
  if (byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every implied value is the same';
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist slug ${slug} is not on the board`;
  return null;
}

/** board.json: the method, the snapshot's date, then one row per line. */
export function boardJson(radar: Radar, rows: BoardRow[]): string {
  const head = { method: methodNote(radar), as_of: radar.as_of, counts: radar.counts, comparables: radar.comparables };
  return `{\n${Object.entries(head)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)},\n`)
    .join('')}"rows": [\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n}\n`;
}

/**
 * The page's data file, dashboard/zz-data.js: the same radar as one assignment, one row per line so the
 * dossier's cut falls between rows. Farm plans are not repeated here: the page writes them with the same
 * farmPlan() that wrote board.json's. The source line drops the endpoint's address: the page names no URL.
 */
export function dataScript(radar: Radar, snapshot: Snapshot): string {
  const fetched = /fetched (\S+)/.exec(snapshot.source);
  const head = {
    as_of: radar.as_of,
    source: `DefiLlama protocols index${fetched ? `, fetched ${fetched[1]}` : ''}`,
    floor_usd: radar.floor_usd,
    total: radar.total,
    counts: radar.counts,
    watchlist_size: snapshot.watchlist.length,
    constants: radar.constants,
    comparables: radar.comparables,
  };
  const lines = (items: unknown[]): string => items.map((r) => JSON.stringify(r)).join(',\n');
  return `// Generated by main.ts from the sealed snapshot. Do not edit: run main.ts.\nwindow.RADAR_DATA = {\n${Object.entries(head)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)},\n`)
    .join('')}"rows": [\n${lines(radar.rows)}\n],\n"aside": [\n${lines(radar.aside)}\n]\n};\n`;
}
