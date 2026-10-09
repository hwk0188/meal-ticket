import { useId } from 'react'

type Option<V extends string> = { value: V; label: string }
type Props<V extends string> = {
  /** 스크린리더용 그룹 이름 (예: '가입 유형') */
  label: string
  options: readonly Option<V>[]
  value: V
  onChange: (value: V) => void
}

/**
 * 두세 개 중 하나를 고르는 분할 버튼. 네이티브 라디오를 숨겨 쓰므로 방향키 이동·Space·단일 탭 정지가 공짜고,
 * 테스트는 getByRole('radio', { name }) / toBeChecked() 로 그대로 읽는다.
 * sr-only 인풋은 보이는 포커스 링이 없으므로 peer-focus-visible 로 그려 준다.
 */
export function SegmentedControl<V extends string>({ label, options, value, onChange }: Props<V>) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-gray-100 p-1 text-sm font-bold">
      {options.map((o) => (
        <label key={o.value} className="rounded-lg">
          <input type="radio" name={name} value={o.value} className="peer sr-only" checked={o.value === value} onChange={() => onChange(o.value)} />
          <span className="block cursor-pointer rounded-lg py-2.5 text-center text-gray-600 peer-checked:bg-white peer-checked:text-blue-600 peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-blue-600">
            {o.label}
          </span>
        </label>
      ))}
    </div>
  )
}
