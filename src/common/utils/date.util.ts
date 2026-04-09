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

  const day = Number(match[1]);
  const month = Number(match[2]);
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
