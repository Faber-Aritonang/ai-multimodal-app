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
 */
const components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed break-words">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-3 first:mt-0">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-dark-300 pl-3 my-2 text-dark-600 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-dark-200" />,
  // Blok kode: `pre` yang mengatur tampilan, isi `code`-nya dibuat netral.
  pre: ({ children }) => (
    <pre className="bg-dark-900 text-dark-100 rounded-lg p-3 my-2 overflow-x-auto text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit [&>code]:whitespace-pre">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="bg-dark-200/70 text-dark-800 rounded px-1 py-0.5 text-xs font-mono break-words">
      {children}
    </code>
  ),
  // Tabel GFM bisa lebih lebar dari bubble chat => beri jalur gulir sendiri.
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full text-xs border-collapse border border-dark-200">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-dark-200 bg-dark-100 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-dark-200 px-2 py-1 align-top">{children}</td>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary-600 underline break-all"
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
