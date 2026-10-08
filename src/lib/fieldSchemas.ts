import { z } from 'zod'
import { isValidMobile, normalizePhone } from './phone'

// 가입 화면·가족 화면이 함께 쓰는 이름 규칙.
// 한글은 조합형(NFD)으로도 들어온다 (iOS 자판·붙여넣기). 그때는 '김' 한 자가 3자로 세어져
// 20자 제한에 억울하게 걸린다. 완성형(NFC)으로 맞춘 뒤 길이를 센다. DB 에 가는 값도 NFC 가 된다.
export const nameSchema = z
  .string()
  .transform((s) => s.normalize('NFC'))
  .pipe(z.string().trim().min(1, '이름을 입력해 주세요').max(20, '이름은 20자 이내로 입력해 주세요'))

// 하이픈·공백·국제 표기를 먼저 숫자열로 정리한 뒤 형식을 본다 (DB 의 normalize_phone 과 같은 규칙).
export const phoneSchema = z.string().transform(normalizePhone).refine(isValidMobile, '휴대폰 번호를 확인해 주세요')
