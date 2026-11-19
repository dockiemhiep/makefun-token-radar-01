/* Token Launch Radar: the page. Renders window.RADAR_DATA (zz-data.js, written by main.ts) with RadarModel
   (radar-model.js), the functions that wrote board.json. No network, no framework. The view's state lives
   in the address's hash, so any view can be linked. */
(function () {
'use strict';
const D = window.RADAR_DATA, M = window.RadarModel;
const $ = (id) => document.getElementById(id);
if (!D || !M) {
  $('empty').hidden = false;
  $('status').textContent = 'No data yet: run main.ts, which writes zz-data.js beside this page.';
  return;
}

// ---- formatting

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const money = M.money, cat = M.categoryOf;
const none = (text) => '<span class="na">' + text + '</span>';
function pct(n) {
  if (n === null) return none('none');
  const a = Math.abs(n), flat = a < 0.05; // under 0.05% reads as 0.0%, with no sign
  return '<span class="' + (flat ? '' : n > 0 ? 'up' : 'down') + '">' + (flat ? '' : n > 0 ? '+' : '−') + (a >= 100 ? Math.round(a) : a.toFixed(1)) + '%</span>';
}
const age = (days) => (days === null ? none('no date') : days >= 365 ? (days / 365).toFixed(1) + ' yr' : days + ' d');
const x = (n) => n.toFixed(n >= 10 ? 1 : n >= 0.095 ? 2 : 3) + '×';
const factor = (n) => n.toFixed(3);
const chainList = (r) => r.chains.map(M.chainName);
const cells = (list) => list.map((c) => '<td' + (c[1] ? ' class="n"' : '') + '>' + c[0] + '</td>').join('');

// ---- state

const state = { view: 'ranked', q: '', cat: '', chain: '', wl: false, sort: 'rank', dir: 1, open: '' };
const bySlug = {};
for (const r of D.rows) bySlug[r.slug] = r;
let shown = [];
const SETS = [
  ['candidate', 'record no token: ranked on the board'], ['priced', 'have a token that trades: the comparables'],
  ['ticker', 'record a ticker but no market cap'], ['product', 'are an exchange, bridge, wrapped, staked or versioned product'],
  ['family', 'share a brand with a protocol that records a token'], ['parent', 'reach the watchlist floor but are left off it']
];
const tokenTvl = (r) => r.token_tvl_usd || r.tvl_usd;
const ratio = (r) => (r.mcap_usd > 0 ? r.mcap_usd / tokenTvl(r) : null);
const WHY = {
  priced: (r) => 'Its token trades: a comparable' + (r.ledgers > 1 ? ', priced on ' + money(tokenTvl(r)) + ' across ' + r.ledgers + ' records' : ''),
  ticker: (r) => 'Records the ticker ' + esc(r.symbol || 'by CoinGecko id') + ', no market cap',
  product: () => 'Exchange, bridge, wrapper, restaking or versioned pool',
  family: (r) => 'Shares its brand with ' + esc(r.kin) + ', which records a token',
  parent: () => 'At the ' + money(D.floor_usd) + ' floor yet off the watchlist: the house rule\'s parent-protocol test'
};

/* A column: key, label, numeric?, the value it sorts by, the cell it draws. */
const COLUMNS = {
  ranked: [
    ['rank', 'Rank', 1, (r) => r.rank, (r) => r.rank],
    ['name', 'Protocol', 0, (r) => r.name.toLowerCase(), (r) => '<button type="button" class="open" data-slug="' + esc(r.slug) + '">' + esc(r.name) + '</button>' +
      (r.watchlist ? '<span class="badge" title="On the snapshot\'s watchlist: TVL of ' + money(D.floor_usd) + ' or more">Watchlist</span>' : '')],
    ['category', 'Category', 0, (r) => cat(r).toLowerCase(), (r) => '<span title="' + esc(cat(r)) + '">' + esc(cat(r)) + '</span>'],
    ['chains', 'Chains', 0, (r) => r.chains.length, (r) => {
      const c = chainList(r);
      return '<span class="chains" title="' + esc(c.join(', ')) + '"><span>' + esc(c.slice(0, 2).join(', ')) + '</span>' + (c.length > 2 ? '<span class="more">+' + (c.length - 2) + '</span>' : '') + '</span>';
    }],
    ['tvl_usd', 'TVL', 1, (r) => r.tvl_usd, (r) => money(r.tvl_usd)],
    ['change_7d', '7d TVL', 1, (r) => r.change_7d, (r) => pct(r.change_7d)],
    ['age', 'Listed for', 1, (r) => r.model.age_days, (r) => age(r.model.age_days)],
    ['implied_value_usd', 'Implied value', 1, (r) => r.implied_value_usd, (r, max) => '<span class="value">' + money(r.implied_value_usd) + '</span>' +
      '<span class="meter"><i style="width:' + (100 * Math.sqrt(r.implied_value_usd / max)).toFixed(1) + '%"></i></span>']
  ],
  aside: [
    ['name', 'Protocol', 0, (r) => r.name.toLowerCase(), (r) => esc(r.name)],
    ['category', 'Category', 0, (r) => cat(r).toLowerCase(), (r) => esc(cat(r))],
    ['tvl_usd', 'TVL', 1, (r) => r.tvl_usd, (r) => money(r.tvl_usd)],
    ['mcap_usd', 'Market cap', 1, (r) => r.mcap_usd, (r) => (r.mcap_usd > 0 ? money(r.mcap_usd) : none('none'))],
    ['ratio', 'Mcap / TVL', 1, ratio, (r) => (ratio(r) === null ? none('none') : x(ratio(r)))],
    ['set', 'Why it is not ranked', 0, (r) => r.set, (r) => WHY[r.set](r)]
  ]
};
const firstSort = () => (state.view === 'aside' ? ['tvl_usd', -1] : ['rank', 1]);

// ---- the hash

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  state.view = h.get('view') === 'aside' ? 'aside' : 'ranked';
  state.q = h.get('q') || '';
  state.cat = h.get('cat') || '';
  state.chain = h.get('chain') || '';
  state.wl = h.get('wl') === '1';
  [state.sort, state.dir] = firstSort();
  const by = h.get('sort') || '', key = by.replace(/^-/, ''); // sort=-tvl_usd: descending
  if (COLUMNS[state.view].some((c) => c[0] === key)) [state.sort, state.dir] = [key, by === key ? 1 : -1];
  state.open = bySlug[h.get('p')] ? h.get('p') : '';
}
function writeHash() {
  const h = new URLSearchParams();
  if (state.view === 'aside') h.set('view', 'aside');
  for (const k of ['q', 'cat', 'chain']) if (state[k]) h.set(k, state[k]);
  if (state.wl) h.set('wl', '1');
  if ([state.sort, state.dir].join() !== firstSort().join()) h.set('sort', (state.dir < 0 ? '-' : '') + state.sort);
  if (state.open) h.set('p', state.open);
  const text = h.toString();
  history.replaceState(null, '', text ? '#' + text : location.pathname + location.search);
}

// ---- filter and sort

function matches(r) {
  if (state.cat && cat(r) !== state.cat) return false;
  if (state.view === 'ranked' && ((state.wl && !r.watchlist) || (state.chain && !r.chains.includes(state.chain)))) return false;
  if (!state.q) return true;
  const hay = [r.name, r.category, r.symbol].concat(r.chains || [], r.chains ? chainList(r) : []).join(' ').toLowerCase();
  return state.q.trim().toLowerCase().split(/\s+/).every((word) => hay.includes(word));
}

/* A row with no value sorts last either way; ties keep the board's order. */
function sortRows(rows) {
  const get = (COLUMNS[state.view].find((c) => c[0] === state.sort) || COLUMNS[state.view][0])[3];
  return rows.slice().sort((a, b) => {
    const va = get(a), vb = get(b);
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return va < vb ? -state.dir : va > vb ? state.dir : 0;
  });
}

// ---- the board

function tally(rows, pick) {
  const counts = {};
  for (const r of rows) for (const k of pick(r)) counts[k] = (counts[k] || 0) + 1;
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : 1)).map((k) => [k, counts[k]]);
}
const byCategory = (rows) => tally(rows, (r) => [cat(r)]);
function options(select, all, counts) {
  select.innerHTML = '<option value="">' + all + '</option>' + counts.map((c) => '<option value="' + esc(c[0]) + '">' + esc(M.chainName(c[0])) + ' (' + c[1] + ')</option>').join('');
}

