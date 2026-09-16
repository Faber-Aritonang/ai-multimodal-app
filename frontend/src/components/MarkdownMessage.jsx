import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Render markdown dari balasan AI.
 *
 * Sebelumnya balasan ditampilkan sebagai teks polos, sehingga tabel GFM,
 * **tebal**, daftar, dan blok kode muncul sebagai simbol mentah di UI.
 *
 * Tailwind di proyek ini belum memakai plugin typography, jadi gaya tiap elemen
 * diatur lewat prop `components` => tidak perlu plugin/tema baru.
 *
 * Warna disesuaikan tema gelap: tabel dan blok kode memakai tepi putih transparan
 * supaya tetap terbaca di dalam bubble kaca.
 */
const components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed break-words">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-3 first:mt-0 text-white">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0 text-white">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-3 first:mt-0 text-slate-100">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-cyan-300/50 pl-3 my-2 text-slate-400 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-white/10" />,
  // Blok kode: `pre` yang mengatur tampilan, isi `code`-nya dibuat netral.
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-xl border border-white/10 bg-ink-950/80 p-3 font-mono text-xs leading-relaxed text-slate-200 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit [&>code]:whitespace-pre">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded border border-white/10 bg-white/[0.07] px-1 py-0.5 font-mono text-xs text-cyan-200 break-words">
      {children}
    </code>
  ),
  // Tabel GFM bisa lebih lebar dari bubble chat => beri jalur gulir sendiri.
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-white/10 bg-white/[0.06] px-2 py-1 text-left font-semibold text-slate-100">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-white/10 px-2 py-1 align-top">{children}</td>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="link-accent break-all"
    >
      {children}
    </a>
  )
}

const MarkdownMessage = ({ content }) => (
  <div className="text-sm">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {String(content ?? '')}
    </ReactMarkdown>
  </div>
)

export default MarkdownMessage
