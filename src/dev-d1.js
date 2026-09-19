/**
 * 兼容层：早期版本用 LocalD1 模拟 D1 接口，现在统一走 src/drivers.js 的驱动。
 *
 * 保留这个文件是为了不破坏外部引用（例如老脚本里 import { LocalD1 }）。
 * 新代码请直接用 createSqliteDriver / createMysqlDriver / D1Driver。
 */
import { createSqliteDriver } from './drivers.js';

/** @deprecated 用 src/drivers.js 的 createSqliteDriver 代替 */
export class LocalD1 {
  constructor(path = ':memory:') {
    throw new Error('LocalD1 已废弃：请改用 src/drivers.js 的 createSqliteDriver()（现在是异步的）');
  }
}

/** 执行多语句脚本（保留给老调用方；新代码用 db.execScript） */
export function runSqlScript(driver, sql) {
  if (!driver || typeof driver.execScript !== 'function') {
    throw new Error('runSqlScript 需要一个驱动实例（见 src/drivers.js）');
  }
  return driver.execScript(sql);
}

export { createSqliteDriver };

