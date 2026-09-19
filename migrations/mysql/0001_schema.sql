-- ============================================================
--  LearnHub MySQL 建库脚本
--  由 scripts/make-mysql-sql.js 从 migrations/0001_schema.sql 自动生成，请勿手改。
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;
-- ============================================================================
--  LearnHub D1 建表脚本
--  Cloudflare D1（SQLite）方言；所有时间统一存 ISO8601 UTC 字符串
-- ============================================================================

-- --------------------------------------------------------------------- 用户
CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255)    NOT NULL UNIQUE,
  name LONGTEXT    NOT NULL,
  role VARCHAR(255)    NOT NULL DEFAULT 'student',   -- teacher | student
  is_admin        INT NOT NULL DEFAULT 0,           -- 平台管理员
  password_hash LONGTEXT    NOT NULL,
  school LONGTEXT,
  student_no LONGTEXT,
  is_active       INT NOT NULL DEFAULT 1,
  -- AI 配置（自带的 key 加密存储，绝不明文）
  ai_provider LONGTEXT,
  ai_api_key_enc LONGTEXT,
  ai_base_url LONGTEXT,
  ai_model LONGTEXT,
  created_at LONGTEXT    NOT NULL
);
CREATE INDEX idx_users_email   ON users(email);
CREATE INDEX idx_users_role    ON users(role);
CREATE INDEX idx_users_admin   ON users(is_admin);

-- --------------------------------------------------------------------- 课程
CREATE TABLE IF NOT EXISTS courses (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title LONGTEXT    NOT NULL,
  description LONGTEXT,
  cover_emoji LONGTEXT    NOT NULL DEFAULT '📘',
  join_code VARCHAR(255)    NOT NULL UNIQUE,
  teacher_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_published  INT NOT NULL DEFAULT 1,
  created_at LONGTEXT    NOT NULL
);
CREATE INDEX idx_courses_teacher ON courses(teacher_id);
CREATE INDEX idx_courses_code    ON courses(join_code);

-- 选课关系
CREATE TABLE IF NOT EXISTS enrollments (
  course_id  INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id INT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  created_at LONGTEXT    NOT NULL,
  PRIMARY KEY (course_id, student_id)
);

-- 协助教师
CREATE TABLE IF NOT EXISTS course_teachers (
  course_id  INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id INT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  PRIMARY KEY (course_id, teacher_id)
);

-- --------------------------------------------------------------------- 知识点
-- scope: course  全班可见（教师发布）
--        teacher 仅教师可见（教师草稿）
--        private 仅创建者本人可见（学生笔记）
CREATE TABLE IF NOT EXISTS knowledge_points (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  course_id   INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title LONGTEXT    NOT NULL,
  content LONGTEXT    NOT NULL DEFAULT '',
  order_no    INT NOT NULL DEFAULT 0,
  scope VARCHAR(255)    NOT NULL DEFAULT 'course',
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  source_file LONGTEXT,
  created_at LONGTEXT    NOT NULL
);
CREATE INDEX idx_kp_course ON knowledge_points(course_id);
CREATE INDEX idx_kp_scope  ON knowledge_points(scope);

-- --------------------------------------------------------------------- 作业
CREATE TABLE IF NOT EXISTS assignments (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  course_id  INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title LONGTEXT    NOT NULL,
  content LONGTEXT    NOT NULL DEFAULT '',
  due_at LONGTEXT,
  full_score DOUBLE    NOT NULL DEFAULT 100,
  created_at LONGTEXT    NOT NULL
);
CREATE INDEX idx_asg_course ON assignments(course_id);

CREATE TABLE IF NOT EXISTS submissions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  assignment_id  INT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id     INT NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  content LONGTEXT    NOT NULL DEFAULT '',
  attachment_url LONGTEXT,
  score          DOUBLE,
  feedback LONGTEXT,
  submitted_at LONGTEXT    NOT NULL,
  graded_at LONGTEXT,
  UNIQUE (assignment_id, student_id)
);
CREATE INDEX idx_sub_asg ON submissions(assignment_id);
CREATE INDEX idx_sub_stu ON submissions(student_id);

