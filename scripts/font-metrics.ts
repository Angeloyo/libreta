// Builds src/core/font-metrics.json: advance widths for every character in our fonts.
// Text is measured from this table in the browser and on the server, so both agree exactly.
import opentype from 'opentype.js'
import { readFileSync, writeFileSync } from 'node:fs'

const fonts = { regular: 'assets/fonts/ShantellSans-Regular.ttf', bold: 'assets/fonts/ShantellSans-Bold.ttf' }

const out: Record<string, unknown> = {}
for (const [weight, path] of Object.entries(fonts)) {
  const font = opentype.parse(readFileSync(path).buffer)
  const widths: Record<string, number> = {}
  for (let i = 0; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i)
    for (const code of glyph.unicodes ?? []) widths[String.fromCodePoint(code)] = glyph.advanceWidth ?? 0
  }
  out.unitsPerEm = font.unitsPerEm
  out.ascender = font.ascender
  out.descender = font.descender
  out[weight] = widths
}
writeFileSync('src/core/font-metrics.json', JSON.stringify(out))
console.log('wrote src/core/font-metrics.json')
