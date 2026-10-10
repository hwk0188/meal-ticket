# 교회 식권 모바일 웹 · 설계 문서

- 작성일: 2026-10-07
- 상태: 1·2·3단계와 4a(식사 상세 현황판)·4b(관리자 사람 탭) 구현 완료 (2026-10-11). 남은 4c(통계·CSV·공유) 계획 전 §15 와 4b 계획(`docs/superpowers/plans/2026-10-11-phase4b-people.md`)의 "4c·5단계로 넘기는 것" 참고
- 목업: `docs/superpowers/specs/mockups/2026-10-07-meal-ticket/index.html` (브라우저에서 바로 열리는 단독 HTML. 파란 테두리가 확정된 선택)

## 1. 개요

교회 주일 식사 식권의 **발급 · 사용 · 관리**를 모바일 웹에서 처리하는 서비스. 결제는 시스템 밖(담당 권사님 계좌 이체)에서 이루어지고, 시스템은 **발급 기록, 사용 처리, 통계**만 담당한다.

### 목표

- 교인이 자기 폰에서 식권을 보고, 배식 담당자가 그 폰을 눌러 사용 처리한다.
- 권사님이 입금 확인 후 두어 번의 탭으로 식권을 발급한다.
- 가족이 한 잔량을 함께 쓰고, 아이도 자기 폰으로 식사할 수 있다.
- 회계 보고에 쓸 수 있는 발급·사용 장부와 월별 통계를 낸다.
- 운영 비용 0원.

### 비목표

- 온라인 결제, 환불 송금.
- 식단·메뉴 관리, 좌석 관리.
- 문자(SMS) 인증·알림 (유료).
- 다교회(멀티 테넌트) 지원. 한 교회 전용.

## 2. 제약

| 항목 | 결정 |
|---|---|
| 예산 | 사실상 0원. 유료 의존성은 사용자 승인 없이 추가하지 않는다 |
| 프론트 호스팅 | GitHub Pages, **공개 저장소** (사용자 승인) |
| 백엔드 | Supabase Free 플랜 1개 프로젝트 (DB 500MB, egress 5GB/월, MAU 5만) |
| 인증 | 카카오 로그인(어른), Supabase 익명 로그인(카카오 없는 아이) |
| 서버 | 없음. 로직은 Postgres 함수(RPC), 권한은 RLS |
| 시간대 | 모든 날짜 판정은 Asia/Seoul |

Supabase Free의 알려진 제약과 대응: 7일 미사용 시 일시정지 → GitHub Actions 2일 간격 keep-alive(스케줄 실행이 한 번 빠져도 7일 안쪽). 자동 백업 없음 → 주 1회 pg_dump를 비공개 저장소에 보관.

## 3. 사용자와 역할

| 역할 | 설명 | 계정 |
|---|---|---|
| 교인(어른) | 식권 구매자. 자기·가족 식권을 보고 사용 화면을 담당자에게 보여준다 | 카카오 |
| 자녀(만 14세 미만) | 보호자가 연결한 아이. 가족 식권을 자기 폰에서 보여준다 | 카카오 또는 익명 |
| 방문자 | 권사님이 이름·전화로 선등록. 가입할 수도, 끝내 안 할 수도 있다 | 없음 또는 카카오 |
| 배식 담당자 | 교인 폰을 꾹 눌러 사용 처리. **계정 불필요** | 없음 |
| 관리자(권사님) | 식사 등록, 발급, 취소, 대신 사용 처리, 사람 관리, 통계 | 카카오 + `role = admin` |

관리자 수는 1~2명으로 고정. 최초 관리자는 개발자가 Supabase에서 직접 지정하고, 화면에는 권한 관리 기능을 두지 않는다.

## 4. 핵심 개념

- **식사(meal)**: "10월 12일 주일 점심"처럼 날짜와 이름을 가진 한 끼. 권사님이 만들며, 주일 점심은 단축 버튼으로 생성.
- **식권(ticket)**: 특정 식사에 묶인 1식 권리. 낱장 단위로 보이고 한 번 누를 때마다 1장 사용. 날짜가 지나면 사용 불가(미사용으로 통계에 남음).
- **사람(person)**: 교인·자녀·방문자. 카카오 계정과 분리되어 있어, 계정 없이도 존재할 수 있다(선발급).
- **가족(family)**: 잔량을 공유하는 단위. 사람은 항상 정확히 하나의 가족에 속한다(처음엔 1인 가족). 식권은 산 사람 이름으로 기록되지만 잔량은 가족 단위로 계산한다.
- **연결 코드(pairing code)**: 아이 폰 또는 배우자 폰에 뜨는 8자리 1회용 코드(10분). 어른이 자기 앱에 입력하면 그 폰의 계정이 어른의 가족에 연결된다.
- **장부(ledger)**: 발급과 사용은 삭제하지 않고 쌓는다. 발급 취소는 `cancelled_at`, 사용 무효는 `voided_at`으로 표시한다.

## 5. 사용자 흐름

### 5.1 네 식구 시나리오 (확정 기준)

아빠 김철수, 엄마 이영희, 아들 민준(11세, 카카오 있음), 딸 서연(9세, 카카오 없음).

**준비(1회)**
1. 아빠: 카카오로 시작 → 이름·휴대폰 번호 입력 + 개인정보 동의 → 가입.
2. 엄마: 같은 방법으로 가입.
3. 엄마 앱 "가족 연결"에서 코드 표시 → 아빠 앱 "가족 추가"에 코드 입력 → 한 가족.
4. 민준: 카카오로 시작 → "만 14세 미만이에요" → 코드 화면 → 아빠 앱 "자녀 추가"에 이름 + 코드 + 법정대리인 동의 체크 → 연결.
5. 서연: "아이 계정으로 시작"(익명 로그인) → 코드 화면 → 아빠가 같은 방법으로 연결. "홈 화면에 추가" 안내.

**구매**
6. 아빠가 권사님 계좌로 20,000원 이체.
7. 권사님: 발급 탭 → 김철수 검색 → 식사 "10/12 주일 점심"(기본 선택) → 4장, 단가 5,000(직전 값) → 발급.
8. 네 사람 폰 모두 "10/12 주일 점심 · 4장"이 낱장으로 표시.

**당일**
9. 아빠·엄마: 아빠 폰에서 담당자가 1번, 2번 식권을 연달아 꾹 → 2장 남음. 엄마 폰도 5초 안에 갱신.
10. 민준: 자기 폰에서 3번 식권 꾹 → 1장 남음.
11. 서연: 자기 폰에서 4번 식권 꾹 → 0장. 모든 폰에서 회색 "사용 완료".
12. 내역: "12:31 아빠 폰 2장, 12:40 민준 폰 1장, 12:45 서연 폰 1장".

