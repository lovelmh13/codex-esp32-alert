// 职责：运行跨平台提醒窗口、持久队列、会话监听和受限 IPC。
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { mkdir, appendFile, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SessionWatcher } from './watcher.js';
import { DurableQueue } from './queue.js';
import { AuthorizationStore } from './authorization-store.js';
import { getDeviceName } from './authorization.js';
import type { BluetoothAuthorization } from './authorization.js';
import type { Receipt, Completion } from './core.js';
import type { BridgeState } from './api.js';

/** 应用根目录与显式命名参数。 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) { return resolve(process.argv[index + 1]); }
  return undefined;
};
/** 验证模式必须使用隔离目录，不得注入真实聊天。 */
const isVerification = process.argv.includes('--verify');
const codexHome = option('--home') || process.env.CODEX_HOME || join(homedir(), '.codex');
const dataOverride = option('--data');
if (isVerification && (!option('--home') || !dataOverride || resolve(codexHome) === resolve(join(homedir(), '.codex')))) {
  throw new Error('验证模式必须显式指定隔离的 --home 和 --data');
}
if (dataOverride) { app.setPath('userData', dataOverride); }
if (!app.requestSingleInstanceLock()) { app.quit(); }
else { void app.whenReady().then(async () => {
  /** 运行目录、持久队列、最近状态和扫描保护。 */
  const data = app.getPath('userData');
  const inbox = join(data, 'inbox');
  const queue = new DurableQueue(join(data, 'queue.json'));
  /** 连接码仅用于匹配设备名称，暂停开关保证重启后不抢连。 */
  const authorizationStore = new AuthorizationStore(join(data, 'authorization.json'));
  let authorization = await authorizationStore.load();
  let message = '正在初始化监听';
  let receipt: Receipt | undefined;
  let isScanning = false;
  let selectionTimeout: ReturnType<typeof setTimeout> | undefined;
  /** 当前扫描回调；取消后清空，防止超时继续选择旧设备。 */
  let selectionCallback: ((id: string) => void) | undefined;
  /** 取消尚未完成的 Web Bluetooth 请求。 */
  const cancelSelection = (): void => {
    if (selectionTimeout) { clearTimeout(selectionTimeout); selectionTimeout = undefined; }
    const callback = selectionCallback;
    selectionCallback = undefined;
    if (callback) { callback(''); }
  };
  await mkdir(inbox, { recursive: true });
  await queue.load();
  /** 日志只记录状态和原因，不保存回答正文。 */
  const log = async (text: string): Promise<void> => {
    await appendFile(join(data, '运行日志.txt'), `${new Date().toISOString()} ${text}\n`).catch(() => {});
  };
  /** 状态文件用于诊断和端到端验证，正常界面使用同一份状态。 */
  const state = (): BridgeState => ({ pendingCount: queue.pending.length, next: queue.pending[0], home: codexHome, message, receipt, authorization });
  const saveStatus = async (): Promise<void> => {
    await writeFile(join(data, 'status.json'), JSON.stringify({ ...state(), pid: process.pid, isVerification }));
  };
  const enqueue = async (event: Completion): Promise<void> => {
    await queue.enqueue(event);
    message = '已收到本轮结束事件';
    await log('已接收主聊天完成事件');
    await saveStatus();
  };
  const watcher = new SessionWatcher(codexHome, enqueue);
  await watcher.initialize();
  message = '正在监听本机 Codex，历史记录不会回放';
  /** 扫描正式 Hook 收件箱与本地日志，两者由队列统一去重。 */
  const scan = async (): Promise<void> => {
    if (isScanning) { return; }
    isScanning = true;
    try {
      for (const file of await readdir(inbox)) {
        if (!file.endsWith('.json')) { continue; }
        const path = join(inbox, file);
        const event = JSON.parse(await readFile(path, 'utf8')) as Completion;
        if (!event || typeof event.id !== 'string' || typeof event.title !== 'string' || typeof event.completedAt !== 'string') { throw new Error('Hook 消息格式无效'); }
        await enqueue(event);
        await unlink(path);
      }
      await watcher.scan();
    } catch (error) { message = `监听暂时失败，将重试：${String(error)}`; await log(message); }
    finally { isScanning = false; }
    await saveStatus();
  };
  /** 窗口只加载本地页面，禁用外部导航及新窗口。 */
  const window = new BrowserWindow({
    width: 640, height: 880, minWidth: 560, minHeight: 650, title: 'Codex 提醒器',
    backgroundColor: '#0b1320', autoHideMenuBar: true,
    webPreferences: { preload: join(root, 'dist', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:codex-alert' },
  });
  window.webContents.on('will-navigate', (event) => { event.preventDefault(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  /** 每次扫描只选择指定名称的提醒器，不连接其他蓝牙设备。 */
  window.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    selectionCallback = callback;
    if (!authorization.canAutoConnect) { cancelSelection(); return; }
    const device = devices.find((item) => item.deviceName === getDeviceName(authorization.connectionCode));
    if (device) {
      if (selectionTimeout) { clearTimeout(selectionTimeout); selectionTimeout = undefined; }
      selectionCallback = undefined;
      callback(device.deviceId);
    } else if (!selectionTimeout) { selectionTimeout = setTimeout(cancelSelection, 25000); }
  });
  /** IPC 仅接受本窗口，回执经过形状校验。 */
  const isOwnWindow = (event: Electron.IpcMainInvokeEvent): boolean => event.sender === window.webContents;
  ipcMain.handle('alert:authorization', async (event, settings: BluetoothAuthorization) => {
    if (!isOwnWindow(event) || !settings) { throw new Error('授权配置来源无效'); }
    await authorizationStore.save(settings);
    authorization = { connectionCode:settings.connectionCode,canAutoConnect:settings.canAutoConnect };
    await saveStatus();
  });
  ipcMain.handle('alert:cancel-selection', (event) => {
    if (!isOwnWindow(event)) { throw new Error('来源无效'); }
    cancelSelection();
  });
  ipcMain.handle('alert:state', (event) => { if (!isOwnWindow(event)) { throw new Error('来源无效'); } return state(); });
  ipcMain.handle('alert:receipt', async (event, value: Receipt) => {
    if (!isOwnWindow(event) || !value || typeof value.lastId !== 'string' || !Number.isInteger(value.count) || value.count < 0 || value.count > 9999 || !['idle', 'alert'].includes(value.state)) { throw new Error('设备回执格式无效'); }
    if (value.connectionCode !== undefined) { getDeviceName(value.connectionCode); }
    receipt = value;
    await queue.acknowledge(value);
    await saveStatus();
  });
  ipcMain.handle('alert:test', async (event) => {
    if (!isOwnWindow(event)) { throw new Error('来源无效'); }
    await enqueue({ id: `manual:${randomUUID()}`, title: '手动测试提醒', completedAt: new Date().toISOString() });
  });
  ipcMain.handle('alert:connection', async (event, isConnected: boolean, text: string) => {
    if (!isOwnWindow(event) || typeof isConnected !== 'boolean' || typeof text !== 'string') { throw new Error('连接状态无效'); }
    message = text.slice(0, 300);
    await log(`${isConnected ? '蓝牙已连接' : '蓝牙未连接'}：${message}`);
    await saveStatus();
  });
  /** 只生成配置供审阅，不修改 Codex 配置或 Hook 信任记录。 */
  ipcMain.handle('alert:hook', async (event) => {
    if (!isOwnWindow(event)) { throw new Error('来源无效'); }
    const quoteShell = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
    const quotePowerShell = (value: string): string => `'${value.replace(/'/g, "''")}'`;
    const executable = process.execPath;
    const hook = join(root, 'dist', 'hook.js');
    const command = `ELECTRON_RUN_AS_NODE=1 ${quoteShell(executable)} ${quoteShell(hook)} --inbox ${quoteShell(inbox)}`;
    const commandWindows = `powershell.exe -NoProfile -NonInteractive -Command "$env:ELECTRON_RUN_AS_NODE='1'; & ${quotePowerShell(executable)} ${quotePowerShell(hook)} --inbox ${quotePowerShell(inbox)}"`;
    const path = join(data, 'hooks.generated.json');
    await writeFile(path, JSON.stringify({ description: 'Codex 屏幕提醒：本轮结束后投递本机 BLE 设备', hooks: { Stop: [{ hooks: [{ type: 'command', command, commandWindows, timeout: 5 }] }] } }, null, 2));
    shell.showItemInFolder(path);
    return path;
  });
  app.on('second-instance', () => { window.show(); window.focus(); });
  app.on('activate', () => { window.show(); });
  window.on('minimize', () => { /* 最小化后仍继续监听与蓝牙投递。 */ });
  window.on('closed', () => { app.quit(); });
  await window.loadFile(join(root, 'index.html'));
  await saveStatus();
  setInterval(() => { void scan().catch((error) => { void log(String(error)); }); }, 1500);
  await log('提醒器启动，历史完成事件不回放');
  /** 启动时自动扫描已授权的目标外设，首次 Mac 权限仍由操作系统提示。 */
  setTimeout(() => { void window.webContents.executeJavaScript('window.codexAlertConnect()', true).catch((error) => { void log(`自动连接失败：${String(error)}`); }); }, 1000);
  if (isVerification) {
    setInterval(() => { void window.webContents.capturePage().then((image) => writeFile(join(data, '界面验证.png'), image.toPNG())).catch(() => {}); }, 5000);
  }
}).catch((error) => { console.error('提醒器启动失败：', error); app.quit(); }); }
