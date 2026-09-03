import { updateMemoryBucket } from '../../src/server/data/repositories/memory'

const [id, iterationsText] = process.argv.slice(2)
const iterations = Number(iterationsText)

for (let i = 0; i < iterations; i += 1) {
  updateMemoryBucket<{ activation_count: number }>(
    id,
    value => {
      if (!value || typeof value !== 'object') return null
      const activationCount = (value as { activation_count?: unknown }).activation_count
      return typeof activationCount === 'number' ? { activation_count: activationCount } : null
    },
    current => ({ activation_count: current.activation_count + 1 }),
  )
}
