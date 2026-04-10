export interface JobTypeTagsProps {
  opts: Record<string, unknown>;
  parentId: string | null;
  pendingChildrenCount: number;
  groupId: string | null;
}

export function JobTypeTags({
  opts,
  parentId,
  pendingChildrenCount,
  groupId,
}: JobTypeTagsProps) {
  const repeat = opts.repeat as Record<string, unknown> | undefined;
  const isCron = repeat?.cron !== undefined;
  const isEvery = !isCron && repeat?.every !== undefined;
  const isChild = parentId !== null;
  const isParent = pendingChildrenCount > 0;
  const hasGroup = groupId !== null;

  if (!isCron && !isEvery && !isChild && !isParent && !hasGroup) return null;

  return (
    <span class="flex items-center gap-1">
      {isCron && (
        <span
          class="inline-flex items-center gap-1 rounded-md bg-violet-glow px-1.5 py-0.5 font-mono text-[10px] font-medium text-violet dark:bg-violet-glow dark:text-violet"
          title={`cron: ${repeat!.cron}`}
        >
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          cron
        </span>
      )}
      {isEvery && (
        <span
          class="inline-flex items-center gap-1 rounded-md bg-sky-glow px-1.5 py-0.5 font-mono text-[10px] font-medium text-sky dark:bg-sky-glow dark:text-sky"
          title={`every ${repeat!.every}ms`}
        >
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          repeat
        </span>
      )}
      {isParent && (
        <span
          class="inline-flex items-center gap-1 rounded-md bg-accent-glow px-1.5 py-0.5 font-mono text-[10px] font-medium text-accent dark:bg-accent-glow dark:text-accent"
          title="Parent job (flow)"
        >
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" />
          </svg>
          flow
        </span>
      )}
      {isChild && (
        <span
          class="inline-flex items-center gap-1 rounded-md bg-teal-glow px-1.5 py-0.5 font-mono text-[10px] font-medium text-teal dark:bg-teal-glow dark:text-teal"
          title="Child job (flow)"
        >
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          child
        </span>
      )}
      {hasGroup && (
        <span
          class="inline-flex items-center gap-1 rounded-md bg-amber-glow px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber dark:bg-amber-glow dark:text-amber"
          title={`group: ${groupId}`}
        >
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {groupId}
        </span>
      )}
    </span>
  );
}
