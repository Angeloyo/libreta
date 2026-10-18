// Renders assets/favicon.svg to the PNG sizes browsers ask for (32 for tabs, 180 for iOS).
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'

const svg = readFileSync('assets/favicon.svg')
for (const [file, size] of [['assets/favicon.png', 32], ['assets/apple-touch-icon.png', 180]] as const) {
  writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng())
  console.log(`wrote ${file}`)
}
