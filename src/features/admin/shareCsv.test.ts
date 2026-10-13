import { canShareCsv, downloadCsv, shareCsv } from './shareCsv'

const TEXT = '﻿종류,일시\r\n발급,2026-10-09 14:00'

describe('downloadCsv', () => {
  it('objectURL 을 만들어 a[download] 를 누르고, 끝나면 되돌린다 (메모리 누수 방지)', () => {
    const createObjectURL = vi.fn<(b: Blob) => string>(() => 'blob:x')
    const revokeObjectURL = vi.fn<(u: string) => void>()
    const click = vi.fn<() => void>()
    const anchor = { click, href: '', download: '' } as unknown as HTMLAnchorElement
    downloadCsv('식권-2026-10.csv', TEXT, { createObjectURL, revokeObjectURL, anchor })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0]![0]
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(anchor.href).toBe('blob:x')
    expect(anchor.download).toBe('식권-2026-10.csv')
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
  })
})

describe('canShareCsv', () => {
  it('canShare 가 파일을 받겠다고 할 때만 참', () => {
    expect(canShareCsv({ canShare: () => true, share: async () => {} })).toBe(true)
  })

  it('canShare 가 거짓이면 거짓 (데스크톱 크롬은 share 는 있고 파일은 못 받는다)', () => {
    expect(canShareCsv({ canShare: () => false, share: async () => {} })).toBe(false)
  })

  it('API 가 아예 없으면 거짓 (iOS 가 아닌 브라우저·jsdom)', () => {
    expect(canShareCsv({})).toBe(false)
    expect(canShareCsv({ share: async () => {} })).toBe(false)
  })

  it('canShare 가 던져도 거짓으로 본다 (파일 생성이 막힌 환경)', () => {
    expect(canShareCsv({ canShare: () => { throw new Error('nope') }, share: async () => {} })).toBe(false)
  })
})

describe('shareCsv', () => {
  it('파일 하나를 share 에 넘긴다', async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {})
    await shareCsv('식권-2026-10.csv', TEXT, { canShare: () => true, share })
    const data = share.mock.calls[0]![0]
    expect(data.files?.[0]?.name).toBe('식권-2026-10.csv')
    expect(data.files?.[0]?.type).toBe('text/csv;charset=utf-8')
    expect(data.title).toBe('식권-2026-10.csv')
  })

  it('사용자가 공유 창을 닫으면(AbortError) 조용히 끝난다 — 오류로 띄우지 않는다', async () => {
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' })
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => { throw abort })
    await expect(shareCsv('x.csv', TEXT, { canShare: () => true, share })).resolves.toBeUndefined()
  })

  it('그 밖의 실패는 던진다 (화면이 문구를 띄운다)', async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => { throw new Error('boom') })
    await expect(shareCsv('x.csv', TEXT, { canShare: () => true, share })).rejects.toThrow('boom')
  })
})
