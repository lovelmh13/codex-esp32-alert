// 职责：跨平台增量读取本机 Codex 完成记录，过滤启动前历史和子代理。
import type { Completion } from './core.ts';
import { createCompletion } from './core.ts';
import { readdir, stat, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 单个日志的读取位置和未完成行。 */
interface Cursor {
  /** 已读取字节位置。 */
  offset: number;
  /** 尚未遇到换行的原始字节。 */
  remainder: Buffer;
  /** 主聊天或子代理的元信息。 */
  meta: Record<string, unknown>;
  /** 是否正在丢弃超长日志行。 */
  isSkipping: boolean;
}

/** 本机会话目录监听器，测试时传入完全隔离的目录。 */
export class SessionWatcher {
  /** Codex 根目录。 */
  private home: string;
  /** 每条已筛选事件的持久投递函数。 */
  private onCompletion: (event: Completion) => Promise<void>;
  /** 启动基准、文件位置、已投递标识和扫描重入保护。 */
  private startedAt = Date.now();
  private cursors = new Map<string, Cursor>();
  private seen = new Set<string>();
  private isScanning = false;
  /** 初始化监听器。 */
  constructor(home: string, onCompletion: (event: Completion) => Promise<void>) {
    this.home = home;
    this.onCompletion = onCompletion;
  }
  /** 建立历史读取基线。 */
  initialize = async (): Promise<void> => {
    for (const file of await this.discover(join(this.home, 'sessions'))) {
      const info = await stat(file);
      this.cursors.set(file, { offset: info.mtimeMs >= this.startedAt ? 0 : info.size, remainder: Buffer.alloc(0), meta: {}, isSkipping: false });
    }
  };
  /** 串行扫描新增内容。 */
  scan = async (): Promise<void> => {
    if (this.isScanning) { return; }
    this.isScanning = true;
    try {
      /** 索引只用于展示标题，不将回答或完整路径发送给设备。 */
      const titles = new Map<string, string>();
      const index = await readFile(join(this.home, 'session_index.jsonl'), 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') { return ''; }
        throw error;
      });
      for (const line of index.split('\n')) {
        try {
          const value = JSON.parse(line);
          if (typeof value.id === 'string' && typeof value.thread_name === 'string') { titles.set(value.id, value.thread_name); }
        } catch { /* 忽略正在写入的半行索引。 */ }
      }
      for (const file of await this.discover(join(this.home, 'sessions'))) { await this.consume(file, titles); }
    } finally { this.isScanning = false; }
  };
  /** 仅扫描会话目录中的普通 JSONL 文件，不跟随符号链接。 */
  private discover = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') { return []; }
      throw error;
    });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { files.push(...await this.discover(path)); }
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) { files.push(path); }
    }
    return files;
  };
  /** 队列持久保存成功后才提交字节位置，失败时下次扫描可重试。 */
  private consume = async (file: string, titles: Map<string, string>): Promise<void> => {
    const info = await stat(file);
    const saved = this.cursors.get(file) ?? { offset: 0, remainder: Buffer.alloc(0), meta: {}, isSkipping: false };
    if (saved.offset === info.size) { return; }
    const cursor = { ...saved };
    if (cursor.offset > info.size) { cursor.offset = 0; cursor.remainder = Buffer.alloc(0); cursor.meta = {}; cursor.isSkipping = false; }
    const handle = await open(file, 'r');
    try {
      if (!cursor.meta.id) {
        const head = Buffer.alloc(Math.min(info.size, 1024 * 1024));
        await handle.read(head, 0, head.length, 0);
        const end = head.indexOf(10);
        if (end >= 0) {
          try {
            const value = JSON.parse(head.subarray(0, end).toString('utf8'));
            if (value.type === 'session_meta' && value.payload && typeof value.payload === 'object') { cursor.meta = value.payload; }
          } catch { /* 非会话文件不能触发提醒。 */ }
        }
      }
      while (cursor.offset < info.size) {
        const chunk = Buffer.alloc(Math.min(256 * 1024, info.size - cursor.offset));
        const result = await handle.read(chunk, 0, chunk.length, cursor.offset);
        if (result.bytesRead === 0) { break; }
        const bytes = Buffer.concat([cursor.remainder, chunk.subarray(0, result.bytesRead)]);
        let start = 0;
        let end = bytes.indexOf(10);
        while (end >= 0) {
          if (cursor.isSkipping) { cursor.isSkipping = false; }
          else {
            let entry: unknown;
            try { entry = JSON.parse(bytes.subarray(start, end).toString('utf8')); } catch { entry = undefined; }
            const event = createCompletion(entry, cursor.meta, this.startedAt);
            if (event && !this.seen.has(event.id)) {
              event.title = titles.get(String(cursor.meta.id))?.trim() || event.title;
              await this.onCompletion(event);
              this.seen.add(event.id);
              if (this.seen.size > 4096) { this.seen.delete(this.seen.values().next().value!); }
            }
          }
          start = end + 1;
          end = bytes.indexOf(10, start);
        }
        cursor.remainder = bytes.subarray(start);
        if (cursor.remainder.length > 4 * 1024 * 1024 || cursor.isSkipping) { cursor.remainder = Buffer.alloc(0); cursor.isSkipping = true; }
        cursor.offset += result.bytesRead;
      }
      this.cursors.set(file, cursor);
    } finally { await handle.close(); }
  };
}
