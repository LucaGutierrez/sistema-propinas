import { cn } from '@/lib/utils';

/** Marca GUTIP: una "G" que envuelve una moneda. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8', className)}>
      <rect width="32" height="32" rx="9" className="fill-sidebar-primary" />
      <path
        d="M22.5 11.2A8 8 0 1 0 24 16h-7.5"
        fill="none"
        strokeWidth="3.2"
        strokeLinecap="round"
        className="stroke-sidebar"
      />
      <circle cx="16" cy="16" r="2.2" className="fill-sidebar" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-lg font-bold tracking-tight">
        GU<span className="text-sidebar-primary">TIP</span>
      </span>
    </span>
  );
}
