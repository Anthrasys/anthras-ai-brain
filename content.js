// RNGidle Roll Profit Overlay - Content Script (MAIN WORLD)
// Injected into https://rngidle.fun/
// Author: anthrakys

(function () {
  'use strict';

  console.log('[RNGidle Mod by anthrakys] Initializing Roll Profit Overlay v1.2.0...');

  // State
  let engineMod = null;
  let activeRollNumber = null;
  let activeRollScore = null;
  let activeRollTier = null;
  let cachedSimulations = null;
  let selectedItemId = 'rss';
  let isMinimized = false;
  let isHidden = false;
  let showAllItems = true;
  let isNetMode = true;
  let isGambleMode = false;
  let tickTimer = null;
  let isCalculating = false;
  let tabScrollLeft = 0;

  // Restore saved settings
  const savedSettings = JSON.parse(localStorage.getItem('rngidle_mod_settings') || '{}');
  if (savedSettings.minimized !== undefined) isMinimized = savedSettings.minimized;
  if (savedSettings.showAll !== undefined) showAllItems = savedSettings.showAll;
  if (savedSettings.netMode !== undefined) isNetMode = savedSettings.netMode;
  if (savedSettings.gambleMode !== undefined) isGambleMode = savedSettings.gambleMode;

  // Lightweight engine hook (imports /engine.js and /number-model.js)
  function hookEngine() {
    const hook = document.createElement('script');
    hook.type = 'module';
    hook.textContent = `
      (async function() {
        try {
          const [engine, numberModel] = await Promise.all([
            import('/engine.js'),
            import('/number-model.js').catch(() => null)
          ]);
          window.__RNGIDLE_ENGINE__ = {
            ...engine,
            normalizeNumber: numberModel?.normalizeNumber || engine.normalizeNumber,
            numberParts: numberModel?.numberParts || engine.numberParts,
            basisUnit: numberModel?.basisUnit || engine.basisUnit,
            formatNumber: numberModel?.formatNumber || engine.formatNumber,
            numberKind: numberModel?.numberKind || engine.numberKind
          };
          window.dispatchEvent(new CustomEvent('rngidle-mod:engine-ready'));
        } catch (e) {
          console.warn('[RNGidle Mod by anthrakys] Engine hook deferred:', e);
        }
      })();
    `;
    (document.head || document.documentElement).appendChild(hook);
    hook.remove();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookEngine);
  } else {
    hookEngine();
  }

  // Listen to Bridge messages from popup
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'RNGIDLE_SETTINGS_INIT' && event.data.settings) {
      if (event.data.settings.showAll !== undefined) showAllItems = event.data.settings.showAll;
      if (event.data.settings.netMode !== undefined) isNetMode = event.data.settings.netMode;
      if (event.data.settings.gambleMode !== undefined) isGambleMode = event.data.settings.gambleMode;
      if (event.data.settings.enabled !== undefined) {
        isHidden = !event.data.settings.enabled;
        updateVisibility();
      }
      renderOverlay();
    } else if (event.data.type === 'RNGIDLE_SETTING_UPDATE') {
      if (event.data.key === 'rngidle_show_all_items') showAllItems = event.data.value;
      if (event.data.key === 'rngidle_net_mode') isNetMode = event.data.value;
      if (event.data.key === 'rngidle_gamble_mode') isGambleMode = event.data.value;
      if (event.data.key === 'rngidle_overlay_enabled') {
        isHidden = !event.data.value;
        updateVisibility();
      }
      renderOverlay();
    }
  });

  function getEngine() {
    if (engineMod) return engineMod;
    if (window.__RNGIDLE_ENGINE__) {
      engineMod = window.__RNGIDLE_ENGINE__;
      return engineMod;
    }
    return null;
  }

  // Canonical normalize number string (delegates to game engine model for reals, complex & hypercomplex)
  const tryNorm = (val) => {
    if (val == null) return null;
    const str = String(val).trim();
    if (!str) return null;
    const eng = getEngine();
    if (eng?.normalizeNumber) {
      try {
        return String(eng.normalizeNumber(str));
      } catch {
        return null;
      }
    }
    // Lightweight fallback
    if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(str)) {
      const neg = str.startsWith('-');
      const clean = str.replace(/^[+-]/, '');
      const [whole, frac] = clean.split('.');
      const intPart = (whole || '0').replace(/^0+(?=\d)/, '');
      return (neg && intPart !== '0' ? '-' : '') + intPart + (frac !== undefined ? '.' + frac : '');
    }
    return str;
  };

  // Fast score cache across simulations and ticks
  const globalScoreCache = new Map();

  // Evaluate candidate roll score
  const scoreCandidate = (numStr) => {
    if (!numStr) return { totalScore: 0, tier: 'common' };
    const cached = globalScoreCache.get(numStr);
    if (cached) return cached;

    const eng = getEngine();
    if (eng) {
      try {
        const scorer = eng.analyzeNumber || eng.composeRollResult;
        if (scorer) {
          const res = scorer(numStr);
          const score = res.totalScore || 0;
          const getTier = eng.getCardRarityTier;
          const tier = getTier ? getTier(score, numStr) : 'common';
          const scored = { totalScore: score, tier };
          if (globalScoreCache.size > 2000) globalScoreCache.clear();
          globalScoreCache.set(numStr, scored);
          return scored;
        }
      } catch (err) {
        // Fallback
      }
    }
    return { totalScore: 0, tier: 'common' };
  };

  const formatCompactEP = (value) => {
    const eng = getEngine();
    if (eng?.formatCompactEP) return eng.formatCompactEP(value);
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    const abs = Math.abs(n);
    if (abs < 1000) return (n < 0 ? '-' : '') + Math.round(abs).toLocaleString();
    const suffixes = ['', 'k', 'M', 'B', 'T', 'Qd', 'Qn', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    const tier = Math.min(suffixes.length - 1, Math.floor(Math.log10(abs) / 3));
    const scaled = abs / 10 ** (tier * 3);
    return (n < 0 ? '-' : '') + Number(scaled.toFixed(1)) + suffixes[tier];
  };

  function digitSlots(n) {
    const out = [];
    for (let i = 0; i < n.length; i++) {
      if (!/[0-9]/.test(n[i]) || n[i - 1] === '_') continue;
      const start = i === 0 || n[i - 1] === '+' || n[i - 1] === '-';
      out.push({ i, leading: start && /[0-9]/.test(n[i + 1] || '') });
    }
    return out;
  }

  // Number items metadata
  const NUMBER_ITEMS = [
    { id: 'rss', name: 'Roulette Splitter', emoji: '🎡', price: 10_000_000, desc: 'One digit ±1 or ±2 on a 16-slot wheel' },
    { id: 'sss', name: 'Slot Splitter', emoji: '🎰', price: 15_000_000, desc: 'Every digit moves +1, -1 or stays' },
    { id: 'dss', name: 'Digit Splitter', emoji: '🔪', price: 20_000_000, desc: 'Replaces one random digit with another' },
    { id: 'horn', name: "Hell's Horn", emoji: '😈', price: 100_000_000, desc: 'One non-6 digit becomes a 6' },
    { id: 'bitflip', name: 'Function Error', emoji: '⚠️', price: 300_000_000, desc: 'Best binary bit-flip that improves score' },
    { id: 'digit_swap', name: 'Digit Swap', emoji: '⇄', price: 500_000_000, desc: 'Swaps two random digit positions' },
    { id: 'gravity', name: 'Gravity Potion', emoji: '🪨', price: 4_000_000_000, desc: 'Every digit falls by 1 (0 -> 9)' },
    { id: 'grinder', name: 'Grinder', emoji: '⚙️', price: 5_000_000_000, desc: 'Grinds away one random digit' },
    { id: 'edge', name: 'Edge of Infinity', emoji: '♾️', price: 20_000_000_000, desc: 'Adds a new random digit' },
    { id: 'glitch', name: 'Glitch Potion', emoji: '👾', price: 23_000_000_000, desc: 'Breaks number (negative, decimal or trash)' }
  ];

  // Simulators - Optimized for Ultra-Fast Non-Blocking Math (<5ms each)
  function simulateDSS(numberStr, baseScore, cost) {
    const slots = digitSlots(numberStr);
    if (!slots.length) return null;
    const chars = [...numberStr];
    const outcomes = [];
    for (const s of slots) {
      const old = +chars[s.i];
      const choices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => d !== old && !(s.leading && d === 0));
      const p = (1 / slots.length) * (1 / choices.length);
      for (const d of choices) {
        const c = [...chars];
        c[s.i] = String(d);
        const norm = tryNorm(c.join(''));
        if (norm) outcomes.push({ number: norm, prob: p });
      }
    }
    return evaluateOutcomes(outcomes, baseScore, cost);
  }

  function simulateRSS(numberStr, baseScore, cost) {
    const slots = digitSlots(numberStr);
    if (!slots.length) return null;
    const self = tryNorm(numberStr) ?? numberStr;
    const seen = new Set([self]);
    const variants = [];
    for (const s of slots) {
      for (const by of [1, -1, 2, -2]) {
        const d = (+numberStr[s.i] + by + 10) % 10;
        if (s.leading && d === 0) continue;
        const norm = tryNorm(numberStr.slice(0, s.i) + d + numberStr.slice(s.i + 1));
        if (norm == null || seen.has(norm)) continue;
        seen.add(norm);
        variants.push(norm);
      }
    }
    const outcomes = [];
    if (variants.length <= 15) {
      const p = 1 / (variants.length + 1);
      outcomes.push({ number: self, prob: p });
      for (const v of variants) outcomes.push({ number: v, prob: p });
    } else {
      outcomes.push({ number: self, prob: 1 / 16 });
      const p = (15 / variants.length) * (1 / 16);
      for (const v of variants) outcomes.push({ number: v, prob: p });
    }
    return evaluateOutcomes(outcomes, baseScore, cost);
  }

  // Exact prime sequence for low-discrepancy Weyl quasi-random lattice
  const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];

  /**
   * Slot Soul Splitter (SSS) Simulator.
   * Every digit slot independently moves by +1, 0, or -1.
   * Enumerates exact full factorial state space for <= 4 slots.
   * Evaluates deterministic stratified lattice (identity, extremes, marginal OAT, and Weyl sequences) for > 4 slots.
   */
  function simulateSSS(numberStr, baseScore, cost) {
    const slots = digitSlots(numberStr);
    if (!slots.length) return null;
    const chars = [...numberStr];
    const outcomes = [];
    if (slots.length <= 4) {
      function recurse(idx, curr, p) {
        if (idx === slots.length) {
          const norm = tryNorm(curr.join(''));
          if (norm) outcomes.push({ number: norm, prob: p });
          return;
        }
        const s = slots[idx];
        const old = +chars[s.i];
        const options = [-1, 0, 1].filter(o => !(s.leading && (old + o + 10) % 10 === 0));
        const nextP = p / options.length;
        for (const o of options) {
          curr[s.i] = String((old + o + 10) % 10);
          recurse(idx + 1, curr, nextP);
        }
      }
      recurse(0, [...chars], 1.0);
    } else {
      const slotOpts = slots.map(s => {
        const old = +chars[s.i];
        return [-1, 0, 1].filter(o => !(s.leading && (old + o + 10) % 10 === 0));
      });
      const combinations = [];
      // 1. Identity
      combinations.push(slots.map(() => 0));
      // 2. Boundary extremes: all +1 and all -1
      combinations.push(slotOpts.map(opts => opts.includes(1) ? 1 : 0));
      combinations.push(slotOpts.map(opts => opts.includes(-1) ? -1 : 0));
      // 3. One-At-a-Time (OAT) marginal sensitivity vectors
      for (let sIdx = 0; sIdx < slots.length; sIdx++) {
        if (slotOpts[sIdx].includes(1)) {
          const c = slots.map(() => 0); c[sIdx] = 1; combinations.push(c);
        }
        if (slotOpts[sIdx].includes(-1)) {
          const c = slots.map(() => 0); c[sIdx] = -1; combinations.push(c);
        }
      }
      // 4. Low-discrepancy Weyl quasi-random lattice for interior coverage
      const SAMPLES = 48;
      const needed = Math.max(0, SAMPLES - combinations.length);
      for (let k = 1; k <= needed; k++) {
        const comb = [];
        for (let j = 0; j < slots.length; j++) {
          const alpha = Math.sqrt(PRIMES[j % PRIMES.length]) % 1;
          const u = (k * alpha) % 1;
          const opts = slotOpts[j];
          comb.push(opts[Math.floor(u * opts.length)]);
        }
        combinations.push(comb);
      }
      const p = 1 / combinations.length;
      for (const comb of combinations) {
        const c = [...chars];
        for (let j = 0; j < slots.length; j++) {
          const s = slots[j];
          const old = +chars[s.i];
          c[s.i] = String((old + comb[j] + 10) % 10);
        }
        const norm = tryNorm(c.join(''));
        if (norm) outcomes.push({ number: norm, prob: p });
      }
    }
    return evaluateOutcomes(outcomes, baseScore, cost);
  }

  function simulateHorn(numberStr, baseScore, cost) {
    const slots = digitSlots(numberStr);
    const free = slots.filter(s => numberStr[s.i] !== '6');
    if (!free.length) return { error: 'Every digit is already a 6.' };
    const p = 1 / free.length;
    const outcomes = [];
    for (const s of free) {
      const norm = tryNorm(numberStr.slice(0, s.i) + '6' + numberStr.slice(s.i + 1));
      if (norm) outcomes.push({ number: norm, prob: p });
    }
    return evaluateOutcomes(outcomes, baseScore, cost);
  }

  /**
   * Function Error (Bitflip) Simulator.
   * Searches single bitflips across the binary representation of the integer part.
   * For complex numbers, accounts for the official 50% probability of an imaginary 404 substitution.
   */
  function simulateBitflip(numberStr, baseScore, cost) {
    const eng = getEngine();
    let p = null;
    if (eng?.numberParts) {
      try { p = eng.numberParts(numberStr); } catch {}
    }
    if (!p) {
      if (/[jklmnopqrstuvwx]|e_\d/.test(numberStr)) {
        return { error: 'Function Error reads real or complex numbers.' };
      }
      if (numberStr.endsWith('i')) {
        const body = numberStr.slice(0, -1);
        const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([+-])((?:\d+(?:\.\d+)?|\.\d+)?)$/.exec(body);
        if (match) {
          p = { complex: true, real: match[1], imaginary: match[3] || '1', negative: match[1].startsWith('-') };
        } else {
          p = { complex: true, real: '0', imaginary: body, negative: false };
        }
      } else {
        const neg = numberStr.startsWith('-');
        p = { complex: false, real: numberStr, negative: neg };
      }
    }

    if (p.hypercomplex || p.empty || numberStr === '∅') {
      return { error: 'Function Error reads real or complex numbers.' };
    }

    const real = p.real || '0';
    const negative = real.startsWith('-');
    const [whole, fraction] = real.replace('-', '').split('.');
    if (!whole || !/^\d+$/.test(whole)) return { error: 'Incompatible' };

    const bits = BigInt(whole).toString(2);
    const value = BigInt(whole);
    const imaginary = p.complex ? (p.imaginary.startsWith('-') ? p.imaginary : '+' + p.imaginary) + 'i' : '';

    let bestScore = baseScore;
    let bestNum = null;
    for (let at = 0; at < bits.length; at++) {
      const candidate = tryNorm((negative ? '-' : '') + (value ^ (1n << BigInt(bits.length - at - 1))).toString() + (fraction === undefined ? '' : '.' + fraction) + imaginary);
      if (!candidate) continue;
      const s = scoreCandidate(candidate).totalScore;
      if (s > bestScore) {
        bestScore = s;
        bestNum = candidate;
      }
    }

    const finalNum = bestNum || tryNorm((negative ? '-404' : '404') + imaginary);
    if (!finalNum) return { error: 'Cannot flip' };

    if (p.complex) {
      let candReal = real;
      if (eng?.numberParts) {
        try { candReal = eng.numberParts(finalNum).real; } catch {}
      } else {
        const m = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))/.exec(finalNum);
        if (m) candReal = m[1];
      }
      const cand404 = tryNorm(candReal + (p.imaginary.startsWith('-') ? '-' : '+') + '404i');
      if (cand404) {
        return evaluateOutcomes([
          { number: finalNum, prob: 0.5 },
          { number: cand404, prob: 0.5 }
        ], baseScore, cost);
      }
    }

    return evaluateOutcomes([{ number: finalNum, prob: 1.0 }], baseScore, cost);
  }

  function simulateSwap(numberStr, baseScore, cost) {
    const slots = digitSlots(numberStr);
    if (slots.length < 2) return { error: 'Requires at least 2 digits' };
    const pairs = [];
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        pairs.push([slots[i].i, slots[j].i]);
      }
    }
    const p = 1 / pairs.length;
    const outcomes = [];
    for (const [a, b] of pairs) {
      const c = [...numberStr];
      [c[a], c[b]] = [c[b], c[a]];
      const norm = tryNorm(c.join(''));
      if (norm) outcomes.push({ number: norm, prob: p });
    }
    return evaluateOutcomes(outcomes, baseScore, cost);
  }

  function simulateGravity(numberStr, baseScore, cost) {
    const slots = digitSlots(numberStr);
    if (!slots.length) return null;
    const chars = [...numberStr];
    for (const s of slots) chars[s.i] = String((+chars[s.i] + 9) % 10);
    const norm = tryNorm(chars.join(''));
    if (!norm) return null;
    return evaluateOutcomes([{ number: norm, prob: 1.0 }], baseScore, cost);
  }

  function simulateGrinder(numberStr, baseScore, cost) {
    const slots = digitSlots(numberStr);
    if (!slots.length) return null;
    const outcomes = [];
    if (slots.length === 1) {
      outcomes.push({ number: '∅', prob: 1 / 3 });
      outcomes.push({ number: numberStr.startsWith('-') ? '-404' : '404', prob: 2 / 3 });
    } else {
      const p = 1 / slots.length;
      for (const s of slots) {
        const norm = tryNorm((numberStr.slice(0, s.i) + numberStr.slice(s.i + 1)).replace(/\.(?!\d)/g, ''));
        if (norm && norm !== numberStr) outcomes.push({ number: norm, prob: p });
      }
    }
    return evaluateOutcomes(outcomes, baseScore, cost);
  }

  /**
   * Edge of Infinity Simulator.
   * Inserts a new random digit at any boundary spot.
   * Evaluates all valid insertion digits [0..9] (or [1..9] if leading) across representative positions.
   */
  function simulateEdge(numberStr, baseScore, cost) {
    const slots = digitSlots(numberStr);
    if (!slots.length) return null;
    const spots = slots.flatMap(s => [
      { at: s.i, leading: s.leading || s.i === 0 || /[+-]/.test(numberStr[s.i - 1] || '') },
      { at: s.i + 1, leading: false }
    ]);

    const spotMap = new Map();
    for (const sp of spots) {
      const key = sp.at + ':' + sp.leading;
      spotMap.set(key, { ...sp, weight: (spotMap.get(key)?.weight || 0) + 1 });
    }
    const uniqueSpots = [...spotMap.values()];

    const chosenSpots = uniqueSpots.length <= 4 ? uniqueSpots : [
      uniqueSpots[0],
      uniqueSpots[Math.floor(uniqueSpots.length / 3)],
      uniqueSpots[Math.floor((2 * uniqueSpots.length) / 3)],
      uniqueSpots[uniqueSpots.length - 1]
    ];

    const totalSpotWeight = chosenSpots.reduce((sum, sp) => sum + sp.weight, 0);
    const outcomes = [];

    for (const sp of chosenSpots) {
      const digits = sp.leading
        ? ['1', '2', '3', '4', '5', '6', '7', '8', '9']
        : ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      const pPerDigit = (sp.weight / totalSpotWeight) / digits.length;
      for (const d of digits) {
        const norm = tryNorm(numberStr.slice(0, sp.at) + d + numberStr.slice(sp.at));
        if (norm && norm !== numberStr) {
          outcomes.push({ number: norm, prob: pPerDigit });
        }
      }
    }
    return evaluateOutcomes(outcomes, baseScore, cost);
  }

  // Canonical trashest joke numbers from glitch-data.js and shop-server.js
  const TRASHEST_JOKES = ['903802', '908206', '908203', '902403', '602403', '802903', '604903', '904803'];
  // Stratified non-zero decimals covering all 10 decades d1 in [0..9] and key badge milestones
  const STRATIFIED_DECIMALS = ['01', '07', '14', '21', '33', '42', '55', '69', '71', '84', '99'];

  /**
   * Glitch Potion Simulator.
   * Canonical model matching server rules:
   * - 40% probability: sign flip on one non-zero component.
   * - 40% probability: 2-digit non-zero fraction appended (stratified across decades).
   * - 20% probability: trashest joke number.
   */
  function simulateGlitch(numberStr, baseScore, cost) {
    const eng = getEngine();
    let p = null;
    if (eng?.numberParts) {
      try { p = eng.numberParts(numberStr); } catch {}
    }

    let comps, build;
    if (p?.hypercomplex) {
      comps = [...p.components];
      const level = p.level;
      const bUnit = eng?.basisUnit || ((axis, lvl) => axis === 0 ? '' : lvl === 2 ? ['', 'i', 'j', 'k'][axis] : `e_${axis}`);
      build = c => c.map((v, i) => (i && !v.startsWith('-') ? '+' : '') + v + bUnit(i, level)).join('');
    } else if (p?.complex || numberStr.endsWith('i')) {
      const realComp = p?.realPresent ? p.real : (p?.real || '0');
      const imagComp = p?.imaginary || '1';
      comps = [realComp, imagComp];
      build = c => c[0] + (c[1].startsWith('-') ? '' : '+') + c[1] + 'i';
    } else {
      comps = [numberStr];
      build = c => c[0];
    }

    const outcomes = [];
    // 40% sign flip on active non-zero components
    const nonZeroIndices = comps.map((c, i) => /[1-9]/.test(c) ? i : -1).filter(i => i !== -1);
    const activeIndices = nonZeroIndices.length ? nonZeroIndices : comps.map((_, i) => i);
    const pSign = 0.4 / activeIndices.length;
    for (const i of activeIndices) {
      const c = [...comps];
      c[i] = c[i].startsWith('-') ? c[i].slice(1) : '-' + c[i];
      const norm = tryNorm(build(c));
      if (norm) outcomes.push({ number: norm, prob: pSign });
    }

    // 40% decimal on one component (stratified uniformly across decades)
    const pDec = 0.4 / (comps.length * STRATIFIED_DECIMALS.length);
    for (let i = 0; i < comps.length; i++) {
      for (const d of STRATIFIED_DECIMALS) {
        const c = [...comps];
        c[i] = c[i].includes('.') ? c[i] + d : c[i] + '.' + d;
        const norm = tryNorm(build(c));
        if (norm) outcomes.push({ number: norm, prob: pDec });
      }
    }

    // 20% trash joke number from canonical game list
    const pTrash = 0.2 / TRASHEST_JOKES.length;
    for (const t of TRASHEST_JOKES) {
      outcomes.push({ number: t, prob: pTrash });
    }

    return evaluateOutcomes(outcomes, baseScore, cost);
  }

  function evaluateOutcomes(outcomes, baseScore, cost) {
    if (!outcomes || !outcomes.length) return null;
    const map = new Map();
    let totalP = 0;
    for (const o of outcomes) {
      if (!o.number || o.prob <= 0) continue;
      totalP += o.prob;
      map.set(o.number, (map.get(o.number) || 0) + o.prob);
    }
    if (totalP <= 0 || map.size === 0) return null;

    let expectedGrossDelta = 0;
    let probWin = 0;
    let probLoss = 0;
    let probNeutral = 0;
    let probNetProfit = 0;

    let best = null;
    let worst = null;

    for (const [num, rawP] of map) {
      const p = rawP / totalP;
      const scored = scoreCandidate(num);
      const grossDelta = scored.totalScore - baseScore;
      const netProfit = grossDelta - cost;

      expectedGrossDelta += p * grossDelta;

      if (grossDelta > 0) probWin += p;
      else if (grossDelta < 0) probLoss += p;
      else probNeutral += p;

      if (netProfit > 0) probNetProfit += p;

      if (!best || grossDelta > best.grossDelta) {
        best = { number: num, score: scored.totalScore, grossDelta, netProfit, tier: scored.tier };
      }
      if (!worst || grossDelta < worst.grossDelta) {
        worst = { number: num, score: scored.totalScore, grossDelta, netProfit, tier: scored.tier };
      }
    }

    const expectedNetProfit = expectedGrossDelta - cost;

    return {
      cost,
      baseScore,
      expectedGrossDelta,
      expectedNetProfit,
      bestGross: best?.grossDelta ?? 0,
      bestNet: best?.netProfit ?? 0,
      worstGross: worst?.grossDelta ?? 0,
      worstNet: worst?.netProfit ?? 0,
      bestOutcome: best,
      worstOutcome: worst,
      winRate: Math.max(0, Math.min(100, probWin * 100)),
      lossRate: Math.max(0, Math.min(100, probLoss * 100)),
      neutralRate: Math.max(0, Math.min(100, probNeutral * 100)),
      netProfitRate: Math.max(0, Math.min(100, probNetProfit * 100)),
      isRentable: expectedNetProfit > 0
    };
  }

  function simulateItem(itemId, numberStr, baseScore) {
    const item = NUMBER_ITEMS.find(i => i.id === itemId);
    if (!item) return null;
    switch (itemId) {
      case 'rss': return simulateRSS(numberStr, baseScore, item.price);
      case 'sss': return simulateSSS(numberStr, baseScore, item.price);
      case 'dss': return simulateDSS(numberStr, baseScore, item.price);
      case 'horn': return simulateHorn(numberStr, baseScore, item.price);
      case 'bitflip': return simulateBitflip(numberStr, baseScore, item.price);
      case 'digit_swap': return simulateSwap(numberStr, baseScore, item.price);
      case 'gravity': return simulateGravity(numberStr, baseScore, item.price);
      case 'grinder': return simulateGrinder(numberStr, baseScore, item.price);
      case 'edge': return simulateEdge(numberStr, baseScore, item.price);
      case 'glitch': return simulateGlitch(numberStr, baseScore, item.price);
      default: return null;
    }
  }

  // Detect displayed score directly from DOM
  function findDisplayedScore() {
    const pills = document.querySelectorAll('.type-data');
    for (const p of pills) {
      const text = p.innerText || p.textContent || '';
      if (text.includes('EP') && !text.includes('LIFETIME') && !text.includes('Archive') && !text.includes('Match')) {
        const m = text.match(/([0-9\s,]+)\s*EP/i);
        if (m) {
          const cleaned = m[1].replace(/[\s,]/g, '');
          const val = Number(cleaned);
          if (Number.isFinite(val) && val > 0) return val;
        }
      }
    }
    return null;
  }

  function findDisplayedTier() {
    const pill = document.querySelector('.type-label, .amolony-label');
    if (pill) {
      const t = (pill.innerText || pill.textContent || '').trim();
      if (t && t.length > 2) return t.toUpperCase();
    }
    return null;
  }

  // Extract active roll data - Ignores active rolling animations
  function detectActiveRollData() {
    // If a batch roll or single roll is in the middle of rolling/spinning, wait for it to settle!
    if (document.querySelector('.animate-digit-spin, .batch-rolling-card, .is-rolling, .animate-shimmer')) {
      return null;
    }

    const artifact = document.querySelector('.number-artifact, .number-card, .bulk-pick-card');
    if (!artifact) return null;

    let numberVal = null;
    let scoreVal = null;
    let tierVal = null;

    // React Fiber extraction
    const fiberKey = Object.keys(artifact).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (fiberKey) {
      let fiber = artifact[fiberKey];
      for (let d = 0; fiber && d < 15; d++) {
        if (fiber.memoizedProps?.number != null) {
          numberVal = String(fiber.memoizedProps.number);
          if (fiber.memoizedProps.score != null) scoreVal = Number(fiber.memoizedProps.score);
          if (fiber.memoizedProps.rarity) tierVal = String(fiber.memoizedProps.rarity).toUpperCase();
          break;
        }
        fiber = fiber.return;
      }
    }

    // Fallback to textContent
    if (!numberVal) {
      const text = (artifact.innerText || artifact.textContent || '').replace(/[\s\r\n]/g, '');
      const match = text.match(/^[+\-]?[0-9a-z_.+]+/i);
      if (match) numberVal = tryNorm(match[0]) || match[0];
    }

    if (!numberVal || numberVal.includes('?')) return null;

    scoreVal = findDisplayedScore();
    if (!tierVal) tierVal = findDisplayedTier();

    if (scoreVal == null) {
      const scored = scoreCandidate(numberVal);
      if (scored.totalScore > 0) {
        scoreVal = scored.totalScore;
        if (!tierVal) tierVal = scored.tier.toUpperCase();
      }
    }

    return {
      number: numberVal,
      totalScore: scoreVal || 0,
      tier: tierVal || 'COMMON'
    };
  }

  function getPlayerInventory() {
    const inv = {};
    const splitButtons = document.querySelectorAll('.split-item');
    splitButtons.forEach(btn => {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const qtyEl = btn.querySelector('.split-qty');
      const qty = qtyEl ? parseInt(qtyEl.textContent.replace(/[^0-9]/g, '')) || 1 : 1;
      for (const item of NUMBER_ITEMS) {
        if (aria.includes(item.name.toLowerCase()) || btn.innerHTML.includes(item.id)) {
          inv[item.id] = qty;
        }
      }
    });
    return inv;
  }

  // Non-blocking asynchronous simulation computation
  async function computeSimulationsAsync(numStr, baseScore, tier) {
    if (isCalculating) return;
    isCalculating = true;

    try {
      const results = {};

      // 1. Compute selected item first for immediate UI responsiveness (<3ms)
      results[selectedItemId] = simulateItem(selectedItemId, numStr, baseScore);

      cachedSimulations = {
        number: numStr,
        baseScore,
        tier: tier || 'COMMON',
        results
      };
      renderOverlay();

      // 2. Yield and compute remaining items asynchronously
      for (const item of NUMBER_ITEMS) {
        if (item.id === selectedItemId) continue;
        await new Promise(r => setTimeout(r, 0));
        if (activeRollNumber !== numStr) return; // Stale, abort
        results[item.id] = simulateItem(item.id, numStr, baseScore);
      }

      if (activeRollNumber === numStr) {
        renderOverlay();
      }
    } finally {
      isCalculating = false;
    }
  }

  // DOM Elements
  let overlayEl = null;
  let pillEl = null;

  function ensureUIElements() {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'rngidle-profit-overlay';
      overlayEl.className = isHidden || isMinimized ? 'hidden' : '';

      if (savedSettings.posX !== undefined && savedSettings.posY !== undefined) {
        overlayEl.style.left = savedSettings.posX + 'px';
        overlayEl.style.top = savedSettings.posY + 'px';
        overlayEl.style.right = 'auto';
      }

      document.body.appendChild(overlayEl);
      initDraggable(overlayEl);
    }

    if (!pillEl) {
      pillEl = document.createElement('div');
      pillEl.id = 'rngidle-profit-pill';
      pillEl.className = isHidden || !isMinimized ? 'hidden' : '';
      pillEl.innerHTML = `<span class="rpo-dot"></span> <span style="font-size:10.5px;font-weight:700;letter-spacing:0.5px;color:#cbd5e1;">AI BRAIN</span> <span class="pill-stat"></span>`;
      pillEl.addEventListener('click', () => {
        isMinimized = false;
        saveLocalSettings();
        updateVisibility();
        renderOverlay();
      });
      document.body.appendChild(pillEl);
    }
  }

  function updateVisibility() {
    if (!overlayEl || !pillEl) return;
    if (isHidden) {
      overlayEl.classList.add('hidden');
      pillEl.classList.add('hidden');
    } else if (isMinimized) {
      overlayEl.classList.add('hidden');
      pillEl.classList.remove('hidden');
    } else {
      overlayEl.classList.remove('hidden');
      pillEl.classList.add('hidden');
    }
  }

  function saveLocalSettings() {
    localStorage.setItem('rngidle_mod_settings', JSON.stringify({
      minimized: isMinimized,
      showAll: showAllItems,
      netMode: isNetMode,
      gambleMode: isGambleMode,
      posX: overlayEl ? parseInt(overlayEl.style.left) || undefined : undefined,
      posY: overlayEl ? parseInt(overlayEl.style.top) || undefined : undefined
    }));
  }

  function initDraggable(el) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const onMouseDown = (e) => {
      if (e.target.closest('button') || e.target.closest('.rpo-seg-btn') || e.target.closest('.rpo-icon-btn') || e.target.closest('.rpo-tab')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      el.style.right = 'auto';
      el.style.left = initialLeft + 'px';
      el.style.top = initialTop + 'px';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = Math.max(10, Math.min(window.innerWidth - el.offsetWidth - 10, initialLeft + dx)) + 'px';
      el.style.top = Math.max(10, Math.min(window.innerHeight - el.offsetHeight - 10, initialTop + dy)) + 'px';
    };

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        saveLocalSettings();
      }
    };

    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.rpo-header')) onMouseDown(e);
    });
  }

  // Render Overlay (100% in English, sober & minimalist UI)
  function renderOverlay() {
    ensureUIElements();
    if (isHidden) return;

    // Preserve scroll position of tabs bar before DOM overwrite
    const existingTabs = overlayEl?.querySelector('.rpo-tabs');
    if (existingTabs) {
      tabScrollLeft = existingTabs.scrollLeft;
    }

    if (!cachedSimulations) {
      overlayEl.innerHTML = `
        <div class="rpo-header">
          <div class="rpo-brand">
            <div class="rpo-dot"></div>
            <span class="rpo-title">Anthra's AI Brain</span>
          </div>
          <div class="rpo-controls">
            <button class="rpo-icon-btn" id="rpo-min-btn" title="Minimize">−</button>
          </div>
        </div>
        <div class="rpo-body">
          <div class="rpo-notice">
            <span>⏳</span>
            <span>Waiting for roll data... Roll or click a number to view live analysis.</span>
          </div>
        </div>
      `;
      document.getElementById('rpo-min-btn')?.addEventListener('click', () => {
        isMinimized = true;
        saveLocalSettings();
        updateVisibility();
      });
      return;
    }

    const { number, baseScore, tier, results } = cachedSimulations;
    const inv = getPlayerInventory();

    // Determine Best Recommendation
    let bestRec = null;
    for (const item of NUMBER_ITEMS) {
      const res = results[item.id];
      if (!res || res.error) continue;
      const qty = inv[item.id] || 0;
      if (!showAllItems && qty <= 0) continue;

      if (!bestRec || res.expectedNetProfit > bestRec.res.expectedNetProfit) {
        bestRec = { item, res, qty };
      }
    }

    // Update minimized pill
    if (pillEl) {
      const statSpan = pillEl.querySelector('.pill-stat');
      if (statSpan) {
        if (bestRec && bestRec.res.isRentable) {
          statSpan.innerHTML = `<span style="color:#34d399;font-weight:600;">+${formatCompactEP(bestRec.res.expectedNetProfit)} (${Math.round(bestRec.res.winRate)}%)</span>`;
        } else {
          statSpan.innerHTML = `<span style="color:#94a3b8;">Hold</span>`;
        }
      }
    }

    const visibleItems = showAllItems ? NUMBER_ITEMS : NUMBER_ITEMS.filter(i => (inv[i.id] || 0) > 0);
    const activeItem = NUMBER_ITEMS.find(i => i.id === selectedItemId) || visibleItems[0] || NUMBER_ITEMS[0];
    const activeRes = results[activeItem.id];

    // Compute Top 3 Gambles (Highest Peak Ceilings)
    const top3Gambles = visibleItems
      .map(item => {
        const res = results[item.id];
        if (!res || res.error) return null;
        const ceiling = isNetMode ? res.bestNet : res.bestGross;
        return { item, res, ceiling };
      })
      .filter(Boolean)
      .filter(g => g.ceiling > 0)
      .sort((a, b) => {
        if (b.ceiling !== a.ceiling) return b.ceiling - a.ceiling;
        return b.res.winRate - a.res.winRate;
      })
      .slice(0, 3);

    // Detect Game Phase & Status
    let phaseNoticeHtml = '';
    const splitChoiceEl = document.querySelector('.split-choice');
    const bulkPauseEl = document.querySelector('.bulk-pause');
    const nextRollEl = document.querySelector('.type-meta');

    if (splitChoiceEl) {
      phaseNoticeHtml = `
        <div class="rpo-notice">
          <span>⏱️</span>
          <span><strong>Decision Phase:</strong> Pick an item or <strong>Nothing</strong> ([Enter]).</span>
        </div>
      `;
    } else if (bulkPauseEl) {
      phaseNoticeHtml = `
        <div class="rpo-notice">
          <span>⏸️</span>
          <span><strong>Batch Paused:</strong> Tap a number to modify, or click <strong>Unfold/Skip</strong>.</span>
        </div>
      `;
    } else if (nextRollEl && (nextRollEl.innerText || nextRollEl.textContent || '').includes('Next roll in')) {
      const parent = nextRollEl.parentElement;
      const timeVal = parent ? (parent.innerText || parent.textContent || '').replace('Next roll in', '').trim() : '';
      if (timeVal) {
        phaseNoticeHtml = `
          <div class="rpo-notice countdown">
            <span>⏳</span>
            <span><strong>Cooldown:</strong> Next roll in ${timeVal}.</span>
          </div>
        `;
      }
    }

    // Build Sober Minimalist Layout
    overlayEl.innerHTML = `
      <div class="rpo-header">
        <div class="rpo-brand">
          <div class="rpo-dot"></div>
          <span class="rpo-title">Anthra's AI Brain</span>
        </div>
        <div class="rpo-controls">
          <div class="rpo-segmented">
            <button class="rpo-seg-btn ${isNetMode ? 'active' : ''}" id="rpo-mode-net" title="Show Net Profit (Gross Gain minus Item Cost)">Net</button>
            <button class="rpo-seg-btn ${!isNetMode ? 'active' : ''}" id="rpo-mode-gross" title="Show Gross Gain">Gross</button>
          </div>
          <div class="rpo-segmented">
            <button class="rpo-seg-btn ${showAllItems ? 'active' : ''}" id="rpo-filter-all" title="Show All Items">All</button>
            <button class="rpo-seg-btn ${!showAllItems ? 'active' : ''}" id="rpo-filter-owned" title="Show Only Owned Items in Bag">Bag</button>
          </div>
          <button class="rpo-seg-btn gamble-btn ${isGambleMode ? 'active' : ''}" id="rpo-gamble-btn" title="Toggle Gamble Mode (Show Top 3 Jackpot Gambles)">🎲 Gamble</button>
          <button class="rpo-icon-btn" id="rpo-min-btn" title="Minimize">−</button>
        </div>
      </div>

      <div class="rpo-body">
        <!-- Roll Summary Strip -->
        <div class="rpo-roll-bar">
          <div class="rpo-roll-left">
            <span class="rpo-caption">Current Roll</span>
            <span class="rpo-number" title="${number}">${number}</span>
          </div>
          <div class="rpo-roll-right">
            <span class="rpo-score">${formatCompactEP(baseScore)} EP</span>
            <span class="rpo-tier">${tier}</span>
          </div>
        </div>

        ${phaseNoticeHtml}

        <!-- Recommendation Banner (Best Optimal Play) -->
        ${bestRec ? `
          <div class="rpo-recommendation ${bestRec.res.isRentable ? 'is-profitable' : 'is-neutral'}">
            <span class="rpo-rec-badge">${bestRec.res.isRentable ? 'Best Play' : 'Hold'}</span>
            <div class="rpo-rec-info">
              <div class="rpo-rec-headline">${bestRec.res.isRentable ? `${bestRec.item.emoji} ${bestRec.item.name}` : 'Hold current roll'}</div>
              <div class="rpo-rec-sub">
                ${bestRec.res.isRentable
                  ? `EV: +${formatCompactEP(bestRec.res.expectedNetProfit)} EP • ${Math.round(bestRec.res.winRate)}% win rate`
                  : 'No item provides positive expected profit'}
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Gamble Mode Section (Top 3 Highest Ceilings) -->
        ${isGambleMode ? `
          <div class="rpo-gamble-box">
            <div class="rpo-gamble-header">
              <div class="rpo-gamble-title">
                <span>🎲</span>
                <span>TOP 3 GAMBLE PLAYS</span>
              </div>
              <span class="rpo-gamble-badge">Jackpot Ceilings</span>
            </div>
            <div class="rpo-gamble-list">
              ${top3Gambles.length > 0 ? top3Gambles.map((g, idx) => `
                <div class="rpo-gamble-item" data-id="${g.item.id}" title="Click to view ${g.item.name} details">
                  <div class="rpo-gamble-left">
                    <span class="rpo-gamble-rank">${idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'} #${idx + 1}</span>
                    <span class="rpo-gamble-emoji">${g.item.emoji}</span>
                    <div class="rpo-gamble-meta">
                      <span class="rpo-gamble-name">${g.item.name}</span>
                      <span class="rpo-gamble-odds">Win: ${Math.round(g.res.winRate)}% • Net Win: ${Math.round(g.res.netProfitRate)}%</span>
                    </div>
                  </div>
                  <div class="rpo-gamble-right">
                    <span class="rpo-gamble-jackpot">+${formatCompactEP(g.ceiling)} ${isNetMode ? 'Net' : 'Gross'}</span>
                    <span class="rpo-gamble-tier">${g.res.bestOutcome?.tier || '-'}</span>
                  </div>
                </div>
              `).join('') : `
                <div style="font-size:11px; color:#94a3b8; padding:3px 2px;">
                  No items can achieve a higher score on this roll.
                </div>
              `}
            </div>
          </div>
        ` : ''}

        <!-- Horizontal Item Tabs -->
        <div class="rpo-tabs">
          ${visibleItems.map(item => {
            const r = results[item.id];
            const qty = inv[item.id] || 0;
            const isRentable = r?.isRentable;
            const isActive = item.id === activeItem.id;
            return `
              <button class="rpo-tab ${isActive ? 'is-active' : ''} ${isRentable ? 'is-profitable' : ''} ${qty <= 0 ? 'not-owned' : ''}" data-id="${item.id}">
                <span>${item.emoji}</span>
                <span>${item.name.replace(' Splitter', '')}</span>
                ${qty > 0 ? `<span class="rpo-tab-qty">x${qty}</span>` : ''}
              </button>
            `;
          }).join('')}
        </div>

        <!-- Selected Item Detail Card -->
        ${activeRes && !activeRes.error ? `
          <div class="rpo-item-panel">
            <div class="rpo-panel-header">
              <div class="rpo-panel-title">
                <span class="rpo-panel-emoji">${activeItem.emoji}</span>
                <div>
                  <div class="rpo-panel-name">${activeItem.name}</div>
                  <div class="rpo-panel-cost">Shop price: ${formatCompactEP(activeItem.price)} EP</div>
                </div>
              </div>
              <div class="rpo-verdict-pill ${activeRes.isRentable ? 'profitable' : 'unprofitable'}">
                ${activeRes.isRentable ? 'Profitable' : 'Unprofitable'}
              </div>
            </div>

            <!-- Odds Progress Bar -->
            <div class="rpo-odds-section">
              <div class="rpo-bar-track">
                <div class="rpo-bar-fill win" style="width: ${activeRes.winRate}%;" title="Gross Gain: ${activeRes.winRate.toFixed(1)}%"></div>
                <div class="rpo-bar-fill neutral" style="width: ${activeRes.neutralRate}%;" title="Neutral: ${activeRes.neutralRate.toFixed(1)}%"></div>
                <div class="rpo-bar-fill loss" style="width: ${activeRes.lossRate}%;" title="Loss: ${activeRes.lossRate.toFixed(1)}%"></div>
              </div>
              <div class="rpo-bar-legend">
                <span class="legend-win">Gain ${activeRes.winRate.toFixed(1)}%</span>
                <span class="legend-net">Net Win ${activeRes.netProfitRate.toFixed(1)}%</span>
                <span class="legend-loss">Loss ${activeRes.lossRate.toFixed(1)}%</span>
              </div>
            </div>

            <!-- Scenarios Table -->
            <table class="rpo-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th class="text-right">${isNetMode ? 'Net Profit' : 'Gross Gain'}</th>
                  <th class="text-right">Outcome</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="scen-label">Best</td>
                  <td class="text-right ${activeRes.bestNet >= 0 ? 'num-pos' : 'num-neg'}">
                    ${isNetMode
                      ? (activeRes.bestNet >= 0 ? '+' : '') + formatCompactEP(activeRes.bestNet)
                      : '+' + formatCompactEP(activeRes.bestGross)}
                  </td>
                  <td class="text-right"><span class="tier-cell">${activeRes.bestOutcome?.tier || '-'}</span></td>
                </tr>
                <tr class="row-highlight">
                  <td class="scen-label bold">Expected (EV)</td>
                  <td class="text-right bold ${activeRes.expectedNetProfit >= 0 ? 'num-pos' : 'num-neg'}">
                    ${isNetMode
                      ? (activeRes.expectedNetProfit >= 0 ? '+' : '') + formatCompactEP(activeRes.expectedNetProfit)
                      : (activeRes.expectedGrossDelta >= 0 ? '+' : '') + formatCompactEP(activeRes.expectedGrossDelta)}
                  </td>
                  <td class="text-right scen-label">-</td>
                </tr>
                <tr>
                  <td class="scen-label">Worst</td>
                  <td class="text-right num-neg">
                    ${isNetMode
                      ? formatCompactEP(activeRes.worstNet)
                      : (activeRes.worstGross >= 0 ? '+' : '') + formatCompactEP(activeRes.worstGross)}
                  </td>
                  <td class="text-right"><span class="tier-cell">${activeRes.worstOutcome?.tier || '-'}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        ` : `
          <div class="rpo-item-panel">
            <span style="color:#fb7185;font-size:11px;">${activeRes?.error || 'This item cannot be used on this number.'}</span>
          </div>
        `}
      </div>
    `;

    // Attach Event Listeners
    document.getElementById('rpo-min-btn')?.addEventListener('click', () => {
      isMinimized = true;
      saveLocalSettings();
      updateVisibility();
    });

    document.getElementById('rpo-mode-net')?.addEventListener('click', () => {
      if (!isNetMode) {
        isNetMode = true;
        saveLocalSettings();
        renderOverlay();
      }
    });

    document.getElementById('rpo-mode-gross')?.addEventListener('click', () => {
      if (isNetMode) {
        isNetMode = false;
        saveLocalSettings();
        renderOverlay();
      }
    });

    document.getElementById('rpo-filter-all')?.addEventListener('click', () => {
      if (!showAllItems) {
        showAllItems = true;
        saveLocalSettings();
        renderOverlay();
      }
    });

    document.getElementById('rpo-filter-owned')?.addEventListener('click', () => {
      if (showAllItems) {
        showAllItems = false;
        saveLocalSettings();
        renderOverlay();
      }
    });

    document.getElementById('rpo-gamble-btn')?.addEventListener('click', () => {
      isGambleMode = !isGambleMode;
      saveLocalSettings();
      window.postMessage({ type: 'RNGIDLE_SAVE_SETTING', key: 'rngidle_gamble_mode', value: isGambleMode }, '*');
      renderOverlay();
    });

    overlayEl.querySelectorAll('.rpo-gamble-item').forEach(item => {
      item.addEventListener('click', () => {
        selectedItemId = item.dataset.id;
        renderOverlay();
      });
    });

    // Restore and handle tabs bar scrolling
    const tabsEl = overlayEl.querySelector('.rpo-tabs');
    if (tabsEl) {
      // Restore previous scroll position immediately
      tabsEl.scrollLeft = tabScrollLeft;

      // Mouse wheel horizontal scrolling over the tabs container
      tabsEl.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          tabsEl.scrollLeft += e.deltaY;
          tabScrollLeft = tabsEl.scrollLeft;
        }
      }, { passive: false });

      // Save scroll position on manual drag or scroll
      tabsEl.addEventListener('scroll', () => {
        tabScrollLeft = tabsEl.scrollLeft;
      });

      // Ensure the active selected tab is visible without snapping back to 0
      const activeTab = tabsEl.querySelector('.rpo-tab.is-active');
      if (activeTab) {
        activeTab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
        tabScrollLeft = tabsEl.scrollLeft;
      }
    }

    overlayEl.querySelectorAll('.rpo-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabs = tab.closest('.rpo-tabs');
        if (tabs) tabScrollLeft = tabs.scrollLeft;
        selectedItemId = tab.dataset.id;
        renderOverlay();
      });
    });

    updateInGameButtonBadges();
  }

  // Safe attribute-based badges on buttons - ZERO DOM NODES INJECTED INSIDE REACT TREE!
  function updateInGameButtonBadges() {
    if (!cachedSimulations?.results) return;
    const splitButtons = document.querySelectorAll('.split-item');
    splitButtons.forEach(btn => {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const html = btn.innerHTML.toLowerCase();
      const matched = NUMBER_ITEMS.find(i => {
        const nameLower = i.name.toLowerCase();
        if (aria.includes(nameLower) || html.includes(i.id)) return true;
        if (i.id === 'dss') {
          return aria.includes('digit') || aria.includes('sword') || html.includes('ia-blade') || html.includes('dss');
        }
        return false;
      });
      if (!matched) return;
      const res = cachedSimulations.results[matched.id];
      if (!res || res.error) {
        if (btn.hasAttribute('data-profit')) btn.removeAttribute('data-profit');
        if (btn.hasAttribute('data-rentable')) btn.removeAttribute('data-rentable');
        return;
      }

      // Safe CSS attribute (prevents React removeChild reconciliation crashes)
      const profitText = `${Math.round(res.winRate)}%`;
      const rentableText = res.isRentable ? 'true' : 'false';
      const titleText = `${matched.name} | Expected Net Profit: ${formatCompactEP(res.expectedNetProfit)} EP | Win Rate: ${Math.round(res.winRate)}%`;

      if (btn.getAttribute('data-profit') !== profitText) btn.setAttribute('data-profit', profitText);
      if (btn.getAttribute('data-rentable') !== rentableText) btn.setAttribute('data-rentable', rentableText);
      if (btn.title !== titleText) btn.title = titleText;
    });
  }

  // Core update check - called conservatively
  function tick() {
    const data = detectActiveRollData();
    if (data?.number) {
      // Only recalculate if roll number or score actually changed
      if (data.number !== activeRollNumber || data.totalScore !== activeRollScore) {
        activeRollNumber = data.number;
        activeRollScore = data.totalScore;
        activeRollTier = data.tier;
        computeSimulationsAsync(activeRollNumber, activeRollScore, activeRollTier);
      }
    } else if (!data && activeRollNumber) {
      activeRollNumber = null;
      activeRollScore = null;
      activeRollTier = null;
      cachedSimulations = null;
      renderOverlay();
    }
  }

  function debouncedTick() {
    if (tickTimer) return;
    tickTimer = setTimeout(() => {
      tickTimer = null;
      tick();
    }, 300);
  }

  // Listen for engine ready event
  window.addEventListener('rngidle-mod:engine-ready', () => {
    engineMod = window.__RNGIDLE_ENGINE__;
    tick();
  });

  // Safe MutationObserver that strictly ignores its own overlay & pill mutations
  const observer = new MutationObserver((mutations) => {
    const isOurUI = mutations.every(m =>
      (overlayEl && (overlayEl === m.target || overlayEl.contains(m.target))) ||
      (pillEl && (pillEl === m.target || pillEl.contains(m.target)))
    );
    if (isOurUI) return;
    debouncedTick();
  });

  function startObservation() {
    ensureUIElements();
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
    setInterval(debouncedTick, 1000);
    debouncedTick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObservation);
  } else {
    startObservation();
  }

  console.log('[RNGidle Mod by anthrakys] Loaded successfully (v1.2.0)!');
})();
