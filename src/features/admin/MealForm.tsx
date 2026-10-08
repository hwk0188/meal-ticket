import { useState, type FormEvent } from 'react'
import { Button, TextField } from '../../components/ui'
import { validateMeal, type MealErrors, type MealValues } from './mealSchema'

type Props = { today: string; pending: boolean; onSubmit: (values: MealValues) => void; onCancel: () => void }

/** 식사 직접 추가 (제목·날짜·비고). 주일 점심은 버튼으로 만들고, 이 폼은 특별 식사용이다. */
export function MealForm({ today, pending, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState('')
  const [servedOn, setServedOn] = useState(today)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<MealErrors>({})

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateMeal({ title, served_on: servedOn, note })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    onSubmit(result.values)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <TextField label="식사 이름" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={30} placeholder="예: 추수감사 점심" error={errors.title} />
      <TextField label="날짜" name="served_on" type="date" value={servedOn} onChange={(e) => setServedOn(e.target.value)} error={errors.served_on} />
      <TextField label="비고 (선택)" name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} error={errors.note} />
      <div className="flex gap-2">
        {/* 취소는 처리 중에도 열어 둔다 — 기다리기 싫으면 빠져나갈 수 있어야 한다 */}
        <Button variant="ghost" onClick={onCancel}>취소</Button>
        <Button type="submit" disabled={pending}>{pending ? '추가 중…' : '식사 추가'}</Button>
      </div>
    </form>
  )
}
