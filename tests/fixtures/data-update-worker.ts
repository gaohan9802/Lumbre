import { updateJsonFile } from '../../src/server/data/json-file'

const filePath = process.argv[2]
const iterations = Number(process.argv[3] || 1)

for (let i = 0; i < iterations; i += 1) {
  updateJsonFile(
    filePath,
    { fallback: () => ({ value: 0 }), validate: value => typeof (value as any)?.value === 'number' },
    current => ({ value: current.value + 1 }),
  )
}
