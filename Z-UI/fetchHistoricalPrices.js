#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yfModule = require('yahoo-finance2');
let yahooFinance = yfModule.default || yfModule;
// If the module exported a constructor, try to instantiate it.
try {
  if (typeof yahooFinance === 'function') {
    // some versions export a class as the default
    try {
      const inst = new yahooFinance();
      yahooFinance = inst;
    } catch (e) {
      // not constructable — leave as-is
    }
  }
  // if the top-level module exposes a YahooFinance class, instantiate it
  if ((!yahooFinance || !yahooFinance.historical) && yfModule && yfModule.YahooFinance) {
    yahooFinance = new yfModule.YahooFinance();
  }
} catch (e) {
  console.warn('yahoo-finance2 init warning:', e && e.message);
}

const holdingsPath = path.join(__dirname, 'src', 'data', 'portfolioHoldings.ts');

function findObjectBlock(source, symbol) {
  const idx = source.indexOf(`symbol: '${symbol}'`);
  if (idx === -1) return null;
  const blockStart = source.lastIndexOf('{', idx);
  // find the end of this object by locating the next '},' after idx
  let blockEnd = source.indexOf('},', idx);
  if (blockEnd === -1) {
    blockEnd = source.indexOf('}', idx);
  }
  if (blockStart === -1 || blockEnd === -1) return null;
  return { start: blockStart, end: blockEnd + 1, text: source.slice(blockStart, blockEnd + 1) };
}

function safeDateOnly(iso) {
  return iso.split('T')[0];
}

(async () => {
  if (!fs.existsSync(holdingsPath)) {
    console.error('holdings file not found at', holdingsPath);
    process.exit(1);
  }

  let src = fs.readFileSync(holdingsPath, 'utf8');

  // collect stock symbols in the STOCK_HOLDINGS section only
  const stockSectionMatch = src.match(/export const STOCK_HOLDINGS[\s\S]*?\];/);
  const stockSection = stockSectionMatch ? stockSectionMatch[0] : null;
  if (!stockSection) {
    console.error('Could not find STOCK_HOLDINGS section in file.');
    process.exit(1);
  }

  const symbolRegex = /symbol:\s*'([A-Z0-9.]+)'/g;
  const symbols = [];
  let m;
  while ((m = symbolRegex.exec(stockSection)) !== null) symbols.push(m[1]);
  const uniqueSymbols = [...new Set(symbols)];

  console.log('Found stock symbols:', uniqueSymbols.join(', '));

  for (const sym of uniqueSymbols) {
    const block = findObjectBlock(stockSection, sym);
    if (!block) continue;
    const purchaseDateMatch = block.text.match(/purchaseDate:\s*'([^']+)'/);
    if (!purchaseDateMatch) {
      console.log(sym, 'has no purchaseDate — skipping');
      continue;
    }
    const purchaseDate = purchaseDateMatch[1];
    const dateOnly = safeDateOnly(purchaseDate);

    console.log(`Fetching historical for ${sym} on ${dateOnly}`);
    let purchasePrice = null;
    try {
      const period1 = dateOnly;
      const dt = new Date(dateOnly);
      dt.setDate(dt.getDate() + 1);
      const period2 = dt.toISOString().slice(0,10);
      const hist = await yahooFinance.historical(sym, { period1, period2, interval: '1d' });
      if (Array.isArray(hist) && hist.length > 0) {
        const h = hist[0];
        purchasePrice = h.adjclose ?? h.adjClose ?? h.close ?? (h.close && h.close.price) ?? null;
        if (purchasePrice != null) console.log(`   (used ${h.adjclose ? 'adjclose' : h.adjClose ? 'adjClose' : 'close'})`);
      }
    } catch (err) {
      console.warn('historical fetch failed for', sym, err && err.message);
    }

    if (purchasePrice == null) {
      // try with a small window around the date
      const start = new Date(dateOnly);
      start.setDate(start.getDate() - 2);
      const end = new Date(dateOnly);
      end.setDate(end.getDate() + 2);
      try {
        const hist2 = await yahooFinance.historical(sym, { period1: start.toISOString().slice(0,10), period2: end.toISOString().slice(0,10), interval: '1d' });
        if (Array.isArray(hist2) && hist2.length > 0) {
          const candidate = hist2.find(h => (h.date && h.date.toISOString().slice(0,10) === dateOnly)) || hist2[0];
          purchasePrice = candidate.adjclose ?? candidate.adjClose ?? candidate.close ?? (candidate.close && candidate.close.price) ?? null;
          if (purchasePrice != null) console.log(`   (fallback used ${candidate.adjclose ? 'adjclose' : candidate.adjClose ? 'adjClose' : 'close'})`);
        }
      } catch (err) {
        console.warn('fallback historical fetch failed for', sym, err && err.message);
      }
    }

    // fetch current quote
    let currentPrice = null;
    let todayChange = null;
    try {
      const quote = await yahooFinance.quote(sym);
      if (quote) {
        currentPrice = quote.regularMarketPrice ?? quote.postMarketPrice ?? quote.preMarketPrice ?? null;
        todayChange = quote.regularMarketChangePercent ?? null;
      }
    } catch (err) {
      console.warn('quote fetch failed for', sym, err && err.message);
    }

    // apply replacements within the STOCK_HOLDINGS section text
    let newBlockText = block.text;
    if (purchasePrice != null) {
      if (/purchasePrice:\s*[0-9]+\.?[0-9]*/.test(newBlockText)) {
        newBlockText = newBlockText.replace(/purchasePrice:\s*[0-9]+\.?[0-9]*/g, `purchasePrice: ${purchasePrice.toFixed(2)}`);
        console.log(` - ${sym} purchasePrice -> ${purchasePrice.toFixed(2)}`);
      } else {
        // insert purchasePrice before purchaseDate line
        newBlockText = newBlockText.replace(/(purchaseDate:\s*'[^']+'\s*,?)/, `purchasePrice: ${purchasePrice.toFixed(2)},\n    $1`);
        console.log(` - ${sym} purchasePrice inserted -> ${purchasePrice.toFixed(2)}`);
      }
    }
    if (currentPrice != null) {
      if (/currentPrice:\s*[0-9]+\.?[0-9]*/.test(newBlockText)) {
        newBlockText = newBlockText.replace(/currentPrice:\s*[0-9]+\.?[0-9]*/g, `currentPrice: ${currentPrice.toFixed(2)}`);
        console.log(` - ${sym} currentPrice -> ${currentPrice.toFixed(2)}`);
      } else {
        // insert currentPrice near top
        newBlockText = newBlockText.replace(/(description:\s*'[^']+'\s*,?)/, `$1\n    currentPrice: ${currentPrice.toFixed(2)},`);
        console.log(` - ${sym} currentPrice inserted -> ${currentPrice.toFixed(2)}`);
      }
    }
    if (todayChange != null) {
      if (/todayChange:\s*-?[0-9]+\.?[0-9]*/.test(newBlockText)) {
        newBlockText = newBlockText.replace(/todayChange:\s*-?[0-9]+\.?[0-9]*/g, `todayChange: ${todayChange.toFixed(2)}`);
      }
    }

    // replace the block inside stockSection
    src = src.replace(block.text, newBlockText);
  }

  // write back file
  fs.writeFileSync(holdingsPath, src, 'utf8');
  console.log('Updated holdings written to', holdingsPath);
})();
