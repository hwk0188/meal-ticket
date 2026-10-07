import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'kakao' | 'ghost' }

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  const base = 'w-full rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed'
  const look = {
    primary: 'bg-blue-600 text-white active:bg-blue-700',
    kakao: 'bg-[#FEE500] text-[#191919]',
    ghost: 'bg-white text-gray-900 border border-gray-300',
  }[variant]
  // type 을 먼저 두어 기본값은 button 이 되고, 제출 버튼은 호출하는 쪽에서 덮어쓴다.
  // (HTML 기본값 submit 이면 폼 안의 모든 버튼이 뜻하지 않게 폼을 제출한다.)
  return <button type="button" className={`${base} ${look} ${className}`} {...rest} />
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }

export function TextField({ label, error, id, 'aria-describedby': describedBy, ...rest }: TextFieldProps) {
  const autoId = useId()
  const inputId = id ?? rest.name ?? autoId
  const errorId = `${inputId}-error`
  return (
    <div className="block">
      <label className="mb-1 block text-xs font-semibold text-gray-500" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-600"
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

type CheckboxProps = InputHTMLAttributes<HTMLInputElement> & { children: ReactNode }

export function Checkbox({ children, ...rest }: CheckboxProps) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-blue-600" {...rest} />
      <span>{children}</span>
    </label>
  )
}

export function Spinner({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh items-center justify-center text-sm text-gray-500">
      {label}
    </div>
  )
}
