'use client'

import { cn } from '@/lib/utils'

export type WorkflowStep = {
  key: string
  label: string
  count: number
  highlight?: boolean
}

interface WorkflowProgressProps {
  steps: WorkflowStep[]
  onReviewClick?: () => void
  className?: string
}

const categoryLabels: Record<string, string> = {
  imported: '取込',
  classified: '分類済',
  posted: '送信済',
  review: '要確認',
}

export function WorkflowProgress({ steps, onReviewClick, className }: WorkflowProgressProps) {
  if (steps.length === 0) return null

  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white p-3', className)}>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {steps.map((step, i) => (
          <span key={step.key} className="flex items-center gap-1">
            {step.highlight && step.count > 0 ? (
              <button
                type="button"
                onClick={onReviewClick}
                className="tabular-nums font-medium text-buddy-green hover:underline"
              >
                {categoryLabels[step.key] ?? step.label} {step.count}件
              </button>
            ) : (
              <span className="tabular-nums text-slate-700">
                {categoryLabels[step.key] ?? step.label} {step.count}件
              </span>
            )}
            {i < steps.length - 1 && <span className="text-slate-300">·</span>}
          </span>
        ))}
      </div>
    </div>
  )
}
