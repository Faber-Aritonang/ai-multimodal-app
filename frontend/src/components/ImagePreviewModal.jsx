import { useEffect, useState } from 'react'
import { resolveMediaUrl } from '../config/api'

const ImagePreviewModal = ({ url, alt = 'Generated image', prompt, resolution, onClose }) => {
  const [actualResolution, setActualResolution] = useState('')

  useEffect(() => {
    setActualResolution('')
  }, [url])

  useEffect(() => {
    if (!url) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [url, onClose])

  if (!url) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-ink-950/90 p-4 backdrop-blur-md sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="glass-panel my-auto w-full max-w-6xl p-4 sm:p-6"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pratinjau gambar"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="hud mb-1">pratinjau gambar</p>
            {prompt && <p className="line-clamp-2 text-sm text-slate-300">{prompt}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost flex-shrink-0 px-3 py-1.5 text-xs"
            aria-label="Tutup pratinjau gambar"
          >
            Tutup
          </button>
        </div>

        <div className="flex max-h-[75vh] min-h-32 items-center justify-center overflow-auto rounded-xl border border-white/10 bg-ink-950/60 p-2 sm:p-4">
          <img
            src={resolveMediaUrl(url)}
            alt={alt}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget
              if (naturalWidth && naturalHeight) setActualResolution(`${naturalWidth} × ${naturalHeight}`)
            }}
            className="max-h-[70vh] max-w-full rounded-lg object-contain"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs text-slate-400" data-testid="image-preview-resolution">
            Resolusi: {resolution || actualResolution || 'Memuat…'}
          </p>
          <a
            href={resolveMediaUrl(url)}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary text-xs"
          >
            Download gambar
          </a>
        </div>
      </section>
    </div>
  )
}

export default ImagePreviewModal
