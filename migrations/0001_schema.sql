-- ============================================================================
--  LearnHub D1 建表脚本
--  Cloudflare D1（SQLite）方言；所有时间统一存 ISO8601 UTC 字符串
-- ============================================================================

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------------- 用户
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  role            TEXT    NOT NULL DEFAULT 'student',   -- teacher | student
  is_admin        INTEGER NOT NULL DEFAULT 0,           -- 平台管理员
  password_hash   TEXT    NOT NULL,
  school          TEXT,
  student_no      TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  -- AI 配置（自带的 key 加密存储，绝不明文）
  ai_provider     TEXT,
  ai_api_key_enc  TEXT,
  ai_base_url     TEXT,
  ai_model        TEXT,
  created_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role    ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_admin   ON users(is_admin);

-- --------------------------------------------------------------------- 课程
CREATE TABLE IF NOT EXISTS courses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  description   TEXT,
  cover_emoji   TEXT    NOT NULL DEFAULT '📘',
  join_code     TEXT    NOT NULL UNIQUE,
  teacher_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_published  INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courses_teacher ON courses(teacher_id);
CREATE INDEX IF NOT EXISTS idx_courses_code    ON courses(join_code);

-- 选课关系
CREATE TABLE IF NOT EXISTS enrollments (
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (course_id, student_id)
);

-- 协助教师
CREATE TABLE IF NOT EXISTS course_teachers (
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  PRIMARY KEY (course_id, teacher_id)
);

-- --------------------------------------------------------------------- 知识点
-- scope: course  全班可见（教师发布）
--        teacher 仅教师可见（教师草稿）
--        private 仅创建者本人可见（学生笔记）
CREATE TABLE IF NOT EXISTS knowledge_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  content     TEXT    NOT NULL DEFAULT '',
  order_no    INTEGER NOT NULL DEFAULT 0,
  scope       TEXT    NOT NULL DEFAULT 'course',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_file TEXT,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kp_course ON knowledge_points(course_id);
CREATE INDEX IF NOT EXISTS idx_kp_scope  ON knowledge_points(scope);

-- --------------------------------------------------------------------- 作业
CREATE TABLE IF NOT EXISTS assignments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL DEFAULT '',
  due_at     TEXT,
  full_score REAL    NOT NULL DEFAULT 100,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asg_course ON assignments(course_id);

CREATE TABLE IF NOT EXISTS submissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id  INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id     INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  content        TEXT    NOT NULL DEFAULT '',
  attachment_url TEXT,
  score          REAL,
  feedback       TEXT,
  submitted_at   TEXT    NOT NULL,
  graded_at      TEXT,
  UNIQUE (assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_sub_asg ON submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_sub_stu ON submissions(student_id);

-- --------------------------------------------------------------------- 试题
-- scope: course 全班可见 | teacher 仅教师可见 | private 仅创建者可见
CREATE TABLE IF NOT EXISTS quiz_sets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'manual',   -- manual | ai
  scope        TEXT    NOT NULL DEFAULT 'course',
  kp_ids       TEXT,                                -- JSON 数组
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quiz_course ON quiz_sets(course_id);
CREATE INDEX IF NOT EXISTS idx_quiz_scope  ON quiz_sets(scope);

CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_set_id INTEGER NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  qtype       TEXT    NOT NULL DEFAULT 'single',    -- single | multi | judge | short
  stem        TEXT    NOT NULL,
  options     TEXT,                                 -- JSON 数组
  answer      TEXT    NOT NULL DEFAULT '',
  analysis    TEXT    NOT NULL DEFAULT '',
  difficulty  INTEGER NOT NULL DEFAULT 3,           -- 1~5
  kp_id       INTEGER REFERENCES knowledge_points(id) ON DELETE SET NULL,
  order_no    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_q_quiz ON questions(quiz_set_id);

CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_set_id  INTEGER NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  answers      TEXT,                                -- JSON {questionId: answer}
  score        REAL    NOT NULL DEFAULT 0,
  total        REAL    NOT NULL DEFAULT 0,
  detail       TEXT,                                -- JSON 逐题对错
  duration_sec INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_quiz ON attempts(quiz_set_id);
CREATE INDEX IF NOT EXISTS idx_att_stu  ON attempts(student_id);

-- --------------------------------------------------------------------- AI 额度
CREATE TABLE IF NOT EXISTS ai_usage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day          TEXT    NOT NULL,                    -- YYYY-MM-DD (UTC)
  used         INTEGER NOT NULL DEFAULT 0,          -- 用平台/教师 key
  used_own_key INTEGER NOT NULL DEFAULT 0,          -- 用自带 key
  last_at      TEXT    NOT NULL,
  UNIQUE (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON ai_usage(user_id, day);

-- --------------------------------------------------------------------- 薄弱点
CREATE TABLE IF NOT EXISTS weak_stats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kp_id      INTEGER NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  total      INTEGER NOT NULL DEFAULT 0,
  wrong      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL,
  UNIQUE (student_id, kp_id)
);
CREATE INDEX IF NOT EXISTS idx_weak_stu ON weak_stats(student_id);

-- --------------------------------------------------------------------- 公告
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ann_course ON announcements(course_id);

-- --------------------------------------------------------------------- 平台配置
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);
