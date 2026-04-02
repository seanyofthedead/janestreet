'use client';

import { useId, type ReactNode } from 'react';

interface TooltipProps {
  hint: string;
  children: ReactNode;
}

export function Tooltip({ hint, children }: TooltipProps) {
  const id = useId();
  return (
    <span className="group relative inline-flex items-center cursor-help">
      <span aria-describedby={id}>{children}</span>
      <span
        id={id}
        role="tooltip"
        className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 text-xs text-gray-200 bg-gray-800 border border-gray-700 rounded shadow-lg whitespace-nowrap z-50 max-w-xs"
      >
        {hint}
      </span>
    </span>
  );
}
