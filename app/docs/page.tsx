import { readFile } from "node:fs/promises"
import path from "node:path"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Levity AI editor API documentation",
  description: "Complete API documentation for the Levity AI editor tools and file operations.",
}

export default async function DocumentationPage() {
  const documentation = await readFile(
    path.join(process.cwd(), "docs", "api-tool-calling.md"),
    "utf8",
  )

  return (
    <main className="docs-page">
      <header className="docs-header">
        <div>
          <p className="docs-eyebrow">LEVITY AI EDITOR API</p>
          <h1>API documentation</h1>
          <p className="docs-intro">
            Complete, copyable documentation for integrating the chat API into your own frontend.
          </p>
        </div>
        <a className="docs-back" href="/">Back to editor</a>
      </header>
      <article className="docs-content">
        <pre>{documentation}</pre>
      </article>
    </main>
  )
}
