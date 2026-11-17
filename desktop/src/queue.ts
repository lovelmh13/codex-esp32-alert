// 职责：原子保存未投递提醒，收到设备对应回执后才出队。
import type { Completion, Receipt } from './core.ts';
import { applyReceipt } from './core.ts';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 进程重启后仍保留的通知队列。 */
export class DurableQueue {
  /** 队列文件。 */
  private file: string;
  /** 当前待投递事件快照。 */
  private items: Completion[] = [];
  /** 已处理标识与串行写入链，避免监听和 Hook 同时入队造成覆盖。 */
  private seen = new Set<string>();
  private operation: Promise<void> = Promise.resolve();
  /** 返回快照，外部不能修改内部持久状态。 */
  get pending(): Completion[] { return this.items.map((event) => ({ ...event })); }
  /** 初始化队列路径。 */
  constructor(file: string) { this.file = file; }
  /** 从磁盘恢复队列。 */
  load = async (): Promise<void> => {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(value.pending) || !Array.isArray(value.seen) || value.pending.some((event: Completion) => !event || typeof event.id !== 'string' || typeof event.title !== 'string' || typeof event.completedAt !== 'string') || value.seen.some((id: unknown) => typeof id !== 'string')) {
        throw new Error('提醒队列格式损坏，请保留文件后检查');
      }
      this.items = value.pending;
      this.seen = new Set(value.seen);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
    }
  };
  /** 持久保存事件，重复标识不再次入队。 */
  enqueue = async (event: Completion): Promise<void> => this.serialize(async () => {
    if (this.seen.has(event.id) || this.items.some((item) => item.id === event.id)) { return; }
    const seen = new Set(this.seen);
    seen.add(event.id);
    if (seen.size > 4096) { seen.delete(seen.values().next().value!); }
    await this.persist([...this.items, event], seen);
  });
  /** 处理明确投递回执。 */
  acknowledge = async (receipt: Receipt): Promise<void> => this.serialize(async () => {
    const next = applyReceipt(this.items, receipt);
    if (next.length !== this.items.length) { await this.persist(next, this.seen); }
  });
  /** 写临时文件后原子替换，成功后才更新内存状态。 */
  private persist = async (items: Completion[], seen: Set<string>): Promise<void> => {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify({ pending: items, seen: [...seen] }), 'utf8');
    await rename(`${this.file}.tmp`, this.file);
    this.items = items;
    this.seen = seen;
  };
  /** 一次失败不会阻止后续操作，但失败本身仍返回给调用方。 */
  private serialize = (action: () => Promise<void>): Promise<void> => {
    const result = this.operation.then(action);
    this.operation = result.catch(() => {});
    return result;
  };
}
