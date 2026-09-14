/** Hand files to the player: share sheet on phones when available, download otherwise. */

export async function deliver(files: { name: string; text: string; type: string }[], title: string): Promise<'shared' | 'downloaded' | 'canceled'> {
  const blobs = files.map((f) => new File([f.text], f.name, { type: f.type }))
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (nav.share && nav.canShare && nav.canShare({ files: blobs })) {
    try {
      await nav.share({ files: blobs, title })
      return 'shared'
    } catch (error) {
      if ((error as Error).name === 'AbortError') return 'canceled'
    }
  }
  for (const file of blobs) {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  return 'downloaded'
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}