**예외**
- 엄마가 못 와 1장 남음 → "미사용 1장"으로 통계에 남음. 다음 주에 쓰게 하려면 권사님이 다음 식사에 **0원 발급 + 메모 "10/12 이월"**. 별도 이월 기능은 두지 않는다.
- 서연이 폰 교체 → 새 폰에서 코드 → 아빠 "자녀 추가"에서 기존 자녀 "김서연" 선택 → 재연결. 옛 폰 접근 차단.
- 엄마가 자기 이름으로 2장 추가 구매 → 이영희에게 발급 → 가족 잔량 6장. 통계는 엄마 구매로 기록.

### 5.2 선발급(미가입자·방문자)

1. 권사님이 발급 화면에서 "새로 등록" → 이름 + 휴대폰 번호 → 사람 생성(1인 가족 자동) → 발급.
2. 그 사람이 나중에 카카오로 가입하며 같은 번호를 입력하면 자동 연결. 번호가 다르면 권사님이 사람 탭에서 "합치기".
3. 끝내 가입하지 않으면 당일 권사님이 식사 상세에서 "대신 사용 처리".

### 5.3 관리자 일상

- **주중**: 입금 확인 → 발급 탭에서 연달아 발급. 다음 주일 점심은 식사 탭 맨 위 버튼으로 생성.
- **주일**: 식사 상세(현황판)로 발급·사용·남음 확인. 폰 없는 분은 대신 처리. 잘못 눌린 사용은 무효.
- **월말**: 통계 탭에서 월별 합계 확인, CSV 저장 또는 카카오톡 공유.

## 6. 아키텍처

```
모바일 브라우저 (React SPA, 교인·담당자·권사님 동일 앱)
   │ ① 앱 로드                 ② 카카오 로그인(PKCE)          ③ 조회(RLS) · RPC 호출
   ▼                            ▼                               ▼
GitHub Pages ──────────   카카오 → Supabase Auth ──────── Supabase Postgres
(정적 파일, 공개 저장소)    (세션·JWT, 익명 로그인 포함)      (테이블 · RLS · 함수)
   ▲ 배포                                                        ▲ keep-alive(2일) · 백업(주 1회)
GitHub Actions ─────────────────────────────────────────────────┘ → 비공개 백업 저장소
```

핵심 결정:

- **앱은 하나.** 로그인한 사람의 역할에 따라 교인 화면과 관리 화면이 나뉜다. 배식 담당자는 계정이 없다.
- **로직은 DB 함수에.** 발급·사용·취소·연결은 각각 한 트랜잭션. 프론트는 호출만 한다.
- **권한은 RLS에.** 프론트 코드와 anon key가 공개되어도 데이터는 DB 정책이 지킨다.
- **해시 라우팅.** `…/#/admin/meals` 형태. GitHub Pages의 새로고침 404 회피. OAuth 콜백은 PKCE(`?code=`)라 해시와 충돌하지 않는다.
- **PWA.** 매니페스트 + 홈 화면 설치. 오프라인 캐시는 앱 셸까지만.

## 7. 데이터 모델

### 7.1 테이블

**families** — 가족
| 열 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| created_at | timestamptz | |

**people** — 사람
| 열 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| family_id | uuid FK families, not null | 생성 시 트리거가 1인 가족을 만들어 채움 |
| name | text not null | 1~20자. 탈퇴 시 '탈퇴한 사용자' |
| phone | text, nullable, unique(부분) | 숫자만. `^01[0-9]{8,9}$`. 자녀는 NULL |
| auth_user_id | uuid FK auth.users, nullable, unique | 카카오 또는 익명. 선발급자는 NULL |
| role | text check in ('member','admin'), default 'member' | |
| is_minor | boolean default false | 만 14세 미만 |
| guardian_id | uuid FK people, nullable | 자녀만 |
| consented_at | timestamptz, nullable | 본인 동의 시각 |
| consent_version | text, nullable | 동의 문구 버전 (예: '2026-10-07') |
| guardian_consented_at | timestamptz, nullable | 보호자 동의 시각 (자녀만) |
| deleted_at | timestamptz, nullable | 탈퇴·삭제 |
| created_at, updated_at | timestamptz | |

제약: `is_minor = true`이면 `guardian_id`와 `guardian_consented_at` 필수. `is_minor = false`이고 `auth_user_id`가 있으면 `consented_at` 필수(선발급자는 가입 전이라 NULL). `deleted_at`이 있으면 `auth_user_id`는 반드시 NULL(익명화 강제. 안 그러면 그 계정은 재가입이 영구히 막힌다). `guardian_id`는 본인일 수 없다. `phone`의 고유 제약은 `deleted_at is null`인 행에만 적용(부분 유니크 인덱스). 전화번호 정규화는 숫자만 남기고 `+82 10…`, `+82 010…`, `0082…` 국제 표기를 `010…`으로 바꾼다. 이름은 저장 시 앞뒤 공백 제거 + NFC 정규화(iOS 는 한글을 NFD 로 보낼 수 있음)하고, 선발급 연결 비교는 공백을 모두 뺀 NFC 키로 한다(표시용 이름은 그대로). `consent_version`은 `YYYY-MM-DD` 형식만 받는다.

**meals** — 식사
| 열 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| title | text not null | 1~30자. 주일 점심은 상수 '주일 점심' |
| served_on | date not null | |
| note | text | |
| created_by | uuid FK people | |
| created_at | timestamptz | |

제약: `unique(served_on, title)`. 발급이 있으면 삭제 불가(FK restrict).

**issuances** — 발급 장부
| 열 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| person_id | uuid FK people | 구매자 |
| family_id | uuid FK families | 발급 시점의 구매자 가족(스냅샷) |
| meal_id | uuid FK meals | |
| quantity | int check > 0 | |
| unit_price | int check >= 0 | 원. 이월은 0 |
| memo | text | |
| issued_by | uuid FK people | 관리자 |
| issued_at | timestamptz | |
| cancelled_at, cancelled_by, cancel_reason | | 취소 표시 |

**usages** — 사용 장부
| 열 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| family_id | uuid FK families | 차감된 가족 |
| person_id | uuid FK people | 어느 폰에서(self) / 누구 몫으로(admin) |
| meal_id | uuid FK meals | |
| quantity | int, 항상 1 | 낱장 사용 |
| used_via | text check in ('self','admin') | |
| recorded_by | uuid FK people | self면 person_id와 같음, admin이면 관리자 |
| request_id | uuid unique | 클라이언트 생성. 재시도 중복 방지 |
| used_at | timestamptz | |
| voided_at, voided_by | | 무효 표시 |

제약: `(cancelled_at is null) = (cancelled_by is null)`, `(voided_at is null) = (voided_by is null)`, `used_via = 'self'` 이면 `recorded_by = person_id`. `usages.request_id` 는 not null unique. `cancel_reason` 과 `memo` 는 100자 이내.

**pairing_codes** — 연결 코드
| 열 | 타입 | 비고 |
|---|---|---|
| code | text PK | 8자리 숫자(`^[0-9]{8}$`). 만료·사용된 코드 자리는 새 코드가 재활용 |
| auth_user_id | uuid FK auth.users **on delete cascade** | 코드를 띄운 폰의 계정 |
| kind | text check in ('child','adult') | |
| created_at, expires_at | timestamptz | 10분 |
| used_at | timestamptz | 1회용 |

