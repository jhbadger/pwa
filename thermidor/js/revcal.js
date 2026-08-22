// French Republican Calendar conversion, ported from the original Android app's
// RevDate.java and DecimalTime.java (ttaxus/Thermidor). The leap-year rule below is
// copied as-is from that source, quirks included, so results match the Android app.

const EPOCH_UTC_DAYS = Date.UTC(1792, 8, 22) / 86400000; // 22 September 1792, start of Year I

function yearLength(year) {
  if (year === 3 || year === 7 || year === 11 || year === 15 || year === 20) return 366;
  if (year > 20 && ((year % 4 === 0 && year % 100 > 0) || year % 400 === 0)) return 366;
  return 365;
}

function toRoman(n) {
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let s = '';
  for (const [value, symbol] of table) {
    while (n >= value) {
      s += symbol;
      n -= value;
    }
  }
  return s;
}

// date: a JS Date, interpreted by its local year/month/day (matches the Android
// app reading the DatePicker's local calendar fields).
export function fromGregorian(date) {
  const utcDays = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  let days = utcDays - EPOCH_UTC_DAYS;
  let year = 1;
  let len = yearLength(year);
  while (days >= len) {
    days -= len;
    year += 1;
    len = yearLength(year);
  }
  const month = 1 + Math.floor(days / 30);
  const day = 1 + (days % 30);
  return { year, month, day };
}

export function formatRevDate(revDate, months) {
  const { year, month, day } = revDate;
  return `${day} ${months[month - 1]} ${toRoman(year)} (${year})`;
}

export function daySymbol(revDate, dayNames) {
  const index = 30 * (revDate.month - 1) + (revDate.day - 1);
  return dayNames[index];
}

// Decimal time: the day divided into 10 hours of 100 minutes of 100 seconds,
// measured from local midnight of `now`.
export function decimalTime(now) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dectime = (now.getTime() - midnight.getTime()) / 86400000;
  const hours = Math.floor(dectime * 10);
  const minutes = Math.floor(dectime * 1000) - hours * 100;
  const seconds = Math.floor(dectime * 100000) - hours * 10000 - minutes * 100;
  const pad = (n) => String(n).padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}
