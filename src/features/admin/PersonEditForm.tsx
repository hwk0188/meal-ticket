import { useState, type FormEvent } from 'react'
import { Button, TextField } from '../../components/ui'
import { codeOf, toUserMessage } from '../../lib/errors'
import type { FieldErrors } from '../../lib/validate'
import { formatPhone } from '../../lib/phone'
import { validateAdminPerson, type AdminPersonInput } from './personSchema'
import { useUpdatePerson } from './usePersonOps'

type Props = { personId: string; name: string; phone: string | null; onDone: (message: string) => void; onCancel: () => void }

/**
 * 관리자 이름·번호 수정. 번호는 비울 수 있다(자녀·방문자).
 * 번호 중복(부분 유니크 인덱스 23505)은 교인 쪽 문구("권사님께 문의해 주세요")가 여기서는 자기한테 묻는 말이 된다 —
 * 읽는 사람이 권사님 본인이므로 그 번호를 사람 탭에서 찾아보라고 이끈다(찾는 중복 행일 수 있다).
 */
function editErrorMessage(err: unknown): string {
  return codeOf(err) === '23505'
    ? '이미 다른 분이 쓰는 번호예요. 사람 탭에서 그 번호로 찾아보세요 — 찾고 있던 중복 행일 수 있어요.'
    : toUserMessage(err)
}

export function PersonEditForm({ personId, name: initialName, phone: initialPhone, onDone, onCancel }: Props) {
  const update = useUpdatePerson(personId)
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone ? formatPhone(initialPhone) : '')
  const [errors, setErrors] = useState<FieldErrors<AdminPersonInput>>({})

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateAdminPerson({ name, phone })
    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    update.mutate(result.values, { onSuccess: () => onDone(`${result.values.name} 님 정보를 저장했어요`) })
  }
  function cancel() {
    setErrors({})
    update.reset()
    onCancel()
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 rounded-2xl border border-blue-600 bg-white p-4">
      <h2 className="font-bold">정보 수정</h2>
      <TextField label="이름" name="person-name" autoComplete="name" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
      <TextField
        label="휴대폰 번호"
        name="person-phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="없으면 비워 두세요"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={errors.phone}
      />
      {update.isError && <p role="alert" className="text-sm text-red-600">{editErrorMessage(update.error)}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={cancel} disabled={update.isPending}>취소</Button>
        <Button type="submit" disabled={update.isPending}>{update.isPending ? '저장 중…' : '저장'}</Button>
      </div>
    </form>
  )
}