### 7.2 뷰

**ticket_balances** (security_invoker)
`family_id, meal_id, issued, used, remaining, amount`
- issued = Σ issuances.quantity where cancelled_at is null
- used = Σ usages.quantity where voided_at is null
- remaining = issued − used
- amount = Σ quantity × unit_price (취소 제외)

`meal_id`/`family_id` 가 coalesce 식이라 PostgREST 임베딩이 안 된다 → 프론트는 뷰를 읽은 뒤 `meals` 를 id 목록으로 따로 읽는다. `security_invoker` 라 관리자는 모든 가족, 교인은 자기 가족 행만 본다.

### 7.3 함수 (RPC 는 SECURITY DEFINER · 호출자 검증 포함. 내부 잠금 헬퍼와 `ping()` 만 예외)

| 함수 | 호출자 | 동작 |
|---|---|---|
| `claim_person(name, phone, consent_version)` | 로그인 사용자 | 번호 정규화 → 같은 번호·**같은 이름**의 미연결 어른이 있으면 `auth_user_id` 연결, 번호가 없으면 새 사람(1인 가족). `consented_at` 기록. 번호가 이미 다른 계정에 연결되어 있거나 이름이 다르면 오류 `phone_taken`(권사님이 사람 탭에서 정리). 코드: `not_authenticated \| anonymous_cannot_claim \| invalid_phone \| invalid_name \| consent_required \| already_registered \| phone_taken`. 이름까지 맞아야 하므로 번호만 대입해 남의 선발급 식권을 가로채기 어렵다 |
| `create_pairing_code(kind)` | 로그인 사용자 | `child`: 사람 미연결 계정만. `adult`: 가입을 마친 어른만. 같은 계정의 이전 코드를 지우고 새 8자리 숫자 코드(10분). 반환은 `{code, expires_at}` 한 행. 같은 계정의 동시 호출은 계정 단위 advisory lock 으로 직렬화. 코드: `not_authenticated \| invalid_kind \| already_registered \| not_registered \| not_adult \| code_generation_failed` |
| `add_family_member(code, child_name, consent_version)` | 어른 교인 | `child`(이름 있음): 자녀 사람 생성(`is_minor`, `guardian_id`=호출자, `guardian_consented_at`=now, `consent_version`=법정대리인 동의 문구 버전 — 없으면 `consent_required`, 가족=호출자 가족, `auth_user_id`=코드의 계정). `adult`(이름 없음): 코드 계정의 사람과 **그 사람의 미성년 자녀**를 호출자 가족으로 옮긴다 — 옛 가족에 산 사람이 없을 때만 장부(issuances·usages)를 새 가족으로 옮기고, 사람도 장부도 없는 빈 가족만 지운다. 남는 사람이 있으면 장부는 남는다. 같은 가족이면 그대로 돌려준다. 사용된 코드로 같은 의도로 다시 부르면 그때 만든 행을 돌려준다(멱등). 코드 종류와 호출 의도가 어긋나면 `expected_child_code`/`expected_adult_code`. 코드: `not_authenticated \| not_registered \| not_adult \| invalid_code \| expected_child_code \| expected_adult_code \| invalid_name \| consent_required \| already_registered` |
| `relink_child(child_id, code)` | 그 자녀의 보호자 | 자녀의 `auth_user_id`를 코드의 계정으로 교체(가족·보호자·미성년 여부와 장부는 그대로). 옛 계정은 사람 행을 잃는다. 코드: `not_authenticated \| not_registered \| not_adult \| child_not_found \| invalid_code \| already_registered` |
| `leave_family()` | 어른 교인 | 호출자와 그 자녀를 새 가족으로 이동. 장부는 옛 가족에 남는다. 다른 어른(또는 남의 자녀)이 없으면 아무것도 바꾸지 않고 현재 행을 돌려준다. 코드: `not_authenticated \| not_registered \| not_adult` |
| `remove_child(child_id)` | 보호자 | 자녀 익명화(`deleted_at`, 이름 '탈퇴한 사용자', 번호·`auth_user_id` NULL). 자녀 계정의 연결 코드도 지운다. 코드: `not_authenticated \| not_registered \| not_adult \| child_not_found` |
| `delete_my_account()` | 교인 | 본인 익명화. 자녀가 있으면 먼저 자녀 처리 요구(`has_children`), 마지막 관리자는 거부(`last_admin` — 역할 지정이 SQL 로만 가능해 운영이 멈춘다). 동의 시각·버전은 증빙으로 남긴다. 코드: `not_authenticated \| not_registered \| not_adult \| has_children \| last_admin` |
| `lock_family(family_id)` | 내부 전용(API 역할 revoke) | 가족 하나를 트랜잭션 단위로 직렬화하는 advisory lock 헬퍼(단일 키, `'family:'` 이름공간) |
| `lock_family_meal(family_id, meal_id)` | 내부 전용(API 역할 revoke) | 가족·식사 단위 advisory lock 헬퍼. `use_ticket` 과 같은 두 키(`hashtext(family), hashtext(meal)`) |
| `use_ticket(meal_id, request_id)` | 가족 구성원(자녀 포함) | `request_id` 중복이면 기존 결과 반환. 식사가 **오늘(Asia/Seoul)**이 아니면 `not_today`. 가족 잔량 행 잠금(advisory lock on family_id, meal_id) → remaining < 1이면 `no_remaining` → usages 1건 삽입. 코드: `not_authenticated \| not_registered \| invalid_request \| meal_not_found \| not_today \| no_remaining \| duplicate_request`. 잠금(`pg_advisory_xact_lock(hashtext(family_id), hashtext(meal_id))`)을 멱등 조회보다 먼저 건다; 같은 request_id 를 다른 식사에 재사용하면 `duplicate_request`. 4a 에서 재정의: 사람 행 `for update` + `lock_family_meal` |
| `issue_tickets(person_id, meal_id, qty, unit_price, memo)` | 관리자 | issuances 삽입. `family_id`는 그 사람의 현재 가족. 코드: `not_authenticated \| forbidden \| invalid_quantity \| invalid_price \| invalid_memo \| person_not_found \| person_is_minor \| meal_not_found`(자녀 이름으로는 발급하지 않는다) |
| `cancel_issuance(id, reason)` | 관리자 | 발급 한 건 통째로 취소(`cancelled_at`·`cancelled_by`·`cancel_reason`). 취소 뒤 가족 잔량이 음수면 `would_go_negative` 거부. 코드: `not_authenticated \| forbidden \| invalid_reason \| issuance_not_found \| already_cancelled \| would_go_negative` |
| `use_ticket_as_admin(person_id, meal_id, family_id, request_id)` | 관리자 | 1장 대신 사용. 날짜 제한 없음(사후 기록). 자녀 몫도 허용(잔량은 가족 것). `used_via='admin'`, `recorded_by`=관리자. `family_id`(선택)는 화면이 본 가족 — 그 사이 사람이 가족을 옮겼으면 `family_changed` 로 거부. `request_id`(선택)는 재시도 키 — 같은 값은 처음 결과를 돌려주고 다른 대상에 재사용하면 `duplicate_request`, 없으면 서버가 만든다(멱등 아님). 코드: `not_authenticated \| forbidden \| person_not_found \| family_changed \| meal_not_found \| no_remaining \| duplicate_request` |
| `void_usage(id)` | 관리자 | 사용 한 건을 무효 표시(`voided_at`·`voided_by`, 잔량 +1). 삭제하지 않는다. 코드: `not_authenticated \| forbidden \| usage_not_found \| already_voided` |
| `merge_people(from_id, into_id)` | 관리자 | from 의 장부(구매자·처리자)·자녀·계정·관리자 권한을 into 로 옮기고 from 익명화. 장부의 가족은 **옛 가족에 산 사람이 남지 않을 때만** 옮긴다. 익명화된 from 행도 남는 쪽 가족으로 옮겨 빈 가족을 지운다. 코드: `not_authenticated \| forbidden \| same_person \| person_not_found \| minor_not_allowed \| both_have_accounts` |
| `link_person(person_id, auth_user_id)` | 관리자 | 수동 연결. **동의 기록이 있는, 계정 없는 어른에게만.** 동의를 대신 만들지 않는다. 코드: `not_authenticated \| forbidden \| person_not_found \| minor_not_allowed \| already_registered \| consent_required \| account_not_found \| anonymous_cannot_claim \| account_taken` |
| `admin_reset_person(person_id)` | 관리자 | 잘못 가입한 사람 초기화: 익명화 + 계정 연결 해제. **장부는 보존.** 그 폰은 다음 접속 때 가입 화면부터 다시 시작. 코드: `not_authenticated \| forbidden \| person_not_found \| minor_not_allowed \| has_children \| last_admin` |
| `create_next_sunday_lunch(p_today date default 서울 오늘)` | 관리자 | 기준일 = max(가장 늦은 '주일 점심', 어제)의 다음 일요일. 동시 클릭만 on conflict 로 수렴하고 순차 재호출은 다음 일요일을 만든다(프론트는 자동 재시도하지 않는다) |
| `ping()` | anon | keep-alive용. `select 1` |

