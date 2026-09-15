import 'dotenv/config'
import fs from 'node:fs'
import { chromium } from 'playwright'
import { DEFAULT_COOKIES_PATH } from './cookies.js'

const GMAIL = process.env.GMAIL || ''
const GPASSWORD = process.env.GPASSWORD || ''
const COOKIES_PATH = process.env.ZEN_COOKIES_PATH || DEFAULT_COOKIES_PATH
const HEADLESS = (process.env.HEADLESS || 'true').toLowerCase() !== 'false'
const START_URL =
  'https://www.nnn.ed.nico/oauth_login?next_url=https%3A%2F%2Fwww.nnn.ed.nico%2Fhome&target_type=n_lobby'

if (!GMAIL || !GPASSWORD) {
  console.error('[login] GMAIL / GPASSWORD が未設定です。project/.env を確認してください（値は表示しません）')
  process.exit(1)
}

function toCookieFileLines(jar) {
  // 既存cookies.txtの形式（name\tvalue\tdomain\t/\texpiry\t...）を維持して更新する
  let existing = []
  try {
    existing = fs.readFileSync(COOKIES_PATH, 'utf-8').split('\n')
  } catch {}
  const byName = new Map()
  for (const c of jar) {
    // zane関連のみ更新対象にする
    if (['_zane_session', 'authority', '_clck', '_clsk', '_ga', '_ga_CYV7Y8H5RK'].includes(c.name)) {
      byName.set(c.name, c)
    }
  }
  const now = new Date()
  const fmtExpiry = (d) => d.toISOString().replace(/\.\d+Z$/, '.000Z')
  const lines = []
  const seen = new Set()
  for (const line of existing) {
    const t = line.trim()
    if (!t) continue
    const cols = t.split('\t')
    const name = cols[0]
    if (byName.has(name)) {
      const c = byName.get(name)
      const domain = cols[2] || (name === '_zane_session' ? '.nnn.ed.nico' : '.ed.nico')
      const expiry = cols[4] || fmtExpiry(new Date(now.getTime() + 14 * 86400 * 1000))
      // 元の列数を保ちつつvalueだけ差し替える
      cols[1] = c.value
      cols[2] = domain
      if (!cols[4]) cols[4] = expiry
      lines.push(cols.join('\t'))
      seen.add(name)
    } else {
      lines.push(line)
    }
  }
  for (const [name, c] of byName) {
    if (seen.has(name)) continue
    const domain = name === '_zane_session' ? '.nnn.ed.nico' : '.ed.nico'
    lines.push([name, c.value, domain, '/', fmtExpiry(new Date(now.getTime() + 14 * 86400 * 1000)), '30', '', '', '', '', '', 'Medium'].join('\t'))
  }
  return lines.join('\n') + '\n'
}

async function main() {
  console.log(`[login] HEADLESS=${HEADLESS} で開始します`)
  const browser = await chromium.launch({ headless: HEADLESS })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    locale: 'ja-JP'
  })
  const page = await ctx.newPage()
  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(6000)
    const btn = page.getByRole('button', { name: /Googleアカウントでログイン/ })
    await btn.first().waitFor({ timeout: 20000 })
    await btn.first().click()
    // Googleの識別子画面へ遷移するのを待つ
    await page.waitForURL(/accounts\.google\.com/, { timeout: 30000 })
    console.log('[login] Google認証画面に遷移しました')

    // メールアドレス入力（Googleの識別子は type=email とは限らない）
    const email = page.locator('#identifierId, input[name="identifier"], input[type="email"], input[type="text"]').first()
    await email.waitFor({ timeout: 20000 })
    await email.click()
    await email.fill(GMAIL)
    await page.getByRole('button', { name: /次へ/ }).first().click()
    await page.waitForTimeout(4000)

    // パスワード入力（画面遷移後に現れる）
    const pass = page.locator('input[name="Passwd"], input[type="password"]').first()
    await pass.waitFor({ timeout: 25000 })
    await pass.click()
    await pass.fill(GPASSWORD)
    await page.getByRole('button', { name: /次へ/ }).first().click()

    // 2段階認証やチャレンジが出る場合は手動介入待ち（HEADLESS=false推奨）
    // 最終的に www.nnn.ed.nico/home に戻るのを最大180秒待つ
    console.log('[login] 認証結果を待機します（2段階認証がある場合は手動で進めてください）')
    await page.waitForURL(/www\.nnn\.ed\.nico\/home/, { timeout: 180000 })
    console.log('[login] ZEN Study home に到達しました:', page.url())

    const cookies = await ctx.cookies()
    const jar = cookies.filter((c) => ['_zane_session', 'authority'].includes(c.name))
    if (!jar.find((c) => c.name === '_zane_session')) {
      throw new Error('_zane_session が取得できませんでした')
    }
    const all = await ctx.cookies()
    fs.writeFileSync(COOKIES_PATH, toCookieFileLines(all))
    console.log(`[login] cookiesを更新しました: ${COOKIES_PATH}`)

    // 検証: TENJIN APIでユーザー取得
    const zane = all.find((c) => c.name === '_zane_session')?.value || ''
    const auth = all.find((c) => c.name === 'authority')?.value || 's_student&s_standard'
    const r = await fetch('https://api.nnn.ed.nico/v1/users', {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Origin: 'https://www.nnn.ed.nico',
        Referer: 'https://www.nnn.ed.nico/home',
        Cookie: `_zane_session=${zane}; authority=${auth}`
      }
    })
    console.log('[login] 検証API status:', r.status)
    const j = await r.text()
    console.log('[login] 検証API body:', j.slice(0, 300))
  } catch (e) {
    console.error('[login] 失敗:', e.message)
    try {
      await page.screenshot({ path: 'login-error.png' })
      console.error('[login] スクリーンショットを login-error.png に保存しました')
    } catch {}
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main()
