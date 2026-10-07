import { Link } from 'react-router'
import { church } from '../config/church'

export function PrivacyPage() {
  const n = church.consentNotice
  const officer = church.privacyOfficer
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-5 p-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-extrabold">개인정보 처리방침</h1>
      <p>
        {church.name}(이하 "교회")은 식권 서비스 운영을 위해 아래와 같이 개인정보를 처리합니다.
      </p>

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
        <h2 className="mb-1 font-bold">4. 동의 거부 권리</h2>
        <p>동의를 거부할 수 있습니다. 다만 {n.refusal}.</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">5. 처리 위탁</h2>
        <p>데이터 저장과 로그인 처리를 위해 Supabase(데이터베이스·인증), 카카오(소셜 로그인)를 이용합니다. 카카오에서는 회원번호와 닉네임을 제공받으며, 프로필 사진과 카카오계정 이메일은 선택 동의 항목으로 거부할 수 있고 제공되더라도 로그인 계정 식별 외에 이용하지 않습니다.</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">6. 개인정보 담당자</h2>
        <p>
          {officer.role}
          {officer.name && ` ${officer.name}`}
          {officer.phone && ` · ${officer.phone}`}
        </p>
      </section>
      <p className="text-xs text-gray-600">시행일: {church.consentVersion}</p>

      <Link to="/" className="mt-4 text-center text-blue-600 underline">돌아가기</Link>
    </main>
  )
}
