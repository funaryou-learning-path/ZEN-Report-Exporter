import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// プロジェクト直下の cookie.txt を既定にする。絶対パス直書きはしない
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const DEFAULT_COOKIES_PATH = path.resolve(__dirname, '..', 'cookie.txt')

const COOKIES_PATH = process.env.ZEN_COOKIES_PATH || DEFAULT_COOKIES_PATH

function parseNetscapeCookies(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const cols = t.split('\t')
    // このcookies.txtは name, value, domain, path, ... の順
    if (cols.length >= 2) {
      const name = cols[0]
      const value = cols[1]
      out[name] = value
    }
  }
  return out
}

export function loadCookieHeader() {
  try {
    const raw = fs.readFileSync(COOKIES_PATH, 'utf-8')
    const jar = parseNetscapeCookies(raw)
    const pairs = []
    if (jar._zane_session) pairs.push(`_zane_session=${jar._zane_session}`)
    if (jar.authority) pairs.push(`authority=${jar.authority}`)
    return pairs.join('; ')
  } catch (e) {
    console.error(`[cookies] failed to read ${COOKIES_PATH}:`, e.message)
    return ''
  }
}

export function cookiePath() {
  return COOKIES_PATH
}
