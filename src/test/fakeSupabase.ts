import type { PostgrestError } from '@supabase/supabase-js'

type Filter = [method: string, ...args: unknown[]]

/**
 * supabase.from(table) 이 돌려주는 체이닝 빌더의 가짜. 어떤 메서드를 불러도 자기 자신을 돌려주고,
 * await 하면 미리 넣어 둔 응답을 준다. 어떤 필터가 걸렸는지 filters 로 확인한다.
 */
type Response<T> = { data: T; error: null } | { data: null; error: PostgrestError }

export class FakeQuery<T> {
  readonly filters: Filter[] = []
  private readonly response: Response<T>
  constructor(response: Response<T>) {
    this.response = response
  }
  private chain(method: string) {
    return (...args: unknown[]) => {
      this.filters.push([method, ...args])
      return this
    }
  }
  select = this.chain('select')
  eq = this.chain('eq')
  is = this.chain('is')
  'in' = this.chain('in')
  or = this.chain('or')
  gt = this.chain('gt')
  gte = this.chain('gte')
  order = this.chain('order')
  limit = this.chain('limit')
  maybeSingle = this.chain('maybeSingle')
  single = this.chain('single')
  insert = this.chain('insert')
  update = this.chain('update')
  delete = this.chain('delete')
  ilike = this.chain('ilike')
  abortSignal = this.chain('abortSignal')
  then<R>(resolve: (value: Response<T>) => R, _reject?: (reason: unknown) => unknown): Promise<R> {
    return Promise.resolve(this.response).then(resolve)
  }
  // 인자는 JSON.stringify 로 비교한다 — 객체 인자는 키 순서가 다르면 다른 값으로 본다.
  has(method: string, ...args: unknown[]): boolean {
    return this.filters.some((f) => f[0] === method && args.every((a, i) => JSON.stringify(f[i + 1]) === JSON.stringify(a)))
  }
}

export function ok<T>(data: T): FakeQuery<T> {
  return new FakeQuery<T>({ data, error: null })
}

export function fail(message: string, code = 'P0001'): FakeQuery<never> {
  return new FakeQuery<never>({ data: null, error: { message, code, details: '', hint: '', name: 'PostgrestError' } as PostgrestError })
}
