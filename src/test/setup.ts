import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// RTL은 afterEach 가 전역일 때 자동 cleanup 하지만, globals 를 끄더라도 동작하도록 명시해 둔다.
afterEach(() => {
  cleanup()
})
