import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Checkbox, TextField } from '../../components/ui'
import { church } from '../../config/church'
import { messageOf, toUserMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { personQueryKey } from '../auth/usePerson'
import { validateOnboarding, type OnboardingErrors, type OnboardingValues } from './onboardingSchema'

// 오류가 여러 개면 이 순서로 첫 칸을 찾아 포커스를 옮긴다 (화면에 보이는 순서와 같게 둔다).
const FIELD_ORDER = ['name', 'phone', 'consent'] as const

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
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<OnboardingErrors>({})

  async function goHome() {
    // 돌려받은 행이 없을 때만 쓴다. Gate 가 사람 행을 다시 읽게 한다
    // (키 접두사 ['person'] 으로 모든 사용자 캐시를 무효화).
    await queryClient.invalidateQueries({ queryKey: ['person'] })
    navigate('/', { replace: true })
  }

  const mutation = useMutation({
    mutationFn: claimPerson,
    // claim_person 은 만든 사람 행을 그대로 돌려준다. 캐시에 넣어 두면 홈이 같은 행을 다시 묻지 않는다.
    onSuccess: (person) => {
      if (userId) queryClient.setQueryData(personQueryKey(userId), person)
      navigate('/', { replace: true })
    },
    // 더블 탭 등으로 먼저 간 요청이 이미 가입을 끝냈으면 서버는 already_registered 를 돌려준다.
    // 이것은 실패가 아니라 "이미 성공" 이므로 홈으로 보낸다 (행을 못 받았으니 Gate 가 다시 읽는다).
    onError: async (err) => {
      if (messageOf(err) === 'already_registered') await goHome()
    },
  })

  function clearError(key: keyof OnboardingErrors) {
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }

  /** 고치는 중에 지난 오류가 남아 있으면 혼란스럽다. 그 칸의 오류와 서버 안내를 함께 치운다. */
  function onEdit(key: 'name' | 'phone') {
    clearError(key)
    // 서버 안내는 방금 보낸 이름·번호에 대한 것이다. 입력이 바뀌면 더 이상 맞는 말이 아니다.
    if (mutation.isError) mutation.reset()
  }

  function focusFirstError(found: OnboardingErrors) {
    const first = FIELD_ORDER.find((key) => found[key])
    // TextField·Checkbox 의 id 를 name 과 같게 두었다. 폼 안에서만 찾는다.
    if (first) formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus()
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateOnboarding({ name, phone, consent })
    if (!result.ok) {
      setErrors(result.errors)
      // 어느 칸을 고쳐야 하는지 바로 알 수 있게 커서를 옮긴다 (화면을 읽어 주는 기기에도 알려진다).
      focusFirstError(result.errors)
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

      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="이름"
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            onEdit('name')
          }}
          autoComplete="name"
          maxLength={20}
          required
          error={errors.name}
        />
        <TextField
          label="휴대폰 번호"
          name="phone"
          type="tel"
          // tel 은 + 가 있는 자판을 띄운다 (numeric 은 숫자만 나와 국제 표기를 적을 수 없다).
          inputMode="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            onEdit('phone')
          }}
          autoComplete="tel"
          placeholder="010-0000-0000"
          required
          error={errors.phone}
        />

        <section className="rounded-xl border border-blue-600 bg-white p-3 text-xs leading-relaxed">
          <div className="flex items-start justify-between gap-2">
            <Checkbox
              id="consent"
              name="consent"
              required
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked)
                clearError('consent')
              }}
            >
              <strong>[필수] 개인정보 수집·이용 동의</strong>
            </Checkbox>
            {/* 링크를 레이블 안에 두면 체크박스 이름에 '자세히' 가 섞인다. 밖에 두고 새 창으로 연다
                (같은 탭에서 열면 적어 둔 이름·번호가 사라진다). */}
            <Link to="/privacy" target="_blank" rel="noreferrer" className="shrink-0 text-blue-600 underline">
              자세히
            </Link>
          </div>
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
          {/* 지금은 화면에서 닿지 않는다 (동의 전에는 제출 버튼이 잠겨 consent 오류가 생기지 않는다).
              규칙은 스키마가 갖고 있으니, 잠금 방식이 바뀌어도 문구가 비지 않도록 남겨 둔다. */}
          {errors.consent && (
            <p role="alert" className="mt-2 pl-6 text-red-600">
              {errors.consent}
            </p>
          )}
        </section>

        {serverError && <p role="alert" className="text-sm text-red-600">{serverError}</p>}

        <div>
          <Button
            type="submit"
            disabled={!consent || mutation.isPending}
            aria-describedby={consent ? undefined : 'submit-hint'}
          >
            {mutation.isPending ? '처리 중…' : '동의하고 시작하기'}
          </Button>
          {/* 버튼이 왜 눌리지 않는지 말해 준다. 잠긴 버튼만 보이면 사용자는 길을 잃는다. */}
          {!consent && (
            <p id="submit-hint" className="mt-2 text-center text-xs text-gray-600">
              동의에 체크하면 시작할 수 있어요
            </p>
          )}
        </div>
      </form>
    </main>
  )
}
