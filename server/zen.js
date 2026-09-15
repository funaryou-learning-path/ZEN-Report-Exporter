import * as cheerio from 'cheerio'
import { loadCookieHeader } from './cookies.js'

const PAPI = 'https://papi.nnn.ed.nico/prod'
const CONTENTS = 'https://www.nnn.ed.nico'

function headers(referer = 'https://www.nnn.ed.nico/home') {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    Cookie: loadCookieHeader(),
    Origin: 'https://www.nnn.ed.nico',
    Referer: referer
  }
}

async function getJson(url) {
  const r = await fetch(url, { headers: headers() })
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`)
  return r.json()
}

async function getHtml(url) {
  const r = await fetch(url, { headers: headers('https://www.nnn.ed.nico/') })
  const text = await r.text()
  return { status: r.status, text }
}

export async function fetchMyCourses() {
  const data = await getJson(`${PAPI}/v2/my_courses?service=n_school`)
  return data.services?.[0]?.courses ?? []
}

export async function fetchCourseDetail(courseId) {
  const data = await getJson(`${PAPI}/v2/material/courses/${courseId}?revision=1`)
  return data.course
}

export async function fetchChapterDetail(courseId, chapterId) {
  const data = await getJson(`${PAPI}/v2/material/courses/${courseId}/chapters/${chapterId}?revision=1`)
  return data
}

const TEST_TYPES = new Set(['evaluation_test', 'essay_test'])
const REPORT_TYPES = new Set(['evaluation_report', 'essay_report'])

function cleanText($el) {
  if (!$el || $el.length === 0) return ''
  // 数式や改行をできるだけ原文保持でテキスト化する
  return $el.text().replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim()
}

function extractParams($) {
  const selectors = [
    'div[data-evaluation-test-params]',
    'div[data-evaluation-report-params]',
    'div[data-essay-test-params]',
    'div[data-essay-report-params]'
  ]
  for (const sel of selectors) {
    const el = $(sel).first()
    if (el.length === 0) continue
    const raw =
      el.attr('data-evaluation-test-params') ||
      el.attr('data-evaluation-report-params') ||
      el.attr('data-essay-test-params') ||
      el.attr('data-essay-report-params') ||
      ''
    try {
      // HTMLエスケープ済みJSONなのでcheerioがデコード済みのはずだが、念のため処理する
      return JSON.parse(raw)
    } catch {
      try {
        return JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
      } catch {
        return {}
      }
    }
  }
  return {}
}

function parseResultHtml(html) {
  const $ = cheerio.load(html)
  const params = extractParams($)
  const answerings = Array.isArray(params.answerings) ? params.answerings.map(String) : []
  const teacherComments = Array.isArray(params.teacherComments)
    ? params.teacherComments.map(String)
    : []

  const sections = []
  $('#kokuban-input-target section.exercise').each((si, sec) => {
    const $sec = $(sec)
    const statement = cleanText($sec.find('> div.statement').first())
    const questions = []
    // 直下ul > li が小問Q1...に対応する
    $sec.find('> ul > li').each((qi, li) => {
      const $li = $(li)
      const q = cleanText($li.find('> div.question').first())
      const choices = []
      $li.find('ul.answers > li').each((ci, c) => {
        const $c = $(c)
        choices.push({ text: cleanText($c), correct: $c.attr('data-correct') === 'true' })
      })
      const explanation = cleanText($li.find('> div.explanation').first())
      questions.push({ q, choices, explanation })
    })
    sections.push({ statement, questions })
  })

  // answeringsはページ全体で小問出現順にフラットに並ぶ。順に割り当てる
  // 選択式（ア〜エ）の回答は番号1〜4で記録されるため、記号に変換する
  const OPTION_MARKS = { 1: 'ア', 2: 'イ', 3: 'ウ', 4: 'エ', 5: 'オ', 6: 'カ' }
  let cursor = 0
  for (const sec of sections) {
    for (const qq of sec.questions) {
      let ans = answerings[cursor] ?? ''
      if (qq.choices && qq.choices.length > 0 && /^\d+$/.test(String(ans).trim())) {
        ans = OPTION_MARKS[Number(String(ans).trim())] || ans
      }
      qq.userAnswer = ans
      qq.teacherComment = teacherComments[cursor] ?? ''
      cursor += 1
    }
  }
  return { params, sections }
}

function mdQuoteFence(text) {
  const body = String(text)
  // ``` を含む場合はフェンスを ```` にして衝突を避ける
  const fence = body.includes('```') ? '````' : '```'
  return [`> ${fence}text`, ...body.split('\n').map((l) => `> ${l}`), `> ${fence}`].join('\n')
}

