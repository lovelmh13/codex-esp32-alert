// 职责：定义主进程与界面之间允许传递的最小接口。
import type { Completion, Receipt } from './core.ts';
import type { BluetoothAuthorization } from './authorization.ts';

/** 界面可读取的监听状态。 */
export interface BridgeState {
  /** 尚未投递的提醒数量。 */
  pendingCount: number;
  /** 下一条待投递消息。 */
  next?: Completion;
  /** 监听的本机 Codex 目录。 */
  home: string;
  /** 最近诊断信息。 */
  message: string;
  /** 最近一次设备状态。 */
  receipt?: Receipt;
  /** 本机的连接码及是否允许自动重连。 */
  authorization: BluetoothAuthorization;
}
/** 仅向本地界面开放的操作。 */
export interface BridgeApi {
  /** 读取待投递队列与运行状态。 */
  getState: () => Promise<BridgeState>;
  /** 提交设备回执并移除对应消息。 */
  acknowledge: (receipt: Receipt) => Promise<void>;
  /** 添加一条明确标记的手动测试提醒。 */
  test: () => Promise<void>;
  /** 保存蓝牙连接状态，用于运行记录。 */
  connection: (isConnected: boolean, message: string) => Promise<void>;
  /** 生成可审阅的正式 Hook 配置。 */
  exportHook: () => Promise<string>;
  /** 原子保存本机授权选择，不修改系统蓝牙权限数据库。 */
  saveAuthorization: (settings: BluetoothAuthorization) => Promise<void>;
  /** 取消尚未完成的蓝牙设备选择。 */
  cancelSelection: () => Promise<void>;
}
