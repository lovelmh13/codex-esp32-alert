// 职责：在隔离上下文中仅暴露提醒器所需的 IPC 方法。
import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeApi } from './api.js';
import type { Receipt } from './core.js';
import type { BluetoothAuthorization } from './authorization.js';

/** 不向网页开放文件系统、命令执行或任意 IPC。 */
const api: BridgeApi = {
  getState: () => ipcRenderer.invoke('alert:state'),
  acknowledge: (receipt: Receipt) => ipcRenderer.invoke('alert:receipt', receipt),
  test: () => ipcRenderer.invoke('alert:test'),
  connection: (isConnected: boolean, message: string) => ipcRenderer.invoke('alert:connection', isConnected, message),
  exportHook: () => ipcRenderer.invoke('alert:hook'),
  saveAuthorization: (settings: BluetoothAuthorization) => ipcRenderer.invoke('alert:authorization', settings),
  cancelSelection: () => ipcRenderer.invoke('alert:cancel-selection'),
};
contextBridge.exposeInMainWorld('alertBridge', api);
