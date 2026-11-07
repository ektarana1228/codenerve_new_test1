import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Layout } from '../components/Layout'
import { deleteProctorMedia, getProctorEvents, getProctorMedia, getProctorMediaUrl, type ProctorMedia } from '../api/client'

type MediaGroup = { id: string; kind: string; size_bytes: number; captured_at: string; chunks: ProctorMedia[] }

function MediaPreview({ sessionId, media }: { sessionId: string; media: MediaGroup }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [index, setIndex] = useState(0)
  const chunk = media.chunks[index]!
  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setUrl(null)
    setError(null)
    void getProctorMediaUrl(sessionId, chunk.id)
      .then((next) => { objectUrl = next; active ? setUrl(next) : URL.revokeObjectURL(next) })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Evidence could not be loaded')
      })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [sessionId, chunk.id, retry])
  if (error) return <div className="py-10 text-center"><p className="text-sm text-[color:var(--status-fail)]">{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 rounded-lg border border-[color:var(--border-strong)] px-4 py-2 text-sm text-[color:var(--text-primary)]">Retry</button></div>
  if (!url) return <p className="py-12 text-center text-sm text-[color:var(--text-muted)]">Loading evidence...</p>
  const next = index + 1 < media.chunks.length ? () => setIndex((value) => value + 1) : undefined
  const mediaError = () => setError('This recording could not be played. It may be incomplete or unsupported.')
  return <div>{chunk.mime_type.startsWith('audio/') ? <audio key={chunk.id} src={url} controls autoPlay={index > 0} onEnded={next} onError={mediaError} className="w-full" /> : <video key={chunk.id} src={url} controls autoPlay={index > 0} onEnded={next} onError={mediaError} className="max-h-[65vh] w-full bg-black" />}{media.chunks.length > 1 && <p className="mt-2 text-center text-xs text-[color:var(--text-muted)]">Part {index + 1} of {media.chunks.length}</p>}</div>
}

export function ProctorEvidencePage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>()
  const [selected, setSelected] = useState<MediaGroup | null>(null)
  const events = useQuery({ queryKey: ['proctor-events', sessionId], queryFn: () => getProctorEvents(sessionId), enabled: !!sessionId })
  const media = useQuery({ queryKey: ['proctor-media', sessionId], queryFn: () => getProctorMedia(sessionId), enabled: !!sessionId, refetchInterval: 5000 })
  const groups = useMemo(() => {
    const grouped = new Map<string, ProctorMedia[]>()
    for (const item of media.data?.data ?? []) {
      if (!item.kind.endsWith('_RECORDING') || item.size_bytes < 4096) continue
      grouped.set(item.kind, [...(grouped.get(item.kind) ?? []), item])
    }
    return [...grouped.entries()].map(([kind, chunks]): MediaGroup => {
      chunks.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at))
      return { id: kind, kind, chunks, captured_at: chunks[0]!.captured_at, size_bytes: chunks.reduce((sum, item) => sum + item.size_bytes, 0) }
    })
  }, [media.data])
  useEffect(() => {
    if (selected) setSelected(groups.find((group) => group.kind === selected.kind) ?? null)
  }, [groups, selected?.kind])
  const remove = async (group: MediaGroup) => {
    if (!window.confirm(`Delete ${group.kind.replace(/_/g, ' ')} permanently?`)) return
    await Promise.all(group.chunks.map((item) => deleteProctorMedia(sessionId, item.id)))
    setSelected(null)
    await media.refetch()
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold text-[color:var(--text-primary)]">Proctoring evidence</h1><p className="mt-1 text-xs text-[color:var(--text-muted)]">Session {sessionId}</p></div>
        <Link to={media.data?.assessment_id ? `/assessments/${media.data.assessment_id}/leaderboard` : '/assessments'} className="text-sm text-[color:var(--text-secondary)]">Back to leaderboard</Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <section>
          <h2 className="mb-3 text-sm font-semibold">Media ({groups.length})</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {groups.map((item) => (
              <div key={item.id} className="min-h-24 border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-3 text-left">
                <p className="text-xs font-semibold text-[color:var(--text-primary)]">{item.kind.replace(/_/g, ' ')}</p>
                <p className="mt-2 text-xs text-[color:var(--text-muted)]">{new Date(item.captured_at).toLocaleString()}</p>
                <p className="text-xs text-[color:var(--text-muted)]">{Math.ceil(item.size_bytes / 1024)} KB</p>
                <div className="mt-3 flex gap-3 text-xs"><button type="button" onClick={() => setSelected(item)} className="text-[color:var(--status-link)]">View</button><button type="button" onClick={() => void remove(item)} className="text-[color:var(--status-fail)]">Delete</button></div>
              </div>
            ))}
          </div>
          {!media.isLoading && !groups.length && <p className="py-10 text-sm text-[color:var(--text-muted)]">No media evidence was captured.</p>}
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold">Event timeline ({events.data?.data.length ?? 0})</h2>
          <div className="max-h-[70vh] divide-y divide-[color:var(--border-subtle)] overflow-y-auto border-y border-[color:var(--border-subtle)]">
            {events.data?.data.map((event) => <div key={event.id} className="py-3"><p className="text-xs font-semibold">{event.type.replace(/_/g, ' ')}</p><p className="text-xs text-[color:var(--text-muted)]">{event.source} · {new Date(event.created_at).toLocaleString()}</p></div>)}
          </div>
        </section>
      </div>
      {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSelected(null)}><div className="w-full max-w-4xl bg-[color:var(--bg-raised)] p-4" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex justify-between gap-3"><p className="text-sm font-semibold">{selected.kind.replace(/_/g, ' ')}</p><button type="button" onClick={() => setSelected(null)} aria-label="Close evidence">Close</button></div><MediaPreview sessionId={sessionId} media={selected} /></div></div>}
    </Layout>
  )
}