-- --------------------------------------------------------------------- 试题
-- scope: course 全班可见 | teacher 仅教师可见 | private 仅创建者可见
CREATE TABLE IF NOT EXISTS quiz_sets (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  course_id    INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title LONGTEXT    NOT NULL,
  source LONGTEXT    NOT NULL DEFAULT 'manual',   -- manual | ai
  scope VARCHAR(255)    NOT NULL DEFAULT 'course',
  kp_ids LONGTEXT,                                -- JSON 数组
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  is_published INT NOT NULL DEFAULT 1,
  created_at LONGTEXT    NOT NULL
);
CREATE INDEX idx_quiz_course ON quiz_sets(course_id);
CREATE INDEX idx_quiz_scope  ON quiz_sets(scope);

CREATE TABLE IF NOT EXISTS questions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  quiz_set_id INT NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  qtype LONGTEXT    NOT NULL DEFAULT 'single',    -- single | multi | judge | short
  stem LONGTEXT    NOT NULL,
  options LONGTEXT,                                 -- JSON 数组
  answer LONGTEXT    NOT NULL DEFAULT '',
  analysis LONGTEXT    NOT NULL DEFAULT '',
  difficulty  INT NOT NULL DEFAULT 3,           -- 1~5
  kp_id       INT REFERENCES knowledge_points(id) ON DELETE SET NULL,
  order_no    INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_q_quiz ON questions(quiz_set_id);

CREATE TABLE IF NOT EXISTS attempts (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  quiz_set_id  INT NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  student_id   INT NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  answers LONGTEXT,                                -- JSON {questionId: answer}
  score        DOUBLE    NOT NULL DEFAULT 0,
  total        DOUBLE    NOT NULL DEFAULT 0,
  detail LONGTEXT,                                -- JSON 逐题对错
  duration_sec INT NOT NULL DEFAULT 0,
  submitted_at LONGTEXT    NOT NULL
);
CREATE INDEX idx_att_quiz ON attempts(quiz_set_id);
CREATE INDEX idx_att_stu  ON attempts(student_id);

-- --------------------------------------------------------------------- AI 额度
CREATE TABLE IF NOT EXISTS ai_usage (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day VARCHAR(255)    NOT NULL,                    -- YYYY-MM-DD (UTC)
  used         INT NOT NULL DEFAULT 0,          -- 用平台/教师 key
  used_own_key INT NOT NULL DEFAULT 0,          -- 用自带 key
  last_at LONGTEXT    NOT NULL,
  UNIQUE (user_id, day)
);
CREATE INDEX idx_usage_user ON ai_usage(user_id, day);

-- --------------------------------------------------------------------- 薄弱点
CREATE TABLE IF NOT EXISTS weak_stats (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kp_id      INT NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  total      INT NOT NULL DEFAULT 0,
  wrong      INT NOT NULL DEFAULT 0,
  updated_at LONGTEXT    NOT NULL,
  UNIQUE (student_id, kp_id)
);
CREATE INDEX idx_weak_stu ON weak_stats(student_id);

-- --------------------------------------------------------------------- 公告
CREATE TABLE IF NOT EXISTS announcements (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  course_id  INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  content LONGTEXT    NOT NULL,
  created_at LONGTEXT    NOT NULL
);
CREATE INDEX idx_ann_course ON announcements(course_id);

-- --------------------------------------------------------------------- 平台配置
CREATE TABLE IF NOT EXISTS settings (
  key LONGTEXT PRIMARY KEY,
  value LONGTEXT,
  updated_at LONGTEXT NOT NULL
);


-- ---------------- 种子数据 ----------------







