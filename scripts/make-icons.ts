/** Render public/icons/icon.svg to the PNG sizes the manifest needs, using headless Chromium. */
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch()
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`)
  await page.screenshot({ path: new URL(`../public/icons/icon-${size}.png`, import.meta.url).pathname, omitBackground: true })
  await page.close()
}
await browser.close()
console.log('Wrote icon-192.png and icon-512.png')
