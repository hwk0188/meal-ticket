import { SignOutButton } from '../components/SignOutButton'
import { useAuth } from '../features/auth/AuthProvider'
import { usePerson } from '../features/auth/usePerson'
import { PairingCodeCard } from '../features/pairing/PairingCodeCard'
import { PAIR_POLL_MS } from '../features/pairing/usePairingCode'

/** `#/pair` — 아이 폰(익명 계정, 또는 카카오 뒤 "만 14세 미만")에 뜨는 연결 코드. 보호자가 연결하면 가드가 홈으로 보낸다. */
export function PairPage() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  // 보호자가 "자녀 추가" 를 마치면 이 계정에 사람 행이 생긴다. 같은 키를 보는 RequireSession 가드가 데이터를 받자마자 홈으로 보낸다.
  // 폴링은 화면이 보일 때만 돈다(refetchIntervalInBackground 기본 false) — 화면이 꺼지거나 다른 앱으로 가면 멈추고, 돌아오면
  // refetchOnWindowFocus 로 바로 다시 읽는다. "잠금 화면에서 안 바뀌었다" 는 버그가 아니다.
  usePerson(userId, { refetchInterval: PAIR_POLL_MS })

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-extrabold">보호자에게 이 코드를 보여 주세요</h1>
      <PairingCodeCard kind="child" hint="보호자 앱의 가족 › 자녀 추가에서 이 숫자를 입력하면 연결돼요" />
      <p className="text-sm leading-relaxed text-gray-600">
        연결이 끝나면 이 화면이 저절로 바뀌고 가족 식권이 보여요. <strong>홈 화면에 추가</strong>해 두면 다음부터 바로 열려요.
      </p>
      <div className="flex-1" />
      {/* 하루 넘게 연결되지 않은 익명 계정은 정리 작업이 지운다 → 코드 요청이 not_authenticated('로그인이 필요해요') 로 실패한다.
          그때는 처음으로 돌아가 "아이 계정으로 시작하기" 를 다시 누르면 새 계정으로 다시 시작된다. */}
      <p className="text-center text-xs text-gray-500">잘못 들어왔거나 코드를 받을 수 없다면 처음으로 돌아가 다시 시작할 수 있어요.</p>
      <SignOutButton label="처음으로 돌아가기" />
    </main>
  )
}
