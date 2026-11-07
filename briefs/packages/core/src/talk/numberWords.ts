const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: readonly [bigint, string][] = [[1_000_000_000_000n, "trillion"], [1_000_000_000n, "billion"], [1_000_000n, "million"], [1_000n, "thousand"]];
const ORDINAL_WORDS: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

function belowThousand(n: number): string {
  const words: string[] = [];
  if (n >= 100) {
    words.push(ONES[Math.floor(n / 100)]!, "hundred");
    n %= 100;
    if (n === 0) return words.join(" ");
  }
  if (n < 20) words.push(ONES[n]!);
  else words.push(TENS[Math.floor(n / 10)]!, ...(n % 10 === 0 ? [] : [ONES[n % 10]!]));
  return words.join(" ");
}

/** "1205" to "one thousand two hundred five" (no hyphens, no "and"). Up to the trillions. */
export function cardinal(value: number | bigint): string {
  let n = BigInt(value);
  if (n < 0n) return `minus ${cardinal(-n)}`;
  if (n < 1000n) return belowThousand(Number(n));
  const words: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      words.push(cardinal(n / size), name);
      n %= size;
    }
  }
  if (n > 0n) words.push(belowThousand(Number(n)));
  return words.join(" ");
}

/** "2" to "second", "21" to "twenty first". */
export function ordinal(value: number | bigint): string {
  const words = cardinal(value).split(" ");
  const last = words.pop()!;
  const special = ORDINAL_WORDS[last];
  words.push(special ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`));
  return words.join(" ");
}

/** Each digit as a word: "0147" to "zero one four seven". */
export function digitWords(digits: string): string {
  return [...digits].map((digit) => ONES[Number(digit)]!).join(" ");
}

/** A year: "2026" to "twenty twenty six", "1900" to "nineteen hundred", "2005" to "two thousand five". */
export function yearWords(year: number): string {
  if (year < 1000 || year > 9999) return cardinal(year);
  const high = Math.floor(year / 100);
  const low = year % 100;
  if (year % 1000 === 0 || (high % 10 === 0 && low < 10)) return cardinal(year);
  if (low === 0) return `${cardinal(high)} hundred`;
  return `${cardinal(high)} ${low < 10 ? `oh ${ONES[low]!}` : cardinal(low)}`;
}

/** "3.25" to "three point two five". */
export function decimalWords(text: string): string {
  const [whole, fraction] = text.split(".");
  return fraction === undefined || fraction.length === 0 ? cardinal(BigInt(whole!)) : `${cardinal(BigInt(whole!))} point ${digitWords(fraction)}`;
}
