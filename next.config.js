/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { instrumentationHook: true },
  output: 'standalone',
  // Include seed data files in standalone build output
  outputFileTracingIncludes: {
    '/api/**': ['./src/seed/**'],
  },
}
module.exports = nextConfig
