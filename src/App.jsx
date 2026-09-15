import { useEffect, useMemo, useState } from 'react'

async function jget(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.json()
}

export default function App() {
  const [health, setHealth] = useState(null)
  const [courses, setCourses] = useState([])
  const [courseId, setCourseId] = useState('')
  const [chapters, setChapters] = useState([])
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [warnings, setWarnings] = useState([])
  const [error, setError] = useState('')
  const [notionTitle, setNotionTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [notionResult, setNotionResult] = useState(null)

  useEffect(() => {
    jget('/api/health').then(setHealth).catch((e) => setError(String(e.message)))
    jget('/api/courses')
      .then((d) => {
        setCourses(d.courses || [])
        if ((d.courses || []).length > 0) setCourseId(String(d.courses[0].id))
      })
      .catch((e) => setError(String(e.message)))
  }, [])

  useEffect(() => {
    if (!courseId) return
    setChapters([])
    setSelected(new Set())
    setMarkdown('')
    setWarnings([])
    jget(`/api/courses/${courseId}/chapters`)
      .then((d) => {
        setChapters(d.chapters || [])
        setCategory(d.category || d.courseTitle || '')
        // 初期選択: 先頭章を選択しておく
        if ((d.chapters || []).length > 0) {
          setSelected(new Set([String(d.chapters[0].id)]))
          setRangeFrom(String(d.chapters[0].id))
          setRangeTo(String(d.chapters[d.chapters.length - 1].id))
        }
      })
      .catch((e) => setError(String(e.message)))
  }, [courseId])

  const toggle = (id) => {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelected(s)
  }

  const applyRange = () => {
    if (!rangeFrom || !rangeTo) return
    const ids = chapters.map((c) => String(c.id))
    const a = ids.indexOf(String(rangeFrom))
    const b = ids.indexOf(String(rangeTo))
    if (a === -1 || b === -1) return
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    setSelected(new Set(ids.slice(lo, hi + 1)))
  }

  const selectAll = () => setSelected(new Set(chapters.map((c) => String(c.id))))
  const clearAll = () => setSelected(new Set())

  const orderedSelected = useMemo(() => {
    const order = new Map(chapters.map((c, i) => [String(c.id), i]))
    return [...selected].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  }, [selected, chapters])

  const submit = async () => {
    setLoading(true)
    setError('')
    setWarnings([])
    try {
      const r = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: Number(courseId), chapterIds: orderedSelected.map(Number) })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `export -> ${r.status}`)
      setMarkdown(data.markdown || '')
      setWarnings(data.warnings || [])
      setNotionResult(null)
      const m = (data.markdown || '').match(/^#\s+(.+)$/m)
      if (m) setNotionTitle(m[1].trim())
    } catch (e) {
      setError(String(e.message))
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
    } catch (e) {
      setError(String(e.message))
    }
  }

  const download = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `zen-${courseId}-${orderedSelected.join('-')}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const uploadNotion = async () => {
    setUploading(true)
    setError('')
    setNotionResult(null)
    try {
      const r = await fetch('/api/notion/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: notionTitle, markdown })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `notion upload -> ${r.status}`)
      setNotionResult(data)
    } catch (e) {
      setError(String(e.message))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="wrap">
      <div className="card">
        <h1>ZEN Report Exporter</h1>
        <div className="meta">
          health: {health ? (health.hasSession ? 'ログイン有効' : 'クッキーなし') : '確認中'}
          {health?.cookiePath ? ` / ${health.cookiePath}` : ''}
        </div>
        {error && <p style={{ color: '#b00020' }}>{error}</p>}
      </div>

      <div className="card">
        <h2>1. 受講コースの選択</h2>
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.id}: {c.title}
            </option>
          ))}
        </select>
        <div className="meta" style={{ marginTop: 8 }}>
          カテゴリー: {category} / チャプター数: {chapters.length}
        </div>
      </div>

      <div className="card">
        <h2>2. チャプター範囲の選択</h2>
        <div className="row">
          <label>
            From{' '}
            <select value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)}>
              {chapters.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            To{' '}
            <select value={rangeTo} onChange={(e) => setRangeTo(e.target.value)}>
              {chapters.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost" onClick={applyRange}>
            範囲適用
          </button>
          <button className="ghost" onClick={selectAll}>
            全選択
          </button>
          <button className="ghost" onClick={clearAll}>
            解除
          </button>
        </div>
        <div className="chapters">
          {chapters.map((c) => (
            <label key={c.id} className="chapter">
              <input
                type="checkbox"
                checked={selected.has(String(c.id))}
                onChange={() => toggle(String(c.id))}
              />
              <span>
                <div>{c.title}</div>
                <small>
                  id:{c.id} / 進捗:{c.progress?.passed_count ?? '-'}/{c.progress?.total_count ?? '-'} /{' '}
                  {c.progress?.status ?? ''}
                </small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>3. サブミット</h2>
        <div className="meta">選択: {orderedSelected.join(', ') || '(なし)'}</div>
        <div className="toolbar">
          <button className="primary" disabled={loading || orderedSelected.length === 0} onClick={submit}>
            {loading ? '取得中...' : 'Markdownを出力'}
          </button>
          <button className="ghost" disabled={!markdown} onClick={copy}>
            コピー
          </button>
          <button className="ghost" disabled={!markdown} onClick={download}>
            .mdダウンロード
          </button>
        </div>
        {warnings.length > 0 && (
          <div className="warn">
            {warnings.map((w, i) => (
              <div key={i}>・{w}</div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>4. 出力</h2>
        <textarea className="output" value={markdown} onChange={(e) => setMarkdown(e.target.value)} placeholder="ここにMarkdownが出力されます" />
      </div>

      <div className="card">
        <h2>5. Notionにアップロード</h2>
        <div className="meta" style={{ marginBottom: 8 }}>
          Notion連携: {health ? (health.notionConfigured ? '設定済み' : '未設定（.envにNOTION_API_KEY / NOTION_PARENT_PAGE_IDが必要）') : '確認中'}
        </div>
        <div className="row">
          <label>
            ページタイトル{' '}
            <input
              value={notionTitle}
              onChange={(e) => setNotionTitle(e.target.value)}
              placeholder="例: 地理探究"
              style={{ minWidth: 240 }}
            />
          </label>
          <button className="primary" disabled={uploading || !markdown} onClick={uploadNotion}>
            {uploading ? 'アップロード中...' : 'Notionにアップロード'}
          </button>
        </div>
        {notionResult && (
          <div className="meta" style={{ marginTop: 8 }}>
            完了: {notionResult.blockCount}ブロック{' '}
            <a href={notionResult.url} target="_blank" rel="noreferrer">
              Notionで開く
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
