import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../../src/components/habits/HabitTrackerView.tsx', import.meta.url), 'utf8')

test('habit tracker keeps the weekly grid primary and the year view tucked away', () => {
  assert.match(source, /Array\.from\(\{ length: 7 \}/)
  assert.match(source, /周\{weekday\[index\]\}/)
  assert.match(source, /aria-label=\{`\$\{habit\.name\} \$\{day\}/)
  assert.match(source, />全年<\/button>/)
  assert.match(source, /Array\.from\(\{ length: 12 \}/)
  assert.match(source, /completed\.has\(day\)/)
  assert.match(source, /todo-receipt-night/)
})
