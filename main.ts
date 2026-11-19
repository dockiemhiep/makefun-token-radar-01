// Token Launch Radar: a token-radar-01 entry (Node 22, standard library only, no network).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), values every protocol that
// records no token with the model in dashboard/radar-model.js, and writes into /output (or --output, or
// MAKEFUN_OUTPUT_DIR):
//
//   board.json            the ranked board, one row per protocol, each with its working and farm plan
//   dashboard/            this repository's dashboard/ plus zz-data.js, the data the page renders
//   screenshots/          this repository's screenshots/
//   dossier.json          what the judge reads, written by the vendored make.fun library
//
// Two runs write the same bytes: nothing here reads a clock, a locale or a random number, and every
// list is written in a stated order.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, boardJson, boardRows, buildRadar, dataScript, parseSnapshot, SnapshotError } from './lib/board.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const DATA_FILE = 'zz-data.js'; // sorts after the hand-written source, so the dossier shows that whole
const DOSSIER_CAPS = { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } };

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** --name value or --name=value from the command line, else the fallback. */
function option(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const joined = args.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Copies a directory's regular files (dot-files skipped) in name order; returns the names. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from)
    .filter((name) => !name.startsWith('.') && statSync(join(from, name)).isFile())
    .sort();
  for (const name of names) copyFileSync(join(from, name), join(to, name));
  return names;
}

const input = option('input', '/input');
const snapshotFile = input.endsWith('.json') ? input : join(input, 'snapshot.json');
if (!existsSync(snapshotFile)) fail(`no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory> or mount /input`, 2);
const out = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
} catch (err) {
  if (err instanceof SnapshotError) fail(err.message, 2);
  throw err;
}

// Value every protocol, rank the ones that record no token, and hold the board to the gate before writing.
const radar = buildRadar(snapshot);
const rows = boardRows(radar);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), boardJson(radar, rows));

const pageFiles = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
writeFileSync(join(out, 'dashboard', DATA_FILE), dataScript(radar, snapshot));

const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} of the 3 images the gate asks for`);

// Last: the scorer rebuilds the dossier from this output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_CAPS));

const top = rows[0]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols read; ${radar.counts.candidate} record no token and are ranked, ` +
    `${radar.counts.priced + radar.counts.ticker + radar.counts.product} set aside; watchlist ${snapshot.watchlist.length}/${snapshot.watchlist.length} covered\n` +
    `token radar: rank 1 ${top.slug} at $${top.implied_value_usd}; wrote board.json, dashboard/ (${pageFiles.length + 1} files), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
