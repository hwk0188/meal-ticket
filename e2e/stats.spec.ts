import { expect, test } from '@playwright/test'
import { formatMealDate, todaySeoul } from '../src/lib/dates.ts'
import { adminCreateTodayMeal, adminIssue, adminLogin, uniqueDigits } from './helpers.ts'

test('관리자 통계: 월 합계 → 이름 검색 → CSV 내용', async ({ page }) => {
  const tag = uniqueDigits()
  const mealTitle = `E2E 통계 ${tag}`
  // adminCreateTodayMeal 은 값을 돌려주지 않는다 — people.spec.ts 와 같은 방식으로 직접 만든다.
  const mealLabel = `${formatMealDate(todaySeoul())} · ${mealTitle}`
  const name = `통계김${tag}`
  const phone = `010${tag.slice(0, 4)}${tag.slice(0, 4)}`

  await adminLogin(page)
  await adminCreateTodayMeal(page, mealTitle)
  // adminIssue 는 quantity·unitPrice 를 숫자로 받는다.
  await adminIssue(page, { mealLabel, name, phone, quantity: 3, unitPrice: 5000 })

  await page.getByRole('link', { name: '통계' }).click()
  // 이번 달이 기본이라 방금 만든 오늘 식사가 들어 있다
  await expect(page.getByRole('status', { name: '이 달 합계' })).toContainText('발급')
  await expect(page.getByRole('list', { name: '식사별 합계' }).getByText(mealTitle)).toBeVisible()

  // 합계는 다른 spec 의 기록과 섞이므로, 유일한 이름으로 좁혀서 단언한다
  await page.getByLabel('이름으로 찾기').fill(name)
  await expect(page.getByRole('status', { name: '찾은 합계' })).toContainText('발급 3장')
  await expect(page.getByRole('status', { name: '찾은 합계' })).toContainText('15,000원')
  const rows = page.getByRole('list', { name: '찾은 장부' }).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('발급 3장')
  await expect(rows.first()).toContainText(mealTitle)

  // CSV 는 이름 검색과 무관하게 그 달 전체 — 방금 만든 줄이 들어 있어야 한다
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '이 달 CSV 저장' }).click(),
  ])
  const path = await download.path()
  expect(download.suggestedFilename()).toMatch(/^식권-\d{4}-\d{2}\.csv$/)
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(path, 'utf8')
  // 한국어 엑셀이 cp949 로 읽지 않도록 BOM 으로 시작한다
  expect(text.startsWith('﻿')).toBe(true)
  expect(text).toContain('종류,일시,식사일,식사명,이름,가족 대표,장수,단가,금액,처리자,메모')
  expect(text).toContain(`발급,`)
  expect(text).toContain(name)
  expect(text).toContain(mealTitle)
  // 금액은 숫자만 — 엑셀에서 더할 수 있어야 한다
  expect(text).toContain(',3,5000,15000,')
})