모든 함수는 실패 시 `raise exception '<snake_case 코드>'`(메시지에 코드 문자열만, 값 보간 없음)로 오류를 내고, PostgREST가 `{"code":"P0001","message":"<코드>"}`로 내보내면 프론트가 사용자 문구로 바꾼다. DB 원시 오류(23503·23505 등)가 그대로 새어 나가면 규약 위반이다. 각 함수의 권위 있는 오류 코드 목록은 마이그레이션 파일의 함수 머리 주석이다.

**가족·장부 함수의 잠금 순서(어기면 40P01 교착).** ① `pairing_codes` 행 → ② 쓸 `people` 행을 **id 순**으로 `for update`(어른·본인 행을 자녀 행보다 먼저) → ③ `lock_family(uuid)` 를 **가족 id 순**으로 → ④ `lock_family_meal(uuid, uuid)` 를 **meal_id 순**으로. 장부 행(issuances·usages) 잠금은 ④ 뒤에 — 합류의 장부 이동과 같은 순서다(먼저 잠그면 40P01). 가족 잠금을 쥔 채 사람 행을 새로 잠그지 않는다 — 잠글 사람 행은 ②에서 모두 잡는다. "빈 가족인가 / 자녀가 있나 / 나뿐인가" 같은 구성원 판정은 ③ 뒤에서 한다.

### 7.4 RLS

| 테이블 | 교인 | 자녀 계정 | 관리자 |
|---|---|---|---|
| people | 같은 가족(탈퇴자 제외) select. 본인 행의 name·phone만 update | 같은 가족 select (수정 불가) | 전부 select, insert·update는 name·phone만, 익명화된 행은 수정 불가(함수로만) |
| families | 자기 가족 select | 동일 | 전부 |
| meals | 전체 select | 동일 | insert/update/delete |
| issuances, usages | 자기 가족 select | 동일 | 전부 select |
| ticket_balances | 뷰, 기반 테이블 RLS 적용 | | |
| pairing_codes | 직접 접근 불가 | | 불가 (함수로만) |

issuances·usages·pairing_codes에는 insert/update 정책을 두지 않는다(함수로만 쓰기).

### 7.5 주기 작업 (pg_cron)

작업 본문은 `public` 함수로 두고 `cron.schedule` 이 그 함수만 부른다(pgTAP 이 함수를 직접 호출해 검증한다). 세 함수 모두 **SECURITY INVOKER** — cron 이 `postgres` 로 실행하므로 충분하고, DEFINER 로 두면 `auth.users` 삭제 권한이 API 역할에 새어 나간다. 세 함수는 `public, anon, authenticated` 에서 execute 를 모두 revoke 한다.

| 함수 | 주기 (UTC → KST) | 지우는 것 |
|---|---|---|
| `cleanup_pairing_codes()` | `0 * * * *` 매시간 | 만료되었거나 사용된 연결 코드 |
| `cleanup_orphan_anonymous_users()` | `15 18 * * *` → 03:15 KST | 만든 지 **24시간**이 지났고 `people` 행이 없으며 **살아 있는 연결 코드도 없는** 익명 `auth.users`(코드를 띄워 둔 폰은 남긴다 — 지우면 cascade 로 코드가 사라지고 그 폰이 로그아웃된다). 카카오 계정은 지우지 않는다 |
| `cleanup_empty_families()` | `30 18 * * *` → 03:30 KST | 사람 행도 장부(issuances·usages)도 없고 만든 지 **1시간** 지난 `families` 행만 |

마이그레이션이 `create extension pg_cron with schema pg_catalog` 로 확장을 켠다(Supabase Free 에서도 무료). **Supabase 공식 문서의 `grant usage on schema cron to postgres; grant all privileges on all tables in schema cron to postgres;` 스니펫은 절대 실행하지 않는다** — supautils 가 이미 권한을 주며, 그 grant 가 남아 있으면 Supabase 의 pg_cron after-create 스크립트가 CASCADE 없이 `revoke all on cron.job from postgres` 를 돌리다 2BP01 로 실패해 `db push` 가 깨진다(마이그레이션이 그런 grant 를 먼저 거두는 prelude 를 둔다).

pg_cron 은 실패를 재시도하지 않는다 — 실패는 `cron.job_run_details` 에만 남고 다음 예정 시각에 다시 돈다.

## 8. 화면 설계

### 8.1 라우트

