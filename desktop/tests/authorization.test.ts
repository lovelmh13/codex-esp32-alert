// 职责：验证撤销授权、暂停重连持久化和连接码校验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDeviceName, revokeDevice } from '../src/authorization.ts';
import { AuthorizationStore } from '../src/authorization-store.ts';

test('仅接受空码或屏幕六位连接码，旧设备名称保持兼容', () => {
  assert.equal(getDeviceName(''), 'Codex-ESP32');
  assert.equal(getDeviceName('123456'), 'Codex-ESP32-123456');
  for (const invalid of ['12345','1234567','abcdef','000000','123 56']) {
    assert.throws(() => getDeviceName(invalid), /连接码/);
  }
});

test('释放设备必须先保存暂停状态，再断开并撤销授权', async () => {
  /** 顺序记录用于确认不会在持久暂停之前断开而触发抢连。 */
  const steps: string[] = [];
  const device = { gatt: { connected: true, disconnect: () => { steps.push('disconnect'); } }, forget: async () => { steps.push('forget'); } };
  assert.equal(await revokeDevice(device, async () => { steps.push('persist'); }), true);
  assert.deepEqual(steps, ['persist','disconnect','forget']);
});

test('保存暂停状态失败时保留当前连接，不能假装已释放', async () => {
  let hasDisconnected = false;
  await assert.rejects(revokeDevice({ gatt: { connected: true, disconnect: () => { hasDisconnected = true; } } }, async () => { throw new Error('磁盘写入失败'); }), /磁盘写入失败/);
  assert.equal(hasDisconnected, false);
});

test('平台不支持forget时仍断开并暂停，不能声称已撤销系统授权', async () => {
  let hasDisconnected = false;
  assert.equal(await revokeDevice({ gatt: { connected: true, disconnect: () => { hasDisconnected = true; } } }, async () => {}), false);
  assert.equal(hasDisconnected, true);
});

test('释放后的电脑重启仍禁止自动抢连，显式重新授权后才启用', async () => {
  const directory = await mkdtemp(join(tmpdir(),'codex-authorization-'));
  try {
    const file = join(directory,'authorization.json');
    const store = new AuthorizationStore(file);
    assert.deepEqual(await store.load(), { connectionCode:'',canAutoConnect:true });
    await store.save({connectionCode:'123456',canAutoConnect:false});
    assert.deepEqual(await new AuthorizationStore(file).load(), {connectionCode:'123456',canAutoConnect:false});
    await store.save({connectionCode:'654321',canAutoConnect:true});
    assert.deepEqual(await new AuthorizationStore(file).load(), {connectionCode:'654321',canAutoConnect:true});
  } finally { await rm(directory,{recursive:true,force:true}); }
});
