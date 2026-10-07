import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'kakao' | 'ghost' }

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  const base = 'w-full rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed'
  const look = {
    primary: 'bg-blue-600 text-white active:bg-blue-700',
    kakao: 'bg-[#FEE500] text-[#191919]',
    ghost: 'bg-white text-gray-900 border border-gray-300',
  }[variant]
  return <button className={`${base} ${look} ${className}`} {...rest} />
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }

export function TextField({ label, error, id, ...rest }: TextFieldProps) {
  const inputId = id ?? rest.name
  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
      <input
        id={inputId}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-600"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...rest}
      />
      {error && (
        <span id={`${inputId}-error`} role="alert" className="mt-1 block text-xs text-red-600">
          {error}
        </span>
      )}
    </label>
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

export function Spinner({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh items-center justify-center text-sm text-gray-500">
      {label}…
    </div>
  )
}