| 경로 | 화면 |
|---|---|
| `#/` | 교인 홈 (오늘 식권 목록) |
| `#/onboarding` | 어른 가입 (이름·번호·동의) / 만 14세 미만 선택 |
| `#/pair` | 연결 코드 표시 |
| `#/history` | 내역 |
| `#/family` | 가족 탭 (어른만) |
| `#/privacy` | 개인정보 처리방침 |
| `#/admin/meals`, `#/admin/meals/:id` | 식사 목록 / 식사 상세(현황판) |
| `#/admin/issue` | 발급 |
| `#/admin/people`, `#/admin/people/:id` | 사람 목록 / 상세 |
| `#/admin/stats` | 통계 |

### 8.2 교인 화면

**시작**: "카카오로 시작하기", "아이 계정으로 시작하기(카카오 없이 · 보호자 연결 필요)", 하단 "개인정보 처리방침".

**가입(onboarding)**: 상단 토글 "어른이에요 / 만 14세 미만이에요".
- 어른: 이름(입금자명과 같게 안내), 휴대폰 번호, **[필수] 개인정보 수집·이용 동의** 체크(항목·목적·보유·거부 시 불이익 네 가지를 화면에 표기, "자세히"는 처리방침). 체크 전 버튼 비활성. 버튼 "동의하고 시작하기".
- 만 14세 미만: 입력 없이 `#/pair`로.

**연결 코드(pair)**: 8자리 큰 글씨, 남은 시간(폰 시계가 아니라 **코드를 받은 시각 + 10분**으로 센다 — 시계가 틀린 폰에서 영원히 '만료' 로 보이지 않게), "보호자 앱의 가족 › 자녀 추가에서 입력" 안내, "홈 화면에 추가" 권유, "처음으로 돌아가기"(로그아웃). 연결되면 사람 행 **3초 폴링**이 알아채 자동으로 홈으로.

**홈**:
- 상단: 가족 아바타 + "우리 가족 식권 · N명". 1인 가족이면 "내 식권".
- 식사 카드: "오늘 · 10월 12일 (주일)", 식사명, **초 단위 실시간 시계**, "N장 남음".
- **식권 목록**: 한 장 = 좌우 꽉 찬 가로 막대, 아래로 쌓임. 왼쪽 아이콘, 가운데 상태, 오른쪽 "3 / 4" 번호. 사용된 장은 제자리에서 회색, "12:31 사용 · 아빠 폰", "사용 완료" 도장. 사용된 장이 3장 이상이면 "사용 완료 N장" 한 줄로 접고 탭하면 펼침. 장수가 많으면 세로 스크롤. 사용된 장은 목록 앞쪽에 모아 회색으로 표시한다(식권은 서로 바꿔 쓸 수 있으므로 "제자리" 는 의미가 없다). 식권 행은 세로 스크롤을 허용한다(`touch-pan-y`, `touch-action: pan-y`), 드래그는 누름을 취소한다.
- **사용 동작**: 담당자가 식권 한 장을 **600ms 꾹 누름**. 누르는 동안 왼쪽에서 색이 차오르고, 다 차면 RPC 호출 → 성공 시 회색 전환 + 짧은 체크 애니메이션. 손을 떼면 즉시 취소. 두 명분이면 두 장을 연달아.
- 안내문: "담당자가 식권을 꾹 눌러 주세요".
- 맨 아래 작은 줄: "다음 · 10/19 주일 점심 · 4장".
- 오늘 식사가 없으면: "오늘은 식사가 없어요" 카드 + 다가오는 식권 목록 + 지난 식권(미사용 장수 표시, 접힘).
- 하단 탭: 식권 · 내역 · 가족(어른만).
- 바닥글에 처리방침 링크와 로그아웃. **아이 계정(익명)은 로그아웃 전에 한 번 더 묻는다** — "아이 계정은 로그아웃하면 보호자가 새 코드로 다시 연결해야 해요. 정말 로그아웃할까요?"(세션을 잃으면 사람 행과의 유일한 연결이 끊어진다).
- 갱신: 화면이 보이는 동안 5초 폴링, 포커스 복귀 시 즉시 재조회.
- 오프라인 배지 문구는 "오프라인 · 사용 처리 불가"(마지막 확인 시각은 미표시).

**내역**: 발급(장수·금액·담당자)과 사용(시각·어느 폰)이 시간 역순.

**가족**: 구성원 목록(이름, 가려진 번호, 나/자녀/미가입 태그, 동의 날짜), "+ 자녀 추가"(이름, 코드, 법정대리인 동의 체크, 기존 자녀 선택 시 재연결), "+ 가족 연결"(두 모드 — "상대 코드 입력 / 내 코드 보여 주기". 내 코드를 보여 주는 중에 상대가 나를 흡수하면 그것도 알아채 "가족이 연결되었어요" 를 띄운다), **행마다 작은 버튼 + 두 단계 확인**("가족 나가기" / "자녀 삭제"). 맨 아래 "내 정보 수정(이름·번호) · 탈퇴". 어른은 1인 가족이어도 이 탭이 있다.

**부정 사용 대비**: 실시간 시계와 흐르는 빛(스크린샷 판별), 사용 시각 표시, 당일만 버튼 노출, 서버 당일 검증. 교인이 스스로 눌러 버리는 것은 본인 손해이므로 막지 않는다.

### 8.3 관리자 화면

하단 탭: 식사 · 발급 · 사람 · 통계 · 내 식권. 상단에 "관리자" 배지.

**식사**: 맨 위 "+ 다음 주일 점심 만들기 (날짜)". 다가오는 식사 카드(발급 장수·가족 수·금액·사용률 바), 지난 식사(발급·사용·미사용). "+ 식사 직접 추가"(제목·날짜·비고). 발급 없는 식사만 삭제 가능.

**발급**: 식사(다음 식사 기본 선택, "변경"), 이름·번호 뒷자리 검색(2글자부터), 결과에 가입/미가입/방문자 태그와 가족 수(검색 결과의 "방문자" 태그와 "가족 수" 는 3·4단계에서 — 2단계는 가입/미가입 태그만. 자녀는 검색 결과에서 제외), "+ 새로 등록(이름·전화)". 다음 → 장수(−/+), 단가(가장 최근의 **유료(0원 제외)·미취소** 발급 단가가 기본값, 첫 발급이면 빈칸), 메모, 합계 표시, "N장 발급하기". 완료 후 발급 화면으로 복귀.
중복 방어: 버튼 즉시 비활성. 같은 사람·식사·장수 발급이 60초 안에 있으면 확인 창.

**식사 상세(현황판)**: 발급·사용·남음·금액 네 숫자 한 줄, 이름 검색(구매자·사용자), 가족 블록(구매자 이름들 · "N장 중 M장 사용" · 남음·금액 · 발급 줄 · 사용 줄). 동작은 ⋯ 메뉴가 아니라 줄마다 작은 두 단계 확인 버튼: 가족 블록 "1장 대신 사용"(활성 발급의 최근 구매자 몫), 발급 줄 "발급 취소"(가족 남은 장수보다 많으면 잠기고 이유 표시), 사용 줄 "무효". 발급 취소는 사유 입력 칸을 거친다(선택 — 비우면 4a 와 똑같이 취소된다. 4b 에서 추가). 5초 폴링.

