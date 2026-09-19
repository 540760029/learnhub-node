/**
 * 数据访问层 —— 基于 Cloudflare D1 binding
 *
 * 只做三件事：薄封装 D1、统一的 JSON 字段解析、几个业务读写辅助。
 * 不引 ORM：D1 是 SQLite 语义，裸 SQL 反而更直观，也不会有驱动兼容问题。
 *
 * D1 API 备忘：
 *   db.prepare(sql).bind(...args).first()   -> 单行对象或 null
 *   db.prepare(sql).bind(...args).all()     -> { results: [...] }
 *   db.prepare(sql).bind(...args).run()     -> { success, meta: { last_row_id, changes } }
 */

export function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** JSON 字段解析：D1 里存的是 TEXT */
export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toJson(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export class Db {
  constructor(d1) {
    if (!d1) throw new Error('缺少 D1 数据库绑定（env.DB）');
    this.d1 = d1;
  }

  async all(sql, ...params) {
    const r = await this.d1.prepare(sql).bind(...params).all();
    return r.results ?? [];
  }

  async first(sql, ...params) {
    const r = await this.d1.prepare(sql).bind(...params).first();
    return r ?? null;
  }

  async run(sql, ...params) {
    const r = await this.d1.prepare(sql).bind(...params).run();
    return { changes: r.meta?.changes ?? 0, lastRowId: r.meta?.last_row_id ?? null };
  }

  /** 批量执行（D1 batch 会把多条语句打包成一次往返） */
  async batch(statements) {
    return this.d1.batch(statements);
  }

  // ------------------------------------------------------------ 便捷查询
  async getUserById(id) {
    return this.first('SELECT * FROM users WHERE id = ?', id);
  }

  async getUserByEmail(email) {
    return this.first('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase());
  }

  async getCourse(id) {
    return this.first('SELECT * FROM courses WHERE id = ?', id);
  }

  async listCoursesOwned(teacherId) {
    return this.all('SELECT * FROM courses WHERE teacher_id = ? ORDER BY created_at DESC', teacherId);
  }

  async listCoursesAssisting(teacherId) {
    return this.all(
      `SELECT c.* FROM courses c
         JOIN course_teachers ct ON ct.course_id = c.id
        WHERE ct.teacher_id = ? AND c.teacher_id <> ?
        ORDER BY c.created_at DESC`,
      teacherId, teacherId,
    );
  }

  async listCoursesJoined(studentId) {
    return this.all(
      `SELECT c.* FROM courses c
         JOIN enrollments e ON e.course_id = c.id
        WHERE e.student_id = ?
        ORDER BY c.created_at DESC`,
      studentId,
    );
  }

  async isEnrolled(courseId, studentId) {
    const row = await this.first(
      'SELECT 1 AS ok FROM enrollments WHERE course_id = ? AND student_id = ?',
      courseId, studentId,
    );
    return !!row;
  }

  async isAssistingTeacher(courseId, teacherId) {
    const row = await this.first(
      'SELECT 1 AS ok FROM course_teachers WHERE course_id = ? AND teacher_id = ?',
      courseId, teacherId,
    );
    return !!row;
  }

  async studentsOf(courseId) {
    return this.all(
      `SELECT u.* FROM users u
         JOIN enrollments e ON e.student_id = u.id
        WHERE e.course_id = ?
        ORDER BY u.name`,
      courseId,
    );
  }

  async countStudents(courseId) {
    const row = await this.first('SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?', courseId);
    return row?.n ?? 0;
  }

  /** 课程维度计数，用于课程卡片 */
  async courseCounts(courseId) {
    const [kp, asg, quiz, stu] = await Promise.all([
      this.first('SELECT COUNT(*) AS n FROM knowledge_points WHERE course_id = ?', courseId),
      this.first('SELECT COUNT(*) AS n FROM assignments WHERE course_id = ?', courseId),
      this.first('SELECT COUNT(*) AS n FROM quiz_sets WHERE course_id = ?', courseId),
      this.countStudents(courseId),
    ]);
    return {
      kp_count: kp?.n ?? 0,
      assignment_count: asg?.n ?? 0,
      quiz_count: quiz?.n ?? 0,
      student_count: stu,
    };
  }

  // ------------------------------------------------------------ AI 额度
  async getUsage(userId) {
    const day = today();
    let row = await this.first('SELECT * FROM ai_usage WHERE user_id = ? AND day = ?', userId, day);
    if (!row) {
      await this.run(
        'INSERT OR IGNORE INTO ai_usage (user_id, day, used, used_own_key, last_at) VALUES (?,?,0,0,?)',
        userId, day, nowIso(),
      );
      row = await this.first('SELECT * FROM ai_usage WHERE user_id = ? AND day = ?', userId, day);
    }
    return row;
  }

  async bumpUsage(userId, { ownKey }) {
    const day = today();
    await this.run(
      `INSERT INTO ai_usage (user_id, day, used, used_own_key, last_at) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id, day) DO UPDATE SET
           used = used + excluded.used,
           used_own_key = used_own_key + excluded.used_own_key,
           last_at = excluded.last_at`,
      userId, day, ownKey ? 0 : 1, ownKey ? 1 : 0, nowIso(),
    );
  }

  async sumUsageToday() {
    const row = await this.first(
      'SELECT COALESCE(SUM(used + used_own_key), 0) AS n FROM ai_usage WHERE day = ?', today(),
    );
    return row?.n ?? 0;
  }

  // ------------------------------------------------------------ 平台配置
  async getSetting(key, fallback = null) {
    const row = await this.first('SELECT value FROM settings WHERE key = ?', key);
    return row && row.value !== null && row.value !== undefined ? row.value : fallback;
  }

  async setSetting(key, value) {
    await this.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key, value, nowIso(),
    );
  }

  async getSettings(keys) {
    if (!keys.length) return {};
    const placeholders = keys.map(() => '?').join(',');
    const rows = await this.all(
      `SELECT key, value FROM settings WHERE key IN (${placeholders})`, ...keys,
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // ------------------------------------------------------------ 薄弱点统计
  async bumpWeakStats(studentId, detail) {
    const byKp = new Map();
    for (const d of detail || []) {
      if (!d.kp_id) continue;
      const cur = byKp.get(d.kp_id) || { total: 0, wrong: 0 };
      cur.total += 1;
      if (!d.correct) cur.wrong += 1;
      byKp.set(d.kp_id, cur);
    }
    const stmts = [];
    for (const [kpId, v] of byKp) {
      stmts.push(this.d1.prepare(
        `INSERT INTO weak_stats (student_id, kp_id, total, wrong, updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(student_id, kp_id) DO UPDATE SET
             total = total + excluded.total,
             wrong = wrong + excluded.wrong,
             updated_at = excluded.updated_at`,
      ).bind(studentId, kpId, v.total, v.wrong, nowIso()));
    }
    if (stmts.length) await this.batch(stmts);
  }
}

/** 生成课程邀请码（避开容易混淆的 0/O/1/I） */
export function randomJoinCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
