// 职责：定义电脑蓝牙授权配置、设备名称和撤销授权的执行顺序。
import type { RecoverableGatt } from './connection.ts';

/** 每台电脑独立保存的蓝牙连接配置。 */
export interface BluetoothAuthorization {
  /** 屏幕显示的六位连接码；空字符串兼容首次连接。 */
  connectionCode: string;
  /** 是否允许启动时连接和断线后自动重连。 */
  canAutoConnect: boolean;
}
/** 能够释放连接并可选撤销设备授权的浏览器对象。 */
export interface RevocableDevice {
  /** 已建立的 GATT 连接。 */
  gatt: RecoverableGatt;
  /** 平台支持时撤销 Web Bluetooth 的设备访问授权。 */
  forget?: () => Promise<void>;
}
/** 从连接码得到唯一广播名称，拒绝无效输入。 */
export const getDeviceName = (connectionCode: string): string => {
  if (typeof connectionCode !== 'string' || (connectionCode !== '' && !/^[1-9][0-9]{5}$/.test(connectionCode))) { throw new Error('连接码必须为屏幕显示的六位数字，首次连接可留空'); }
  return connectionCode ? `Codex-ESP32-${connectionCode}` : 'Codex-ESP32';
};
/** 先持久暂停重连，再断开、撤销授权；返回平台是否成功执行撤销。 */
export const revokeDevice = async (device: RevocableDevice | undefined, savePause: () => Promise<void>): Promise<boolean> => {
  await savePause();
  if (!device) { return false; }
  if (device.gatt.connected) { device.gatt.disconnect(); }
  if (!device.forget) { return false; }
  try { await device.forget(); return true; } catch { return false; }
};
