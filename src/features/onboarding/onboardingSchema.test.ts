import { validateOnboarding, type OnboardingInput } from './onboardingSchema'

// 결과 전체를 한 번에 비교한다. `if (!r.ok) expect(...)` 는 좁히기엔 편하지만
// 조건부 expect 라서 (vitest/no-conditional-expect) 검사가 아예 안 돌아도 테스트가 통과한다.
describe('validateOnboarding', () => {
  it('정상 입력은 번호를 정규화해 돌려준다', () => {
    const r = validateOnboarding({ name: ' 김철수 ', phone: '010-1234-5678', consent: true })
    expect(r).toEqual({ ok: true, values: { name: '김철수', phone: '01012345678', consent: true } })
  })

  it('이름이 비면 이름 오류', () => {
    const r = validateOnboarding({ name: '  ', phone: '01012345678', consent: true })
    expect(r).toEqual({ ok: false, errors: { name: '이름을 입력해 주세요' } })
  })

  it('이름이 20자를 넘으면 오류', () => {
    const r = validateOnboarding({ name: '가'.repeat(21), phone: '01012345678', consent: true })
    expect(r).toEqual({ ok: false, errors: { name: '이름은 20자 이내로 입력해 주세요' } })
  })

  it('휴대폰 형식이 아니면 번호 오류', () => {
    const r = validateOnboarding({ name: '김철수', phone: '02-123-4567', consent: true })
    expect(r).toEqual({ ok: false, errors: { phone: '휴대폰 번호를 확인해 주세요' } })
  })

  it('+82 국제 표기도 010 으로 정규화한다', () => {
    const r = validateOnboarding({ name: '김철수', phone: '+82 10-1234-5678', consent: true })
    expect(r).toEqual({ ok: true, values: { name: '김철수', phone: '01012345678', consent: true } })
  })

  it('동의하지 않으면 동의 오류', () => {
    const r = validateOnboarding({ name: '김철수', phone: '01012345678', consent: false })
    expect(r).toEqual({ ok: false, errors: { consent: '개인정보 동의가 필요해요' } })
  })

  it('조합형(NFD) 한글 이름도 완성형으로 세어 20자까지 받는다', () => {
    // NFD 는 '김' 한 자가 3자로 세어진다. 정규화하지 않으면 7자 이름이 21자로 걸린다.
    const nfd = '김김김김김김김'.normalize('NFD')
    expect(nfd.length).toBe(21)
    const r = validateOnboarding({ name: nfd, phone: '01012345678', consent: true })
    expect(r).toEqual({ ok: true, values: { name: '김김김김김김김', phone: '01012345678', consent: true } })
  })

  it('필드를 가리키지 않는 오류는 일반 문구로 바꾼다', () => {
    // 타입이 막아 주지만 경계에서 한 번 더 본다. 객체가 아니면 zod 는 경로 없는 오류를 돌려준다.
    const r = validateOnboarding(null as unknown as OnboardingInput)
    expect(r).toEqual({ ok: false, errors: { name: '입력 내용을 확인해 주세요' } })
  })

  it('여러 오류가 있으면 필드별로 첫 메시지만 담는다', () => {
    const r = validateOnboarding({ name: '', phone: 'abc', consent: false })
    expect(r).toEqual({
      ok: false,
      errors: {
        name: '이름을 입력해 주세요',
        phone: '휴대폰 번호를 확인해 주세요',
        consent: '개인정보 동의가 필요해요',
      },
    })
  })
})