// 指定テンプレ: 箇条書きの問題文 + <br> + 引用形式の回答・解説
function mdQA(questionLine, answer, explanation) {
  return (
    `${questionLine}\n` +
    `\n<br>\n` +
    `\n> ***回答*** \n` +
    `${mdQuoteFence(answer || '(未回答)')}\n` +
    `\n<br>\n` +
    `\n> ***解説***\n` +
    `${mdQuoteFence(explanation || '(解説なし)')}\n`
  )
}

function mdForMaterial(materialTitle, parsed) {
  // セクション見出しは出力しない。問題を通し番号でフラットに並べる
  let out = ''
  let n = 0
  for (const sec of parsed.sections) {
    for (const qq of sec.questions) {
      n += 1
      const qTitle = qq.q || `問題${n}`
      // 問題文自体は1行で出す
      const oneLineQ = qTitle.replace(/\n+/g, ' ')
      let expl = qq.explanation || '(解説なし)'
      if (qq.teacherComment) expl += `\n\n[添削コメント]\n${qq.teacherComment}`
      out += mdQA(`${n}. ${oneLineQ}`, qq.userAnswer, expl)
    }
  }
  if (n === 0) {
    out += mdQA('1. 問題', '(問題を取得できませんでした)', '(解説なし)')
  }
  return out
}

export async function exportMarkdown({ courseId, chapterIds }) {
  const course = await fetchCourseDetail(courseId)
  const category = course?.subject_category?.title || course?.title || `course ${courseId}`
  const warnings = []
  let md = `# ${category}\n`

  for (const chapterId of chapterIds) {
    let detail
    try {
      detail = await fetchChapterDetail(courseId, chapterId)
    } catch (e) {
      warnings.push(`chapter ${chapterId}: 章詳細の取得に失敗: ${e.message}`)
      continue
    }
    const ch = detail.chapter
    md += `## ${ch.title}\n`

    const targets = (ch.sections || []).filter(
      (s) => TEST_TYPES.has(s.resource_type) || REPORT_TYPES.has(s.resource_type)
    )
    const tests = targets.filter((s) => TEST_TYPES.has(s.resource_type))
    const reports = targets.filter((s) => REPORT_TYPES.has(s.resource_type))

    // 確認テスト群: 教材ごとに###を立てる
    for (const t of tests) {
      md += `### ${t.title}\n`
      const url = ensureResultUrl(t.content_url)
      const { status, text } = await getHtml(url)
      if (!isResultHtml(text)) {
        warnings.push(`${ch.title} / ${t.title}: 結果ページなし (status ${status})。未完了の可能性があります`)
        md += mdQA('1. 問題', '(未回答/結果なし)', '(解説なし)')
        md += `---\n`
        continue
      }
      const parsed = parseResultHtml(text)
      md += mdForMaterial(t.title, parsed)
      md += `---\n`
    }

    // レポート群: テンプレ通り### レポートにまとめる
    if (reports.length > 0) {
      md += `### レポート\n`
      for (const r of reports) {
        md += `#### ${r.title}\n`
        const url = ensureResultUrl(r.content_url)
        const { status, text } = await getHtml(url)
        if (!isResultHtml(text)) {
          warnings.push(`${ch.title} / ${r.title}: 結果ページなし (status ${status})`)
          md += mdQA('1. 問題', '(未回答/結果なし)', '(解説なし)')
          md += `---\n`
          continue
        }
        const parsed = parseResultHtml(text)
        md += mdForMaterial(r.title, parsed)
        md += `---\n`
      }
    }
  }
  return { markdown: md, warnings }
}

function ensureResultUrl(contentUrl) {
  if (!contentUrl) return contentUrl
  if (contentUrl.includes('/result')) return contentUrl
  // 未完了章は/resultなしだが、試しに/result化して取得し、なければ警告にする
  const [base, query] = contentUrl.split('?')
  const q = query ? `?${query}` : ''
  return `${base}/result${q}`
}

function isResultHtml(html) {
  return (
    html.includes('kokuban-input-target') &&
    (html.includes('"isResult":true') || html.includes('data-result-page'))
  )
}
