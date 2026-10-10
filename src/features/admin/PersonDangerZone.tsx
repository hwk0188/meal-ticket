import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ConfirmButton } from '../../components/ConfirmButton'
import { Button, TextField } from '../../components/ui'
import { formatPhone } from '../../lib/phone'
import type { Person } from '../auth/usePerson'
import { validateAuthUserId } from './personSchema'
import { personOpsErrorMessage, useLinkPerson, useResetPerson } from './usePersonOps'

type Props = { person: Person; editing?: boolean; onDone: (message: string) => void; onStart?: () => void }

const RESET_NOTICE = '이름·번호를 지우고 카카오 연결을 끊어요. 발급·사용 기록은 남아요. 그 폰은 다음 접속 때 가입 화면부터 다시 시작해요. 되돌릴 수 없어요.'

/** 사람 상세 맨 아래: 초기화(잘못 가입 정정) · 카카오 계정 수동 연결(복구 경로). */
export function PersonDangerZone({ person, editing = false, onDone, onStart }: Props) {
  const reset = useResetPerson(person.id)
  const link = useLinkPerson(person.id)
  const [linking, setLinking] = useState(false)
  const [authUserId, setAuthUserId] = useState('')
  const [idError, setIdError] = useState<string | undefined>()

  // "수정" 폼이 열리면 이 구역의 지난 오류는 치운다 — 저장 성공 알림 위에 무관한 초기화·연결 오류가 남지 않게.
  // reset.reset·link.reset 은 매 렌더 새 참조라(useMutation) ref 에 최신 함수만 담아 둔다(useHold 의 latest 와 같은 요령).
  const resetReset = useRef(reset.reset)
  const linkReset = useRef(link.reset)
  useEffect(() => {
    resetReset.current = reset.reset
  }, [reset.reset])
  useEffect(() => {
    linkReset.current = link.reset
  }, [link.reset])
  useEffect(() => {
    if (editing) {
      resetReset.current()
      linkReset.current()
    }
  }, [editing])

  function onLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateAuthUserId({ authUserId })
    if (!result.ok) return setIdError(result.errors.authUserId)
    setIdError(undefined)
    onStart?.()
    reset.reset() // 두 동작이 서로의 오류를 지운다 — 초기화가 실패한 채 연결에 성공해도 빨간 오류가 남지 않게.
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
            <Button variant="ghost" aria-label="계정 연결 그만두기" onClick={() => { setLinking(false); setIdError(undefined); link.reset() }} disabled={link.isPending}>
              그만두기
            </Button>
            <Button type="submit" disabled={link.isPending}>{link.isPending ? '연결 중…' : '연결'}</Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => { link.reset(); setLinking(true) }}>계정 연결</Button>
      )}

      <div className="flex flex-col items-end gap-1">
        <ConfirmButton
          label={reset.isPending ? '처리 중…' : '사람 초기화'}
          message={`${person.name}(${person.phone ? formatPhone(person.phone) : '번호 없음'}) 님을 초기화할까요? ${RESET_NOTICE}`}
          confirmLabel="초기화"
          context={person.name}
          onConfirm={() => {
            onStart?.()
            link.reset() // 두 동작이 서로의 오류를 지운다
            reset.mutate(undefined, { onSuccess: () => onDone(`${person.name} 님을 초기화했어요`) })
          }}
          disabled={reset.isPending}
        />
        {reset.isError && <p role="alert" className="text-sm text-red-600">{personOpsErrorMessage(reset.error)}</p>}
      </div>
    </section>
  )
}
