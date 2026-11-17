// 职责：隔离模拟页面与蓝牙，验证过期通知、释放电脑及扫描取消不会破坏新授权。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

/** 等待异步界面操作完成，不访问真实设备或会话目录。 */
const waitFor = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() > deadline) { throw new Error('隔离界面操作超时'); }
    await delay(5);
  }
};

test('旧设备延迟回执不能撤销新设备，释放后不抢连，扫描可取消后重新授权', async () => {
  /** 使用最小页面接口，事件由测试主动触发。 */
  const elements = new Map<string, { value: string; textContent: string; classList: { add: () => void; remove: () => void }; addEventListener: (name: string, callback: () => void) => void; handlers: Map<string, () => void> }>();
  const element = (id: string) => {
    if (!elements.has(id)) {
      const handlers = new Map<string, () => void>();
      elements.set(id, {value:'',textContent:'',classList:{add:()=>{},remove:()=>{}},handlers,addEventListener:(name,callback)=>{handlers.set(name,callback);}});
    }
    return elements.get(id)!;
  };
  const click = (id: string): void => { element(id).handlers.get('click')!(); };
  /** 配置和输入均为独立内存对象。 */
  let settings = {connectionCode:'123456',canAutoConnect:false};
  let canHoldReceipt = false;
  let releaseReceipt: (() => void) | undefined;
  let cancelRequest: ((error: Error) => void) | undefined;
  let canHoldSelection = false;
  /** 模拟设备拒绝换码写入，但蓝牙连接仍保持的失败路径。 */
  let canRejectRelease = false;
  const requests: unknown[] = [];
  const timers: Array<() => void> = [];
  const writes: string[] = [];
  const devices: FakeDevice[] = [];
  /** 模拟标准特征读写与订阅。 */
  class FakeCharacteristic extends EventTarget {
    /** 当前设备状态。 */
    value: DataView;
    /** 初始化一个与当前连接码一致的回执。 */
    constructor(code: string) { super(); this.value = new DataView(new TextEncoder().encode(JSON.stringify({count:0,lastId:'',state:'idle',connectionCode:code})).buffer); }
    /** 读取模拟值。 */
    readValue = async () => this.value;
    /** 订阅模拟通知。 */
    startNotifications = async () => this;
    /** 释放指令发出前必须已经持久暂停。 */
    writeValueWithResponse = async (bytes: Uint8Array) => {
      const payload = new TextDecoder().decode(bytes);
      if (JSON.parse(payload).type === 'reauthorize') {
        assert.equal(settings.canAutoConnect,false);
        if (canRejectRelease) { throw new Error('设备队列已满'); }
      }
      writes.push(payload);
    };
  }
  /** 每次设备选择返回新对象，旧对象可延迟触发事件。 */
  class FakeDevice extends EventTarget {
    /** 状态特征、命令特征及撤销次数。 */
    status: FakeCharacteristic;
    command: FakeCharacteristic;
    forgotten = 0;
    gatt = {
      connected:false,
      connect:async () => {
        this.gatt.connected = true;
        return {getPrimaryService:async () => ({getCharacteristic:async (uuid: string) => uuid.startsWith('9c3b0002') ? this.command : this.status})};
      },
      disconnect:() => {this.gatt.connected=false;this.dispatchEvent(new Event('gattserverdisconnected'));},
    };
    /** 保存此设备的状态快照。 */
    constructor(code: string) { super(); this.status=new FakeCharacteristic(code);this.command=new FakeCharacteristic(code); }
    /** 记录授权已被撤销。 */
    forget = async () => {this.forgotten++;};
  }
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const previousInterval = globalThis.setInterval;
  Object.assign(globalThis, {
    document:{getElementById:element},
    window:{alertBridge:{
      getState:async()=>({pendingCount:0,home:'/隔离/codex',message:'',authorization:{...settings}}),
      saveAuthorization:async(value:typeof settings)=>{settings={...value};},
      cancelSelection:async()=>{if(cancelRequest){cancelRequest(new Error('扫描已取消'));cancelRequest=undefined;}},
      acknowledge:async()=>{if(canHoldReceipt){canHoldReceipt=false;await new Promise<void>((resolve)=>{releaseReceipt=resolve;});}},
      connection:async()=>{},test:async()=>{},exportHook:async()=>'',
    }},
  });
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{bluetooth:{requestDevice:async(options:unknown)=>{
    requests.push(options);
    if(canHoldSelection){canHoldSelection=false;await new Promise<void>((_resolve,reject)=>{cancelRequest=reject;});}
    const device=new FakeDevice(settings.connectionCode);devices.push(device);return device;
  }}}});
  globalThis.setInterval=((callback:()=>void)=>{timers.push(callback);return 0;}) as unknown as typeof setInterval;
  try {
    // 本项目测试命令先编译，避免测试到旧的构建产物。
    await import('../dist/renderer.js');
    const window = (globalThis as unknown as {window:{codexAlertConnect:()=>Promise<void>}}).window;
    await window.codexAlertConnect();
    assert.equal(requests.length,0);
    element('connection-code').value='456789';
    click('reauthorize');
    await waitFor(()=>devices.length===1 && element('connection').textContent==='蓝牙已连接');
    const old=devices[0];
    canHoldReceipt=true;
    old.status.dispatchEvent(new Event('characteristicvaluechanged'));
    await waitFor(()=>releaseReceipt!==undefined);
    element('connection-code').value='987654';
    click('reauthorize');
    await waitFor(()=>devices.length===2 && devices[1].gatt.connected && element('connection').textContent==='蓝牙已连接');
    releaseReceipt!();
    await delay(30);
    assert.equal(devices[1].gatt.connected,true,'旧设备的延迟回执撤销了新设备');
    assert.equal(devices[1].forgotten,0);
    click('release');
    await waitFor(()=>devices[1].forgotten===1);
    assert.equal(settings.canAutoConnect,false);
    assert.ok(writes.some((value)=>JSON.parse(value).type==='reauthorize'));
    for(const timer of timers){timer();}
    await window.codexAlertConnect();
    assert.equal(requests.length,2);
    canHoldSelection=true;
    click('connect');
    await waitFor(()=>cancelRequest!==undefined);
    element('connection-code').value='111222';
    click('reauthorize');
    await waitFor(()=>devices.length===3 && devices[2].gatt.connected);
    assert.equal(settings.connectionCode,'111222');
    assert.equal(settings.canAutoConnect,true);
    canRejectRelease=true;
    click('release');
    await waitFor(()=>element('message').textContent.includes('未确认'));
    assert.equal(devices[2].gatt.connected,false,'换码写入失败后旧电脑仍占据连接');
    assert.equal(devices[2].forgotten,1);
  } finally {
    globalThis.setInterval=previousInterval;
    if(previousNavigator){Object.defineProperty(globalThis,'navigator',previousNavigator);}else{Reflect.deleteProperty(globalThis,'navigator');}
    Reflect.deleteProperty(globalThis,'window');Reflect.deleteProperty(globalThis,'document');
  }
});
