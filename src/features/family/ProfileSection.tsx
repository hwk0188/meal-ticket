import { useState, type FormEvent } from 'react'
import { ConfirmButton } from '../../components/ConfirmButton'
import { Button, TextField } from '../../components/ui'
import { toUserMessage } from '../../lib/errors'
import { formatPhone, maskPhone } from '../../lib/phone'
import type { FieldErrors } from '../../lib/validate'
import type { Person } from '../auth/usePerson'
import { validateProfile, type ProfileInput } from './familySchema'
import { profileErrorMessage, useDeleteAccount, useUpdateProfile } from './useFamilyActions'

const DELETE_NOTICE = '이름·번호는 익명 처리되고 식권 기록은 익명으로 남아요. 자녀가 있으면 먼저 삭제해 주세요. 정말 탈퇴할까요?'

/** 가족 탭 맨 아래: 내 정보 수정(이름·번호) · 탈퇴 (설계 §8.2). 번호는 인증된 값이 아니라 본인이 고칠 수 있다. */
export function ProfileSection({ me }: { me: Person }) {
  const update = useUpdateProfile(me)
  const del = useDeleteAccount()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(me.name)
  const [phone, setPhone] = useState(formatPhone(me.phone ?? ''))
  const [errors, setErrors] = useState<FieldErrors<ProfileInput>>({})

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateProfile({ name, phone })
    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    update.mutate(result.values, { onSuccess: () => setEditing(false) })
  }
  function startEditing() {
    // 다른 기기에서 바꾼 뒤 열 수도 있다 — 열 때마다 현재 값으로 채운다 (초기 useState 값은 첫 렌더용)
    setName(me.name)
    setPhone(formatPhone(me.phone ?? ''))
    setErrors({})
    setEditing(true)
  }
  function cancel() {
    setEditing(false)
    setErrors({})
    update.reset()
  }

  return (
    <section className="mt-4 flex flex-col gap-3 border-t border-gray-200 pt-4">
      <h2 className="text-xs font-bold text-gray-500">내 정보</h2>
      {editing ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <TextField label="이름" name="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} error={errors.name} />
          <TextField label="휴대폰 번호" name="profile-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
          {update.isError && <p role="alert" className="text-sm text-red-600">{profileErrorMessage(update.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={cancel} disabled={update.isPending}>취소</Button>
            <Button type="submit" disabled={update.isPending}>{update.isPending ? '저장 중…' : '저장'}</Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between text-sm">
          <span>{me.name} · {maskPhone(me.phone)}</span>
          <button type="button" onClick={startEditing} className="px-3 py-2 text-xs text-blue-600 underline">수정</button>
        </div>
      )}
      <div className="flex flex-col items-end gap-1">
        <ConfirmButton label={del.isPending ? '처리 중…' : '탈퇴'} message={DELETE_NOTICE} confirmLabel="탈퇴하기" onConfirm={() => del.mutate()} disabled={del.isPending} />
        {del.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(del.error)}</p>}
        {/* 익명화는 끝났는데 로그아웃만 실패한 경우 (Task 10 리뷰): 다시 누르면 not_registered 가 되므로 재시도를 권하지 않는다 */}
        {del.data?.signedOut === false && (
          <p role="alert" className="text-sm text-red-600">탈퇴는 끝났어요. 통신이 불안정해 로그아웃은 못 했어요 — 앱을 닫고 다시 열어 주세요.</p>
        )}
      </div>
    </section>
  )
}