INSERT IGNORE INTO users (id,email,name,role,is_admin,password_hash,school,student_no,is_active,created_at) VALUES
  (1,'admin@demo.edu','平台管理员','teacher',1,'pbkdf2_sha256$100000$wwQqQehBWWLOM/KpjxDZvQ==$YcfDtEpxSiEZpH84EYi2r5oBRvB8IBmuYduw8DcAUu0=','山西农业大学软件学院',NULL,1,'2026-09-19 14:51:39'),
  (2,'teacher@demo.edu','张明','teacher',0,'pbkdf2_sha256$100000$wwQqQehBWWLOM/KpjxDZvQ==$YcfDtEpxSiEZpH84EYi2r5oBRvB8IBmuYduw8DcAUu0=','山西农业大学软件学院',NULL,1,'2026-09-19 14:51:39'),
  (3,'student@demo.edu','李小凡','student',0,'pbkdf2_sha256$100000$wwQqQehBWWLOM/KpjxDZvQ==$YcfDtEpxSiEZpH84EYi2r5oBRvB8IBmuYduw8DcAUu0=','山西农业大学软件学院','2026S001',1,'2026-09-19 14:51:39');

INSERT IGNORE INTO courses (id,title,description,cover_emoji,join_code,teacher_id,is_published,created_at) VALUES
  (1,'多传感器信息融合滤波技术','卡尔曼滤波 / EKF / UKF 与多传感器加权融合，含状态估计方差对比实验。','🛰️','DEMO01',2,1,'2026-09-19 14:51:39');

INSERT IGNORE INTO enrollments (course_id,student_id,created_at) VALUES (1,3,'2026-09-19 14:51:39');

