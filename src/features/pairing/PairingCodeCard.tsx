import { Button, Spinner } from '../../components/ui'
import { toUserMessage } from '../../lib/errors'
import { formatRemaining, useCountdown } from './useCountdown'
import { PAIR_CODE_TTL_MS, usePairingCode, type PairingKind } from './usePairingCode'

type Props = {
  kind: PairingKind
  /** 이 코드를 어디에 넣는지 (아이 화면과 가족 탭 "내 코드" 가 다르다) */
  hint: string
}

/** 8자리 코드를 크게, 남은 시간과 함께. 만료되면 흐리게 하고 "새 코드 받기" 로 다시 받는다. */
export function PairingCodeCard({ kind, hint }: Props) {
  const code = usePairingCode(kind)
  // 서버가 준 만료 시각을 폰 시계와 그대로 비교하면, 폰 시계가 10분 이상 어긋난 경우 늘 만료로 보이거나
  // 반대로 줄어들지 않을 수 있다. 쿼리가 도착한 시각(React Query 의 dataUpdatedAt — 역시 이 폰 시계 기준)에
  // TTL 을 더해 한 시계로 통일한다. 왕복 시간만큼 조금 일찍 만료로 보이게 되지만 그게 안전한 방향이다.
  const remaining = useCountdown(code.data ? code.dataUpdatedAt + PAIR_CODE_TTL_MS : undefined)
  const expired = code.data !== undefined && remaining === 0

  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-blue-600 bg-white p-6 text-center">
      {code.data ? (
        <>
          <p
            data-testid="pairing-code"
            className={`font-mono text-4xl font-extrabold tabular-nums tracking-[0.1em] whitespace-nowrap ${expired ? 'text-gray-500 line-through' : ''}`}
          >
            {code.data.code.slice(0, 4)} {code.data.code.slice(4)}
          </p>
          {/* 매초 바뀌는 남은 시간을 스크린 리더가 계속 읽지 않도록 aria-live 를 끈다 — 만료라는 상태 변화만
              아래 한 번짜리 알림으로 따로 알린다. */}
          <p role="status" aria-live="off" className={`text-sm ${expired ? 'font-bold text-red-600' : 'text-gray-600'}`}>
            {expired ? '코드가 만료되었어요 · 새 코드를 받아 주세요' : `${formatRemaining(remaining)} 남음 · 1회용`}
          </p>
          {expired && (
            <p role="alert" className="sr-only">
              연결 코드가 만료되었어요. 새 코드 받기를 눌러 주세요.
            </p>
          )}
          {/* 공통 규약: data 가 있으면 본문은 그대로 보여 주고, 재발급(refetch) 실패는 작은 안내로만 알린다 —
              이미 보여 준 코드를 지우고 빈 화면을 띄우지 않는다. */}
          {code.status === 'error' && (
            <p role="alert" className="text-xs text-red-600">새 코드를 받지 못했어요. 다시 눌러 주세요.</p>
          )}
        </>
      ) : code.status === 'error' ? (
        <p role="alert" className="text-sm text-red-600">{toUserMessage(code.error)}</p>
      ) : (
        <Spinner inline />
      )}
      {hint && <p className="text-xs leading-relaxed text-gray-600">{hint}</p>}
      <Button variant="ghost" onClick={() => void code.refetch()} disabled={code.isFetching}>
        {code.isFetching ? '받는 중…' : '새 코드 받기'}
      </Button>
    </section>
  )
}
