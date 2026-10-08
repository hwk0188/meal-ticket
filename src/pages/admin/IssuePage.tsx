import { useState, type FormEvent } from 'react'
import { Button, Spinner, TextField } from '../../components/ui'
import { validateIssue, validateNewPerson, QUANTITY_MAX, QUANTITY_MIN, type IssueErrors, type NewPersonErrors } from '../../features/admin/issueSchema'
import { findRecentDuplicate, useIssueTickets, useLatestUnitPrice } from '../../features/admin/useIssue'
import { useMeals } from '../../features/admin/useMeals'
import { registerErrorMessage, SEARCH_MIN, sanitizeQuery, usePeopleSearch, useRegisterPerson, type PersonHit } from '../../features/admin/usePeopleSearch'
import type { Meal } from '../../features/tickets/groupTickets'
import { formatMealDate, todaySeoul } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { formatWon } from '../../lib/money'
import { formatPhone } from '../../lib/phone'

const mealLabel = (m: Meal) => `${formatMealDate(m.served_on)} · ${m.title}`

export function IssuePage() {
  const today = todaySeoul()
  const meals = useMeals()
  const upcoming = (meals.data ?? []).filter((m) => m.served_on >= today).toSorted((a, b) => a.served_on.localeCompare(b.served_on) || a.title.localeCompare(b.title, 'ko'))
  const [mealId, setMealId] = useState<string | null>(null)
  // 고른 식사가 다른 곳에서 지워졌으면(식사 탭) 다음 식사로 되돌아간다 — 빈 "변경" 없는 막다른 화면 대신.
  const meal = (mealId ? meals.data?.find((m) => m.id === mealId) : undefined) ?? upcoming[0] ?? null
  const [person, setPerson] = useState<PersonHit | null>(null)
  const [done, setDone] = useState<string | null>(null)

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">발급</h1>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>
      {done && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{done}</p>}

      {/* 식사 목록이 있어야 발급을 시작할 수 있다 (공통 규약: data 로 분기) */}
      {meals.data ? (
        person && meal ? (
          <AmountStep person={person} meal={meal} onBack={() => setPerson(null)}
            onDone={(message) => { setDone(message); setPerson(null) }} />
        ) : (
          <PickStep meal={meal} meals={upcoming} onMeal={setMealId} onPerson={(p) => { setDone(null); setPerson(p) }} />
        )
      ) : meals.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          식사를 불러오지 못했어요
          <button type="button" onClick={() => void meals.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function PickStep({ meal, meals, onMeal, onPerson }: { meal: Meal | null; meals: Meal[]; onMeal: (id: string) => void; onPerson: (p: PersonHit) => void }) {
  const [changing, setChanging] = useState(false)
  const [query, setQuery] = useState('')
  const [registering, setRegistering] = useState(false)
  const search = usePeopleSearch(query)
  const ready = sanitizeQuery(query).length >= SEARCH_MIN

  return (
    <>
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-bold text-gray-500">식사</h2>
        {meal ? (
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">{mealLabel(meal)}</span>
            <button type="button" onClick={() => setChanging((v) => !v)} className="text-xs text-blue-600 underline">변경</button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">예정된 식사가 없어요. 식사 탭에서 먼저 만들어 주세요.</p>
        )}
        {changing && (
          <ul className="mt-2 flex flex-col gap-1">
            {meals.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => { onMeal(m.id); setChanging(false) }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${m.id === meal?.id ? 'bg-blue-50 font-bold' : 'hover:bg-gray-50'}`}>
                  {mealLabel(m)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <TextField label="이름 또는 번호 뒷자리" name="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="2글자부터 찾아요" autoComplete="off" />
        {/* 검색도 data 로 분기: 재조회 실패에 결과가 사라지지 않게 */}
        {ready && !search.data && search.isFetching && <p role="status" className="text-xs text-gray-500">찾는 중…</p>}
        {ready && !search.data && search.status === 'error' && <p role="alert" className="text-xs text-red-600">{toUserMessage(search.error)}</p>}
        {ready && search.data && (
          search.data.length === 0 ? <p className="text-sm text-gray-500">찾는 사람이 없어요</p> : (
            <ul className="flex flex-col gap-1">
              {search.data.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onPerson(p)} disabled={!meal}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-40">
                    <span><strong>{p.name}</strong> <span className="text-gray-500">{p.phone ? formatPhone(p.phone) : '번호 없음'}</span></span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${p.auth_user_id ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                      {p.auth_user_id ? '가입' : '미가입'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        {registering ? (
          <NewPersonForm onCancel={() => setRegistering(false)} onRegistered={(p) => { setRegistering(false); onPerson(p) }} />
        ) : (
          <Button variant="ghost" onClick={() => setRegistering(true)} disabled={!meal}>+ 새로 등록</Button>
        )}
      </section>
    </>
  )
}

function NewPersonForm({ onCancel, onRegistered }: { onCancel: () => void; onRegistered: (p: PersonHit) => void }) {
  const register = useRegisterPerson()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<NewPersonErrors>({})

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateNewPerson({ name, phone })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    try {
      onRegistered(await register.mutateAsync(result.values))
    } catch {
      // register.isError 가 문구를 띄운다
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3 rounded-xl border border-dashed border-gray-300 p-3">
      <p className="text-xs text-gray-500">입금자명과 같게 적어 주세요. 이 사람이 나중에 같은 이름·번호로 가입하면 자동으로 연결돼요.</p>
      <TextField label="이름" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} error={errors.name} />
      <TextField label="휴대폰 번호" name="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" error={errors.phone} />
      {register.isError && <p role="alert" className="text-xs text-red-600">{registerErrorMessage(register.error)}</p>}
      <div className="flex gap-2">
        {/* 등록이 진행 중일 때 취소를 누르면 폼은 닫히지만 요청은 그대로 끝나 onPerson 이 뒤늦게 불린다 — 잠가 막는다 */}
        <Button variant="ghost" onClick={onCancel} disabled={register.isPending}>취소</Button>
        <Button type="submit" disabled={register.isPending}>{register.isPending ? '등록 중…' : '등록하고 선택'}</Button>
      </div>
    </form>
  )
}

function AmountStep({ person, meal, onBack, onDone }: { person: PersonHit; meal: Meal; onBack: () => void; onDone: (message: string) => void }) {
  const latest = useLatestUnitPrice()
  const issue = useIssueTickets()
  const [quantity, setQuantity] = useState(1)
  const [unitPrice, setUnitPrice] = useState<string | null>(null) // null = 아직 손대지 않음 → 최근 단가
  const [memo, setMemo] = useState('')
  const [errors, setErrors] = useState<IssueErrors>({})
  const [busy, setBusy] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  const priceText = unitPrice ?? (latest.data === null || latest.data === undefined ? '' : String(latest.data))
  const priceNumber = Number(priceText.replace(/,/g, '')) || 0
  const total = quantity * priceNumber

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateIssue({ quantity, unitPrice: priceText, memo })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setCheckError(null)
    issue.reset()
    setBusy(true) // 버튼을 즉시 잠근다 (이중 클릭 방어 1)
    try {
      // 60초 안에 같은 사람·식사·장수 발급이 있으면 묻는다 (이중 클릭 방어 2)
      let duplicate: boolean
      try {
        duplicate = await findRecentDuplicate({ personId: person.id, mealId: meal.id, quantity })
      } catch (err) {
        setCheckError(toUserMessage(err))
        return
      }
      if (duplicate && !window.confirm(`1분 안에 ${person.name} 님께 같은 식사 ${quantity}장을 발급한 기록이 있어요. 그래도 발급할까요?`)) return
      await issue.mutateAsync({ personId: person.id, mealId: meal.id, ...result.values })
      onDone(`${person.name} 님께 ${quantity}장 발급했어요`)
    } catch {
      // issue.isError 가 문구를 띄운다
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-extrabold">{person.name} 님께 발급</h2>
          <p className="text-xs text-gray-500">{mealLabel(meal)}</p>
        </div>
        <button type="button" onClick={onBack} className="text-xs text-blue-600 underline">다른 사람</button>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-gray-500">장수</p>
        <div className="flex items-center gap-3">
          <button type="button" aria-label="장수 줄이기" onClick={() => setQuantity((q) => Math.max(QUANTITY_MIN, q - 1))} className="h-11 w-11 rounded-xl border border-gray-300 text-xl">−</button>
          <span className="w-12 text-center text-2xl font-extrabold tabular-nums" aria-live="polite">{quantity}</span>
          <button type="button" aria-label="장수 늘리기" onClick={() => setQuantity((q) => Math.min(QUANTITY_MAX, q + 1))} className="h-11 w-11 rounded-xl border border-gray-300 text-xl">+</button>
        </div>
        {errors.quantity && <p role="alert" className="mt-1 text-xs text-red-600">{errors.quantity}</p>}
      </div>

      <TextField
        label="단가 (원)"
        name="unitPrice"
        inputMode="numeric"
        value={priceText}
        onChange={(e) => setUnitPrice(e.target.value)}
        placeholder={latest.status === 'error' ? '최근 단가를 못 불러왔어요. 단가를 적어 주세요' : '첫 발급이에요. 단가를 적어 주세요'}
        error={errors.unitPrice}
      />
      <TextField label="메모 (선택)" name="memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={100} placeholder="예: 10/5 이월" error={errors.memo} />

      {/* getByText 는 엘리먼트의 "직속" 텍스트 노드만 본다 — 합계와 금액을 한 텍스트로 묶는다 */}
      <p className="text-right text-sm"><strong>{`합계 ${formatWon(total)}`}</strong></p>
      {checkError && <p role="alert" className="text-sm text-red-600">{checkError}</p>}
      {issue.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(issue.error)}</p>}
      <Button type="submit" disabled={busy || issue.isPending}>{busy || issue.isPending ? '발급 중…' : `${quantity}장 발급하기`}</Button>
    </form>
  )
}
