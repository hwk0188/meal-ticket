import { Link } from 'react-router'
import { church } from '../config/church'
import { officerLine } from './officerLine'

export function PrivacyPage() {
  const n = church.consentNotice
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-5 p-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-extrabold">개인정보 처리방침</h1>
      <p>{church.name}에서는 식권 서비스 운영을 위해 아래와 같이 개인정보를 처리합니다.</p>

      <section>
        <h2 className="mb-1 font-bold">1. 수집 항목</h2>
        <p>{n.items}. 만 14세 미만 자녀는 보호자가 입력한 이름만 처리하며, 보호자(법정대리인)의 동의를 받습니다.</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">2. 수집·이용 목적</h2>
        <p>{n.purpose}</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">3. 보유 및 이용 기간</h2>
        <p>{n.retention}. 발급·사용 기록은 사람을 알아볼 수 없게 처리한 뒤 회계 통계 목적으로만 보관합니다.</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">4. 정보주체의 권리와 행사 방법</h2>
        <p>동의를 거부할 수 있습니다. 다만 {n.refusal}. 열람·정정·삭제·처리정지를 아래 담당자에게 요청할 수 있고, 법정대리인은 자녀 몫을 대신 요청할 수 있습니다.</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">5. 제3자 제공과 처리 위탁</h2>
        <p>개인정보를 제3자에게 제공하지 않습니다. 데이터 저장과 로그인 처리를 위해 Supabase(데이터베이스·인증), 카카오(소셜 로그인)를 이용합니다. 카카오에서는 회원번호와 닉네임을 제공받으며, 프로필 사진과 카카오계정 이메일은 선택 동의 항목으로 거부할 수 있고 제공되더라도 로그인 계정 식별 외에 이용하지 않습니다. 데이터는 Supabase 의 국내(서울) 리전에 보관합니다.</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">6. 개인정보 담당자</h2>
        <p>{officerLine(church.privacyOfficer)}</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">7. 저장소·안전조치</h2>
        <p>로그인 유지를 위해 브라우저 로컬 저장소에 세션 토큰을 저장하며, 로그아웃하면 지웁니다. 광고·분석 목적의 쿠키는 쓰지 않습니다. 데이터는 접근 권한 정책(RLS)으로 본인과 가족, 관리자만 볼 수 있게 보호하고, 탈퇴 시 이름·번호를 익명화합니다.</p>
      </section>
      <p className="text-xs text-gray-600">시행일: {church.consentVersion}</p>

      <Link to="/" className="mt-4 text-center text-blue-600 underline">돌아가기</Link>
    </main>
  )
}
