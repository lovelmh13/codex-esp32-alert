// 职责：持久保存本机连接码和自动重连开关，重启后保持释放状态。
import type { BluetoothAuthorization } from './authorization.ts';
import { getDeviceName } from './authorization.ts';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 当前电脑的授权配置文件。 */
export class AuthorizationStore {
  /** 配置文件位置。 */
  private file: string;
  /** 序列化保存，防止旧配置覆盖后到的授权选择。 */
  private operation: Promise<void> = Promise.resolve();
  /** 初始化保存位置。 */
  constructor(file: string) { this.file = file; }
  /** 读取配置，首次运行兼容原连接行为。 */
  load = async (): Promise<BluetoothAuthorization> => {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as BluetoothAuthorization;
      getDeviceName(value.connectionCode);
      if (typeof value.canAutoConnect !== 'boolean') { throw new Error('蓝牙授权配置格式错误'); }
      return { connectionCode: value.connectionCode, canAutoConnect: value.canAutoConnect };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return { connectionCode:'',canAutoConnect:true }; }
      throw error;
    }
  };
  /** 原子保存授权配置。 */
  save = async (settings: BluetoothAuthorization): Promise<void> => {
    getDeviceName(settings.connectionCode);
    if (typeof settings.canAutoConnect !== 'boolean') { throw new Error('蓝牙自动连接配置格式错误'); }
    const snapshot = { connectionCode:settings.connectionCode,canAutoConnect:settings.canAutoConnect };
    const result = this.operation.then(async () => {
      await mkdir(dirname(this.file),{recursive:true});
      await writeFile(`${this.file}.tmp`,JSON.stringify(snapshot),'utf8');
      await rename(`${this.file}.tmp`,this.file);
    });
    this.operation = result.catch(() => {});
    return result;
  };
}
