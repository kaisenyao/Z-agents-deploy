import { fetchHistoricalPrices, type HistoricalPricePoint } from './historicalPriceService';

const OPTION_TICKER_PATTERN = /^([A-Z]{1,6})\d{6}[CP]\d{8}$/;
const HOLDING_HISTORY_START_DATE = '2017-01-01';
const MIN_SHARED_OBSERVATIONS = 24;
const FRONTIER_SAMPLE_COUNT = 100;
const FALLBACK_ANNUAL_RISK_FREE_RATE = 0.02;
const SOLVER_TOLERANCE = 1e-8;

export interface EfficientFrontierHoldingInput {
  ticker: string;
  name: string;
  amount: number;
}

export interface EfficientFrontierExcludedAsset {
  ticker: string;
  name: string;
  amount: number;
  reason: string;
}

export interface EfficientFrontierModeledAsset {
  ticker: string;
  name: string;
  amount: number;
  weight: number;
}

export interface EfficientFrontierPortfolio {
  label: string;
  shortLabel: string;
  optimizationLabel: string;
  expectedReturn: number;
  volatility: number;
  sharpe: number | null;
  weights: Record<string, number>;
  targetReturn: number;
}

export interface EfficientFrontierSingleAssetPoint {
  ticker: string;
  name: string;
  expectedReturn: number;
  volatility: number;
  sharpe: number | null;
}

export interface EfficientFrontierUniverse {
  tickers: string[];
  assetCount: number;
  sharedMonthlyObservations: number;
  annualRiskFreeRate: number;
  riskFreeRateSource: 'proxy' | 'fallback';
  startDate: string;
  endDate: string;
}

export interface EfficientFrontierDiagnostics {
  attemptedAssetCount: number;
  usableAssetCount: number;
  sharedMonthlyObservations: number;
  droppedForOverlap: string[];
}

export interface EfficientFrontierAnalysis {
  frontierPortfolios: EfficientFrontierPortfolio[];
  singleAssetPoints: EfficientFrontierSingleAssetPoint[];
  currentPortfolio: EfficientFrontierPortfolio;
  maxSharpePortfolio: EfficientFrontierPortfolio;
  minimumVolatilityPortfolio: EfficientFrontierPortfolio;
  universe: EfficientFrontierUniverse;
  diagnostics: EfficientFrontierDiagnostics;
  excludedAssets: EfficientFrontierExcludedAsset[];
  modeledSubset: EfficientFrontierModeledAsset[];
}

interface NormalizedHolding {
  ticker: string;
  name: string;
  amount: number;
}

interface AssetHistory {
  ticker: string;
  name: string;
  amount: number;
  priceSeries: HistoricalPricePoint[];
  priceMap: Map<string, number>;
  returnMap: Map<string, number>;
  returnDates: string[];
  returnCount: number;
}

function normalizeTicker(ticker: string): string {
  return String(ticker || '').trim().toUpperCase();
}

function getHoldingHistoryEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatMonthKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function deduplicateAndNormalizeHoldings(holdings: EfficientFrontierHoldingInput[]): NormalizedHolding[] {
  const merged = new Map<string, NormalizedHolding>();

  for (const holding of holdings) {
    const ticker = normalizeTicker(holding.ticker);
    const amount = Number(holding.amount);
    if (!ticker || !Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const existing = merged.get(ticker);
    if (existing) {
      existing.amount += amount;
      if (!existing.name && holding.name) {
        existing.name = holding.name;
      }
    } else {
      merged.set(ticker, {
        ticker,
        name: String(holding.name || ticker).trim() || ticker,
        amount,
      });
    }
  }

  return Array.from(merged.values());
}

function buildReturnSeries(priceSeries: HistoricalPricePoint[]): { returnDates: string[]; returnMap: Map<string, number>; priceMap: Map<string, number> } {
  const sorted = [...priceSeries]
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price) && point.price > 0)
    .sort((left, right) => left.timestamp - right.timestamp);
  const priceMap = new Map<string, number>();
  const returnMap = new Map<string, number>();
  const returnDates: string[] = [];

  for (const point of sorted) {
    priceMap.set(formatMonthKey(point.timestamp), point.price);
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!(previous.price > 0 && current.price > 0)) {
      continue;
    }

    const monthlyReturn = (current.price / previous.price) - 1;
    const monthKey = formatMonthKey(current.timestamp);
    if (!Number.isFinite(monthlyReturn)) {
      continue;
    }

    returnMap.set(monthKey, monthlyReturn);
    returnDates.push(monthKey);
  }

  return { returnDates, returnMap, priceMap };
}

