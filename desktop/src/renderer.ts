// 职责：连接指定 BLE 提醒器，顺序投递队列并展示中文运行状态。
import { encodeNotice } from './core.js';
import { initializeConnection } from './connection.js';
import { getDeviceName, revokeDevice } from './authorization.js';
import type { BluetoothAuthorization } from './authorization.js';
import type { Receipt } from './core.js';
import type { BridgeApi } from './api.js';

/** 浏览器蓝牙接口的本项目最小使用范围。 */
interface AlertCharacteristic extends EventTarget {
  /** 最近一次通知值。 */
  value?: DataView;
  /** 读取完整特征值。 */
  readValue: () => Promise<DataView>;
  /** 带响应写入，允许底层协商长写入。 */
  writeValueWithResponse: (value: Uint8Array) => Promise<void>;
  /** 订阅状态更新。 */
  startNotifications: () => Promise<AlertCharacteristic>;
}
/** 目标 BLE 设备。 */
interface AlertDevice extends EventTarget {
  /** 平台支持时删除该设备的浏览器访问授权。 */
  forget?: () => Promise<void>;
  /** GATT 连接对象。 */
  gatt: {
    /** 当前连接标志。 */
    connected: boolean;
    /** 连接目标外设。 */
    connect: () => Promise<{ getPrimaryService: (uuid: string) => Promise<{ getCharacteristic: (uuid: string) => Promise<AlertCharacteristic> }> }>;
    /** 主动断开。 */
    disconnect: () => void;
  };
}
declare global {
  interface Window {
    /** 受限的主进程 API。 */
    alertBridge: BridgeApi;
    /** 提供给主进程的自动连接入口。 */
    codexAlertConnect: () => Promise<void>;
  }
}
/** 固定服务和消息/状态特征 UUID。 */
const serviceId = '9c3b0001-5b6e-4f64-9d8a-1a24e5b6c701';
const commandId = '9c3b0002-5b6e-4f64-9d8a-1a24e5b6c701';
const statusId = '9c3b0003-5b6e-4f64-9d8a-1a24e5b6c701';
/** 当前连接和异步操作保护。 */
let device: AlertDevice | undefined;
let command: AlertCharacteristic | undefined;
let status: AlertCharacteristic | undefined;
let isConnecting = false;
let isTicking = false;
/** 清除请求与投递共用同一轮询，避免并发 GATT 操作。 */
let hasClearRequest = false;
let nextReconnectAt = 0;
/** 授权操作、扫描、轮询和连接代次，防止旧异步回调覆盖新设备。 */
let authorization: BluetoothAuthorization = { connectionCode:'',canAutoConnect:true };
let isAuthorizing = false;
let connectionVersion = 0;
let connectAttempt: Promise<void> | undefined;
let tickAttempt: Promise<void> | undefined;
/** 页面元素按实际 ID 获取。 */
const element = (id: string): HTMLElement => document.getElementById(id)!;
/** 显示诊断文字，始终使用纯文本。 */
const showMessage = (message: string): void => { element('message').textContent = message; };
/** 授权配置先落盘，再更新本窗口状态。 */
const saveAuthorization = async (settings: BluetoothAuthorization): Promise<void> => {
  await window.alertBridge.saveAuthorization(settings);
  authorization = { ...settings };
};
/** 初始自动连接必须等待本机的暂停配置读取完成。 */
const authorizationReady = window.alertBridge.getState().then((state) => {
  authorization = state.authorization;
  (element('connection-code') as HTMLInputElement).value = authorization.connectionCode;
  if (!authorization.canAutoConnect) { showMessage('自动连接已暂停；输入设备连接码后点击“重新授权设备”。'); }
});
/** 清理当前设备引用，先保存暂停状态，避免断开事件触发自动抢连。 */
const suspendDevice = async (): Promise<boolean> => {
  const previous = device;
  const hasForgotten = await revokeDevice(previous, async () => {
    await saveAuthorization({ ...authorization,canAutoConnect:false });
    connectionVersion++;
    device = undefined;
    command = undefined;
    status = undefined;
    hasClearRequest = false;
  });
  element('connection').textContent = '自动连接已暂停';
  element('connection').classList.remove('connected');
  await window.alertBridge.connection(false, '已释放设备并暂停自动连接，未投递队列保留');
  return hasForgotten;
};
/** 校验并提交设备回执。 */
const receive = async (value: DataView, source: AlertDevice, version: number): Promise<void> => {
  if (source !== device || version !== connectionVersion) { return; }
  const receipt = JSON.parse(new TextDecoder().decode(value)) as Receipt;
  if (!Number.isInteger(receipt.count) || typeof receipt.lastId !== 'string' || !['idle', 'alert'].includes(receipt.state)) { throw new Error('设备状态格式不匹配'); }
  element('device-count').textContent = String(receipt.count);
  element('device-caption').textContent = receipt.count > 0 ? '条提醒等待触摸确认' : '设备正在等待任务';
  await window.alertBridge.acknowledge(receipt);
  if (source !== device || version !== connectionVersion) { return; }
  if (receipt.connectionCode !== undefined && receipt.connectionCode !== authorization.connectionCode && !isAuthorizing) {
    await suspendDevice();
    showMessage('设备已重新授权。请到新电脑输入屏幕的新连接码；此电脑已停止自动重连。');
  }
};
/** 同一设备断线后重连，无需重新选择其他外设。 */
const openGatt = async (): Promise<void> => {
  if (!device) { return; }
  const selected = device;
  const version = connectionVersion;
  /** 每次等待后检查代次，取消的连接不能恢复成已连接。 */
  const ensureCurrent = (): void => {
    if (selected !== device || version !== connectionVersion || !authorization.canAutoConnect) { throw new Error('连接已取消'); }
  };
  try { await initializeConnection(selected.gatt, async () => {
  const server = await selected.gatt.connect();
  ensureCurrent();
  const service = await server.getPrimaryService(serviceId);
  ensureCurrent();
  const nextCommand = await service.getCharacteristic(commandId);
  const nextStatus = await service.getCharacteristic(statusId);
  ensureCurrent();
  await nextStatus.startNotifications();
  ensureCurrent();
  nextStatus.addEventListener('characteristicvaluechanged', (event) => {
    if (device !== selected || version !== connectionVersion) { return; }
    const value = (event.target as AlertCharacteristic).value;
    if (value) { void receive(value, selected, version).catch((error) => { showMessage(String(error)); }); }
  });
  await receive(await nextStatus.readValue(), selected, version);
  ensureCurrent();
  command = nextCommand;
  status = nextStatus;
  element('connection').textContent = '蓝牙已连接';
  element('connection').classList.add('connected');
  showMessage('可以开始工作了，本轮结束后屏幕会持续提醒。');
  await window.alertBridge.connection(true, '设备已连接，监听正在运行');
  }); } catch (error) {
    if (version === connectionVersion) { command = undefined; status = undefined; }
    throw error;
  }
};
/** 仅请求包含固定服务的 Codex-ESP32 外设。 */
const performConnect = async (isManual: boolean): Promise<void> => {
  await authorizationReady;
  if (isConnecting || device?.gatt.connected) { return; }
  if (!isManual && !authorization.canAutoConnect) { return; }
  if (isManual) {
    const code = (element('connection-code') as HTMLInputElement).value.trim();
    getDeviceName(code);
    await saveAuthorization({connectionCode:code,canAutoConnect:true});
  }
  const version = connectionVersion;
  isConnecting = true;
  showMessage(`正在查找 ${getDeviceName(authorization.connectionCode)}，请确认设备已通电、电脑蓝牙已开启。`);
  try {
    const bluetooth = (navigator as Navigator & { bluetooth?: { requestDevice: (options: unknown) => Promise<AlertDevice> } }).bluetooth;
    if (!bluetooth) { throw new Error('当前系统没有可用的 Web Bluetooth 接口'); }
    const selected = await bluetooth.requestDevice({ filters: [{ services: [serviceId], name: getDeviceName(authorization.connectionCode) }] });
    if (version !== connectionVersion || !authorization.canAutoConnect) { await revokeDevice(selected, async () => {}); return; }
    device = selected;
    selected.addEventListener('gattserverdisconnected', () => {
      if (device !== selected || version !== connectionVersion) { return; }
      command = undefined; status = undefined;
      element('connection').textContent = '连接已断开';
      element('connection').classList.remove('connected');
      showMessage(authorization.canAutoConnect ? '等待自动重连；如果设备已换码，请输入新连接码重新授权。' : '已暂停自动连接，未投递的提醒已保存在电脑。');
      void window.alertBridge.connection(false, '连接断开，队列已保留');
    });
    await openGatt();
  } catch (error) {
    if (version === connectionVersion && authorization.canAutoConnect) {
      showMessage(`连接未完成：${String(error)}`);
      await window.alertBridge.connection(false, String(error));
    }
  } finally { isConnecting = false; nextReconnectAt = Date.now() + 5000; }
};
/** 同一时刻仅允许一个设备选择请求。 */
const connect = (isManual = false): Promise<void> => {
  if (connectAttempt) { return connectAttempt; }
  const attempt = performConnect(isManual);
  connectAttempt = attempt;
  return attempt.finally(() => { if (connectAttempt === attempt) { connectAttempt = undefined; } });
};
/** 定时拉取持久队列，每次只发送队首事件，等待明确回执出队。 */
const performTick = async (): Promise<void> => {
  await authorizationReady;
  if (isTicking || isConnecting || isAuthorizing) { return; }
  isTicking = true;
  try {
    const state = await window.alertBridge.getState();
    element('queue-count').textContent = String(state.pendingCount);
    element('watch-home').textContent = state.home;
    if (!authorization.canAutoConnect) { return; }
    if (!device?.gatt.connected) {
      if (device && Date.now() >= nextReconnectAt) {
        nextReconnectAt = Date.now() + 5000;
        try { await openGatt(); } catch (error) { showMessage(`等待重新连接：${String(error)}`); }
      }
      return;
    }
    if (command && status) {
      const selected = device;
      const version = connectionVersion;
      const currentCommand = command;
      const currentStatus = status;
      if (hasClearRequest) {
        await currentCommand.writeValueWithResponse(new TextEncoder().encode('{"v":1,"type":"clear"}'));
        hasClearRequest = false;
      } else if (state.next) { await currentCommand.writeValueWithResponse(encodeNotice(state.next)); }
      await receive(await currentStatus.readValue(), selected, version);
    }
  } catch (error) { showMessage(`投递暂未完成，稍后重试：${String(error)}`); }
  finally { isTicking = false; }
};
/** 暴露当前轮询Promise，重新授权时等旧GATT操作结束再发起新连接。 */
const tick = (): Promise<void> => {
  if (tickAttempt) { return tickAttempt; }
  const attempt = performTick();
  tickAttempt = attempt;
  return attempt.finally(() => { if (tickAttempt === attempt) { tickAttempt = undefined; } });
};
/** 重新请求设备访问授权，保留提醒队列。 */
const reauthorize = async (): Promise<void> => {
  if (isAuthorizing) { return; }
  isAuthorizing = true;
  try {
    await authorizationReady;
    getDeviceName((element('connection-code') as HTMLInputElement).value.trim());
    await suspendDevice();
    await window.alertBridge.cancelSelection();
    await connectAttempt;
    await tickAttempt;
  } catch (error) { showMessage(`重新授权未完成：${String(error)}`); return; }
  finally { isAuthorizing = false; }
  await connect(true);
};
/** 持久暂停旧电脑，通知设备换码，再释放该电脑的访问授权。 */
const releaseComputer = async (): Promise<void> => {
  if (isAuthorizing) { return; }
  isAuthorizing = true;
  /** 暂停持久化成功后，即使设备拒绝换码也必须释放连接。 */
  let hasPaused = false;
  let failure: unknown;
  try {
    await authorizationReady;
    await saveAuthorization({...authorization,canAutoConnect:false});
    hasPaused = true;
    await window.alertBridge.cancelSelection();
    await connectAttempt;
    await tickAttempt;
    if (command && device?.gatt.connected) {
      await command.writeValueWithResponse(new TextEncoder().encode('{"v":1,"type":"reauthorize"}'));
    }
  } catch (error) {
    failure = error;
  } finally {
    if (hasPaused) {
      try { await suspendDevice(); } catch (error) { failure = error; }
    }
    isAuthorizing = false;
  }
  if (failure) { showMessage(`切换请求未确认：${String(failure)}。可在设备长按“重新授权”后连接新电脑。`); }
  else { showMessage('此电脑已停止自动连接。请在新电脑输入设备屏幕上的连接码；需要换码可在设备长按“重新授权”。'); }
};
window.codexAlertConnect = () => connect(false);
element('connect').addEventListener('click', () => { void connect(true).catch((error) => { showMessage(String(error)); }); });
element('reauthorize').addEventListener('click', () => { void reauthorize().catch((error) => { showMessage(String(error)); }); });
element('release').addEventListener('click', () => { void releaseComputer(); });
element('test').addEventListener('click', () => { void window.alertBridge.test().then(() => { showMessage('测试提醒已加入队列'); }); });
element('clear').addEventListener('click', () => {
  if (!command) { showMessage('请先连接设备，再清除设备上的提醒。'); return; }
  hasClearRequest = true;
});
element('hook').addEventListener('click', () => {
  void window.alertBridge.exportHook().then(() => { showMessage('已生成 Hook 配置；如需启用，请合并后在 Codex 的 Hooks 设置中审阅并信任。'); });
});
setInterval(() => { void tick(); }, 1000);
void tick();
