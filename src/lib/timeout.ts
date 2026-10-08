/**
 * ms 뒤에 TimeoutError 로 abort 되는 신호. 응답이 오면 done() 으로 타이머를 치운다.
 * AbortSignal.timeout() 대신 직접 만드는 이유: jsdom(테스트)에 없을 수 있고, 가짜 타이머로 제어하기 쉽다.
 * RPC(POST) 전용 가정. GET 조회에 붙이면 postgrest-js 가 TimeoutError 를 abort 로 보지 않아 빈 재시도를 몇 번 더 한다.
 */
export function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('signal timed out', 'TimeoutError'))
  }, ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}