function intersectDates(assets: AssetHistory[]): string[] {
  if (!assets.length) {
    return [];
  }

  let sharedDates = [...assets[0].returnDates];
  for (let index = 1; index < assets.length; index += 1) {
    const available = new Set(assets[index].returnDates);
    sharedDates = sharedDates.filter((date) => available.has(date));
    if (!sharedDates.length) {
      return [];
    }
  }

  return sharedDates.sort();
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + (value * (right[index] || 0)), 0);
}

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => dot(row, vector));
}

function buildCovarianceMatrix(rows: number[][], means: number[]): number[][] {
  const assetCount = means.length;
  const denominator = Math.max(rows.length - 1, 1);
  const covariance = Array.from({ length: assetCount }, () => Array.from({ length: assetCount }, () => 0));

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    for (let left = 0; left < assetCount; left += 1) {
      const leftDelta = row[left] - means[left];
      for (let right = left; right < assetCount; right += 1) {
        const value = leftDelta * (row[right] - means[right]);
        covariance[left][right] += value;
        if (left !== right) {
          covariance[right][left] += value;
        }
      }
    }
  }

  for (let row = 0; row < assetCount; row += 1) {
    for (let column = 0; column < assetCount; column += 1) {
      covariance[row][column] = (covariance[row][column] / denominator) * 12;
    }
  }

  return covariance;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = matrix.length;
  if (!size || vector.length !== size) {
    return null;
  }

  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    let pivotValue = Math.abs(augmented[column][column]);

    for (let candidate = column + 1; candidate < size; candidate += 1) {
      const candidateValue = Math.abs(augmented[candidate][column]);
      if (candidateValue > pivotValue) {
        pivotValue = candidateValue;
        pivotRow = candidate;
      }
    }

    if (pivotValue < SOLVER_TOLERANCE) {
      return null;
    }

    if (pivotRow !== column) {
      [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    }

    const pivot = augmented[column][column];
    for (let current = column; current <= size; current += 1) {
      augmented[column][current] /= pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = augmented[row][column];
      if (Math.abs(factor) < SOLVER_TOLERANCE) {
        continue;
      }

      for (let current = column; current <= size; current += 1) {
        augmented[row][current] -= factor * augmented[column][current];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function solveActiveSetWeights(
  expectedReturns: number[],
  covariance: number[][],
  targetReturn: number | null,
): number[] | null {
  let active = expectedReturns.map((_, index) => index);

  while (active.length > 0) {
    const activeCovariance = active.map((row) => active.map((column) => covariance[row][column]));
    for (let index = 0; index < activeCovariance.length; index += 1) {
      activeCovariance[index][index] += 1e-8;
    }

    const constraints: number[][] = [active.map(() => 1)];
    const constraintTargets = [1];
    if (targetReturn !== null) {
      constraints.push(active.map((index) => expectedReturns[index]));
      constraintTargets.push(targetReturn);
    }

    if (active.length === 1) {
      const onlyIndex = active[0];
      if (targetReturn !== null && Math.abs(expectedReturns[onlyIndex] - targetReturn) > 1e-6) {
        return null;
      }

      const fullWeights = expectedReturns.map(() => 0);
      fullWeights[onlyIndex] = 1;
      return fullWeights;
    }

    const size = active.length + constraints.length;
    const system = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    const vector = Array.from({ length: size }, () => 0);

    for (let row = 0; row < active.length; row += 1) {
      for (let column = 0; column < active.length; column += 1) {
        system[row][column] = activeCovariance[row][column];
      }
    }

    for (let constraintIndex = 0; constraintIndex < constraints.length; constraintIndex += 1) {
      const constraint = constraints[constraintIndex];
      const systemRow = active.length + constraintIndex;
      vector[systemRow] = constraintTargets[constraintIndex];

      for (let column = 0; column < active.length; column += 1) {
        system[column][systemRow] = constraint[column];
        system[systemRow][column] = constraint[column];
      }
    }

    const solution = solveLinearSystem(system, vector);
    if (!solution) {
      return null;
    }

    const activeWeights = solution.slice(0, active.length);
    let mostNegativeIndex = -1;
    let mostNegativeWeight = 0;

    for (let index = 0; index < activeWeights.length; index += 1) {
      if (activeWeights[index] < mostNegativeWeight) {
        mostNegativeWeight = activeWeights[index];
        mostNegativeIndex = index;
      }
    }

    if (mostNegativeWeight >= -1e-7) {
      const fullWeights = expectedReturns.map(() => 0);
      active.forEach((assetIndex, index) => {
        fullWeights[assetIndex] = Math.max(activeWeights[index], 0);
      });

      const totalWeight = fullWeights.reduce((sum, value) => sum + value, 0);
      if (totalWeight <= 0) {
        return null;
      }

      return fullWeights.map((value) => value / totalWeight);
    }

    active = active.filter((_, index) => index !== mostNegativeIndex);
  }

  return null;
}

function computePortfolioReturn(expectedReturns: number[], weights: number[]): number {
  return dot(expectedReturns, weights);
}

function computePortfolioVolatility(covariance: number[][], weights: number[]): number {
  const variance = dot(weights, multiplyMatrixVector(covariance, weights));
  return Math.sqrt(Math.max(variance, 0));
}

function computeSharpe(expectedReturn: number, volatility: number, annualRiskFreeRate: number): number | null {
  if (!(volatility > 0)) {
    return null;
  }

  const sharpe = (expectedReturn - annualRiskFreeRate) / volatility;
  return Number.isFinite(sharpe) ? sharpe : null;
}

function createWeightMap(tickers: string[], weights: number[]): Record<string, number> {
  return tickers.reduce<Record<string, number>>((accumulator, ticker, index) => {
    accumulator[ticker] = weights[index] || 0;
    return accumulator;
  }, {});
}

function createPortfolio(
  tickers: string[],
  expectedReturns: number[],
  covariance: number[][],
  annualRiskFreeRate: number,
  weights: number[],
  labels: { label: string; shortLabel: string; optimizationLabel: string },
): EfficientFrontierPortfolio {
  const expectedReturn = computePortfolioReturn(expectedReturns, weights);
  const volatility = computePortfolioVolatility(covariance, weights);
  const sharpe = computeSharpe(expectedReturn, volatility, annualRiskFreeRate);

  return {
    ...labels,
    expectedReturn,
    volatility,
    sharpe,
    weights: createWeightMap(tickers, weights),
    targetReturn: expectedReturn,
  };
}

function pruneDominatedPortfolios(portfolios: EfficientFrontierPortfolio[]): EfficientFrontierPortfolio[] {
  const sorted = [...portfolios].sort((left, right) => {
    if (Math.abs(left.volatility - right.volatility) > 1e-9) {
      return left.volatility - right.volatility;
    }

    return right.expectedReturn - left.expectedReturn;
  });
  const pruned: EfficientFrontierPortfolio[] = [];
  let bestReturnSeen = -Infinity;

  for (const portfolio of sorted) {
    if (portfolio.expectedReturn > bestReturnSeen + 1e-7) {
      pruned.push(portfolio);
      bestReturnSeen = portfolio.expectedReturn;
    }
  }

  return pruned;
}

function buildModeledSubset(assets: AssetHistory[]): EfficientFrontierModeledAsset[] {
  const totalModeledAmount = assets.reduce((sum, asset) => sum + asset.amount, 0);

  return assets.map((asset) => ({
    ticker: asset.ticker,
    name: asset.name,
    amount: asset.amount,
    weight: totalModeledAmount > 0 ? asset.amount / totalModeledAmount : 0,
  }));
}

function pickAnnualRiskFreeRate(sharedDates: string[], riskFreeSeries: HistoricalPricePoint[]): {
  annualRiskFreeRate: number;
  source: 'proxy' | 'fallback';
} {
  const riskFreeMap = new Map<string, number>();
  for (const point of riskFreeSeries) {
    riskFreeMap.set(formatMonthKey(point.timestamp), point.price);
  }

  const overlappingYields = sharedDates
    .map((date) => riskFreeMap.get(date))
    .filter((value): value is number => Number.isFinite(value))
    .map((value) => value / 100)
    .filter((value) => value >= 0 && value < 1);

  if (overlappingYields.length >= 12) {
    return {
      annualRiskFreeRate: average(overlappingYields),
      source: 'proxy',
    };
  }

  return {
    annualRiskFreeRate: FALLBACK_ANNUAL_RISK_FREE_RATE,
    source: 'fallback',
  };
}

async function loadAssetHistory(holding: NormalizedHolding): Promise<AssetHistory | null> {
  const historyEndDate = getHoldingHistoryEndDate();
  const priceSeries = await fetchHistoricalPrices(holding.ticker, {
    startDate: HOLDING_HISTORY_START_DATE,
    endDate: historyEndDate,
    interval: '1mo',
    useAdjustedClose: true,
  });

  if (priceSeries.length < MIN_SHARED_OBSERVATIONS + 1) {
    return null;
  }

  const { returnDates, returnMap, priceMap } = buildReturnSeries(priceSeries);
  if (returnDates.length < MIN_SHARED_OBSERVATIONS) {
    return null;
  }

  return {
    ticker: holding.ticker,
    name: holding.name,
    amount: holding.amount,
    priceSeries,
    priceMap,
    returnMap,
    returnDates,
    returnCount: returnDates.length,
  };
}

export async function buildEfficientFrontierAnalysis(
  holdings: EfficientFrontierHoldingInput[],
): Promise<EfficientFrontierAnalysis | null> {
  const historyEndDate = getHoldingHistoryEndDate();
  const normalizedHoldings = deduplicateAndNormalizeHoldings(holdings);
  const excludedAssets: EfficientFrontierExcludedAsset[] = [];

  for (const holding of holdings) {
    const ticker = normalizeTicker(holding.ticker);
    const amount = Number(holding.amount);
    if (!ticker || !Number.isFinite(amount) || amount <= 0) {
      excludedAssets.push({
        ticker,
        name: String(holding.name || ticker).trim() || ticker,
        amount: Number.isFinite(amount) ? amount : 0,
        reason: 'Invalid or non-positive holding',
      });
    }
  }

  const candidateHoldings = normalizedHoldings.filter((holding) => {
    if (OPTION_TICKER_PATTERN.test(holding.ticker)) {
      excludedAssets.push({
        ticker: holding.ticker,
        name: holding.name,
        amount: holding.amount,
        reason: 'Option contracts are excluded from the efficient frontier model',
      });
      return false;
    }

    return true;
  });

  if (candidateHoldings.length < 2) {
    return null;
  }

  const histories = await Promise.all(candidateHoldings.map((holding) => loadAssetHistory(holding)));
  let usableAssets = histories.filter((history): history is AssetHistory => history !== null);

  for (let index = 0; index < candidateHoldings.length; index += 1) {
    if (!histories[index]) {
      excludedAssets.push({
        ticker: candidateHoldings[index].ticker,
        name: candidateHoldings[index].name,
        amount: candidateHoldings[index].amount,
        reason: 'Insufficient monthly history to model this asset',
      });
    }
  }

  if (usableAssets.length < 2) {
    return null;
  }

  const droppedForOverlap: string[] = [];
  let sharedDates = intersectDates(usableAssets);

  while (sharedDates.length < MIN_SHARED_OBSERVATIONS && usableAssets.length > 2) {
    const shortestAsset = [...usableAssets].sort((left, right) => left.returnCount - right.returnCount)[0];
    usableAssets = usableAssets.filter((asset) => asset.ticker !== shortestAsset.ticker);
    droppedForOverlap.push(shortestAsset.ticker);
    excludedAssets.push({
      ticker: shortestAsset.ticker,
      name: shortestAsset.name,
      amount: shortestAsset.amount,
      reason: 'Dropped to maximize shared monthly overlap across modeled assets',
    });
    sharedDates = intersectDates(usableAssets);
  }

  if (usableAssets.length < 2 || sharedDates.length < MIN_SHARED_OBSERVATIONS) {
    return null;
  }

  const rows = sharedDates.map((date) => usableAssets.map((asset) => asset.returnMap.get(date) || 0));
  const monthlyMeans = usableAssets.map((_, assetIndex) => average(rows.map((row) => row[assetIndex])));
  const annualExpectedReturns = monthlyMeans.map((value) => value * 12);
  const annualCovariance = buildCovarianceMatrix(rows, monthlyMeans);
  const tickers = usableAssets.map((asset) => asset.ticker);
  const modeledSubset = buildModeledSubset(usableAssets);
  const modeledWeights = modeledSubset.map((asset) => asset.weight);

  const riskFreeSeries = await fetchHistoricalPrices('^IRX', {
    startDate: HOLDING_HISTORY_START_DATE,
    endDate: historyEndDate,
    interval: '1mo',
    useAdjustedClose: false,
  });
  const { annualRiskFreeRate, source: riskFreeRateSource } = pickAnnualRiskFreeRate(sharedDates, riskFreeSeries);

  const providedPortfolioLabels = excludedAssets.length > 0
    ? {
        label: 'Modeled Portfolio Subset',
        shortLabel: 'Modeled Portfolio',
        optimizationLabel: 'Provided / Modeled',
      }
    : {
        label: 'Provided Portfolio',
        shortLabel: 'Provided Portfolio',
        optimizationLabel: 'Provided / Modeled',
      };

  const currentPortfolio = createPortfolio(
    tickers,
    annualExpectedReturns,
    annualCovariance,
    annualRiskFreeRate,
    modeledWeights,
    providedPortfolioLabels,
  );

  const minimumVolatilityWeights = solveActiveSetWeights(annualExpectedReturns, annualCovariance, null);
  if (!minimumVolatilityWeights) {
    return null;
  }

  const minimumVolatilityPortfolio = createPortfolio(
    tickers,
    annualExpectedReturns,
    annualCovariance,
    annualRiskFreeRate,
    minimumVolatilityWeights,
    {
      label: 'Minimum Volatility Portfolio',
      shortLabel: 'Min Vol',
      optimizationLabel: 'Minimum Volatility',
    },
  );

  const maxReturnIndex = annualExpectedReturns.reduce(
    (bestIndex, value, index, values) => value > values[bestIndex] ? index : bestIndex,
    0,
  );
  const maxReturnWeights = annualExpectedReturns.map((_, index) => index === maxReturnIndex ? 1 : 0);
  const maxReturnPortfolio = createPortfolio(
    tickers,
    annualExpectedReturns,
    annualCovariance,
    annualRiskFreeRate,
    maxReturnWeights,
    {
      label: `${tickers[maxReturnIndex]} Corner Portfolio`,
      shortLabel: tickers[maxReturnIndex],
      optimizationLabel: 'Max Return Corner',
    },
  );

  const targetStart = minimumVolatilityPortfolio.expectedReturn;
  const targetEnd = maxReturnPortfolio.expectedReturn;
  const frontierCandidates: EfficientFrontierPortfolio[] = [minimumVolatilityPortfolio, maxReturnPortfolio];

  for (let step = 0; step < FRONTIER_SAMPLE_COUNT; step += 1) {
    const ratio = FRONTIER_SAMPLE_COUNT === 1 ? 0 : step / (FRONTIER_SAMPLE_COUNT - 1);
    const targetReturn = targetStart + ((targetEnd - targetStart) * ratio);
    const weights = solveActiveSetWeights(annualExpectedReturns, annualCovariance, targetReturn);

    if (!weights) {
      continue;
    }

    frontierCandidates.push(createPortfolio(
      tickers,
      annualExpectedReturns,
      annualCovariance,
      annualRiskFreeRate,
      weights,
      {
        label: `Frontier ${step + 1}`,
        shortLabel: `F${step + 1}`,
        optimizationLabel: `Target Return ${(targetReturn * 100).toFixed(1)}%`,
      },
    ));
  }

  const frontierPortfolios = pruneDominatedPortfolios(frontierCandidates)
    .sort((left, right) => left.volatility - right.volatility)
    .map((portfolio, index) => ({
      ...portfolio,
      label: `Frontier Portfolio ${index + 1}`,
      shortLabel: `F${index + 1}`,
      optimizationLabel: `Frontier Portfolio ${index + 1}`,
    }));

  if (!frontierPortfolios.length) {
    return null;
  }

  const maxSharpePortfolio = frontierPortfolios.reduce((best, portfolio) => {
    if (best.sharpe === null) {
      return portfolio;
    }

    if (portfolio.sharpe === null) {
      return best;
    }

    return portfolio.sharpe > best.sharpe ? portfolio : best;
  }, frontierPortfolios[0]);

  const singleAssetPoints = usableAssets.map((asset, index) => {
    const expectedReturn = annualExpectedReturns[index];
    const volatility = Math.sqrt(Math.max(annualCovariance[index][index], 0));

    return {
      ticker: asset.ticker,
      name: asset.name,
      expectedReturn,
      volatility,
      sharpe: computeSharpe(expectedReturn, volatility, annualRiskFreeRate),
    };
  });

  return {
    frontierPortfolios,
    singleAssetPoints,
    currentPortfolio,
    maxSharpePortfolio: {
      ...maxSharpePortfolio,
      label: 'Tangency Portfolio',
      shortLabel: 'Tangency',
      optimizationLabel: 'Tangency Portfolio',
    },
    minimumVolatilityPortfolio,
    universe: {
      tickers,
      assetCount: tickers.length,
      sharedMonthlyObservations: sharedDates.length,
      annualRiskFreeRate,
      riskFreeRateSource,
      startDate: sharedDates[0],
      endDate: sharedDates[sharedDates.length - 1],
    },
    diagnostics: {
      attemptedAssetCount: normalizedHoldings.length,
      usableAssetCount: usableAssets.length,
      sharedMonthlyObservations: sharedDates.length,
      droppedForOverlap,
    },
    excludedAssets,
    modeledSubset,
  };
}
