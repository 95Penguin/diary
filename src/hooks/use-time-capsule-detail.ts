import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { showAppDialog } from '@/components/app-dialog-host';
import {
  createTimeCapsuleReply,
  deleteTimeCapsule,
  deleteTimeCapsuleReply,
  getTimeCapsule,
  openTimeCapsule,
  setTimeCapsuleNotification,
  type TimeCapsule,
} from '@/database/time-capsule-repository';
import { cancelTimeCapsuleNotification, scheduleTimeCapsuleNotification } from '@/utils/time-capsule-notifications';

export function useTimeCapsuleDetail(id: string) {
  const db = useSQLiteContext();
  const [capsule, setCapsule] = useState<TimeCapsule | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCapsule(await getTimeCapsule(db, id));
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function openCapsule() {
    const decision = await showAppDialog({
      title: '开启这枚时间胶囊？',
      message: '开启后会永久进入“已开启”，以后仍然可以反复阅读。',
      actions: [{ label: '稍后', value: 'cancel' }, { label: '现在开启', value: 'open', tone: 'primary' }],
    });
    if (decision !== 'open') return;
    try {
      if (!await openTimeCapsule(db, id)) {
        await showAppDialog({ title: '还不能开启', message: '这枚胶囊还没有到约定时间。' });
        return;
      }
      await cancelTimeCapsuleNotification(id);
      await load();
    } catch {
      await showAppDialog({ title: '开启失败', message: '时间胶囊暂时无法开启，请稍后再试。' });
    }
  }

  async function removeCapsule() {
    const decision = await showAppDialog({
      title: '删除这枚时间胶囊？',
      message: '胶囊会移入回收站并保留 30 天。',
      actions: [{ label: '取消', value: 'cancel' }, { label: '移入回收站', value: 'delete', tone: 'danger' }],
    });
    if (decision !== 'delete') return;
    try {
      await deleteTimeCapsule(db, id);
      await cancelTimeCapsuleNotification(id);
      router.back();
    } catch {
      await showAppDialog({ title: '移入失败', message: '时间胶囊暂时无法移入回收站，请稍后再试。' });
    }
  }

  async function toggleReminder() {
    if (!capsule || capsule.status !== 'locked') return;
    try {
      if (capsule.notificationEnabled) {
        await cancelTimeCapsuleNotification(capsule.id);
        await setTimeCapsuleNotification(db, capsule.id, false);
      } else if (await scheduleTimeCapsuleNotification(capsule)) {
        await setTimeCapsuleNotification(db, capsule.id, true);
      } else {
        await showAppDialog({ title: '没有通知权限', message: '请在手机设置中允许拾时发送通知。胶囊本身仍会正常到期。' });
      }
      await load();
    } catch {
      await showAppDialog({ title: '提醒设置失败', message: '提醒状态没有改变，请稍后再试。' });
    }
  }

  async function submitReply(content: string) {
    if (!content.trim()) return false;
    try {
      await createTimeCapsuleReply(db, id, content);
      await load();
      return true;
    } catch {
      await showAppDialog({ title: '回应没有保存', message: '请稍后再试。' });
      return false;
    }
  }

  async function removeReply(replyId: string) {
    const decision = await showAppDialog({
      title: '删除这条回应？',
      message: '删除后无法恢复，时间胶囊本身不会受到影响。',
      actions: [{ label: '取消', value: 'cancel' }, { label: '删除', value: 'delete', tone: 'danger' }],
    });
    if (decision !== 'delete') return;
    try {
      if (await deleteTimeCapsuleReply(db, id, replyId)) await load();
      else await showAppDialog({ title: '回应已经不存在', message: '页面将重新读取最新内容。' });
    } catch {
      await showAppDialog({ title: '删除失败', message: '回应没有被删除，请稍后再试。' });
    }
  }

  return { capsule, loading, loadError, reload: load, openCapsule, removeCapsule, toggleReminder, submitReply, removeReply };
}
