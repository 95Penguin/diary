import { useEffect, useState } from 'react';

import { AppDialog } from '@/components/app-dialog';

export type AppDialogRequest = {
  title: string;
  message?: string;
  actions?: { label: string; value: string; tone?: 'primary' | 'danger' | 'neutral' }[];
};

type PendingDialog = AppDialogRequest & { resolve: (value: string | null) => void };

const queue: PendingDialog[] = [];
let listener: ((dialog: PendingDialog | null) => void) | null = null;
let active: PendingDialog | null = null;

function publishNext() {
  if (active || !listener) return;
  active = queue.shift() ?? null;
  listener(active);
}

export function showAppDialog(request: AppDialogRequest) {
  return new Promise<string | null>((resolve) => {
    queue.push({ ...request, resolve });
    publishNext();
  });
}

function completeDialog(value: string | null) {
  const current = active;
  active = null;
  listener?.(null);
  current?.resolve(value);
  requestAnimationFrame(publishNext);
}

export function AppDialogHost() {
  const [dialog, setDialog] = useState<PendingDialog | null>(null);

  useEffect(() => {
    listener = setDialog;
    publishNext();
    return () => { listener = null; };
  }, []);

  function finish(value: string | null) {
    completeDialog(value);
  }

  const actions = dialog?.actions ?? [{ label: '知道了', value: 'ok', tone: 'primary' as const }];
  return <AppDialog
    visible={Boolean(dialog)}
    title={dialog?.title ?? ''}
    message={dialog?.message}
    onClose={() => finish(null)}
    actions={actions.map((action) => ({
      label: action.label,
      tone: action.tone,
      onPress: () => finish(action.value),
    }))}
  />;
}
