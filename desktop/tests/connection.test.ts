// 职责：验证服务发现失败后释放 GATT，不让半初始化连接阻塞后续通知。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeConnection } from '../src/connection.ts';

test('服务发现失败后断开底层连接，下一次初始化仍可成功', async () => {
  /** 模拟已经连接但服务发现失败的外设，不需要真实蓝牙硬件。 */
  const gatt = { connected: true, disconnect: () => { gatt.connected = false; } };
  await assert.rejects(initializeConnection(gatt, async () => { throw new Error('服务发现失败'); }), /服务发现失败/);
  assert.equal(gatt.connected, false);
  await initializeConnection(gatt, async () => { gatt.connected = true; });
  assert.equal(gatt.connected, true);
});