**사람**(4b 에서 구현): 검색(이름·번호 뒷자리 — 살아 있는 사람 전체를 한 번 읽어 클라이언트에서 좁힌다), 필터 칩(전체·미가입·관리자), 목록(전체 번호, 관리자·자녀·미가입 태그와 가족 수). 상세: 이름·번호 수정, 가족 보기, 발급·사용 이력(취소 사유 포함), 중복 사람 합치기, 사람 초기화, 카카오 계정 수동 연결(복구 경로). 익명화된 사람은 목록에서 빼고, 상세는 "기록만 남아 있어요" 로 보여 준다.
**"방문자" 태그는 넣지 않았다** — 스키마에 근거가 될 열이 없다(선발급 입력과 미가입은 구별되지 않는다). 대신 관리자 태그를 둔다.
목록 줄은 번호 없는 동명이인을 구분할 수 있어야 한다(자녀는 번호 없이 등록되고 유일 인덱스는 번호 있는 행만 본다) — 식구 한 명의 이름을 함께 보여 주고, 줄 링크에 명시적 접근성 이름을 준다.

**통계**: 월 선택(식사일 기준) → 발급 장수·금액·사용 장수 → 식사별 행 → 교인별 검색. "CSV 저장"(다운로드), "카톡으로 공유"(Web Share API, 미지원 시 숨김).
CSV 열: 종류(발급/취소/사용/무효), 일시, 식사일, 식사명, 이름, 가족 대표, 장수, 단가, 금액, 처리자, 메모. 월 단위 필터 적용.

## 9. 예외 처리

### 사용
- 동시 사용으로 잔량 부족: 함수가 `no_remaining` → "방금 다른 폰에서 사용되었어요" + 목록 재조회.
- 느린 네트워크: 누름 완료 후 "처리 중…", 5초 타임아웃 → "통신이 불안정해요. 다시 눌러 주세요". 같은 `request_id`로 재시도하므로 이중 차감 없음.
- 오프라인: 상단에 "오프라인 · 마지막 확인 HH:MM" 배지, 사용 버튼 비활성. 오프라인 사용 처리는 지원하지 않는다.
- 당일 아님: 버튼 미노출 + 서버 `not_today`.
- 잘못 누름: 관리자가 무효 처리.

### 발급
- 이중 클릭: 버튼 비활성 + 60초 내 동일 발급 확인 창.
- 취소 불가: `would_go_negative` → "이미 사용된 장수가 있어 이 발급은 취소할 수 없어요. 먼저 사용 기록을 무효 처리해 주세요"(발급 단위 취소이므로 가족 남은 장수보다 많은 발급은 버튼도 잠기고 이유를 보여 준다).
- 식사 삭제 불가: "발급이 있는 식사는 삭제할 수 없어요. 발급을 모두 취소한 뒤 삭제하세요".

### 가입·연결
- `phone_taken`: "이미 등록된 번호예요. 권사님께 문의해 주세요".
- 코드 오류·만료: "코드가 맞지 않거나 만료되었어요. 자녀 폰에서 새 코드를 받아 주세요".
- 14세 미만이 어른으로 가입: 기술적으로 막지 않음. 안내 문구로 유도하고, 발견 시 관리자가 **사람 › 사람 초기화** 를 누르면 아이 폰이 가입 화면으로 돌아가 "만 14세 미만 → 코드 → 보호자 자녀 추가"의 정상 경로를 다시 탄다.
- 카카오 로그인 취소·실패: 시작 화면 + 한 줄 안내.
- 익명 세션 소실(브라우저 데이터 삭제·폰 교체): 시작 화면으로. 보호자가 재연결.
- 세션 만료: Supabase가 리프레시 토큰으로 자동 갱신. 실패 시 재로그인 유도.

### 관리자·운영
- 권한 없는 접근: 라우트 가드 + RLS. 데이터 미노출.
- Supabase 일시정지: 초기 연결 실패 시 "서버가 잠시 쉬고 있어요. 관리자에게 알려 주세요". keep-alive로 예방.
- 관리자 교체·분실: 개발자가 SQL로 `role` 변경. 운영 문서에 절차 기재.
- 오류 기록: 브라우저 콘솔 + Supabase 로그(1일). 필요 시 Sentry 무료 플랜 추가(선택).

## 10. 개인정보 보호