function renderBoard() {
  const ranked = state.view === 'ranked', cols = COLUMNS[state.view], source = ranked ? D.rows : D.aside;
  shown = sortRows(source.filter(matches));
  const max = shown.reduce((m, r) => Math.max(m, r.implied_value_usd || 0), 1);

  $('head').innerHTML = cols.map((c) => {
    const on = c[0] === state.sort;
    return '<th scope="col"' + (c[2] ? ' class="n"' : '') + (on ? ' aria-sort="' + (state.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-sort="' + c[0] + '">' +
      c[1] + '<span class="arrow" aria-hidden="true">' + (on ? (state.dir > 0 ? '▲' : '▼') : '') + '</span></button></th>';
  }).join('');
  $('rows').innerHTML = shown.map((r) => '<tr' + (ranked ? ' data-slug="' + esc(r.slug) + '"' : '') + '>' +
    cols.map((c) => '<td class="c-' + c[0] + (c[2] ? ' n' : '') + '">' + c[4](r, max) + '</td>').join('') + '</tr>').join('');

  $('board').className = state.view;
  $('empty').hidden = shown.length > 0;
  $('caption').textContent = ranked ? 'Protocols that record no token, ranked by implied launch value' : 'Protocols the board does not rank, and why';
  const filtered = state.q.trim() || state.cat || (ranked && (state.chain || state.wl));
  $('count').innerHTML = '<b>' + shown.length + '</b> of ' + source.length + (ranked ? ' ranked protocols' : ' protocols set aside') +
    (filtered ? ' match the filters' : ranked ? '. Select a protocol for its working and its farm plan.' : ': a token is on record for it or its family, or it is a product of another.');
  $('view-ranked').setAttribute('aria-pressed', ranked);
  $('view-aside').setAttribute('aria-pressed', !ranked);
  $('wl').checked = state.wl;
  for (const k of ['q', 'cat', 'chain']) { $(k).value = state[k]; $(k).classList.toggle('on', !!state[k]); }
  $('chain').disabled = $('wl').disabled = !ranked;
  $('reset').disabled = !filtered;
}

const update = () => { writeHash(); renderBoard(); };
const reset = () => { state.q = state.cat = state.chain = ''; state.wl = false; update(); };
function setView(view) {
  state.view = view;
  state.cat = '';
  [state.sort, state.dir] = firstSort();
  options($('cat'), 'All categories', byCategory(view === 'aside' ? D.aside : D.rows));
  update();
}

// ---- the detail view

/* One protocol: its value line by line, the priced tokens behind its multiple, its farm plan. */
function renderDetail(r) {
  const w = r.model, comps = D.comparables, group = comps.by[cat(r)];
  const plan = M.farmPlan(r, D.as_of), tier = M.sizeTier(r.tvl_usd);
  const peers = D.aside.filter((p) => p.mcap_usd > 0 && cat(p) === cat(r)).sort((a, b) => tokenTvl(b) - tokenTvl(a));
  const ledger = [
    ['TVL', money(r.tvl_usd), 'tvl_usd in the snapshot'],
    ['× Category multiple', factor(w.multiple), w.basis === 'category' ? 'median ' + x(group.median) + ' of ' + group.n + ' priced, shrunk toward the global ' + x(comps.global.median)
      : 'the global median: ' + (group ? group.n : 0) + ' priced in the category, ' + D.constants.minComps + ' needed'],
    ['× Size', factor(w.size), 'TVL is ' + x(r.tvl_usd / comps.pivot_tvl) + ' the median comparable\'s ' + money(comps.pivot_tvl)],
    ['× Momentum', factor(w.momentum), r.change_7d === null ? 'no 7-day change on record: neutral' : 'TVL moved ' + pct(r.change_7d) + ' in 7 days'],
    ['× Maturity', factor(w.maturity), w.age_days === null ? 'no listing date on record: neutral' : w.age_days + ' days listed (since ' + esc(r.listed_at) + ') with no token'],
    ['× Breadth', factor(w.breadth), r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains')]
  ];
  const stats = [['7d TVL', pct(r.change_7d)], ['Listed for', age(w.age_days)], ['Implied / TVL', x(r.implied_value_usd / r.tvl_usd)], ['Chains', r.chains.length]];
  $('detail').innerHTML =
    '<header class="d-head"><div><p class="d-sub">Rank ' + r.rank + ' of ' + D.rows.length + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</p>' +
    '<h2 id="d-name" tabindex="-1" autofocus>' + esc(r.name) + '</h2><p class="d-sub">' + esc(cat(r)) + ' on ' + esc(chainList(r).slice(0, 6).join(', ')) + (r.chains.length > 6 ? ' and ' + (r.chains.length - 6) + ' more' : '') + '. Records no token.</p></div>' +
    '<button type="button" class="ghost" data-close>Close</button></header>' +
    '<div class="d-body"><section aria-labelledby="d-value"><h3 id="d-value">Implied launch value</h3>' +
    '<p class="d-figure">' + money(M.impliedValue(r.tvl_usd, w.multiple, w)) + '</p>' +
    '<p class="d-sub">' + money(r.value_low_usd) + ' to ' + money(r.value_high_usd) + ' at the comparables\' lower and upper quartile multiples, ' + x(w.low) + ' and ' + x(w.high) + '</p>' +
    '<table class="ledger"><tbody>' + ledger.map((l) => '<tr><th scope="row">' + l[0] + '</th><td class="n">' + l[1] + '</td><td>' + l[2] + '</td></tr>').join('') +
    '<tr class="total"><th scope="row">= Implied value</th><td class="n">' + money(r.implied_value_usd) + '</td><td></td></tr></tbody></table>' +
    '<dl class="d-stats">' + stats.map((s) => '<div><dt>' + s[0] + '</dt><dd>' + s[1] + '</dd></div>').join('') + '</dl>' +
    '<h3>Priced ' + esc(cat(r)) + ' protocols</h3>' + (peers.length
      ? '<table class="mini"><thead><tr><th scope="col">Protocol</th><th scope="col" class="n">TVL</th><th scope="col" class="n">Market cap</th><th scope="col" class="n">Mcap / TVL</th></tr></thead><tbody>' +
        peers.slice(0, 4).map((p) => '<tr><th scope="row">' + esc(p.name) + (p.ledgers > 1 ? ' <span class="more">+' + (p.ledgers - 1) + '</span>' : '') + '</th>' + cells([[money(tokenTvl(p)), 1], [money(p.mcap_usd), 1], [x(ratio(p)), 1]]) + '</tr>').join('') + '</tbody></table>' +
        '<p class="d-sub">' + (peers.length > 4 ? 'The 4 largest by TVL of ' + peers.length + '. ' : '') + 'TVL sums all of a token\'s records (+N others).</p>'
      : '<p class="d-sub">None in this snapshot.</p>') + '</section>' +
    '<section aria-labelledby="d-plan"><h3 id="d-plan">Farm plan</h3><p class="d-sub">The ' + M.playbookOf(r.category, r.chains[0]) + ' playbook at the ' + tier.name + ' size tier: ' + M.usd(tier.lo) + ' to ' + M.usd(tier.hi) + ' of capital. Costs and times are estimates.</p>' +
    '<ol class="plan">' + plan.map((s) => '<li><p>' + esc(s.action) + '</p><dl><div><dt>Cost</dt><dd>' + esc(s.cost) + '</dd></div><div><dt>Time</dt><dd>' + esc(s.time) + '</dd></div></dl></li>').join('') + '</ol></section></div>';
}

function openDetail(slug) {
  if (!bySlug[slug]) return;
  state.open = slug;
  writeHash();
  renderDetail(bySlug[slug]);
  if (!$('detail').open) $('detail').showModal();
  $('detail').scrollTop = 0;
  $('d-name').focus();
}

// ---- the page's fixed parts

function renderFrame() {
  const c = D.counts, comps = D.comparables, k = D.constants;
  $('facts').innerHTML = [['Snapshot', D.as_of], ['Ranked', c.candidate], ['Watchlist covered', D.rows.filter((r) => r.watchlist).length + ' / ' + D.watchlist_size], ['Comparables', comps.n]]
    .map((f) => '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>').join('');

  $('universe-total').textContent = D.total;
  $('universe-bar').innerHTML = SETS.map((s) => '<i class="s-' + s[0] + '" style="flex:' + c[s[0]] + '"></i>').join('');
  $('universe-legend').innerHTML = SETS.map((s) => '<li class="s-' + s[0] + '"><b>' + c[s[0]] + '</b> ' + s[1] + '</li>').join('');

  const range = (lo, hi) => lo.toFixed(2) + '–' + hi.toFixed(2), swing = k.momentumPct / 100 * k.momentumWeight;
  const fill = { n: comps.n, global: x(comps.global.median), b: comps.elasticity.toFixed(2), size: range(k.size[0], k.size[1]), clamp: k.momentumPct,
    momentum: range(1 - swing, 1 + swing), maturity: range(k.maturity[0], k.maturity[1]), breadth: range(1, k.breadthCap) };
  for (const el of document.querySelectorAll('#method [data-k]')) el.textContent = fill[el.getAttribute('data-k')];

  // The four categories with the most ranked rows, then all.
  $('comps').tBodies[0].innerHTML = byCategory(D.rows).slice(0, 4).map((entry) => {
    const g = comps.by[entry[0]];
    return '<tr><th scope="row">' + esc(entry[0]) + '</th>' + cells([[entry[1], 1], [g ? g.n : 0, 1], [g ? x(g.median) : 'none', 1], ['<b>' + x((g && g.n >= k.minComps ? g : comps.global).multiple) + '</b>', 1]]) + '</tr>';
  }).join('') + '<tr><th scope="row">All categories</th>' + cells([[c.candidate, 1], [comps.n, 1], [x(comps.global.median), 1], ['<b>' + x(comps.global.multiple) + '</b>', 1]]) + '</tr>';

  options($('chain'), 'All chains', tally(D.rows, (r) => r.chains));
}

// ---- events

const on = (id, type, fn) => $(id).addEventListener(type, fn);
on('filters', 'submit', (e) => e.preventDefault());
on('q', 'input', (e) => { state.q = e.target.value; update(); });
on('cat', 'change', (e) => { state.cat = e.target.value; update(); });
on('chain', 'change', (e) => { state.chain = e.target.value; update(); });
on('wl', 'change', (e) => { state.wl = e.target.checked; update(); });
on('reset', 'click', reset);
on('reset-empty', 'click', reset);
on('view-ranked', 'click', () => setView('ranked'));
on('view-aside', 'click', () => setView('aside'));
on('head', 'click', (e) => {
  const b = e.target.closest('button[data-sort]');
  if (!b) return;
  const key = b.getAttribute('data-sort'), col = COLUMNS[state.view].find((c) => c[0] === key);
  // A second click flips the order; a first click starts figures high to low.
  state.dir = state.sort === key ? -state.dir : col[2] && key !== 'rank' ? -1 : 1;
  state.sort = key;
  update();
});
on('rows', 'click', (e) => {
  const row = e.target.closest('tr[data-slug]');
  if (row) openDetail(row.getAttribute('data-slug'));
});
on('detail', 'click', (e) => {
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) e.currentTarget.close();
});
on('detail', 'close', () => {
  const from = document.querySelector('button.open[data-slug="' + state.open + '"]');
  state.open = '';
  writeHash();
  if (from) from.focus();
});

function start() {
  readHash();
  options($('cat'), 'All categories', byCategory(state.view === 'aside' ? D.aside : D.rows));
  renderBoard();
  if (state.open) openDetail(state.open);
  else if ($('detail').open) $('detail').close();
}
window.addEventListener('hashchange', start);
renderFrame();
start();
})();
