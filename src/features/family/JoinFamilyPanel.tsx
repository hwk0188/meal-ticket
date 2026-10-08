import { useState, type FormEvent } from 'react'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Button, TextField } from '../../components/ui'
import { toUserMessage } from '../../lib/errors'
import { PairingCodeCard } from '../pairing/PairingCodeCard'
import { validateJoin } from './familySchema'
import { useJoinFamily } from './useFamilyActions'

type Props = { onDone: (message: string) => void; onCancel: () => void }
type Mode = 'enter' | 'show'

const ENTER_HINT = '상대 폰의 가족 › 가족 연결 › 내 코드 보여 주기에 뜬 숫자를 넣으면, 그분과 그분의 자녀가 우리 가족으로 들어와요. 그분 가족에 남은 사람이 없으면 식권도 함께 옮겨 와요.'
const SHOW_HINT = '상대 폰의 가족 › 가족 연결 › 상대 코드 입력에 이 숫자를 넣으면 나와 내 자녀가 그 가족으로 들어가요. 우리 가족에 나와 내 자녀만 있으면 내 식권도 함께 옮겨 가요.'

/** 어른끼리 가족 합치기. 코드를 "넣는" 쪽 가족이 남고, "보여 주는" 쪽이 그리로 옮겨 간다 (설계 §5.1 준비 3). */
export function JoinFamilyPanel({ onDone, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>('enter')
  const join = useJoinFamily()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | undefined>()

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateJoin({ code })
    if (!result.ok) return setError(result.errors.code)
    setError(undefined)
    join.mutate(result.values, { onSuccess: (row) => onDone(`${row.name} 님이 우리 가족이 되었어요`) })
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-blue-600 bg-white p-4">
      <h2 className="font-bold">가족 연결</h2>
      <SegmentedControl
        label="연결 방법"
        value={mode}
        onChange={(next) => {
          setMode(next)
          setError(undefined)
          join.reset()
        }}
        options={[
          { value: 'enter', label: '상대 코드 입력' },
          { value: 'show', label: '내 코드 보여 주기' },
        ]}
      />
      {mode === 'enter' ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-gray-600">{ENTER_HINT}</p>
          <TextField
            label="상대 폰에 뜬 코드"
            name="join-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="8자리 숫자"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={9}
            error={error}
          />
          {join.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(join.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={join.isPending}>취소</Button>
            <Button type="submit" disabled={join.isPending}>{join.isPending ? '연결 중…' : '우리 가족으로 연결'}</Button>
          </div>
        </form>
      ) : (
        <>
          <PairingCodeCard kind="adult" hint={SHOW_HINT} />
          <Button variant="ghost" onClick={onCancel}>닫기</Button>
        </>
      )}
    </section>
  )
}
