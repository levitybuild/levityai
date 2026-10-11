import { readFile } from 'node:fs/promises'
import path from 'node:path'

export async function GET() {
  const html = await readFile(path.join(process.cwd(), 'public/demo/index.html'), 'utf8')
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export const dynamic = 'force-static'

export function HEAD() {
  return new Response(null, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
