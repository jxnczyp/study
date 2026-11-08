export const seedQuestions = [
  { subject: '数学', title: '二次函数的顶点与最值', content: '已知二次函数 y = x² − 4x + 3，求该函数的最小值。', answer: '−1', options: ['−1', '1', '3', '−3'], explanation: '配方得 y = (x − 2)² − 1。因为 (x − 2)² ≥ 0，所以当 x = 2 时，函数取得最小值 −1。', topic: '二次函数', difficulty: '中等', reason: '计算失误', mastered: 0 },
  { subject: '英语', title: '现在完成时的时间标志', content: 'She _____ in this city since 2020.', answer: 'has lived', options: ['lives', 'lived', 'has lived', 'is living'], explanation: 'since + 过去的时间点表示从过去持续到现在，主句使用现在完成时。主语 She 为第三人称单数，因此用 has lived。', topic: '时态与语态', difficulty: '基础', reason: '概念不清', mastered: 0 },
  { subject: '物理', title: '欧姆定律的应用', content: '一个电阻两端的电压为 12 V，通过的电流为 0.5 A，求该电阻的阻值。', answer: '24 Ω', options: ['6 Ω', '12 Ω', '24 Ω', '48 Ω'], explanation: '根据欧姆定律 I = U / R，可得 R = U / I = 12 / 0.5 = 24 Ω。注意单位换算以及公式变形。', topic: '电流与电路', difficulty: '基础', reason: '公式用错', mastered: 0 },
  { subject: '数学', title: '一元一次方程的求解', content: '解方程：3x + 7 = 22。', answer: '5', options: ['3', '5', '7', '9'], explanation: '先在等式两边同时减去 7，得 3x = 15，再同时除以 3，得到 x = 5。', topic: '方程与不等式', difficulty: '基础', reason: '审题疏忽', mastered: 1 },
  { subject: '语文', title: '古诗文名句默写', content: '补全《望岳》中的诗句：“会当凌绝顶，________。”', answer: '一览众山小', options: ['一览众山小', '不畏浮云遮望眼', '独怆然而涕下', '长风破浪会有时'], explanation: '杜甫《望岳》：“会当凌绝顶，一览众山小。”表达了诗人不怕困难、敢于攀登绝顶、俯视一切的雄心和气概。', topic: '古诗文积累', difficulty: '基础', reason: '记忆模糊', mastered: 0 },
  { subject: '数学', title: '勾股定理与直角三角形', content: '一个直角三角形的两条直角边长分别为 6 和 8，求斜边长。', answer: '10', options: ['10', '12', '14', '100'], explanation: '由勾股定理 c² = a² + b² = 6² + 8² = 100，因此斜边 c = 10。', topic: '几何与图形', difficulty: '中等', reason: '概念不清', mastered: 0 },
];

export function generateQuestions(subject, count, difficulty = '中等') {
  return Array.from({ length: count }, (_, i) => {
    const n = Math.floor(Math.random() * 15) + 2;
    const m = Math.floor(Math.random() * 8) + 2;
    let q;
    if (subject === '数学') {
      q = difficulty === '挑战' ? { title: '二次函数变式练习', content: `已知 y = x² − ${2 * n}x + ${n * n - m}，求函数的最小值。`, answer: String(-m), options: [String(-m), String(m), String(n), String(-n - m)], explanation: `配方得 y = (x − ${n})² − ${m}。平方项的最小值为 0，所以函数最小值为 ${-m}。`, topic: '二次函数' } : { title: '方程变式练习', content: `解方程：${m}x + ${n} = ${m * n + n}。`, answer: String(n), options: [String(n), String(n + 1), String(n - 1), String(n + m)], explanation: `两边同时减去 ${n}，得 ${m}x = ${m * n}，再除以 ${m}，得 x = ${n}。`, topic: '方程与不等式' };
    } else if (subject === '物理') {
      q = { title: '欧姆定律变式练习', content: `某电阻的阻值为 ${n} Ω，通过它的电流为 ${m} A，求电阻两端的电压。`, answer: `${n * m} V`, options: [`${n * m} V`, `${n + m} V`, `${n * m + m} V`, `${n * m - m} V`], explanation: `根据欧姆定律 U = IR = ${m} × ${n} = ${n * m} V。`, topic: '电流与电路' };
    } else {
      const pool = seedQuestions.filter(q => q.subject === subject);
      q = { ...pool[i % pool.length] };
    }
    return { ...q, subject, difficulty, id: `generated-${i}`, options: [...new Set(q.options)].sort(() => Math.random() - .5), generated: true };
  });
}
