// 职责：验证离线提醒持久保存、重启恢复、去重及回执出队。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableQueue } from '../src/queue.ts';

test('离线通知重启后仍存在，错误回执不能删除通知，已投递事件不重复入队', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-esp32-queue-'));
  const file = join(directory, 'queue.json');
  const event = { id: 'session:turn', title: '中文任务', completedAt: new Date().toISOString() };
  try {
    const queue = new DurableQueue(file);
    await queue.load();
    await Promise.all([queue.enqueue(event), queue.enqueue(event)]);
    assert.equal(queue.pending.length, 1);
    const restored = new DurableQueue(file);
    await restored.load();
    assert.deepEqual(restored.pending, [event]);
    await restored.acknowledge({ lastId: 'wrong', count: 1, state: 'alert' });
    assert.equal(restored.pending.length, 1);
    await restored.acknowledge({ lastId: event.id, count: 1, state: 'alert' });
    assert.equal(restored.pending.length, 0);
    await restored.enqueue(event);
    assert.equal(restored.pending.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
