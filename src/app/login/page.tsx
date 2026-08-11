import { LoginForm } from './LoginForm'

function safeNext(value: string | string[] | undefined): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export default function LoginPage({ searchParams }: { searchParams?: { next?: string | string[]; error?: string | string[] } }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-day-bg px-5 py-10 text-day-text dark:bg-night-bg dark:text-night-text">
      <div className="pointer-events-none absolute -left-24 top-[-8rem] h-72 w-72 rounded-full bg-day-pink/10 blur-3xl dark:bg-night-amber/10" />
      <div className="pointer-events-none absolute -bottom-32 right-[-5rem] h-80 w-80 rounded-full bg-rose-200/25 blur-3xl dark:bg-night-info/10" />
      <LoginForm next={safeNext(searchParams?.next)} notConfigured={searchParams?.error === 'not_configured'} />
    </main>
  )
}
