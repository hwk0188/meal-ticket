import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Checkbox, TextField } from '../../components/ui'
import { church } from '../../config/church'
import { messageOf, toUserMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { validateOnboarding, type OnboardingErrors, type OnboardingValues } from './onboardingSchema'

async function claimPerson(values: OnboardingValues) {
  const { data, error } = await supabase.rpc('claim_person', {
    p_name: values.name,
    p_phone: values.phone,
    p_consent_version: church.consentVersion,
  })
  // PostgREST 오류는 Error 가 아닌 평범한 객체다 (usePerson 과 같은 방식으로 감싼다).
  // react-query 는 error 를 Error 로 타이핑하므로, 날것을 던지면 타입과 실제가 어긋난다.
  if (error) throw Object.assign(new Error(error.message), { code: error.code, cause: error })
  return data
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<OnboardingErrors>({})

  async function goHome() {
    // 사람 행이 생겼으므로 Gate 가 다시 읽게 한다 (키 접두사 ['person'] 으로 모든 사용자 캐시를 무효화).
    await queryClient.invalidateQueries({ queryKey: ['person'] })
    navigate('/', { replace: true })
  }

  const mutation = useMutation({
    mutationFn: claimPerson,
    onSuccess: goHome,
    // 더블 탭 등으로 먼저 간 요청이 이미 가입을 끝냈으면 서버는 already_registered 를 돌려준다.
    // 이것은 실패가 아니라 "이미 성공" 이므로 홈으로 보낸다 (Gate 가 사람 행을 다시 읽는다).
    onError: async (err) => {
      if (messageOf(err) === 'already_registered') await goHome()
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateOnboarding({ name, phone, consent })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    mutation.mutate(result.values)
  }

  const notice = church.consentNotice
  const serverError =
    mutation.isError && messageOf(mutation.error) !== 'already_registered' ? toUserMessage(mutation.error) : null

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-extrabold">처음 오셨네요</h1>
      <p className="text-sm text-gray-600">권사님이 식권을 발급할 때 쓰는 정보예요. 입금하신 이름과 같게 적어 주세요.</p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="이름"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={20}
          error={errors.name}
        />
        <TextField
          label="휴대폰 번호"
          name="phone"
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          placeholder="010-0000-0000"
          error={errors.phone}
        />

        <section className="rounded-xl border border-blue-600 bg-white p-3 text-xs leading-relaxed">
          <Checkbox name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)}>
            <b>[필수] 개인정보 수집·이용 동의</b>{' '}
            <Link to="/privacy" className="text-blue-600 underline">자세히</Link>
          </Checkbox>
          <dl className="mt-2 grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1 pl-6 text-gray-600">
            <dt>항목</dt>
            <dd>{notice.items}</dd>
            <dt>목적</dt>
            <dd>{notice.purpose}</dd>
            <dt>보유</dt>
            <dd>{notice.retention}</dd>
            <dt>거부 시</dt>
            <dd>{notice.refusal}</dd>
          </dl>
          {errors.consent && (
            <p role="alert" className="mt-2 pl-6 text-red-600">
              {errors.consent}
            </p>
          )}
        </section>

        {serverError && <p role="alert" className="text-sm text-red-600">{serverError}</p>}

        <Button type="submit" disabled={!consent || mutation.isPending}>
          {mutation.isPending ? '처리 중…' : '동의하고 시작하기'}
        </Button>
      </form>
    </main>
  )
}
