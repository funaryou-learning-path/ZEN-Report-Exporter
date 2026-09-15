const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

// Notionのコードブロック言語名に合わせる（"text"は非対応のため"plain text"にする）
function mapCodeLang(lang) {
  const l = String(lang || '').toLowerCase()
  const allow = new Set([
    'abap', 'arduino', 'bash', 'basic', 'c', 'clojure', 'coffeescript', 'c++', 'c#', 'css',
    'dart', 'diff', 'docker', 'elixir', 'elm', 'erlang', 'flow', 'fortran', 'f#', 'gherkin',
    'glsl', 'go', 'graphql', 'groovy', 'haskell', 'html', 'java', 'javascript', 'json',
    'julia', 'kotlin', 'latex', 'less', 'lisp', 'livescript', 'lua', 'makefile', 'markdown',
    'markup', 'matlab', 'mermaid', 'nix', 'objective-c', 'ocaml', 'pascal', 'perl', 'php',
    'plain text', 'powershell', 'prolog', 'protobuf', 'python', 'r', 'reason', 'ruby', 'rust',
    'sass', 'scala', 'scheme', 'scss', 'shell', 'sql', 'swift', 'typescript', 'vb.net', 'verilog',
    'vhdl', 'visual basic', 'webassembly', 'xml', 'yaml', 'java/c/c++/c#'
  ])
  if (l === '' || l === 'text' || l === 'txt') return 'plain text'
  return allow.has(l) ? l : 'plain text'
}

function rt(text, annotations) {
  const t = { type: 'text', text: { content: String(text).slice(0, 2000) } }
  if (annotations) t.annotations = annotations
  return t
}

// 生成Markdownは以下形式を想定する
//   # / ## / ### / #### 見出し、N. 問題文、<br>、> ***回答*** / > ***解説***、> ```text フェンス
export function markdownToBlocks(markdown) {
  const blocks = []
  const push = (b) => {
    if (blocks.length > 0 || b.type !== 'paragraph' || (b.paragraph.rich_text[0]?.text.content || '').trim()) {
      blocks.push(b)
    } else if (b.type !== 'paragraph') {
      blocks.push(b)
    }
  }
  const lines = String(markdown).split('\n')
  let inCode = false
  let codeLang = 'plain text'
  let codeLines = []

  const flushCode = () => {
    blocks.push({
      type: 'code',
      code: { language: codeLang, rich_text: [rt(codeLines.join('\n'))] }
    })
    inCode = false
    codeLines = []
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')

    // コードフェンス内
    if (inCode) {
      if (/^>?\s*```+\s*$/.test(line)) {
        flushCode()
        continue
      }
      codeLines.push(line.replace(/^>\s?/, ''))
      continue
    }
    // フェンス開始（引用内・素の両対応）
    let m = line.match(/^>\s*```+\s*(\w*)\s*$/)
    if (m) {
      inCode = true
      codeLang = mapCodeLang(m[1])
      codeLines = []
      continue
    }
    m = line.match(/^```+\s*(\w*)\s*$/)
    if (m) {
      inCode = true
      codeLang = mapCodeLang(m[1])
      codeLines = []
      continue
    }

    // 見出し
    m = line.match(/^(#{1,4})\s+(.*)$/)
    if (m) {
      const level = Math.min(m[1].length, 3)
      const text = m[2].trim()
      if (!text) continue
      blocks.push({
        type: `heading_${level}`,
        [`heading_${level}`]: { rich_text: [rt(text)] }
      })
      continue
    }
    // 問題文の番号付き行: Notionの自動採番は他ブロックで分断すると振り直されるため太字段落にする
    m = line.match(/^(\d+)\.\s+(.*)$/)
    if (m) {
      const text = `${m[1]}. ${m[2]}`.trim()
      if (!text) continue
      blocks.push({ type: 'paragraph', paragraph: { rich_text: [rt(text, { bold: true })] } })
      continue
    }
    // <br>と空行はスキップする
    if (/^<br\s*\/?>$/.test(line.trim()) || line.trim() === '') continue
    // 区切り線はdividerにする
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ type: 'divider', divider: {} })
      continue
    }
    // 引用行
    m = line.match(/^>\s?(.*)$/)
    if (m) {
      const inner = m[1]
      // > ***回答*** → 太字＋斜体の引用にする
      const em = inner.match(/^\*\*\*(.+?)\*\*\*\s*$/)
      if (em) {
        blocks.push({
          type: 'quote',
          quote: { rich_text: [rt(em[1], { bold: true, italic: true })] }
        })
        continue
      }
      if (!inner.trim()) continue
      blocks.push({ type: 'quote', quote: { rich_text: [rt(inner)] } })
      continue
    }
    // 通常段落
    blocks.push({ type: 'paragraph', paragraph: { rich_text: [rt(line)] } })
  }
  if (inCode) flushCode()
  return blocks
}

export function extractTitle(markdown, fallback = 'ZEN Report') {
  const m = String(markdown).match(/^#\s+(.+)$/m)
  return (m ? m[1] : fallback).trim().slice(0, 100) || fallback
}

export function notionConfigured() {
  return Boolean(process.env.NOTION_API_KEY && process.env.NOTION_PARENT_PAGE_ID)
}

export async function uploadToNotion({ title, markdown }) {
  const key = process.env.NOTION_API_KEY || ''
  const parent = process.env.NOTION_PARENT_PAGE_ID || ''
  if (!key || !parent) {
    throw new Error('NOTION_API_KEY / NOTION_PARENT_PAGE_ID が未設定です。project/.env を確認してください')
  }
  const headers = {
    Authorization: `Bearer ${key}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  }
  const pageTitle = String(title || '').trim() || extractTitle(markdown)

  const pr = await fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { page_id: parent },
      properties: { title: [{ text: { content: pageTitle } }] }
    })
  })
  if (!pr.ok) {
    const body = await pr.text().then((t) => t.slice(0, 500))
    throw new Error(`ページ作成に失敗しました (${pr.status}): ${body}`)
  }
  const page = await pr.json()

  const blocks = markdownToBlocks(markdown)
  // 1リクエスト100ブロック上限のため分割追加する
  const CHUNK = 90
  for (let i = 0; i < blocks.length; i += CHUNK) {
    const ar = await fetch(`${NOTION_API}/blocks/${page.id}/children`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ children: blocks.slice(i, i + CHUNK) })
    })
    if (!ar.ok) {
      const body = await ar.text().then((t) => t.slice(0, 500))
      throw new Error(`ブロック追加に失敗しました (${ar.status}): ${body}`)
    }
    if (i + CHUNK < blocks.length) await new Promise((r) => setTimeout(r, 350))
  }
  return { pageId: page.id, url: page.url, blockCount: blocks.length }
}
