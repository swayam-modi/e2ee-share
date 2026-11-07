'use client'

import { Progress } from '@/components/ui/progress'

interface ProgressBarProps {
  value: number
  'aria-label'?: string
}

export function ProgressBar({ value, ...props }: ProgressBarProps) {
  return (
    <Progress value={Math.round(value * 100)} className="h-1.5" {...props} />
  )
}
