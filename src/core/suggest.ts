// "Did you mean ...?" for typos in ids and keys.

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = old
    }
  }
  return row[b.length]
}

/** The closest option to `word`, if it's close enough to be a likely typo. */
export function suggest(word: string, options: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestDistance = Infinity
  for (const option of options) {
    const d = distance(word.toLowerCase(), option.toLowerCase())
    if (d < bestDistance) [best, bestDistance] = [option, d]
  }
  return bestDistance <= Math.max(2, Math.floor(word.length / 3)) ? best : undefined
}

export function didYouMean(word: string, options: Iterable<string>): string {
  const s = suggest(word, options)
  return s ? ` — did you mean "${s}"?` : ''
}
