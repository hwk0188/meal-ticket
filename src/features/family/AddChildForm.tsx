import { useState, type FormEvent } from 'react'
import { Button, Checkbox, TextField } from '../../components/ui'
import { toUserMessage } from '../../lib/errors'
import { validateAddChild, validateRelink } from './familySchema'
import { useAddChild, useRelinkChild } from './useFamilyActions'
import type { FamilyMember } from './useFamilyMembers'

type Props = {
  /** 내 자녀들. 고르면 "다시 연결" 모드. (React 의 children 과 섞이지 않게 이름을 따로 둔다) */
  existingChildren: readonly FamilyMember[]
  onDone: (message: string) => void
  onCancel: () => void
}
type FormErrors = Partial<Record<'name' | 'code' | 'consent', string>>

const GUARDIAN_CONSENT_TEXT = '만 14세 미만 자녀의 이름을 식권 사용 확인 목적으로 처리하는 데 보호자로서 동의합니다. 자녀 삭제 시 즉시 파기됩니다.'

/** 자녀 추가(이름·코드·법정대리인 동의) 또는 기존 자녀 재연결(코드만). 동의 체크가 법정대리인 동의 기록이 된다 (설계 §10). */
export function AddChildForm({ existingChildren: existing, onDone, onCancel }: Props) {
  const addChild = useAddChild()
  const relink = useRelinkChild()
  const [childId, setChildId] = useState('') // '' = 새 자녀
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const relinking = existing.some((c) => c.id === childId)
  const pending = addChild.isPending || relink.isPending
  const serverError = addChild.isError ? toUserMessage(addChild.error) : relink.isError ? toUserMessage(relink.error) : null

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (relinking) {
      const result = validateRelink({ childId, code })
      if (!result.ok) return setErrors(result.errors)
      setErrors({})
      relink.mutate(result.values, { onSuccess: (row) => onDone(`${row.name} 님을 다시 연결했어요`) })
    } else {
      const result = validateAddChild({ name, code, consent })
      if (!result.ok) return setErrors(result.errors)
      setErrors({})
      addChild.mutate({ name: result.values.name, code: result.values.code }, { onSuccess: (row) => onDone(`${row.name} 님을 연결했어요`) })
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 rounded-2xl border border-blue-600 bg-white p-4">
      <h2 className="font-bold">자녀 추가</h2>
      {existing.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">자녀</span>
          <select
            value={childId}
            onChange={(e) => {
              setChildId(e.target.value)
              setErrors({})
              addChild.reset()
              relink.reset()
            }}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base"
          >
            <option value="">새 자녀 추가</option>
            {existing.map((c) => (
              <option key={c.id} value={c.id}>{c.name} (다른 폰으로 다시 연결)</option>
            ))}
          </select>
        </label>
      )}
      {!relinking && (
        <TextField label="자녀 이름" name="child-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} error={errors.name} />
      )}
      <TextField
        label="자녀 폰에 뜬 코드"
        name="child-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="8자리 숫자"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        maxLength={9}
        error={errors.code}
      />
      {!relinking && (
        <section className="rounded-xl border border-gray-200 p-3 text-xs leading-relaxed">
          <Checkbox id="guardian-consent" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)}>
            <strong>[필수] 법정대리인 동의</strong>
          </Checkbox>
          <p className="mt-1 pl-6 text-gray-600">{GUARDIAN_CONSENT_TEXT}</p>
          {/* 지금은 화면에서 닿지 않는다 (동의 전에는 제출 버튼이 잠겨 consent 오류가 생기지 않는다).
              규칙은 스키마가 갖고 있으니, 잠금 방식이 바뀌어도 문구가 비지 않도록 남겨 둔다. */}
          {errors.consent && <p role="alert" className="mt-1 pl-6 text-red-600">{errors.consent}</p>}
        </section>
      )}
      {serverError && <p role="alert" className="text-sm text-red-600">{serverError}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>취소</Button>
        <Button
          type="submit"
          disabled={pending || (!relinking && !consent)}
          aria-describedby={!relinking && !consent ? 'add-child-submit-hint' : undefined}
        >
          {pending ? '연결 중…' : relinking ? '다시 연결하기' : '연결하기'}
        </Button>
      </div>
      {!relinking && !consent && (
        <p id="add-child-submit-hint" className="text-center text-xs text-gray-600">동의에 체크하면 연결할 수 있어요</p>
      )}
      {existing.length > 0 && (
        <p className="text-center text-xs text-gray-500">폰을 바꾼 자녀는 위에서 이름을 고르면 다시 연결돼요</p>
      )}
    </form>
  )
}
