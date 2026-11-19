/* Token Launch Radar: the model.
   One file, run in two places. main.ts imports it to write board.json; the page loads it to show each
   row's working and to write its farm plan. Every figure comes from the snapshot: no protocol is named
   in this file and no value is set by hand. */
(function (root) {
  'use strict';

  /* The model's constants, each stated on the page. */
  const K = {
    minComps: 3,           // a category needs 3 priced protocols before its own multiple is used
    prior: 4,              // its median is then shrunk toward the global one as if 4 more comparables sat there
    winsor: [0.1, 0.9],    // multiples outside the comparables' 10th-90th percentile are pulled to the edge
    sizeWeight: 0.5,       // half of the measured size discount is applied: category mix inflates the raw slope
    size: [0.35, 1.5],     // bounds of the size factor
    momentumPct: 30,       // 7-day TVL change is clamped to +/-30% ...
    momentumWeight: 0.5,   // ... and half of it moves the value: 0.85 to 1.15
    maturity: [0.8, 1.2],  // listed today 0.8, listed 3 years or more 1.2
    maturityDays: 1095,
    breadthStep: 0.03,     // +3% for each doubling of the chain count ...
    breadthCap: 1.15       // ... up to 1.15
  };

  const asc = (a, b) => a - b;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const round4 = (x) => Math.round(x * 1e4) / 1e4;
  const categoryOf = (p) => p.category || 'Uncategorised';

  /* The q-quantile of an ascending list, linear between neighbours. */
  function quantile(sorted, q) {
    const at = (sorted.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
  }

  /* Geometric shrinkage: n observations at `value`, K.prior pseudo-observations at `global`. */
  const shrink = (n, value, global) => Math.exp((n * Math.log(value) + K.prior * Math.log(global)) / (n + K.prior));

  /* ---- who is ranked ---- */

  const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;
  const CUSTODY = ['Bridge', 'Canonical Bridge', 'CEX', 'Liquid Restaking', 'Liquid Staking', 'Restaked BTC'];

  /* Sorts a protocol into one of four sets. Only `candidate` is ranked.
     priced     its token trades: it records a market cap, and it is a comparable
     ticker     it records a ticker or a CoinGecko id but no market cap: a token is on record
     product    an exchange, a bridge, a wrapped or staked product, or a versioned pool of another protocol
     candidate  it records no token at all: the launches still to come */
  function classify(p) {
    if (p.mcap_usd > 0) return 'priced';
    if (p.mcap_usd !== null || p.symbol !== null || p.gecko_id !== null) return 'ticker'; // a market cap of 0 or less prices nothing
    if (CUSTODY.includes(p.category) || VERSIONED.test(p.name) || WRAPPER_WORD.test(p.name)) return 'product';
    return 'candidate';
  }

  /* ---- comparables ---- */

  /* Market-cap / TVL multiples of the protocols whose token trades, by category.
     Fallback chain for a pre-token protocol's multiple:
       1. its category has K.minComps comparables or more: the category median, shrunk toward the global median (K.prior)
       2. its category has fewer: the global median, since one or two protocols are not a market
     The same shrinkage gives each category a low and a high multiple from its quartiles. */
  function comparables(protocols) {
    const priced = protocols.filter((p) => p.mcap_usd > 0 && p.tvl_usd > 0);
    const raw = priced.map((p) => p.mcap_usd / p.tvl_usd).sort(asc);
    const lo = quantile(raw, K.winsor[0]), hi = quantile(raw, K.winsor[1]);
    const groups = {}, all = [];
    for (const p of priced) {
      const m = clamp(p.mcap_usd / p.tvl_usd, lo, hi);
      all.push(m);
      (groups[categoryOf(p)] = groups[categoryOf(p)] || []).push(m);
    }
    all.sort(asc);
    const g = { low: quantile(all, 0.25), median: quantile(all, 0.5), high: quantile(all, 0.75) };
    const by = {};
    for (const cat of Object.keys(groups).sort()) {
      const list = groups[cat].sort(asc), n = list.length;
      by[cat] = {
        n: n,
        median: round4(quantile(list, 0.5)),
        multiple: round4(shrink(n, quantile(list, 0.5), g.median)),
        low: round4(shrink(n, quantile(list, 0.25), g.low)),
        high: round4(shrink(n, quantile(list, 0.75), g.high))
      };
    }
    return {
      n: all.length,
      global: { n: all.length, median: round4(g.median), multiple: round4(g.median), low: round4(g.low), high: round4(g.high) },
      by: by,
      elasticity: round4(sizeElasticity(priced)),
      pivot_tvl: Math.round(quantile(priced.map((p) => p.tvl_usd).sort(asc), 0.5))
    };
  }

  /* How market cap scales with TVL across the comparables: the slope b of ln(mcap) on ln(TVL).
     b < 1: a protocol ten times larger is worth less than ten times more. Kept inside 0.3..1. */
  function sizeElasticity(priced) {
    const n = priced.length;
    let mx = 0, my = 0, sxy = 0, sxx = 0;
    for (const p of priced) { mx += Math.log(p.tvl_usd) / n; my += Math.log(p.mcap_usd) / n; }
    for (const p of priced) {
      const dx = Math.log(p.tvl_usd) - mx;
      sxy += dx * (Math.log(p.mcap_usd) - my);
      sxx += dx * dx;
    }
    return sxx > 0 ? clamp(sxy / sxx, 0.3, 1) : 1;
  }

  /* ---- implied value ---- */

  /* Whole days from listed_at to the snapshot's date; null when the snapshot gives no date. */
  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    const days = Math.floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listedAt + 'T00:00:00Z')) / 86400000);
    return days >= 0 ? days : null;
  }

  /* The working behind one protocol's implied value:
       implied = TVL x multiple x size x momentum x maturity x breadth
     Every factor is bounded, so the value stays a multiple of TVL the comparables support. */
  function working(p, comps, asOf) {
    const own = comps.by[categoryOf(p)], cat = own && own.n >= K.minComps ? own : null, basis = cat || comps.global;
    const age = ageDays(asOf, p.listed_at);
    const change = p.change_7d === null ? 0 : clamp(p.change_7d, -K.momentumPct, K.momentumPct);
    return {
      multiple: basis.multiple,
      low: basis.low,
      high: basis.high,
      basis: cat ? 'category' : 'global',
      comps: basis.n,
      // size: (TVL / median comparable TVL) ^ ((b - 1) x sizeWeight), bounded
      size: round4(clamp(Math.pow(p.tvl_usd / comps.pivot_tvl, (comps.elasticity - 1) * K.sizeWeight), K.size[0], K.size[1])),
      // momentum: half of the clamped 7-day change; no change on record is neutral
      momentum: round4(1 + (change / 100) * K.momentumWeight),
      // maturity: the longer it has run with no token, the stronger its launch claim; no date is neutral
      maturity: age === null ? 1 : round4(K.maturity[0] + (K.maturity[1] - K.maturity[0]) * Math.min(age, K.maturityDays) / K.maturityDays),
      // breadth: more chains, more users a launch reaches
      breadth: round4(Math.min(K.breadthCap, 1 + K.breadthStep * Math.log2(Math.max(1, p.chains.length)))),
      age_days: age
    };
  }

  /* The implied value in whole dollars for a multiple and a row's factors: the one formula. */
  const impliedValue = (tvl, multiple, w) => Math.max(1, Math.round(tvl * multiple * w.size * w.momentum * w.maturity * w.breadth));

  /* ---- the radar ---- */

  /* The whole radar from a snapshot: comparables, the ranked board, and the protocols set aside. */
  function buildRadar(snapshot) {
    const comps = comparables(snapshot.protocols);
    const watch = new Set(snapshot.watchlist);
    const rows = [], aside = [], counts = { priced: 0, ticker: 0, product: 0, candidate: 0 };
    for (const p of snapshot.protocols) {
      // The watchlist is the floor: a slug on it is ranked whatever classify() says of it.
      const set = watch.has(p.slug) ? 'candidate' : classify(p);
      counts[set]++;
      if (set !== 'candidate') {
        aside.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, symbol: p.symbol, set: set });
        continue;
      }
      const w = working(p, comps, snapshot.as_of);
      rows.push({
        rank: 0, slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
        change_7d: p.change_7d, listed_at: p.listed_at, watchlist: watch.has(p.slug),
        implied_value_usd: impliedValue(p.tvl_usd, w.multiple, w),
        value_low_usd: impliedValue(p.tvl_usd, w.low, w),
        value_high_usd: impliedValue(p.tvl_usd, w.high, w),
        model: w
      });
    }
    // Stable orders: value, then TVL, then slug.
    const bySlug = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || bySlug(a, b));
    rows.forEach((r, i) => { r.rank = i + 1; });
    aside.sort((a, b) => b.tvl_usd - a.tvl_usd || bySlug(a, b));
    return { as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, total: snapshot.protocols.length, counts: counts, constants: K, comparables: comps, rows: rows, aside: aside };
  }

  /* ---- farm plans ---- */

  /* Dollars as text: $1,250, or cents under a dollar ($0.60). No locale: the same bytes everywhere. */
  function usd(n) {
    if (n < 1) return '$' + n.toFixed(2);
    return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ',');
  }
  /* Dollars at a glance: $2.75B, $543.6M, $12.4K. */
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    return n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n);
  }

  /* Per chain: the token that pays fees and a typical fee for one transaction in dollars. Estimates, and
     the plan says so. A chain not listed here pays about $0.10 in its own gas token. */
  const GAS = {
    Ethereum: ['ETH', 4], Arbitrum: ['ETH', 0.15], Base: ['ETH', 0.05], Optimism: ['ETH', 0.05], Ink: ['ETH', 0.03],
    Binance: ['BNB', 0.2], Solana: ['SOL', 0.01], Bitcoin: ['BTC', 2], Avalanche: ['AVAX', 0.1], Polygon: ['POL', 0.02],
    'Hyperliquid L1': ['HYPE', 0.05], Monad: ['MON', 0.02], Tron: ['TRX', 1.5], Sui: ['SUI', 0.01], Plasma: ['XPL', 0.02],
    Ripple: ['XRP', 0.01], Mantle: ['MNT', 0.03], Stellar: ['XLM', 0.01], Flare: ['FLR', 0.02], Algorand: ['ALGO', 0.01],
    Bittensor: ['TAO', 0.01]
  };
  const CHAIN_NAME = { Binance: 'BNB Chain', Ripple: 'XRP Ledger', 'Hyperliquid L1': 'Hyperliquid' };
  const BTC_CHAIN = /^(Bitcoin|RSK|CORE|Mezo|BSquared|Citrea|Stacks)$/;
  const chainName = (c) => CHAIN_NAME[c] || c;
  const gasOf = (c) => GAS[c] || ['its gas token', 0.1];

  /* The capital range a position gets, from the protocol's own TVL. */
  function sizeTier(tvl) {
    if (tvl >= 1e9) return { name: 'deep', lo: 2000, hi: 10000 };
    if (tvl >= 2.5e8) return { name: 'large', lo: 1000, hi: 5000 };
    if (tvl >= 5e7) return { name: 'mid', lo: 500, hi: 2500 };
    if (tvl >= 1.5e7) return { name: 'small', lo: 250, hi: 1000 };
    return { name: 'thin', lo: 100, hi: 500 };
  }

  /* Category to playbook, first match wins; a third entry is the first chain the match also needs. None matching: the yield playbook.
     Only 'lending' borrows: a vault that delegates does not lend. */
  const PLAYBOOK_OF = [
    [/payment/i, 'payment channel', /^Bitcoin$/], [/dex/i, 'subnet pool', /^Bittensor$/], [/collateral market|restak/i, 'delegation'],
    [/insurance/i, 'cover'], [/prediction/i, 'prediction'], [/uncollateral|leveraged|yield|basis|cedefi|index/i, 'yield'],
    [/lend|cdp/i, 'lending'], [/curator|allocator/i, 'curated vault'], [/dex|liquidity|farm/i, 'liquidity'],
    [/deriv|option|synthetic|otc/i, 'trading'], [/rwa|stable|reserve/i, 'asset'], [/stak|btc|governance|locker/i, 'staking'],
    [/chain|bridge|launchpad|privacy|payment|card/i, 'network']
  ];
  const playbookOf = (category, chain) => (PLAYBOOK_OF.find((p) => p[0].test(category || '') && (!p[2] || p[2].test(chain))) || [0, 'yield'])[1];

  /* "about <fees for n transactions> in fees", alone and after "<range> of capital and"; the two commonest times. */
  const fees = (c, txs) => 'about ' + usd(c.fee * txs) + ' in fees';
  const capital = (c, txs) => c.range + ' of capital and ' + fees(c, txs);
  const ONCE = '15 minutes, once', WEEKLY = '10 minutes a week';

  /* Each playbook: the two steps that are the category's own work, as [action, cost, time]. c is the row's context. */
  const PLAYBOOKS = {
    lending: (c) => [
      ['Supply ' + c.range + ' of ' + c.asset + ' to ' + c.name + "'s largest market on " + c.chain + '. ' + c.depth, capital(c, 2) + ' to approve and deposit', ONCE],
      [(c.cdp ? 'Mint ' + c.name + "'s stablecoin against it, to 20-30% of the collateral's value, and use it on " + c.chain + '. Repay and mint'
        : 'Borrow 20-30% of the supplied value from ' + c.name + ' in a different asset and keep the health factor above 2.0. Repay and borrow') + ' again once a month.',
      'about ' + usd(c.lo * 0.25 * 0.08 / 12) + '-' + usd(c.hi * 0.25 * 0.08 / 12) + ' of interest a month at an assumed 8% APR, plus ' + usd(c.fee * 2) + ' in fees per cycle', '15 minutes a month']
    ],
    delegation: (c) => [
      ['Pick one ' + c.name + ' vault on ' + c.chain + ' and deposit ' + c.range + ' of the single collateral asset it holds: the vault delegates it to operators. ' + c.depth, capital(c, 2) + '; an operator\'s fault can slash the stake', '20 minutes, once'],
      ['In week two test ' + c.name + "'s exit with a small amount: request a withdrawal, wait for the vault's next epoch to end (it stays slashable until then), then claim.", fees(c, 2) + ' to request and claim', '15 minutes, over two epochs']
    ],
    cover: (c) => [
      ['Stake ' + c.range + ' of ' + c.asset + ' in ' + c.name + "'s vault on " + c.chain + ' and keep ' + (c.fxrp ? 'the stXRP' : 'the receipt token') + ' it mints: its rate moves, and a paid cover claim can cut the stake. ' + c.depth, capital(c, 2) + ' to approve and stake', '20 minutes, once'],
      ['Find ' + c.name + "'s unstaking window and test it with a small amount before adding more: a cover vault can hold stake for a coverage period of 30 days or more.", fees(c, 2), ONCE]
    ],
    'curated vault': (c) => [
      ['Deposit ' + c.range + ' of ' + c.asset + ' into ' + c.name + "'s largest vault on " + c.chain + ', through the lending app that hosts it, and keep the shares in the same wallet. ' + c.depth, capital(c, 2) + '; the curator takes a performance fee', ONCE],
      ['After two weeks move a quarter of the position into a second ' + c.name + ' vault with a different collateral mix; read that vault\'s withdrawal liquidity first.', fees(c, 3), ONCE]
    ],
    yield: (c) => [
      ['Deposit ' + c.range + ' of ' + c.asset + ' into ' + c.name + "'s main strategy on " + c.chain + ' and hold the receipt token it returns. ' + c.depth, capital(c, 2) + '; check for a deposit or exit fee, often 0-0.5%', ONCE],
      ['Find the redemption cooldown or queue in ' + c.name + "'s app and test it with a small withdrawal in week two; then leave the rest in place: time in the strategy is what a points programme usually counts.", fees(c, 2) + ', and yield forgone during the cooldown', ONCE]
    ],
    liquidity: (c) => [
      ['Add ' + c.range + ' of liquidity to ' + c.name + ' on ' + c.chain + ', in ' + c.pair + '; on a concentrated pool pick a wide range. ' + c.depth, capital(c, 3) + '; assume 1-3% of impermanent loss over 90 days', '20 minutes, once'],
      ['Route 3-5 swaps of $50-$200 through ' + c.name + ' each week, on different days.', 'pool fee of 0.05-0.3% a swap (about $0.03-$0.60 each) plus ' + usd(c.fee) + ' of network fee', WEEKLY]
    ],
    'subnet pool': (c) => [
      ['Choose one subnet on ' + c.name + ': its pool pairs TAO with that subnet\'s alpha token. Stake ' + c.range + ' of TAO there, which swaps it for alpha through the pool. Adding a liquidity position needs user liquidity enabled on that subnet; it is off by default. ' + c.depth, capital(c, 2) + '; a large stake moves the price, so split it', '25 minutes, once'],
      ['Each week swap $50-$200 of TAO into the alpha of a second, then a third ' + c.name + ' subnet, on different days. Alpha is priced in TAO and swings hard.', 'slippage on each swap plus ' + usd(c.fee) + ' of network fee', WEEKLY]
    ],
    trading: (c) => [
      ['Deposit ' + c.range + ' of USDC as margin or trading balance on ' + c.name + ' (' + c.chain + '). ' + c.depth, capital(c, 2) + ' to deposit', ONCE],
      ['Trade 2-3 times a week in ' + c.name + "'s most liquid market at 1-2x leverage, or hold a small hedged pair: volume without a directional bet.", 'taker fees near 0.05% a side, about $1 per $1,000 traded round trip, plus funding on open positions', '15 minutes a session']
    ],
    prediction: (c) => [
      ['Deposit ' + c.range + ' of ' + c.asset + ' on ' + c.name + ' (' + c.chain + ') and take small positions in 3-5 outcome markets that resolve on different dates; hold at least one to resolution. ' + c.depth, capital(c, 2) + '; a share on the losing outcome pays nothing', '30 minutes, once'],
      ['Each week rest limit orders on both sides of one busy ' + c.name + ' market to provide liquidity. Read its rules and resolution source first: a disputed outcome can lock a position or resolve against you.', 'the spread you quote, plus any taker fee', '15 minutes a session']
    ],
    asset: (c) => [
      ['Read ' + c.name + "'s eligibility rules first (issuers often require KYC or exclude some countries), then mint or buy " + c.range + ' of its asset on ' + c.chain + '. ' + c.depth, capital(c, 2) + ', and a mint or swap spread of roughly 0.1-0.5% (' + usd(c.lo * 0.001) + '-' + usd(c.hi * 0.005) + ')', '20 minutes, or a few days where KYC applies'],
      ['Hold ' + c.name + "'s asset in your own wallet and, where a lending market or pool on " + c.chain + ' lists it, put up to half to work there.', fees(c, 3), '20 minutes, once']
    ],
    staking: (c) => [
      ['Stake, lock or deposit ' + c.range + ' of the asset ' + c.name + ' accepts on ' + c.chain + ' and keep the receipt token or position in that wallet. ' + c.depth, capital(c, 2) + '; note the lock or unbonding delay before you commit', ONCE],
      ['Stay in ' + c.name + ' through at least three reward periods; claim or compound monthly and cast any vote the position carries each epoch.', fees(c, 1) + ' per claim or vote', '10 minutes a month']
    ],
    network: (c) => [
      ['Move ' + c.range + ' of ' + c.asset + ' to ' + c.name + (c.name === c.chain ? '' : ' on ' + c.chain) + ' and ' + c.use + ': 5-10 transactions in the first week. ' + c.depth, capital(c, 10), '30 minutes in week one'],
      ['Return to ' + c.name + ' each week to ' + c.use + ' 2-3 more times, on different days, and leave a balance on ' + c.chain + ' between visits: funds at rest count as well as traffic.', fees(c, 3) + ' a week', WEEKLY]
    ],
    'payment channel': (c) => [
      ['Open a payment channel of ' + c.range + ' from that wallet to a well-connected ' + c.name + ' node: one on-chain Bitcoin transaction, usable after about three confirmations. Start low: funds leave a channel only as payments or by closing it.', c.range + ' of capital locked in the channel and about ' + usd(c.onchain) + ' of on-chain fee to open, once, and again to close', '30-60 minutes, once'],
      ['Pay 5-10 invoices over ' + c.name + ' in the first week, then 2-3 a week: paste each invoice into the wallet, which routes the payment through other nodes\' channels.', 'routing fees in parts per million (ppm) of the amount: about ' + usd(c.fee) + ' on $20 at an assumed 1,000 ppm', WEEKLY]
    ]
  };

  /* A row's farm plan: seven steps of {action, cost, time}, each naming the protocol and written from its own category,
     chains, TVL, 7-day change and age: set up, read first, the playbook's two steps, breadth, the weekly cadence, the exit. */
  function farmPlan(row, asOf) {
    const tier = sizeTier(row.tvl_usd), chains = row.chains.length ? row.chains : ['its main chain'];
    const first = chains[0], gas = gasOf(first), n = chains.length, cat = row.category || '';
    const play = playbookOf(cat, first), ln = play === 'payment channel', fxrp = first === 'Flare', cdp = /cdp/i.test(cat);
    // A routed Lightning payment pays a routing fee, not the chain's fee.
    const fee = ln ? 0.02 : gas[1], tvl = money(row.tvl_usd);
    const c = {
      name: row.name, chain: chainName(first), chain2: chainName(chains[1]), lo: tier.lo, hi: tier.hi,
      range: usd(tier.lo) + '-' + usd(tier.hi), fee: fee, onchain: gas[1], cdp: cat === 'CDP', fxrp: fxrp,
      asset: cdp ? 'a collateral asset it accepts' : BTC_CHAIN.test(first) ? 'BTC or its wrapped form'
        : fxrp ? 'FXRP (XRP wrapped onto Flare through FAssets)' : "USDC or the chain's main stablecoin",
      pair: (GAS[first] ? 'the ' + gas[0] + '/stablecoin pair' : 'a stablecoin pair') + ' or whichever pool is deepest',
      use: /card/i.test(cat) ? 'pay with its card' : /bridge/i.test(cat) ? 'send transfers through it' : 'swap, transfer and stake on it',
      // TVL is a protocol total, not what one vault can pay out: the plan never promises an exit.
      depth: tier.lo >= 1000 ? 'The snapshot\'s ' + tvl + ' of TVL is ' + row.name + "'s total" + (n > 1 ? ' across ' + n + ' chains' : '') + ', not what one vault, pool or market holds: check the withdrawable liquidity or utilisation of the one you choose before sizing the deposit.'
        : tier.name === 'thin' ? 'TVL is only ' + tvl + ': stay at the low end and expect slippage on the way out.'
          : 'At ' + tvl + ' of TVL, start low in the range and add once a withdrawal has worked.'
    };
    const gasBudget = Math.max(5, Math.round(fee * 12));
    const list = chains.slice(0, 3).map(chainName).join(', ') + (n > 3 ? ' and ' + (n - 3) + ' more' : '');
    const steps = [
      [(ln ? 'Install a self-custodial Lightning wallet that opens its own channels, fund its on-chain address and keep' : 'Set up a wallet that supports ' + c.chain + ' and keep') + ' about ' + usd(gasBudget) + ' of ' + gas[0] + ' in it for fees. ' + c.name + ' records TVL on ' + (n === 1 ? '1 chain' : n + ' chains (' + list + ')') + '; start on ' + c.chain + ', the first in its record.', usd(gasBudget) + ' of ' + gas[0] + ' set aside for fees', '20 minutes, once'],
      ['Read ' + c.name + "'s docs and announcements for a points programme, season dates or a referral code before you deposit. The snapshot records no token for " + c.name + ' and nothing here promises one.', '$0', '30 minutes, once']
    ].concat(PLAYBOOKS[play](c));

    let total = gasBudget + fee * 25; // the fee total the last step states
    if (n > 1) {
      const fee2 = gasOf(chains[1])[1], bridge = Math.max(1, c.hi * 0.25 * 0.001);
      total += bridge + fee2 * 3;
      steps.push(['Open a second position of about a quarter of your size on ' + c.chain2 + (n > 2 ? ', and make one transaction on ' + chainName(chains[2]) : '') + ', so the wallet is active on more than one of ' + c.name + "'s " + n + ' chains; bridge by the route its app offers.', 'about ' + usd(bridge) + ' in bridge fees and ' + usd(fee2 * 3) + ' in fees on ' + c.chain2, '25 minutes, once']);
    } else {
      steps.push([c.name + ' records TVL on ' + c.chain + ' alone: spread your activity over at least four separate weeks and ' +
        (ln ? 'receive too: create an invoice and have it paid, which needs inbound capacity.' : 'use each function of its app at least once.'), fees(c, 4), '10 minutes a week for a month']);
    }

    const ch = row.change_7d, moved = ch === null ? '' : 'TVL moved ' + (ch > 0 ? '+' : '') + ch.toFixed(1) + '% in the 7 days to ' + asOf;
    // How to pace the deposit of step 3, from the 7-day change.
    const pace = ch === null || Math.abs(ch) < 0.05 ? 'The snapshot shows no 7-day change in TVL, so make the step 3 deposit in two halves a week apart.'
      : ch > 100 ? moved + ': a jump that size is often one large deposit, so wait a week and confirm it holds before step 3.'
        : ch >= 10 ? moved + ': deposits are arriving now, so make half of the step 3 deposit this week.'
          : ch <= -10 ? moved + ': start step 3 at the low end and add the rest only once it stops shrinking.'
            : moved + ', steady enough to make the step 3 deposit in two halves a week apart.';
    steps.push(['Check in on ' + c.name + ' weekly until a snapshot or the end of a programme is announced: confirm the position is still open and add one small transaction. ' + pace, fees(c, 13) + ' over 13 weeks', WEEKLY]);

    const age = row.model.age_days;
    const hold = age === null ? 'The snapshot gives no listing date, so review after 90 days.'
      : age < 180 ? 'Tracked for only ' + age + ' days, it is early: plan on 180 days.'
        : age >= 730 ? 'It has run ' + age + ' days and records no token: a long run dates nothing, so review every 90 days and commit only what can sit idle.'
          : 'It has run ' + age + ' days and records no token: plan on 120 days and review then.';
    steps.push([hold + ' Leave ' + c.name + ' early if TVL falls more than 40% below the ' + tvl + ' the snapshot records.', 'in all: ' + c.range + ' of capital at risk and about ' + usd(Math.ceil(total)) + ' in network fees over the first 90 days, before the costs steps 3 and 4 name', (n > 1 ? '6-12' : '5-10') + ' hours over 90 days']);
    return steps.map((s) => ({ action: s[0], cost: s[1], time: s[2] }));
  }

  /* One step as the single string board.json carries. */
  const stepText = (step) => step.action + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';

  const api = { K, classify, comparables, sizeElasticity, ageDays, working, impliedValue, buildRadar, sizeTier, playbookOf, farmPlan, stepText, usd, money, chainName, categoryOf };
  root.RadarModel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this);
