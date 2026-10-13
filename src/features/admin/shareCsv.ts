/**
 * CSV 를 내려받거나 공유한다. 브라우저 API 를 여기 한 곳에 모아 두어 화면은 평범한 함수만 부르고,
 * 테스트는 그 API 를 바꿔 끼운다 — jsdom 에는 `createObjectURL` 과 `navigator.share` 가 아예 없다.
 */
export const CSV_TYPE = 'text/csv;charset=utf-8'

type DownloadDeps = {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
  anchor: HTMLAnchorElement
}

function browserDownloadDeps(): DownloadDeps {
  return { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL, anchor: document.createElement('a') }
}

/** objectURL 을 만들어 `a[download]` 를 누른다. 끝나면 되돌린다 — 안 되돌리면 탭이 살아 있는 동안 메모리에 남는다. */
export function downloadCsv(filename: string, text: string, deps: DownloadDeps = browserDownloadDeps()): void {
  const url = deps.createObjectURL(new Blob([text], { type: CSV_TYPE }))
  try {
    deps.anchor.href = url
    deps.anchor.download = filename
    deps.anchor.click()
  } finally {
    deps.revokeObjectURL(url)
  }
}

type ShareDeps = {
  canShare?: (data: ShareData) => boolean
  share?: (data: ShareData) => Promise<void>
}

const probeFile = () => new File(['﻿'], 'probe.csv', { type: CSV_TYPE })

/**
 * 파일 공유가 되는 브라우저인가. `canShare({ files })` 가 유일하게 믿을 수 있는 신호다 —
 * 데스크톱 크롬은 `share` 는 있고 파일은 못 받는다. 설계대로 거짓이면 버튼을 아예 그리지 않는다.
 */
export function canShareCsv(nav: ShareDeps = navigator): boolean {
  if (typeof nav.canShare !== 'function' || typeof nav.share !== 'function') return false
  try {
    return nav.canShare({ files: [probeFile()] })
  } catch {
    // File 을 만들 수 없거나 canShare 가 던지는 환경 — 없는 것으로 본다
    return false
  }
}

/** 카카오톡 등으로 공유. 사용자가 창을 닫으면(AbortError) 조용히 끝낸다 — 실패가 아니다. */
export async function shareCsv(filename: string, text: string, nav: ShareDeps = navigator): Promise<void> {
  const share = nav.share
  if (!share) return
  try {
    await share({ title: filename, files: [new File([text], filename, { type: CSV_TYPE })] })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return
    throw err
  }
}
