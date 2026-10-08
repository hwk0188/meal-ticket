import type { ReactNode } from 'react'
import { ConfirmButton } from '../../components/ConfirmButton'
import { formatDate } from '../../lib/dates'
import { maskPhone } from '../../lib/phone'
import type { Person } from '../auth/usePerson'
import { canLeaveFamily, type FamilyMember } from './useFamilyMembers'

type Props = {
  members: readonly FamilyMember[]
  me: Pick<Person, 'id'>
  pending: boolean
  onLeave: () => void
  onRemoveChild: (child: FamilyMember) => void
}

/** 구성원 한 줄: 이름·태그(나/자녀/미가입)·가려진 번호·동의 날짜. 내 행엔 "가족 나가기", 내 자녀 행엔 "자녀 삭제". */
export function MemberList({ members, me, pending, onLeave, onRemoveChild }: Props) {
  const canLeave = canLeaveFamily(members, me.id)
  return (
    <ul aria-label="가족 구성원" className="flex flex-col gap-2">
      {members.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-sm font-bold">
              <span className="truncate">{m.name}</span>
              {m.id === me.id && <Tag>나</Tag>}
              {m.is_minor && <Tag>자녀</Tag>}
              {!m.is_minor && !m.auth_user_id && <Tag>미가입</Tag>}
            </div>
            <div className="text-xs text-gray-500">{detailOf(m)}</div>
          </div>
          {m.id === me.id && canLeave && (
            <ConfirmButton
              label={pending ? '처리 중…' : '가족 나가기'}
              message="나와 내 자녀만 새 가족이 돼요. 남은 식권과 지금까지의 발급·사용 내역은 이 가족에 남아요."
              confirmLabel="나가기"
              onConfirm={onLeave}
              disabled={pending}
            />
          )}
          {m.is_minor && m.guardian_id === me.id && (
            <ConfirmButton
              label={pending ? '처리 중…' : '자녀 삭제'}
              message={`${m.name} 의 이름을 지우고 연결을 끊어요. 되돌릴 수 없어요.`}
              confirmLabel="삭제"
              onConfirm={() => onRemoveChild(m)}
              disabled={pending}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

/** 자녀: 보호자 동의 날짜. 어른: 가려진 번호 · 동의 날짜(미가입이면 번호만). */
function detailOf(m: FamilyMember): string {
  if (m.is_minor) return m.guardian_consented_at ? `보호자 동의 ${formatDate(m.guardian_consented_at)}` : ''
  return [maskPhone(m.phone), m.consented_at ? `동의 ${formatDate(m.consented_at)}` : null].filter(Boolean).join(' · ')
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">{children}</span>
}
