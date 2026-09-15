import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCookieHeader, cookiePath } from './cookies.js'
import { uploadToNotion, notionConfigured } from './notion.js'
import {
  fetchMyCourses,
  fetchCourseDetail,
  fetchChapterDetail,
  exportMarkdown
} from './zen.js'

const app = express()
const PORT = Number(process.env.PORT || 8787)
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (req, res) => {
  const cookie = loadCookieHeader()
  res.json({
    ok: true,
    hasSession: cookie.includes('_zane_session'),
    cookiePath: cookiePath(),
    notionConfigured: notionConfigured()
  })
})

app.get('/api/courses', async (req, res) => {
  try {
    const courses = await fetchMyCourses()
    res.json({
      courses: courses.map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        progress: c.progress
      }))
    })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.get('/api/courses/:id/chapters', async (req, res) => {
  try {
    const course = await fetchCourseDetail(req.params.id)
    res.json({
      category: course?.subject_category?.title || course?.title || '',
      courseTitle: course?.title || '',
      chapters: (course?.chapters || []).map((ch) => ({
        id: ch.id,
        title: ch.title,
        outline: ch.outline || '',
        progress: ch.progress
      }))
    })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.get('/api/courses/:courseId/chapters/:chapterId/materials', async (req, res) => {
  try {
    const detail = await fetchChapterDetail(req.params.courseId, req.params.chapterId)
    const sections = detail.chapter?.sections || []
    const pick = sections
      .filter((s) =>
        ['evaluation_test', 'essay_test', 'evaluation_report', 'essay_report'].includes(s.resource_type)
      )
      .map((s) => ({
        resource_type: s.resource_type,
        id: s.id,
        title: s.title,
        total_question: s.total_question ?? null,
        done: s.done ?? null,
        passed: s.passed ?? null,
        hasResult: String(s.content_url || '').includes('/result')
      }))
    res.json({ chapter: { id: detail.chapter?.id, title: detail.chapter?.title }, materials: pick })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.post('/api/export', async (req, res) => {
  try {
    const { courseId, chapterIds } = req.body || {}
    if (!courseId || !Array.isArray(chapterIds) || chapterIds.length === 0) {
      return res.status(400).json({ error: 'courseId と chapterIds[] を指定してください' })
    }
    const result = await exportMarkdown({ courseId: Number(courseId), chapterIds: chapterIds.map(Number) })
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.post('/api/notion/upload', async (req, res) => {
  try {
    const { title, markdown } = req.body || {}
    if (!markdown || !String(markdown).trim()) {
      return res.status(400).json({ error: 'markdown が空です' })
    }
    const result = await uploadToNotion({ title, markdown })
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// 本番時はdistを配信する
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dist = path.resolve(__dirname, '../dist')
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(dist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`[zen-report] server listening on http://localhost:${PORT}`)
})
