// 职责：以隔离收件箱验证正式 Hook 对长回答和中文项目名的处理。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('合法 Stop 事件即使附带超过 64KiB 的回答也能投递', async () => {
  /** 子进程只写入独立临时收件箱。 */
  const inbox = await mkdtemp(join(tmpdir(), 'codex-esp32-hook-'));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/hook.ts', import.meta.url)), '--inbox', inbox], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'hook-session', turn_id: 'hook-turn', cwd: '/项目/中文工程', last_assistant_message: '这是一段较长的回答。'.repeat(20000) }), encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), {});
    const files = await readdir(inbox);
    assert.equal(files.length, 1, result.stderr);
    const event = JSON.parse(await readFile(join(inbox, files[0]), 'utf8'));
    assert.equal(event.title, '中文工程');
    assert.equal(event.id, 'hook-session:hook-turn');
    assert.equal('last_assistant_message' in event, false);
  } finally { await rm(inbox, { recursive: true, force: true }); }
});
