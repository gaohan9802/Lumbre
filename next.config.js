/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { instrumentationHook: true },
  output: 'standalone',
}
module.exports = nextConfig
