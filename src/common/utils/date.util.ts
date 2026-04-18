export function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function parseDmyDate(input: string | null | undefined): Date | null {
  if (!input) {
    return null;
  }

  const clean = input.trim();
  if (!clean) {
    return null;
  }

  const match = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) {
    return null;
  }

  // Opera Cloud reports commonly emit dates as MM/DD/YY (for example 06/04/25 = Jun 04, 2025).
  // Fallback swaps values when first component is clearly not a month.
  let month = Number(match[1]);
  let day = Number(match[2]);
  if (month > 12 && day <= 12) {
    const tmp = month;
    month = day;
    day = tmp;
  }

  let year = Number(match[3]);

  if (year < 100) {
    year += year >= 70 ? 1900 : 2000;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export function parseOperaDate(input: string | null | undefined): Date | null {
  if (!input) {
    return null;
  }

  const clean = input.trim().toUpperCase();
  if (!clean) {
    return null;
  }

  const match = clean.match(/^(\d{1,2})-([A-Z]{3})-(\d{2}|\d{4})$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const monthToken = match[2];
  let year = Number(match[3]);
  if (year < 100) {
    year += year >= 70 ? 1900 : 2000;
  }

  const monthMap: Record<string, number> = {
    JAN: 1,
    FEB: 2,
    MAR: 3,
    APR: 4,
    MAY: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    NOV: 11,
    DEC: 12
  };

  const month = monthMap[monthToken];
  if (!month) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export function parseIsoDate(input: string | null | undefined): Date | null {
  if (!input) {
    return null;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return toUtcDateOnly(parsed);
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function enumerateDateRange(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cursor = toUtcDateOnly(start);
  const limit = toUtcDateOnly(end);

  while (cursor <= limit) {
    out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return out;
}
