// 职责：使用隔离会话目录验证增量读取、半行中文和历史过滤。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionWatcher } from '../src/watcher.ts';

test('启动不回放历史，分段中文完成记录只投递一次', async () => {
  /** 仅操作专门创建的模拟 Codex 目录。 */
  const directory = await mkdtemp(join(tmpdir(), 'codex-esp32-watcher-'));
  const sessions = join(directory, 'sessions', '2026', '11', '17');
  const events: string[] = [];
  await mkdir(sessions, { recursive: true });
  const file = join(sessions, 'rollout-test.jsonl');
  const metadata = JSON.stringify({ type: 'session_meta', payload: { id: 'test-session', cwd: '/项目/测试中文', source: 'vscode' } }) + '\n';
  const history = JSON.stringify({ type: 'event_msg', timestamp: '2020-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 'old' } }) + '\n';
  await writeFile(file, metadata + history);
  const watcher = new SessionWatcher(directory, async (event) => { events.push(event.id); });
  try {
    await watcher.initialize();
    await watcher.scan();
    assert.deepEqual(events, []);
    const bytes = Buffer.from(JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_complete', turn_id: '新的回合' } }) + '\n');
    const split = bytes.indexOf(Buffer.from('新')) + 1;
    await appendFile(file, bytes.subarray(0, split));
    await watcher.scan();
    assert.deepEqual(events, []);
    await appendFile(file, bytes.subarray(split));
    await watcher.scan();
    await watcher.scan();
    assert.deepEqual(events, ['test-session:新的回合']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
