// 职责：验证提醒协议、事件筛选和离线队列的关键边界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompletion, encodeNotice, applyReceipt } from '../src/core.ts';

test('只处理启动后的主聊天完成事件，不回放历史与子代理', () => {
  const entry = { timestamp: '2026-11-17T01:00:01Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } };
  const meta = { id: 'session-1', cwd: 'D:\\工程\\提醒工具', source: 'vscode' };
  assert.equal(createCompletion(entry, meta, Date.parse('2026-11-17T01:00:00Z'))?.title, '提醒工具');
  assert.equal(createCompletion(entry, meta, Date.parse('2026-11-17T01:00:02Z')), undefined);
  assert.equal(createCompletion(entry, { ...meta, source: { subagent: { thread_spawn: {} } } }, 0), undefined);
});

test('消息保留中文且按 UTF-8 字节限制长度', () => {
  const bytes = encodeNotice({ id: 's:t', title: '中文项目'.repeat(100), completedAt: '2026-11-17T01:00:01Z' });
  assert.ok(bytes.byteLength <= 384);
  const message = JSON.parse(new TextDecoder().decode(bytes));
  assert.equal(message.type, 'done');
  assert.ok(message.title.startsWith('中文项目'));
  assert.equal(message.id, 's:t');
});

test('只有设备明确确认对应事件后才从待投递队列移除', () => {
  const first = { id: '1', title: '任务一', completedAt: '' };
  const second = { id: '2', title: '任务二', completedAt: '' };
  assert.deepEqual(applyReceipt([first, second], { lastId: 'unknown', count: 0, state: 'idle' }), [first, second]);
  assert.deepEqual(applyReceipt([first, second], { lastId: '1', count: 1, state: 'alert' }), [second]);
});

test('格式错误或缺少事件标识的日志不触发提醒', () => {
  assert.equal(createCompletion(null, {}, 0), undefined);
  assert.equal(createCompletion({ type: 'event_msg', payload: { type: 'task_complete' } }, { id: 's' }, 0), undefined);
});
