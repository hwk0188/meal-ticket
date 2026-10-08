import { Button, Spinner } from '../../components/ui'
import { toUserMessage } from '../../lib/errors'
import { formatRemaining, useCountdown } from './useCountdown'
import { usePairingCode, type PairingKind } from './usePairingCode'

type Props = {
  kind: PairingKind
  /** 이 코드를 어디에 넣는지 (아이 화면과 가족 탭 "내 코드" 가 다르다) */
  hint: string
}

/** 8자리 코드를 크게, 남은 시간과 함께. 만료되면 흐리게 하고 "새 코드 받기" 로 다시 받는다. */
export function PairingCodeCard({ kind, hint }: Props) {
  const code = usePairingCode(kind)
  const remaining = useCountdown(code.data?.expires_at)
  const expired = code.data !== undefined && remaining === 0

  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-blue-600 bg-white p-6 text-center">
      {code.data ? (
        <>
          <p
            data-testid="pairing-code"
            className={`font-mono text-5xl font-extrabold tabular-nums tracking-[0.2em] ${expired ? 'text-gray-300 line-through' : ''}`}
          >
            {code.data.code.slice(0, 4)} {code.data.code.slice(4)}
          </p>
          <p role="status" className={`text-sm ${expired ? 'font-bold text-red-600' : 'text-gray-600'}`}>
            {expired ? '코드가 만료되었어요' : `${formatRemaining(remaining)} 남음 · 1회용`}
          </p>
        </>
      ) : code.status === 'error' ? (
        <p role="alert" className="text-sm text-red-600">{toUserMessage(code.error)}</p>
      ) : (
        <Spinner inline />
      )}
      {hint && <p className="text-xs leading-relaxed text-gray-600">{hint}</p>}
      <Button variant="ghost" onClick={() => void code.refetch()} disabled={code.isFetching}>
        새 코드 받기
      </Button>
    </section>
  )
}
