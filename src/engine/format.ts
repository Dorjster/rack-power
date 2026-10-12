/** Display formatting only — never feed these strings back into calculations. */
export const fmtNum = (x: number | null | undefined, digits = 2): string =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : Number(x.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits });

export const fmtW = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? '—' : `${fmtNum(x, digits)} W`);
export const fmtKw = (x: number | null | undefined, digits = 2) => (x === null || x === undefined ? '—' : `${fmtNum(x / 1000, digits)} kW`);
export const fmtA = (x: number | null | undefined, digits = 2) => (x === null || x === undefined ? '—' : `${fmtNum(x, digits)} A`);
export const fmtV = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${fmtNum(x, 1)} V`);
export const fmtPct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${fmtNum(x * 100, digits)}%`);
export const fmtVa = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${fmtNum(x / 1000, 2)} kVA`);
export const fmtBtu = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${fmtNum(x, 0)} BTU/h`);
