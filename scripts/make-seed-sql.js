#!/usr/bin/env node
/**
 * 生成种子数据 SQL（migrations/0002_seed.sql）
 *
 *   node scripts/make-seed-sql.js
 *
 * 为什么先生成 SQL 而不是运行时插入：
 *   D1 的远程环境只能用 `wrangler d1 execute --file=...` 灌数据，
 *   而密码哈希必须由 WebCrypto 算出来（Worker 里没有 node:crypto 的同等便利）。
 *   所以这里在本地算好哈希，产出一份可直接执行的 .sql。
 *
 * 演示账号密码统一为 demo1234。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashPassword } from '../src/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PASSWORD = 'demo1234';
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const KPS = [
  ['卡尔曼滤波的基本思想',
    '卡尔曼滤波是一种递推的最小方差估计方法。它把系统建模为状态方程与观测方程，' +
    '在每个时刻交替执行「预测」与「更新」两步：\n\n' +
    '- 预测：用状态转移矩阵 F 外推状态与协方差\n' +
    '- 更新：用卡尔曼增益 K 融合观测，修正估计\n\n' +
    '核心公式：K = P⁻Hᵀ(HP⁻Hᵀ+R)⁻¹。卡尔曼增益本质上是在「相信预测」和「相信观测」之间做加权平衡：' +
    '预测协方差大就多信观测，观测噪声大就多信预测。\n\n' +
    '适用前提：系统线性、噪声为互不相关的高斯白噪声。'],
  ['扩展卡尔曼滤波（EKF）',
    '当状态方程或观测方程非线性时，EKF 通过一阶泰勒展开在工作点附近做线性化：\n\n' +
    '- 用雅可比矩阵 F_k = ∂f/∂x 代替线性系统的状态转移矩阵\n' +
    '- 用雅可比矩阵 H_k = ∂h/∂x 代替观测矩阵\n\n' +
    'EKF 的优点是计算量小；缺点是：\n' +
    '1. 一阶线性化在强非线性下误差大，甚至发散；\n' +
    '2. 雅可比矩阵需要解析求导，模型复杂时推导困难；\n' +
    '3. 线性化点偏离真值较远时估计精度明显下降。'],
  ['无迹卡尔曼滤波（UKF）与无迹变换',
    'UKF 不使用线性化，而是用「无迹变换（UT）」处理非线性：\n\n' +
    '1. 按确定性规则在均值周围选取 2n+1 个 Sigma 点；\n' +
    '2. 将 Sigma 点直接代入非线性函数传播；\n' +
    '3. 用传播后点集的加权均值与协方差近似后验分布。\n\n' +
    '关键参数：λ = α²(n+κ) − n，α 决定 Sigma 点的散布范围（常取 1e-3 ~ 1）。\n\n' +
    'UKF 能达到二阶以上精度，且无需计算雅可比矩阵，在强非线性场景下优于 EKF。'],
  ['多传感器加权融合准则',
    '对 L 个传感器的局部估计 x̂ᵢ（方差 Pᵢ），在最小均方误差准则下，线性加权融合估计为：\n\n' +
    'x̂ = Σ Wᵢ x̂ᵢ， 其中权重 Wᵢ = Pᵢ⁻¹ / Σ Pⱼ⁻¹\n\n结论：\n' +
    '1. 方差越小的传感器权重越大，符合直觉；\n' +
    '2. 融合后方差 P = (Σ Pᵢ⁻¹)⁻¹，恒小于任一局部方差；\n' +
    '3. 若各传感器噪声相关，最优权重需用互协方差矩阵修正，经典标量权重公式不再最优。'],
];

const longOk =
  '本题考查卡尔曼增益的物理意义。正确选项 B 正确，因为增益 K = P⁻Hᵀ(HP⁻Hᵀ+R)⁻¹ 在预测与观测之间做加权平衡：' +
  '预测不确定就多信观测，观测噪声大就多信预测。选项 A 把增益误当成观测噪声的方差；' +
  '选项 C 混淆了状态转移矩阵的作用；选项 D 则把过程噪声谱密度与增益混为一谈。';
const judgeOk =
  '该说法错误。Q 增大意味着更不信任预测模型，预测协方差 P⁻ 变大，卡尔曼增益随之增大（而非减小），' +
  '从而更多采纳观测值。判断这类题要抓住「谁变大→谁被更信任→增益往哪边移」这条因果链。';

const QUESTIONS = [
  ['single', '卡尔曼滤波的卡尔曼增益 K 的物理含义是：',
    ['A. 观测噪声的方差', 'B. 在预测与观测之间做加权平衡的系数', 'C. 状态转移矩阵的逆',
      'D. 系统过程噪声的功率谱密度'], 'B', longOk, 2],
  ['judge', '当过程噪声方差 Q 增大时，卡尔曼增益会相应减小。', ['对', '错'], '错', judgeOk, 2],
  ['multi', '卡尔曼滤波的适用前提包括：',
    ['A. 系统为线性系统', 'B. 过程噪声与观测噪声为高斯白噪声', 'C. 噪声之间互不相关',
      'D. 系统必须是时不变的'], 'ABC',
    '经典卡尔曼滤波要求线性系统、高斯白噪声且互不相关，但并不要求时不变——时变系统同样可以逐步递推。' +
    '故 D 错误，选 ABC。', 3],
  ['single', '融合前后状态估计方差的关系是：',
    ['A. 融合后方差等于各传感器方差的算术平均', 'B. 融合后方差大于最小单传感器方差',
      'C. 融合后方差小于任一单传感器方差', 'D. 二者没有确定关系'], 'C',
    '按最小均方误差准则，P = (Σ Pᵢ⁻¹)⁻¹，即各传感器信息量（方差倒数）之和的倒数，' +
    '必然小于任何一个单独的 Pᵢ。这正是多传感器融合提升精度的理论依据。故选 C。', 3],
];

const pw = await hashPassword(PASSWORD);
const T = now();

const lines = [];
lines.push('-- ============================================================================');
lines.push('--  LearnHub 种子数据（由 scripts/make-seed-sql.js 生成，请勿手改）');
lines.push('--  演示账号密码统一为 demo1234');
lines.push('--  应用： npx wrangler d1 execute learnhub --local  --file=./migrations/0002_seed.sql');
lines.push('--         npx wrangler d1 execute learnhub --remote --file=./migrations/0002_seed.sql');
lines.push('-- ============================================================================');
lines.push('');
lines.push('-- 幂等：已存在则跳过');
lines.push("INSERT OR IGNORE INTO users (id,email,name,role,is_admin,password_hash,school,student_no,is_active,created_at) VALUES");
lines.push(`  (1,'admin@demo.edu','平台管理员','teacher',1,${q(pw)},'山西农业大学软件学院',NULL,1,${q(T)}),`);
lines.push(`  (2,'teacher@demo.edu','张明','teacher',0,${q(pw)},'山西农业大学软件学院',NULL,1,${q(T)}),`);
lines.push(`  (3,'student@demo.edu','李小凡','student',0,${q(pw)},'山西农业大学软件学院','2026S001',1,${q(T)});`);
lines.push('');
lines.push("INSERT OR IGNORE INTO courses (id,title,description,cover_emoji,join_code,teacher_id,is_published,created_at) VALUES");
lines.push(`  (1,'多传感器信息融合滤波技术','卡尔曼滤波 / EKF / UKF 与多传感器加权融合，含状态估计方差对比实验。','🛰️','DEMO01',2,1,${q(T)});`);
lines.push('');
lines.push("INSERT OR IGNORE INTO enrollments (course_id,student_id,created_at) VALUES (1,3," + q(T) + ');');
lines.push('');
lines.push('-- 知识点');
lines.push('INSERT OR IGNORE INTO knowledge_points (id,course_id,title,content,order_no,scope,created_by,created_at) VALUES');
KPS.forEach(([title, content], i) => {
  const end = i === KPS.length - 1 ? ';' : ',';
  lines.push(`  (${i + 1},1,${q(title)},${q(content)},${i},'course',2,${q(T)})${end}`);
});
lines.push('');
lines.push('-- 公告');
lines.push(`INSERT OR IGNORE INTO announcements (id,course_id,content,created_at) VALUES`);
lines.push(`  (1,1,'本周重点：UKF 的无迹变换与 Sigma 点选取，请完成课后作业并做一遍知识点自测。',${q(T)});`);
lines.push('');
lines.push('-- 作业');
lines.push('INSERT OR IGNORE INTO assignments (id,course_id,title,content,due_at,full_score,created_at) VALUES');
lines.push('  (1,1,' + q('实验一：卡尔曼滤波状态估计方差对比') + ',' +
  q('用 MATLAB 或 Python 复现课件中的仿真：\n1. 建立线性系统模型，生成三路传感器观测；\n' +
    '2. 分别给出三路传感器的状态估计方差曲线；\n3. 与融合后的方差曲线对比，说明融合带来的精度提升。\n\n' +
    '提交内容：代码 + 方差对比图 + 不超过 500 字的结论分析。') +
  `,NULL,100,${q(T)});`);
lines.push('');
lines.push('-- 试题');
lines.push('INSERT OR IGNORE INTO quiz_sets (id,course_id,title,source,scope,kp_ids,created_by,is_published,created_at) VALUES');
lines.push(`  (1,1,'第 1 章 · 卡尔曼滤波基础自测','manual','course','[1]',2,1,${q(T)});`);
lines.push('');
lines.push('INSERT OR IGNORE INTO questions (id,quiz_set_id,qtype,stem,options,answer,analysis,difficulty,kp_id,order_no) VALUES');
QUESTIONS.forEach(([qtype, stem, options, answer, analysis, difficulty], i) => {
  const end = i === QUESTIONS.length - 1 ? ';' : ',';
  lines.push(`  (${i + 1},1,${q(qtype)},${q(stem)},${q(JSON.stringify(options))},${q(answer)},${q(analysis)},${difficulty},1,${i})${end}`);
});
lines.push('');

const out = path.join(ROOT, 'migrations', '0002_seed.sql');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`已生成 ${out}`);
console.log(`  教师/学生/管理员 3 个账号，密码 ${PASSWORD}`);
console.log(`  1 门课程（邀请码 DEMO01）、${KPS.length} 个知识点、1 份作业、1 套 ${QUESTIONS.length} 题试卷`);