- **법적 근거**: 교인 가입 시 명시적 동의(개인정보 보호법 제15조). 선발급 입력은 식권 구매 계약 이행에 필요한 처리로 별도 동의 없이 가능하며, 가입 시 정식 동의를 받는다. 만 14세 미만은 보호자가 "자녀 추가"에서 체크하는 것을 법정대리인 동의로 기록한다(제22조의2).
- **수집 최소화**: 카카오에서 실제로 쓰는 항목은 회원번호뿐이며, 닉네임·프로필 사진·이메일은 모두 **선택 동의**로 두어 교인이 거부할 수 있게 한다(앱은 세 값을 읽지 않는다). 앱은 어른의 이름·휴대폰 번호, 자녀의 이름만 저장한다. (Supabase 의 카카오 연동은 `account_email` scope 를 항상 요청하므로, 카카오 앱을 **개인 개발자 비즈 앱**으로 전환해 이메일 동의항목을 등록해야 로그인이 된다. 비용은 없다. 2025~2026년 Supabase 이슈 #36878 참고.)
- **고지 4요소**: 항목(이름, 휴대폰 번호) / 목적(식권 발급·사용 확인, 본인 식별) / 보유(탈퇴 시까지, 탈퇴 후 익명 처리) / 거부 시 서비스 이용 불가. 가입 화면과 `#/privacy`에 표기.
- **증빙**: `consented_at`, `consent_version`, `guardian_consented_at`. 자녀 행의 `consent_version` 은 보호자가 "자녀 추가" 에서 체크한 **법정대리인 동의 문구의 버전**(`YYYY-MM-DD`)이다.
- **파기**: 탈퇴·자녀 삭제 시 이름 '탈퇴한 사용자' 로 치환, 번호·계정 NULL. 장부는 익명 상태로 보존(금액 통계). 익명화된 구성원 행은 가족 행과 함께 영구히 남는다 — 구성원 행이 하나라도 있는 가족 행은 지우지 않으므로(`cleanup_empty_families`) `families` 는 세대 변동만큼만 늘어난다. 마지막 관리자는 탈퇴할 수 없다(`last_admin`) — 역할 지정이 SQL 로만 가능해 운영이 멈춘다.
- **연결 코드 길이(8자리)**: 어른 코드를 한 번 맞히면 그 가족과 장부, 가려지지 않은 전화번호까지 공격자의 가족으로 통째로 합쳐진다. RPC 에는 호출 횟수 제한이 없어 방어는 추측 공간뿐이므로 6자리(10^6)보다 100배 비싼 8자리(10^8 × 10분 창)로 둔다.
- **노출 최소화**: 교인 화면은 번호 가운데 마스킹. 전체 번호는 관리자 사람 탭에서만.
- **발급 취소 사유는 가족에게 비공개가 아니다**: `issuances.cancel_reason` 은 관리자가 적는 자유 서술인데, `issuances` 의 select 권한은 열 단위가 아니라 표 단위로 `authenticated` 에 주어지고 `issuances_select_family_or_admin` 은 자기 가족 행을 열 제한 없이 연다. 교인 화면(`HistoryPage`)과 교인 쪽 조회(`useFamilyLedger`)는 이 열을 **읽지 않지만**, 작정한 교인은 직접 질의해 볼 수 있다. 그래서 입력 칸 아래에 "가족도 볼 수 있어요" 를 적는다. 진짜 비공개가 필요해지면 관리자 전용 읽기 경로(definer 함수 또는 관리자 전용 뷰)를 만들고 이 열을 교인 권한에서 뺀다 — 4c 에서 결정한다.
- **백업**: 비공개 저장소에만. 공개 저장소의 Actions 아티팩트에 두지 않는다.
- **처리방침 필수 항목(제30조)**: 수집 항목·목적·보유기간·거부권 외에 정보주체 권리 행사 방법(열람·정정·삭제·처리정지, 법정대리인 대리 행사), 제3자 제공 없음, 처리 위탁(Supabase·카카오), 데이터 보관 위치(Supabase 국내·서울 리전 — 프로젝트 생성 시 반드시 서울 리전 선택), 로컬 저장소에 세션 토큰 저장·로그아웃 시 삭제, 안전조치(RLS·익명화)를 적는다. 홈 화면에서도 처리방침 링크에 상시 접근 가능해야 한다.
- **처리방침에 필요한 입력값(교회 확인 사항)**: 교회 공식 명칭, 개인정보 담당자 이름·연락처(빈 값으로 출시 금지), 앱 이름.

## 11. 기술 스택

| 영역 | 선택 |
|---|---|
| 프론트 | React 19, Vite, TypeScript(strict) |
| 스타일 | Tailwind CSS |
| 라우팅 | React Router (HashRouter) |
| 데이터 | `@supabase/supabase-js` v2, TanStack Query |
| 폼·검증 | Zod (전화번호·이름·장수·단가) |
| PWA | vite-plugin-pwa |
| DB 스키마 | Supabase CLI 마이그레이션 (`supabase/migrations/*.sql`), 함수·RLS·pg_cron 포함 |
| 테스트 | pgTAP, Vitest, Testing Library, Playwright |
| CI/CD | GitHub Actions |

Supabase 설정: Kakao provider(REST API key, client secret), "Allow users without an email" 켬, 익명 로그인 켬, Redirect URL에 GitHub Pages 주소 등록, PKCE 플로우.

카카오 개발자 콘솔: 앱 생성(회사명 = 교회명), **개인 개발자 비즈 앱 전환**(무료, 사업자번호 불필요), 카카오 로그인 ON, OpenID Connect 는 끔, 동의항목 = 닉네임(선택) · 프로필 사진(선택) · 카카오계정 이메일(선택) — 세 항목 모두 "사용"으로 켜 두되 전부 선택 동의, Redirect URI = Supabase 콜백 주소. Supabase 쪽은 "Allow users without an email" 켬. ※ Supabase(GoTrue)가 카카오 scope 를 `account_email, profile_image, profile_nickname` 으로 고정 요청하므로 이메일 동의항목이 없으면 KOE205 오류가 난다.

## 12. 테스트 전략 (커버리지 80% 이상, TDD)

1. **pgTAP (로컬 Supabase)** — 가장 두텁게.
   - `use_ticket`: 잔량 초과 거부, 당일 외 거부, 동일 `request_id` 1회 처리, 동시 호출 중 1건만 성공, 자녀 계정 호출 성공, 다른 가족 호출 거부.
   - `issue_tickets`/`cancel_issuance`/`use_ticket_as_admin`/`void_usage`: 비관리자 거부, 음수 잔량 거부(`would_go_negative`), family 스냅샷, 대신 사용 멱등(`request_id`)·가족 확인(`family_changed`)·④ 잠금 키 고정(`pg_locks`), 무효 재호출 거부.
   - `claim_person`: 선발급 연결, 중복 번호 거부, 동의 기록.
   - `add_family_member`/`relink_child`/`leave_family`: 가족 이동, 자녀 동반 이동, 빈 가족 삭제, 장부 보존.
   - `merge_people`/`admin_reset_person`/`link_person`: 장부(구매자·처리자 네 열)·자녀·계정·관리자 권한 이동, 옛 가족을 유지할 조건, 익명화된 사람을 주는 쪽·받는 쪽으로 삼을 때 거부, ③ `lock_family`·④ `lock_family_meal` 잠금 키(`pg_locks`), 초기화 뒤 장부 보존, 연결의 모든 관문.
   - RLS: 다른 가족 issuances/usages/people 비노출, 관리자 전부 가시, pairing_codes 직접 접근 불가.
   - `create_next_sunday_lunch`: 날짜 계산, 중복 시 기존 반환.
2. **Vitest 단위**: 전화번호 정규화·검증, 금액 표기, 식권 목록 접기 규칙, Asia/Seoul 날짜 유틸, 꾹 누르기 훅(600ms, 조기 해제 취소), 오류 코드 → 문구 매핑.
3. **Testing Library 컴포넌트**: 식권 목록 상태(미사용·누르는 중·사용·접힘), 가입 폼(동의 전 비활성), 발급 폼(검증·합계), 식사 상세 행 버튼(취소·대신 사용·무효, 두 단계 확인).
4. **Playwright E2E (로컬 Supabase, 테스트 세션 주입)**: (a)+(c) 관리자 발급 → 선발급 가입 자동 연결 → 꾹 눌러 사용 → 회색, 2단계에서 한 테스트(`e2e/tickets.spec.ts`)로 합쳤다. (b) 아이 익명 시작 → 코드 → 보호자 자녀 추가 → 아이 폰에 가족 잔량 → 아이 폰에서 사용 → 보호자 폰 반영 = 3단계의 `e2e/family.spec.ts`(**두 브라우저 컨텍스트** = 두 대의 폰). (d) 관리자 현황판 → 발급 명단 → 1장 대신 사용 → 무효 → 발급 취소 = 4a 의 `e2e/admin.spec.ts`. (e) 중복 사람 합치기 → 이력 합산 → 발급 취소 사유 → 사람 초기화 = 4b 의 `e2e/people.spec.ts`. 공통 동작은 `e2e/helpers.ts`. E2E 는 단일 워커 직렬 실행(공유 DB).
5. **CI**: `supabase start`(러너마다 새 DB — 마이그레이션·시드가 그때 적용되므로 `db reset` 은 불필요) → pgTAP → 린트 → Vitest(coverage) → `npm run build` → 하위 경로 빌드(`VITE_BASE_PATH=/meal-ticket/`) → Playwright. main push 는 통과 시 `supabase db push`(마이그레이션 먼저) → Pages 배포. 새 프론트가 옛 스키마를 만나지 않도록 DB를 먼저 올린다.
6. **수동**: 실제 폰에서 꾹 누르기 감도, 지하 식당 네트워크, iOS Safari PWA 설치.

## 13. 운영 자동화 (GitHub Actions)

| 워크플로 | 저장소 | 주기 | 내용 |
|---|---|---|---|
| deploy | 공개 | push to main | 테스트 → 빌드 → DB 마이그레이션 → Pages 배포 |
| keep-alive | 공개 | 2일마다 | publishable key로 `ping()` 호출 (anon 에게 열린 유일한 RPC) |
| backup | **비공개** | 주 1회 | `pg_dump` → 저장소에 커밋, 12주 보관 |

비밀값(Supabase service role, DB 연결 문자열)은 각 저장소의 Actions Secrets에만 둔다.

## 14. 구현 단계 (제안)

단계마다 별도의 구현 계획을 세우고, 각 단계가 끝날 때마다 배포 가능한 상태를 유지한다.

1. **기반**: 저장소·Vite·Tailwind·Supabase CLI·CI 뼈대, 카카오 로그인, 어른 가입(동의), 처리방침 페이지. (완료, 2026-10-08)
2. **식권 핵심**: meals/people/families/issuances/usages 스키마와 함수, 관리자 식사·발급, 교인 홈(식권 목록, 꾹 누르기), 내역. (완료, 2026-10-08)
3. **가족·아이**: pairing_codes, 익명 로그인, 가족 탭, 자녀 추가·재연결, 가족 공유 잔량, pg_cron 정리. (완료, 2026-10-09)
4. **관리 확장**: **4a** 식사 상세 현황판(1장 대신 사용·발급 취소·사용 무효)과 `use_ticket` 재정의. (완료, 2026-10-10) · **4b** 사람 탭(합치기·연결·초기화·번호 수정·이력, 발급 취소 사유). (완료, 2026-10-11) · **4c** 통계·CSV·공유.
5. **운영**: PWA, keep-alive, 백업, 운영 문서(관리자 지정, 복구 절차, 카카오·Supabase 설정 안내).

## 15. 범위 밖 · 향후 검토

- 사람 목록은 살아 있는 사람 **전체**를 한 번 읽는다(수백 명 전제, `staleTime` 30초, `max_rows` 1000 천장을 화면이 알린다). 수천 명이 되면 서버 검색 + 가족 수 집계 뷰로 바꾼다.
- `link_person` 은 계정 id 를 손으로 붙여 넣는 **복구 경로**다. 교인이 스스로 가입하면 자동 연결(`claim_person`) 또는 합치기로 해결되므로 평소에는 쓰지 않는다. 더 쉬운 길이 필요하면 미가입 폰이 `#/pair` 처럼 코드를 띄우는 방식을 검토한다.
- **합치기와 초기화는 되돌릴 수 없다.** 분리(un-merge)는 범위 밖 — 필요해지면 `merge_log` 표를 먼저 두고 설계한다.
- 익명화된 사람은 목록에서 뺀다(이름이 모두 같아 검색을 방해한다). 감사 목적으로 보고 싶어지면 `useAllPeople` 에 플래그를 더한다.
- 가족 안 1인당 사용 제한.
- 식권 양도(가족 밖).
- 알림(발급 완료 카카오톡 알림 등). 알림톡은 유료라 제외.
- 식단 공지, 식수 예측 외 기능.
- 스테이징 환경(Supabase 무료 프로젝트 2개로 가능하나 당장은 두지 않음).
- ~~로그아웃 시 쿼리 캐시 정리를 `AuthProvider`의 `SIGNED_OUT` 처리로 이동~~ → **3단계에서 구현됨**(콜백 안에서 `setTimeout(…, 0)`으로 한 틱 미뤄 auth lock 재진입을 피한다. `['pairing-code', kind]` 키가 사용자 범위가 아니라, 비우지 않으면 새 익명 계정이 이전 계정의 코드를 캐시에서 읽는다).
- 로그아웃은 `scope: 'local'`(이 기기만) — 공용 폰에서 로그아웃해도 본인 폰의 세션은 남는다.
- 연결 코드 무차별 대입 완화(실패 횟수 제한) 보류: RPC 가 예외로 끝나면 같은 트랜잭션의 "실패 기록" 도 함께 롤백된다. 코드는 8자리·10분이라 교회 앱에서는 감수한다(§10). 필요해지면 `add_family_member` 가 예외 대신 실패 행을 반환하도록 바꾼다.
- 탈퇴한 카카오 계정의 `auth.users` 행 정리 보류(사람 행만 익명화하고 계정은 남긴다 — 다음 로그인 때 가입 화면으로 간다). 5단계에서 `cleanup_orphan_anonymous_users` 를 넓혀 결정한다.
- 같은 가족의 두 어른이 각자 다른 가족으로 합류하면, 나중에 커밋된 쪽이 옛 가족의 장부 풀을 통째로 가져간다(순서 의존 — 손상은 없고 설계상 그렇다).
- 가족 합치기(`add_family_member` adult 경로) 때는 장부 `family_id` 를 통째로 새 가족으로 옮긴다(풀 병합). `leave_family` 는 장부를 옛 가족에 두고 나간다(2단계 계획 인계 항목).
- pg_cron 의 빈 가족 정리는 장부(issuances·usages)가 없는 가족만 지운다(2단계 계획 인계 항목).
- ~~4단계에서 잔량을 바꾸는 함수(`cancel_issuance`·`void_usage`·`use_ticket_as_admin`)는 `lock_family_meal(uuid, uuid)` 로 잠그고 `use_ticket` 도 사람 행 `for update` 로 재정의한다~~ → **4a 에서 완료**(2단계·3단계 계획 인계 항목; 합류 중 사용이 옛 가족 풀에 기록되던 틈이 닫혔다).
- ~~`cancel_issuance` 는 잔량이 음수가 되면 `would_go_negative` 로 반드시 거부해야 한다~~ → **4a 에서 구현**(2단계 계획 인계 항목).
- 대신 사용의 재시도 키는 메모리에만 있다(새로고침 뒤 새 키) — 발급과 같은 60초 중복 확인을 대신 사용에도 둘지는 4b/4c 에서 검토한다.
- 취소된 발급이 있는 식사의 삭제 정책(soft-delete 또는 삭제 버튼 숨김)을 4단계에서 정해야 한다(2단계 계획 인계 항목).
- 가족 이력이 쌓이면 홈·잔량 조회에 90일 등 이력 창을 두는 것을 검토한다(2단계 계획 인계 항목).
- PWA standalone 표시가 생기면 상단 안전 영역(`pt-[env(safe-area-inset-top)]`)을 시작·가입·홈 머리말에 더해야 한다(2단계 계획 인계 항목).