INSERT IGNORE INTO knowledge_points (id,course_id,title,content,order_no,scope,created_by,created_at) VALUES
  (1,1,'卡尔曼滤波的基本思想','卡尔曼滤波是一种递推的最小方差估计方法。它把系统建模为状态方程与观测方程，在每个时刻交替执行「预测」与「更新」两步：

- 预测：用状态转移矩阵 F 外推状态与协方差
- 更新：用卡尔曼增益 K 融合观测，修正估计

核心公式：K = P⁻Hᵀ(HP⁻Hᵀ+R)⁻¹。卡尔曼增益本质上是在「相信预测」和「相信观测」之间做加权平衡：预测协方差大就多信观测，观测噪声大就多信预测。

适用前提：系统线性、噪声为互不相关的高斯白噪声。',0,'course',2,'2026-09-19 14:51:39'),
  (2,1,'扩展卡尔曼滤波（EKF）','当状态方程或观测方程非线性时，EKF 通过一阶泰勒展开在工作点附近做线性化：

- 用雅可比矩阵 F_k = ∂f/∂x 代替线性系统的状态转移矩阵
- 用雅可比矩阵 H_k = ∂h/∂x 代替观测矩阵

EKF 的优点是计算量小；缺点是：
1. 一阶线性化在强非线性下误差大，甚至发散；
2. 雅可比矩阵需要解析求导，模型复杂时推导困难；
3. 线性化点偏离真值较远时估计精度明显下降。',1,'course',2,'2026-09-19 14:51:39'),
  (3,1,'无迹卡尔曼滤波（UKF）与无迹变换','UKF 不使用线性化，而是用「无迹变换（UT）」处理非线性：

1. 按确定性规则在均值周围选取 2n+1 个 Sigma 点；
2. 将 Sigma 点直接代入非线性函数传播；
3. 用传播后点集的加权均值与协方差近似后验分布。

关键参数：λ = α²(n+κ) − n，α 决定 Sigma 点的散布范围（常取 1e-3 ~ 1）。

UKF 能达到二阶以上精度，且无需计算雅可比矩阵，在强非线性场景下优于 EKF。',2,'course',2,'2026-09-19 14:51:39'),
  (4,1,'多传感器加权融合准则','对 L 个传感器的局部估计 x̂ᵢ（方差 Pᵢ），在最小均方误差准则下，线性加权融合估计为：

x̂ = Σ Wᵢ x̂ᵢ， 其中权重 Wᵢ = Pᵢ⁻¹ / Σ Pⱼ⁻¹

结论：
1. 方差越小的传感器权重越大，符合直觉；
2. 融合后方差 P = (Σ Pᵢ⁻¹)⁻¹，恒小于任一局部方差；
3. 若各传感器噪声相关，最优权重需用互协方差矩阵修正，经典标量权重公式不再最优。',3,'course',2,'2026-09-19 14:51:39');

INSERT IGNORE INTO announcements (id,course_id,content,created_at) VALUES
  (1,1,'本周重点：UKF 的无迹变换与 Sigma 点选取，请完成课后作业并做一遍知识点自测。','2026-09-19 14:51:39');

INSERT IGNORE INTO assignments (id,course_id,title,content,due_at,full_score,created_at) VALUES
  (1,1,'实验一：卡尔曼滤波状态估计方差对比','用 MATLAB 或 Python 复现课件中的仿真：
1. 建立线性系统模型，生成三路传感器观测；
2. 分别给出三路传感器的状态估计方差曲线；
3. 与融合后的方差曲线对比，说明融合带来的精度提升。

提交内容：代码 + 方差对比图 + 不超过 500 字的结论分析。',NULL,100,'2026-09-19 14:51:39');

INSERT IGNORE INTO quiz_sets (id,course_id,title,source,scope,kp_ids,created_by,is_published,created_at) VALUES
  (1,1,'第 1 章 · 卡尔曼滤波基础自测','manual','course','[1]',2,1,'2026-09-19 14:51:39');

INSERT IGNORE INTO questions (id,quiz_set_id,qtype,stem,options,answer,analysis,difficulty,kp_id,order_no) VALUES
  (1,1,'single','卡尔曼滤波的卡尔曼增益 K 的物理含义是：','["A. 观测噪声的方差","B. 在预测与观测之间做加权平衡的系数","C. 状态转移矩阵的逆","D. 系统过程噪声的功率谱密度"]','B','本题考查卡尔曼增益的物理意义。正确选项 B 正确，因为增益 K = P⁻Hᵀ(HP⁻Hᵀ+R)⁻¹ 在预测与观测之间做加权平衡：预测不确定就多信观测，观测噪声大就多信预测。选项 A 把增益误当成观测噪声的方差；选项 C 混淆了状态转移矩阵的作用；选项 D 则把过程噪声谱密度与增益混为一谈。',2,1,0),
  (2,1,'judge','当过程噪声方差 Q 增大时，卡尔曼增益会相应减小。','["对","错"]','错','该说法错误。Q 增大意味着更不信任预测模型，预测协方差 P⁻ 变大，卡尔曼增益随之增大（而非减小），从而更多采纳观测值。判断这类题要抓住「谁变大→谁被更信任→增益往哪边移」这条因果链。',2,1,1),
  (3,1,'multi','卡尔曼滤波的适用前提包括：','["A. 系统为线性系统","B. 过程噪声与观测噪声为高斯白噪声","C. 噪声之间互不相关","D. 系统必须是时不变的"]','ABC','经典卡尔曼滤波要求线性系统、高斯白噪声且互不相关，但并不要求时不变——时变系统同样可以逐步递推。故 D 错误，选 ABC。',3,1,2),
  (4,1,'single','融合前后状态估计方差的关系是：','["A. 融合后方差等于各传感器方差的算术平均","B. 融合后方差大于最小单传感器方差","C. 融合后方差小于任一单传感器方差","D. 二者没有确定关系"]','C','按最小均方误差准则，P = (Σ Pᵢ⁻¹)⁻¹，即各传感器信息量（方差倒数）之和的倒数，必然小于任何一个单独的 Pᵢ。这正是多传感器融合提升精度的理论依据。故选 C。',3,1,3);
