import { useState, type FormEvent } from 'react'
import { ConfirmButton } from '../../components/ConfirmButton'
import { Button, TextField } from '../../components/ui'
import type { Person } from '../auth/usePerson'
import { validateAuthUserId } from './personSchema'
import { personOpsErrorMessage, useLinkPerson, useResetPerson } from './usePersonOps'

type Props = { person: Person; onDone: (message: string) => void }

const RESET_NOTICE = '이름·번호를 지우고 카카오 연결을 끊어요. 발급·사용 기록은 남아요. 그 폰은 다음 접속 때 가입 화면부터 다시 시작해요. 되돌릴 수 없어요.'

/** 사람 상세 맨 아래: 초기화(잘못 가입 정정) · 카카오 계정 수동 연결(복구 경로). */
export function PersonDangerZone({ person, onDone }: Props) {
  const reset = useResetPerson(person.id)
  const link = useLinkPerson(person.id)
  const [linking, setLinking] = useState(false)
  const [authUserId, setAuthUserId] = useState('')
  const [idError, setIdError] = useState<string | undefined>()

  function onLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateAuthUserId({ authUserId })
    if (!result.ok) return setIdError(result.errors.authUserId)
    setIdError(undefined)
    link.mutate(result.values.authUserId, {
      onSuccess: () => {
        onDone('카카오 계정을 연결했어요')
        setLinking(false)
        setAuthUserId('')
      },
    })
  }

  return (
    <section className="mt-2 flex flex-col gap-3 border-t border-gray-200 pt-4">
      <h2 className="text-xs font-bold text-gray-500">정정</h2>

      {person.auth_user_id ? (
        <p className="text-xs text-gray-500">카카오 계정이 연결돼 있어요</p>
      ) : person.consented_at === null ? (
        <p className="text-xs text-gray-500">동의 기록이 없어 연결할 수 없어요. 본인이 가입 화면에서 동의해야 해요.</p>
      ) : linking ? (
        <form onSubmit={onLink} noValidate className="flex flex-col gap-3 rounded-xl border border-gray-200 p-3">
          <p className="text-xs leading-relaxed text-gray-600">
            초기화한 사람을 같은 카카오 계정으로 되돌릴 때만 씁니다. 계정 id 는 Supabase 의 Authentication › Users 에서 복사해 주세요.
          </p>
          <TextField label="카카오 계정 id" name="auth-user-id" value={authUserId} onChange={(e) => setAuthUserId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" error={idError} />
          {link.isError && <p role="alert" className="text-sm text-red-600">{personOpsErrorMessage(link.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setLinking(false); setIdError(undefined); link.reset() }} disabled={link.isPending}>그만두기</Button>
            <Button type="submit" disabled={link.isPending}>{link.isPending ? '연결 중…' : '연결'}</Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => { link.reset(); setLinking(true) }}>계정 연결</Button>
      )}

      <div className="flex flex-col items-end gap-1">
        <ConfirmButton
          label={reset.isPending ? '처리 중…' : '사람 초기화'}
          message={RESET_NOTICE}
          confirmLabel="초기화"
          onConfirm={() => reset.mutate(undefined, { onSuccess: () => onDone(`${person.name} 님을 초기화했어요`) })}
          disabled={reset.isPending}
        />
        {reset.isError && <p role="alert" className="text-sm text-red-600">{personOpsErrorMessage(reset.error)}</p>}
      </div>
    </section>
  )
}
