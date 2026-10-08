import { PostgrestError } from '@supabase/supabase-js'
import { toError, unwrap } from './postgrest'

const pgError = new PostgrestError({ message: 'phone_taken', code: 'P0001', details: '', hint: '' })

describe('toError', () => {
  it('message 와 code 를 보존한 Error 를 만든다', () => {
    const err = toError(pgError)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('phone_taken')
    expect(err.code).toBe('P0001')
    expect(err.cause).toBe(pgError)
  })
})

describe('unwrap', () => {
  it('오류가 없으면 data 를 돌려준다 (null 도 값이다)', () => {
    expect(unwrap({ data: [1, 2], error: null })).toEqual([1, 2])
    expect(unwrap({ data: null, error: null })).toBeNull()
  })

  it('오류가 있으면 던진다', () => {
    expect(() => unwrap({ data: null, error: pgError })).toThrow('phone_taken')
  })

  it('throwOnError 없이 받은 평범한 객체 오류도 같은 방식으로 던진다', () => {
    const plainError = { message: 'no_remaining', code: 'P0001', details: null, hint: null } as unknown as PostgrestError
    let caught: unknown
    try {
      unwrap({ data: null, error: plainError })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error & { code: string }).code).toBe('P0001')
    expect((caught as Error).cause).toBe(plainError)
  })
})
