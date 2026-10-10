import { useState, type FormEvent } from 'react'
import { Button, TextField } from '../../components/ui'
import type { FieldErrors } from '../../lib/validate'
import { formatPhone } from '../../lib/phone'
import { profileErrorMessage } from '../family/useFamilyActions'
import { validateAdminPerson, type AdminPersonInput } from './personSchema'
import { useUpdatePerson } from './usePersonOps'

type Props = { personId: string; name: string; phone: string | null; onDone: (message: string) => void; onCancel: () => void }

/** 관리자 이름·번호 수정. 번호는 비울 수 있다(자녀·방문자). 번호 중복은 23505 → 구체적인 문구. */
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
      {update.isError && <p role="alert" className="text-sm text-red-600">{profileErrorMessage(update.error)}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={cancel} disabled={update.isPending}>취소</Button>
        <Button type="submit" disabled={update.isPending}>{update.isPending ? '저장 중…' : '저장'}</Button>
      </div>
    </form>
  )
}
