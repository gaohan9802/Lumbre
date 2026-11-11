'use client'

interface ChatAvatarProps {
  src?: string
  fallback: string
  label: string
  onClick: () => void
  className?: string
  disabled?: boolean
}

export function ChatAvatar({ src, fallback, label, onClick, className = '', disabled }: ChatAvatarProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={event => { event.stopPropagation(); onClick() }}
      className={`chat-avatar grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full text-base disabled:opacity-40 ${className}`}
    >
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={src} alt="" aria-hidden="true" className="h-full w-full object-contain" />
      ) : <span aria-hidden="true">{fallback}</span>}
    </button>
  )
}
