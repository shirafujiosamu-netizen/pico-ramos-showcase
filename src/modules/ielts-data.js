/* 雅思模块内置数据
   vocab      : 学术高频词（AWL 核心 + 雅思常考话题词）
   writing    : Task 1 / Task 2 题库，official = 官方公开发布的样题原文，mock = 同题型同话题的模拟题
   speaking   : Part 1 / 2 / 3 题库
   listening  : 官方样题场景（音频需自备，此处只登记题型与内容）
   reading    : 官方样题题型与文本主题
   题库来源：ielts.org / British Council 官方免费样题（公开发布，供考生练习用）
*/
window.IELTS_DATA = {

  /* ── 词汇：word | 词性. 释义 ───────────────────────────── */
  vocab: [
    ['abandon', 'v. 放弃，抛弃'],
    ['academic', 'adj. 学术的'],
    ['accelerate', 'v. 加速'],
    ['accessible', 'adj. 可获取的；易接近的'],
    ['accommodate', 'v. 容纳；适应'],
    ['accumulate', 'v. 积累'],
    ['accurate', 'adj. 准确的'],
    ['acquire', 'v. 获得，习得'],
    ['adapt', 'v. 适应'],
    ['adequate', 'adj. 充足的'],
    ['adjust', 'v. 调整'],
    ['advocate', 'v. 提倡'],
    ['aggregate', 'n./v. 总计；合计'],
    ['allocate', 'v. 分配'],
    ['alternative', 'n./adj. 替代方案；可替代的'],
    ['ambiguous', 'adj. 模棱两可的'],
    ['analyse', 'v. 分析'],
    ['annual', 'adj. 年度的'],
    ['apparent', 'adj. 明显的'],
    ['approach', 'n. 方法；v. 着手处理'],
    ['appropriate', 'adj. 恰当的'],
    ['arbitrary', 'adj. 任意的；武断的'],
    ['assess', 'v. 评估'],
    ['assume', 'v. 假定；承担'],
    ['attain', 'v. 达到'],
    ['attribute', 'v. 归因于；n. 特质'],
    ['authority', 'n. 权威；当局'],
    ['available', 'adj. 可获得的'],
    ['benefit', 'n. 益处；v. 受益'],
    ['bias', 'n. 偏见'],
    ['capable', 'adj. 有能力的'],
    ['capacity', 'n. 容量；能力'],
    ['category', 'n. 类别'],
    ['cease', 'v. 停止'],
    ['challenge', 'n./v. 挑战'],
    ['circumstance', 'n. 情况，环境'],
    ['cite', 'v. 引用'],
    ['clarify', 'v. 阐明'],
    ['coherent', 'adj. 连贯的'],
    ['coincide', 'v. 同时发生；一致'],
    ['collapse', 'v./n. 崩溃'],
    ['commence', 'v. 开始'],
    ['commodity', 'n. 商品'],
    ['compatible', 'adj. 兼容的'],
    ['compensate', 'v. 补偿'],
    ['complex', 'adj. 复杂的'],
    ['component', 'n. 组成部分'],
    ['comprehensive', 'adj. 全面的'],
    ['comprise', 'v. 由…构成'],
    ['concept', 'n. 概念'],
    ['conclude', 'v. 得出结论'],
    ['conduct', 'v. 实施；n. 行为'],
    ['confirm', 'v. 确认'],
    ['conflict', 'n./v. 冲突'],
    ['consequence', 'n. 后果'],
    ['considerable', 'adj. 相当大的'],
    ['consist', 'v. 由…组成'],
    ['constant', 'adj. 持续的；不变的'],
    ['constitute', 'v. 构成'],
    ['constrain', 'v. 限制'],
    ['consult', 'v. 咨询'],
    ['consume', 'v. 消耗'],
    ['contemporary', 'adj. 当代的'],
    ['context', 'n. 背景；语境'],
    ['contract', 'n. 合同；v. 收缩'],
    ['contradict', 'v. 反驳；与…矛盾'],
    ['contrast', 'n./v. 对比'],
    ['contribute', 'v. 贡献；促成'],
    ['controversial', 'adj. 有争议的'],
    ['convention', 'n. 惯例；大会'],
    ['convey', 'v. 传达'],
    ['cooperate', 'v. 合作'],
    ['core', 'n. 核心'],
    ['correlate', 'v. 相关联'],
    ['criteria', 'n. 标准（复数）'],
    ['crucial', 'adj. 关键的'],
    ['cumulative', 'adj. 累积的'],
    ['cycle', 'n. 循环'],
    ['debate', 'n./v. 辩论'],
    ['decade', 'n. 十年'],
    ['decline', 'n./v. 下降'],
    ['dedicate', 'v. 投入；献身'],
    ['define', 'v. 定义'],
    ['demonstrate', 'v. 证明；展示'],
    ['denote', 'v. 表示'],
    ['derive', 'v. 源于；获得'],
    ['detect', 'v. 察觉，探测'],
    ['determine', 'v. 决定；确定'],
    ['devote', 'v. 投入'],
    ['diminish', 'v. 减少'],
    ['discipline', 'n. 学科；纪律'],
    ['discrete', 'adj. 离散的；分离的'],
    ['discriminate', 'v. 歧视；区分'],
    ['display', 'v./n. 展示'],
    ['distinct', 'adj. 截然不同的；明显的'],
    ['distort', 'v. 歪曲'],
    ['distribute', 'v. 分发；分布'],
    ['diverse', 'adj. 多样的'],
    ['domain', 'n. 领域'],
    ['domestic', 'adj. 国内的；家庭的'],
    ['dominate', 'v. 主导'],
    ['duration', 'n. 持续时间'],
    ['dynamic', 'adj. 动态的'],
    ['ecological', 'adj. 生态的'],
    ['economic', 'adj. 经济的'],
    ['element', 'n. 元素'],
    ['eliminate', 'v. 消除'],
    ['emerge', 'v. 出现'],
    ['emphasis', 'n. 强调'],
    ['empirical', 'adj. 实证的'],
    ['enable', 'v. 使能够'],
    ['encounter', 'v./n. 遭遇'],
    ['enhance', 'v. 增强'],
    ['enormous', 'adj. 巨大的'],
    ['ensure', 'v. 确保'],
    ['entity', 'n. 实体'],
    ['environment', 'n. 环境'],
    ['equivalent', 'adj./n. 等同的；等价物'],
    ['erode', 'v. 侵蚀'],
    ['establish', 'v. 建立'],
    ['estimate', 'v./n. 估计'],
    ['ethics', 'n. 伦理'],
    ['evaluate', 'v. 评估'],
    ['evident', 'adj. 明显的'],
    ['evolve', 'v. 演变'],
    ['exceed', 'v. 超过'],
    ['exclude', 'v. 排除'],
    ['expand', 'v. 扩张'],
    ['expenditure', 'n. 支出'],
    ['exploit', 'v. 利用；剥削'],
    ['explore', 'v. 探索'],
    ['expose', 'v. 暴露；使接触'],
    ['extend', 'v. 延伸'],
    ['external', 'adj. 外部的'],
    ['extract', 'v. 提取'],
    ['facilitate', 'v. 促进'],
    ['factor', 'n. 因素'],
    ['feature', 'n. 特征'],
    ['finance', 'n. 财政；v. 资助'],
    ['flexible', 'adj. 灵活的'],
    ['fluctuate', 'v. 波动'],
    ['focus', 'n./v. 焦点；聚焦'],
    ['foundation', 'n. 基础'],
    ['framework', 'n. 框架'],
    ['function', 'n./v. 功能；运作'],
    ['generate', 'v. 产生'],
    ['globalisation', 'n. 全球化'],
    ['guarantee', 'v./n. 保证'],
    ['hierarchy', 'n. 等级制度'],
    ['identify', 'v. 识别'],
    ['impact', 'n./v. 影响'],
    ['implement', 'v. 实施'],
    ['imply', 'v. 暗示'],
    ['incentive', 'n. 激励'],
    ['indicate', 'v. 表明'],
    ['individual', 'n./adj. 个人；个体的'],
    ['induce', 'v. 诱发'],
    ['inevitable', 'adj. 不可避免的'],
    ['infrastructure', 'n. 基础设施'],
    ['inherent', 'adj. 固有的'],
    ['initial', 'adj. 最初的'],
    ['innovation', 'n. 创新'],
    ['instance', 'n. 实例'],
    ['institute', 'n. 机构；v. 设立'],
    ['integrate', 'v. 整合'],
    ['intensity', 'n. 强度'],
    ['interpret', 'v. 解读'],
    ['invest', 'v. 投资'],
    ['involve', 'v. 涉及'],
    ['issue', 'n. 议题；v. 发布'],
    ['legislation', 'n. 立法'],
    ['maintain', 'v. 维持；主张'],
    ['major', 'adj. 主要的'],
    ['manipulate', 'v. 操纵'],
    ['mechanism', 'n. 机制'],
    ['method', 'n. 方法'],
    ['migrate', 'v. 迁移'],
    ['minimise', 'v. 使最小化'],
    ['monitor', 'v. 监测'],
    ['motivate', 'v. 激励'],
    ['negative', 'adj. 负面的'],
    ['nevertheless', 'adv. 然而'],
    ['norm', 'n. 规范；常态'],
    ['obtain', 'v. 获得'],
    ['obvious', 'adj. 明显的'],
    ['occupy', 'v. 占据'],
    ['occur', 'v. 发生'],
    ['participate', 'v. 参与'],
    ['perceive', 'v. 感知；认为'],
    ['percent', 'n. 百分比'],
    ['period', 'n. 时期'],
    ['perspective', 'n. 视角'],
    ['phenomenon', 'n. 现象'],
    ['policy', 'n. 政策'],
    ['positive', 'adj. 积极的；正面的'],
    ['potential', 'n./adj. 潜力；潜在的'],
    ['precise', 'adj. 精确的'],
    ['predominant', 'adj. 占主导的'],
    ['preliminary', 'adj. 初步的'],
    ['principle', 'n. 原则'],
    ['priority', 'n. 优先事项'],
    ['proceed', 'v. 继续进行'],
    ['process', 'n. 过程'],
    ['promote', 'v. 促进；推广'],
    ['proportion', 'n. 比例'],
    ['pursue', 'v. 追求；从事'],
    ['radical', 'adj. 激进的；根本的'],
    ['reinforce', 'v. 加强'],
    ['reluctant', 'adj. 不情愿的'],
    ['require', 'v. 需要；要求'],
    ['research', 'n./v. 研究'],
    ['resident', 'n. 居民'],
    ['resolve', 'v. 解决'],
    ['resource', 'n. 资源'],
    ['respond', 'v. 回应'],
    ['restrict', 'v. 限制'],
    ['retain', 'v. 保留'],
    ['reveal', 'v. 揭示'],
    ['revenue', 'n. 收入（政府/企业）'],
    ['reverse', 'v. 逆转'],
    ['role', 'n. 角色；作用'],
    ['rural', 'adj. 农村的'],
    ['scenario', 'n. 情景；设想'],
    ['schedule', 'n. 日程'],
    ['scope', 'n. 范围'],
    ['section', 'n. 部分'],
    ['sector', 'n. 部门；行业'],
    ['secure', 'adj./v. 安全的；获得'],
    ['seek', 'v. 寻求'],
    ['segment', 'n. 部分；细分'],
    ['sequence', 'n. 顺序'],
    ['shift', 'n./v. 转变'],
    ['significant', 'adj. 显著的'],
    ['similar', 'adj. 相似的'],
    ['simulate', 'v. 模拟'],
    ['source', 'n. 来源'],
    ['specific', 'adj. 具体的'],
    ['stable', 'adj. 稳定的'],
    ['strategy', 'n. 策略'],
    ['stress', 'n./v. 压力；强调'],
    ['structure', 'n. 结构'],
    ['struggle', 'v./n. 挣扎；奋斗'],
    ['sufficient', 'adj. 充足的'],
    ['summary', 'n. 总结'],
    ['sustainable', 'adj. 可持续的'],
    ['symbol', 'n. 象征'],
    ['target', 'n. 目标'],
    ['tendency', 'n. 趋势；倾向'],
    ['theory', 'n. 理论'],
    ['threat', 'n. 威胁'],
    ['transform', 'v. 转变'],
    ['transition', 'n. 过渡'],
    ['transmit', 'v. 传播'],
    ['trend', 'n. 趋势'],
    ['trigger', 'v. 引发'],
    ['undertake', 'v. 承担；着手'],
    ['urban', 'adj. 城市的'],
    ['utility', 'n. 效用；公用事业'],
    ['utilise', 'v. 利用'],
    ['vary', 'v. 变化'],
    ['vast', 'adj. 广阔的'],
    ['verify', 'v. 核实'],
    ['vulnerable', 'adj. 脆弱的；易受伤的'],
    ['welfare', 'n. 福利'],
    ['whereas', 'conj. 然而；鉴于'],
    ['widespread', 'adj. 广泛的'],

    /* 雅思常考话题词 */
    ['urbanisation', 'n. 城市化'],
    ['emission', 'n. 排放'],
    ['renewable', 'adj. 可再生的'],
    ['fossil', 'n. 化石；adj. 化石的'],
    ['biodiversity', 'n. 生物多样性'],
    ['obesity', 'n. 肥胖'],
    ['sedentary', 'adj. 久坐的'],
    ['chronic', 'adj. 慢性的'],
    ['nutrition', 'n. 营养'],
    ['curriculum', 'n. 课程'],
    ['tuition', 'n. 学费'],
    ['literacy', 'n. 读写能力'],
    ['vocational', 'adj. 职业的'],
    ['automation', 'n. 自动化'],
    ['remote', 'adj. 远程的；偏远的'],
    ['inequality', 'n. 不平等'],
    ['demographic', 'adj. 人口的'],
    ['ageing', 'n./adj. 老龄化'],
    ['poverty', 'n. 贫困'],
    ['subsidy', 'n. 补贴'],
    ['regulation', 'n. 监管'],
    ['surveillance', 'n. 监视'],
    ['privacy', 'n. 隐私'],
    ['addiction', 'n. 上瘾'],
    ['peer', 'n. 同龄人'],
    ['adolescent', 'n. 青少年'],
    ['cognitive', 'adj. 认知的'],
    ['creativity', 'n. 创造力'],
    ['efficiency', 'n. 效率'],
    ['productivity', 'n. 生产力'],
    ['unemployment', 'n. 失业'],
    ['commute', 'v./n. 通勤'],
    ['congestion', 'n. 拥堵'],
    ['pedestrian', 'n. 行人'],
    ['heritage', 'n. 遗产'],
    ['tourism', 'n. 旅游业'],
    ['consumer', 'n. 消费者'],
    ['retailer', 'n. 零售商'],
    ['penalty', 'n. 惩罚'],
    ['deterrent', 'n. 威慑因素'],
    ['rehabilitation', 'n. 康复；改造'],
    ['offender', 'n. 违法者'],
    ['juvenile', 'adj. 青少年的'],
    ['prevention', 'n. 预防'],
    ['awareness', 'n. 意识'],
    ['campaign', 'n. 运动（社会/宣传）'],
    ['volunteer', 'n./v. 志愿者；自愿做']
  ],

  /* ── 写作题库 ────────────────────────────────────────────
     src: official = 官方公开发布的样题原文（ielts.org / British Council）
          mock     = 同题型同话题的模拟题                            */
  writing: [
    /* Task 1 —— 官方样题 */
    { id: 'wt1', task: 'T1', src: 'official', type: '柱状图', from: 'BC Academic Writing Sample 1A',
      prompt: 'The chart below shows the number of men and women in further education in Britain in three periods and whether they were studying full-time or part-time. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.' },
    { id: 'wt2', task: 'T1', src: 'official', type: '折线图', from: 'BC Academic Writing Sample 1B',
      prompt: 'The graph below shows radio and television audiences throughout the day in 1992. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.' },
    { id: 'wt3', task: 'T1', src: 'official', type: '流程图', from: 'BC Academic Writing Sample 1C',
      prompt: 'The diagram below shows the process by which bricks are manufactured for the building industry. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.' },
    { id: 'wt4', task: 'T1', src: 'official', type: '表格', from: 'ielts.org Academic Writing Sample',
      prompt: 'The table below gives information about the percentage of the population by age group in one town who rode a bicycle in June 2011. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.' },

    /* Task 1 —— 模拟题 */
    { id: 'wt5', task: 'T1', src: 'mock', type: '柱状图', from: '模拟题',
      prompt: 'The bar chart shows the proportion of households with access to the internet in five countries in 2010 and 2020. Summarise the information by selecting and reporting the main features.' },
    { id: 'wt6', task: 'T1', src: 'mock', type: '折线图', from: '模拟题',
      prompt: 'The line graph shows changes in the number of international students at three universities between 2005 and 2020. Summarise the information by selecting and reporting the main features.' },
    { id: 'wt7', task: 'T1', src: 'mock', type: '饼图', from: '模拟题',
      prompt: 'The pie charts compare household expenditure patterns in two different years. Summarise the information by selecting and reporting the main features.' },
    { id: 'wt8', task: 'T1', src: 'mock', type: '表格', from: '模拟题',
      prompt: 'The table shows the average commuting time and preferred transport mode in four cities. Summarise the information by selecting and reporting the main features.' },
    { id: 'wt9', task: 'T1', src: 'mock', type: '流程图', from: '模拟题',
      prompt: 'The diagram illustrates how recycled paper is produced. Summarise the process by describing the main stages.' },
    { id: 'wt10', task: 'T1', src: 'mock', type: '地图', from: '模拟题',
      prompt: 'The maps show the layout of a town centre in 1990 and its present-day layout. Summarise the changes by selecting and reporting the main features.' },
    { id: 'wt11', task: 'T1', src: 'mock', type: '混合图', from: '模拟题',
      prompt: 'The chart and table together show energy consumption and sources in one European country over 30 years. Summarise the information by selecting and reporting the main features.' },
    { id: 'wt12', task: 'T1', src: 'mock', type: '柱状图', from: '模拟题',
      prompt: 'The bar chart compares the percentage of men and women aged 25–64 participating in regular sport in six regions. Summarise the information and make comparisons.' },

    /* Task 2 —— 官方样题 */
    { id: 'wt20', task: 'T2', src: 'official', type: '同意与否', from: 'BC Academic Writing Sample 2A',
      prompt: 'Children who are brought up in families that do not have large amounts of money are better prepared to deal with the problems of adult life than children brought up by wealthy parents. To what extent do you agree or disagree with this opinion?' },
    { id: 'wt21', task: 'T2', src: 'official', type: '利弊比较', from: 'BC Academic Writing Sample 2B',
      prompt: 'International tourism has brought enormous benefit to many places. At the same time, there is concern about its impact on local inhabitants and the environment. Do the disadvantages of international tourism outweigh the advantages?' },
    { id: 'wt22', task: 'T2', src: 'official', type: '同意与否', from: 'ielts.org Academic Writing Sample',
      prompt: 'Scientific research should be carried out and controlled by governments, rather than by private companies. To what extent do you agree or disagree?' },

    /* Task 2 —— 模拟题：教育 */
    { id: 'wt30', task: 'T2', src: 'mock', type: '同意与否', from: '模拟题 · 教育',
      prompt: 'Some people believe that university education should be free for all students. To what extent do you agree or disagree?' },
    { id: 'wt31', task: 'T2', src: 'mock', type: '双边讨论', from: '模拟题 · 教育',
      prompt: 'Some people think schools should group students by ability, while others believe mixed-ability classes are better. Discuss both views and give your own opinion.' },
    { id: 'wt32', task: 'T2', src: 'mock', type: '利弊比较', from: '模拟题 · 教育',
      prompt: 'More students now choose to study abroad. Do the advantages of this trend outweigh the disadvantages?' },
    /* 科技 */
    { id: 'wt33', task: 'T2', src: 'mock', type: '双边讨论', from: '模拟题 · 科技',
      prompt: 'Some people think technology has made our lives simpler, while others believe it has made life more complicated. Discuss both views and give your opinion.' },
    { id: 'wt34', task: 'T2', src: 'mock', type: '同意与否', from: '模拟题 · 科技',
      prompt: 'Children nowadays spend too much time on electronic devices. What problems does this cause, and what solutions can you suggest?' },
    { id: 'wt35', task: 'T2', src: 'mock', type: '利弊比较', from: '模拟题 · 科技',
      prompt: 'Remote work has become increasingly common. Do the advantages of working from home outweigh the disadvantages?' },
    /* 环境 */
    { id: 'wt36', task: 'T2', src: 'mock', type: '问题解决', from: '模拟题 · 环境',
      prompt: 'Many countries face serious water shortages. What are the causes of this problem, and what measures can be taken to address it?' },
    { id: 'wt37', task: 'T2', src: 'mock', type: '同意与否', from: '模拟题 · 环境',
      prompt: 'Some people argue that individuals cannot affect environmental problems and only governments and large companies can make a difference. To what extent do you agree or disagree?' },
    /* 社会与人口 */
    { id: 'wt38', task: 'T2', src: 'mock', type: '利弊比较', from: '模拟题 · 社会',
      prompt: 'In many countries, the proportion of older people is steadily increasing. Discuss the advantages and disadvantages of this trend.' },
    { id: 'wt39', task: 'T2', src: 'mock', type: '双边讨论', from: '模拟题 · 社会',
      prompt: 'Some people believe that people who commit crimes should be punished with long prison sentences, while others think education and training are more effective. Discuss both views and give your opinion.' },
    /* 工作与经济 */
    { id: 'wt40', task: 'T2', src: 'mock', type: '同意与否', from: '模拟题 · 工作',
      prompt: 'Some people think that a person\'s salary should reflect their contribution to society rather than their job title. To what extent do you agree or disagree?' },
    { id: 'wt41', task: 'T2', src: 'mock', type: '问题解决', from: '模拟题 · 工作',
      prompt: 'Automation is replacing many jobs. What problems does this create, and how can governments and individuals respond?' },
    /* 交通与城市 */
    { id: 'wt42', task: 'T2', src: 'mock', type: '双边讨论', from: '模拟题 · 城市',
      prompt: 'Some people think governments should invest more in public transport rather than building new roads. Discuss both views and give your opinion.' },
    /* 文化与全球化 */
    { id: 'wt43', task: 'T2', src: 'mock', type: '利弊比较', from: '模拟题 · 文化',
      prompt: 'Globalisation has made many traditional cultures disappear. Do the advantages of a global culture outweigh the loss of local traditions?' },
    /* 健康 */
    { id: 'wt44', task: 'T2', src: 'mock', type: '问题解决', from: '模拟题 · 健康',
      prompt: 'Rates of obesity among children have risen sharply in recent decades. What are the causes, and what solutions would you suggest?' },
    /* 媒体与广告 */
    { id: 'wt45', task: 'T2', src: 'mock', type: '同意与否', from: '模拟题 · 媒体',
      prompt: 'Advertising aimed at children should be banned. To what extent do you agree or disagree?' },
    /* 政府与资金 */
    { id: 'wt46', task: 'T2', src: 'mock', type: '双边讨论', from: '模拟题 · 政府',
      prompt: 'Some people think governments should spend money on the arts, while others believe this money would be better spent on public services. Discuss both views and give your own opinion.' }
  ],

  /* ── 口语题库 ──────────────────────────────────────────── */
  speaking: {
    p1: [
      'Where is your hometown? What do you like most about it?',
      'Do you work or are you a student? What do you enjoy about it?',
      'What kind of weather do you like? Does the weather affect your mood?',
      'How do you usually spend your weekends?',
      'Do you like reading? What kind of books do you prefer?',
      'Do you enjoy cooking? Who cooks in your family?',
      'What kind of music do you listen to? Has your taste changed?',
      'Do you like taking photos? Why or why not?',
      'How often do you use the internet? What for?',
      'Do you prefer to study alone or with others? Why?',
      'What do you usually do to relax after a busy day?',
      'Do you like animals? Have you ever kept a pet?',
      'How do you usually travel around your city?',
      'Do you enjoy shopping? Where do you usually go?',
      'What is your favourite time of day? Why?',
      'Do you like watching films? What kind do you like?',
      'How do you keep in touch with friends and family?',
      'Do you like sports? Which one do you like most?',
      'Have you ever lived in another city? How was it different?',
      'Do you collect anything? Why do people collect things?',
      'What did you want to be when you were a child?',
      'Do you enjoy learning new things? What would you like to learn?'
    ],
    p2: [
      'Describe a person you admire. You should say who the person is, how you know them, what they have done, and explain why you admire them.',
      'Describe a place you would like to visit. You should say where it is, how you heard about it, what you would do there, and explain why you want to go.',
      'Describe an object that is important to you. You should say what it is, how you got it, how often you use it, and explain why it matters to you.',
      'Describe a memorable event in your life. You should say what happened, when and where it happened, who was there, and explain why it was memorable.',
      'Describe a skill you would like to learn. You should say what it is, why you want to learn it, how you would learn it, and explain what difference it would make.',
      'Describe a book or film that influenced you. You should say what it was, when you experienced it, what it was about, and explain its effect on you.',
      'Describe a change you made in your daily routine. You should say what the change was, why you made it, how difficult it was, and explain how you feel about it now.',
      'Describe a time you helped someone. You should say who you helped, what you did, why they needed help, and explain how you felt afterwards.',
      'Describe your favourite room or space. You should say where it is, what it looks like, what you do there, and explain why you like it.',
      'Describe a journey that took longer than expected. You should say where you were going, what happened, how you dealt with it, and explain how you felt.',
      'Describe an activity you do to stay healthy. You should say what it is, how often you do it, who you do it with, and explain why it works for you.',
      'Describe a piece of technology you use often. You should say what it is, how long you have used it, what you use it for, and explain what you would do without it.',
      'Describe a tradition in your country or family. You should say what it is, when it takes place, who takes part, and explain why it is meaningful.',
      'Describe someone who has influenced your career or study choices. You should say who they are, how you met, what advice they gave, and explain their influence.',
      'Describe a place where you go to study or work. You should say where it is, what it is like, how often you go there, and explain whether it suits you.',
      'Describe a goal you want to achieve. You should say what it is, why you set it, what you have done so far, and explain how you will achieve it.',
      'Describe a time you received good news. You should say what the news was, who told you, how you reacted, and explain why it was important.',
      'Describe a hobby you enjoy. You should say what it is, when you started, how much time you spend on it, and explain what you get out of it.',
      'Describe a meal you particularly enjoyed. You should say what it was, where you had it, who you were with, and explain why you remember it.',
      'Describe an area of nature you like. You should say where it is, what it looks like, what you do there, and explain why you value it.',
      'Describe a difficult decision you made. You should say what the decision was, why it was difficult, what you chose, and explain whether you regret it.',
      'Describe a friend you have known for a long time. You should say how you met, what you do together, what they are like, and explain why the friendship lasts.',
      'Describe a project or task you completed recently. You should say what it was, why you did it, what difficulties you faced, and explain how you felt when it was done.',
      'Describe something you bought that you were pleased with. You should say what it was, where you bought it, why you needed it, and explain why you were happy with it.',
      'Describe a time when you were very busy. You should say when it was, what you had to do, how you managed your time, and explain how you felt afterwards.',
      'Describe a subject you enjoyed at school. You should say what it was, who taught it, what you learned, and explain why you liked it.',
      'Describe a city you have lived in or visited. You should say where it is, what it is famous for, what you did there, and explain your impression of it.',
      'Describe a way you relax after work or study. You should say what you do, when you do it, who you do it with, and explain why it helps you unwind.',
      'Describe an environmental problem you are aware of. You should say what it is, where it occurs, what causes it, and explain what could be done about it.',
      'Describe a person who is very different from you. You should say who they are, how you know them, in what ways you differ, and explain what you learn from them.'
    ],
    p3: [
      'Why do you think people admire celebrities so much?',
      'How has travel changed in your country over the last twenty years?',
      'What skills do you think will be most important in the future?',
      'Do you think children today have more pressure than previous generations?',
      'How important is it to preserve traditional culture in a modern society?',
      'What role should governments play in protecting the environment?',
      'How does technology change the way people communicate?',
      'Why do some people prefer to live in cities rather than the countryside?',
      'What makes a job satisfying besides salary?',
      'How can schools better prepare students for the workplace?',
      'Do you think online education will replace classrooms? Why or why not?',
      'What are the advantages and disadvantages of living in a multicultural society?',
      'How important is it for people to continue learning as adults?',
      'In what ways does advertising influence what people buy?',
      'Do you think people are healthier now than in the past? Why?',
      'How might cities change in the next fifty years?',
      'What can be done to reduce traffic congestion in large cities?',
      'Why do some people choose to work abroad?',
      'How does the media shape public opinion?',
      'What responsibilities do individuals have towards their communities?'
    ]
  },

  /* ── 听力：官方样题场景（BC 公开发布；音频需自备） ────────── */
  listening: [
    { part: 'Part 1', type: '笔记填空 Note Completion', desc: 'Two people discussing second-hand furniture.', src: 'official' },
    { part: 'Part 1', type: '多选 Multiple choice (more than one answer)', desc: 'Two people discussing a guide to a library.', src: 'official' },
    { part: 'Part 2', type: '地图标注 Plan/Map/Diagram Labelling', desc: 'A tour guide describes different places in a US town.', src: 'official' },
    { part: 'Part 2', type: '简答题 Short Answer Questions', desc: 'A representative from a clothing company talks to high school students.', src: 'official' },
    { part: 'Part 3', type: '单选 Multiple Choice (one answer)', desc: 'A student called Judy discusses her research with her tutor and fellow students.', src: 'official' },
    { part: 'Part 3', type: '句子填空 Sentence Completion', desc: 'Two friends discuss studying with the Open University.', src: 'official' },
    { part: 'Part 4', type: '表格填空 Table Completion', desc: 'A university lecturer gives a talk about research into “learner persistence”.', src: 'official' }
  ],

  /* ── 阅读：官方题型与样题主题 ────────────────────────────── */
  reading: [
    { type: 'Multiple Choice (one answer)', desc: 'Passage about older people in the workforce.', src: 'official' },
    { type: 'Multiple Choice (more than one answer)', desc: 'Passage about older people in the workforce.', src: 'official' },
    { type: 'Identifying Information (True/False/Not Given)', desc: 'Passage about the scientist Marie Curie.', src: 'official' },
    { type: 'Note Completion', desc: 'Academic reading passage with gap-fill summary.', src: 'official' },
    { type: 'Matching Headings', desc: 'Match paragraph headings to sections of a passage.', src: 'mock' },
    { type: 'Matching Information', desc: 'Locate specific information across paragraphs.', src: 'mock' },
    { type: 'Summary Completion', desc: 'Complete a summary using words from the text.', src: 'mock' },
    { type: 'Diagram Label Completion', desc: 'Label a diagram described in the passage.', src: 'mock' }
  ],

  /* ── 题型归类（错题本用） ───────────────────────────────── */

  /* ── TTS 朗读文稿（原创模拟稿，非官方原文；UI 会标注「模拟」）── */
  listeningScripts: [
  {
    "id": "ls0",
    "part": "Part 1",
    "title": "Second-hand Furniture",
    "roles": {
      "A": "Emma",
      "B": "Tom"
    },
    "origin": "sim",
    "lines": [
      [
        "A",
        "Tom, you're moving into the new flat next week, aren't you? Do you need any furniture?"
      ],
      [
        "B",
        "I do, actually. I've got absolutely nothing except a bed and my books. I was thinking of buying everything new, but it's so expensive."
      ],
      [
        "A",
        "Have you thought about second-hand? There's a huge furniture shop just off Mill Road. Most of the stuff is in really good condition."
      ],
      [
        "B",
        "I did look online, but a lot of the pieces people are selling need to be collected, and I don't have a car."
      ],
      [
        "A",
        "That's the advantage of that shop. They deliver for fifteen pounds, anywhere in the city."
      ],
      [
        "B",
        "That's not bad. What kind of prices are we talking about?"
      ],
      [
        "A",
        "Well, I got a solid oak desk there for sixty pounds. It had a small scratch on one leg, so they took ten pounds off."
      ],
      [
        "B",
        "Nice. Does that sort of thing happen often, or was that lucky?"
      ],
      [
        "A",
        "They expect you to haggle a bit, especially on anything that's been there for more than a month."
      ],
      [
        "B",
        "Good to know. I need a wardrobe, a bookshelf and probably a small table for the kitchen."
      ],
      [
        "A",
        "You could easily get all three for under a hundred and fifty. And honestly, older furniture was built to last. Modern flat-pack stuff falls apart in two years."
      ],
      [
        "B",
        "True. It feels better too, not throwing everything into landfill."
      ],
      [
        "A",
        "Exactly. So, are you free on Saturday? I can come with you and help you choose."
      ],
      [
        "B",
        "That'd be great. Saturday morning works for me."
      ],
      [
        "A",
        "Perfect. We'll go at ten, before the good stuff goes. And bring cash, they give a small discount for cash."
      ],
      [
        "B",
        "Will do. Thanks, Emma, you're saving me a fortune."
      ]
    ]
  },
  {
    "id": "ls1",
    "part": "Part 1",
    "title": "A Guide to the Library",
    "roles": {
      "A": "Lisa",
      "B": "Omar"
    },
    "origin": "sim",
    "lines": [
      [
        "B",
        "Excuse me, is this the reference desk? I'm a new student and I have no idea how the library works."
      ],
      [
        "A",
        "You've come to the right place. I'm Lisa, one of the librarians. What's your course?"
      ],
      [
        "B",
        "Environmental engineering. First year."
      ],
      [
        "A",
        "Welcome. So the first thing you need is your student card. It's also your library card. You'll need it to borrow anything and to get into the building after seven in the evening."
      ],
      [
        "B",
        "How many books can I take out at once?"
      ],
      [
        "A",
        "Undergraduates can borrow twenty-five items for four weeks. If nobody else has reserved them, you can renew twice, either at this desk or through the online catalogue."
      ],
      [
        "B",
        "And what about journal articles? I'll need those for my first assignment."
      ],
      [
        "A",
        "We subscribe to over forty electronic databases. You can access all of them from the library website, using your normal university login. You don't even have to come into the building."
      ],
      [
        "B",
        "That's convenient. Is there a limit on those?"
      ],
      [
        "A",
        "No limit, though you can't keep them permanently, of course. You can download and save the PDFs you need for your own study."
      ],
      [
        "B",
        "What if the library doesn't have something I need?"
      ],
      [
        "A",
        "Then we use the inter-library loan service. Fill in a request form online, and we'll usually get it from another university within a week."
      ],
      [
        "B",
        "Is there a charge?"
      ],
      [
        "A",
        "No, it's free for students. Last thing: we have twelve group study rooms on the second floor. You can book them online for up to three hours a day, and they're always full in exam season, so book early."
      ],
      [
        "B",
        "I'll remember that. Thanks for your help, Lisa."
      ],
      [
        "A",
        "Any time. And do come to one of the orientation tours. We run them every Tuesday afternoon."
      ]
    ]
  },
  {
    "id": "ls2",
    "part": "Part 2",
    "title": "A Tour of Kingsbury",
    "roles": {
      "A": "Guide"
    },
    "origin": "sim",
    "lines": [
      [
        "A",
        "Good morning, everyone, and welcome to Kingsbury. My name's Diane and I'll be your guide for the next two hours. We're going to start here at the information centre, in the old market square, which as you can see is right in the heart of town."
      ],
      [
        "A",
        "The square has been the centre of Kingsbury's commercial life for over six hundred years. These days the stalls are mostly here on Thursdays and Saturdays, selling local produce."
      ],
      [
        "A",
        "If you look to the north, you'll see the river. Running along its bank is the Old Mill Walk. The mill itself stopped working in the 1950s, and it's now a small museum. It's well worth visiting if you're interested in the town's industrial past."
      ],
      [
        "A",
        "Just to the east of the mill is the theatre, the Kingsbury Playhouse. It was built in 1897 and restored about ten years ago. They put on everything from Shakespeare to modern comedy."
      ],
      [
        "A",
        "Now, if you follow me round to the south side of the square, we come to Central Park. That's the large green area with the bandstand. It's a lovely spot, but the thing to see there is the boating lake. You can hire a rowboat or a pedal boat from April until October."
      ],
      [
        "A",
        "Opposite the park entrance is the public library, a modern building with a cafe on the ground floor. If you need to check your email or just want a coffee, that's the place to go."
      ],
      [
        "A",
        "Finally, to the west, past the shopping street, is the town hall. You can't miss it. It's the building with the clock tower. Guided tours run on Friday afternoons, and the view from the top is excellent on a clear day."
      ],
      [
        "A",
        "So that's the old town. Before we move on, are there any questions?"
      ]
    ]
  },
  {
    "id": "ls3",
    "part": "Part 2",
    "title": "A Talk to High School Students",
    "roles": {
      "A": "Ms Carter"
    },
    "origin": "sim",
    "lines": [
      [
        "A",
        "Thank you for having me. My name's Rachel Carter, and I work for a clothing company called Northbridge. I'm here to tell you a little about the company, and about the opportunities we offer to young people."
      ],
      [
        "A",
        "Northbridge was founded in 1984 by two brothers in a small town in the north of England. For the first fifteen years we made almost nothing but workwear. Strong trousers, jackets, that sort of thing."
      ],
      [
        "A",
        "Everything changed in 1999, when we started using recycled plastic in our fabrics. At the time people thought we were mad. Today, more than half of everything we sell contains some recycled material."
      ],
      [
        "A",
        "We now employ around nine hundred people. About a hundred and twenty of them work in design and product development, and that's the part of the business that's growing fastest."
      ],
      [
        "A",
        "Which brings me to why I'm talking to you. Every summer we take on fifteen interns, aged sixteen to eighteen. The placement lasts six weeks, and you're paid the national minimum wage."
      ],
      [
        "A",
        "You don't need any experience. What we're looking for is curiosity and reliability. Interns work in small teams, and each team is asked to design one garment from scratch and present it to the whole company at the end of the six weeks."
      ],
      [
        "A",
        "Applications open on the first of March and close on the thirtieth of April. There's no formal application form. You send us a one-page letter telling us what you'd like to learn, and if we like your letter, we'll invite you for a short interview in May."
      ],
      [
        "A",
        "I've got some brochures here, and I'm very happy to answer questions."
      ]
    ]
  },
  {
    "id": "ls4",
    "part": "Part 3",
    "title": "Judy Discusses Her Research",
    "roles": {
      "A": "Professor Hale",
      "B": "Judy",
      "C": "Mark"
    },
    "origin": "sim",
    "lines": [
      [
        "A",
        "Right, Judy, you wanted to talk to us about your research proposal for the education module. What's the topic?"
      ],
      [
        "B",
        "I want to look at how effective remote learning is compared with face-to-face teaching, specifically for first-year students."
      ],
      [
        "A",
        "That's a huge area. You'll need to narrow it down considerably. Have you thought about which subject, or which aspect of effectiveness you mean?"
      ],
      [
        "B",
        "I was thinking of exam results, but Mark said that's too simple."
      ],
      [
        "C",
        "Well, results tell you whether people passed, but not whether they actually understood anything. I'd look at something like retention. What do students still remember six months later?"
      ],
      [
        "B",
        "That's a much better way to measure it. So I could give the same test at the end of the course and then again after six months."
      ],
      [
        "A",
        "Good. Now, methodology. How many participants can you realistically get?"
      ],
      [
        "B",
        "I was hoping for around a hundred and twenty. I have access to two large first-year cohorts."
      ],
      [
        "A",
        "That's a healthy sample, but remember you'll need consent from every single participant, and that always takes longer than you expect. I'd allow a month just for that."
      ],
      [
        "B",
        "OK. And how long should the whole project be?"
      ],
      [
        "A",
        "Your deadline is the fifteenth of May. Working backwards, I'd suggest finishing data collection by the end of February at the latest."
      ],
      [
        "B",
        "That's tight but doable. One more thing. Would it be acceptable to use a questionnaire instead of interviews?"
      ],
      [
        "A",
        "For a sample that size, yes. You could do interviews with a smaller subgroup afterwards, perhaps ten students, to add some depth."
      ],
      [
        "B",
        "That's exactly what I hoped to hear. Thank you both."
      ]
    ]
  },
  {
    "id": "ls5",
    "part": "Part 3",
    "title": "Studying with the Open University",
    "roles": {
      "A": "Zoe",
      "B": "Ben"
    },
    "origin": "sim",
    "lines": [
      [
        "B",
        "Zoe, I hear you've signed up for another course with the Open University. Isn't that your third one?"
      ],
      [
        "A",
        "Fourth, actually. I start a psychology module in February."
      ],
      [
        "B",
        "What made you choose them? I thought about it, but I'm not sure I'd have the discipline to study from home."
      ],
      [
        "A",
        "That's what everybody says. The trick is that the timetable is completely flexible. You get your materials at the start of the module, and you work through them at your own pace, as long as you finish by the deadlines."
      ],
      [
        "B",
        "Do you have to go in for exams?"
      ],
      [
        "A",
        "Yes, but only two or three times a year. And you can pick the exam centre. I use one about twenty minutes from my flat."
      ],
      [
        "B",
        "And the fees? Is it cheaper than a normal degree?"
      ],
      [
        "A",
        "Considerably. You pay per module, not per year, and part-time students can usually get a government grant that covers about two thirds of the cost."
      ],
      [
        "B",
        "Is there any actual teaching, or is it just textbooks?"
      ],
      [
        "A",
        "Both, really. Each module has an online forum with a tutor who answers questions, and there are optional tutorials once a month. Some are face-to-face, some are online. You can attend as many as you like."
      ],
      [
        "B",
        "Do people actually finish? I've heard the drop-out rate is enormous."
      ],
      [
        "A",
        "It's higher than at a traditional university, that's true. But most people who drop out do it in the first few weeks, usually because they've underestimated how much reading is involved."
      ],
      [
        "B",
        "How many hours a week would you say?"
      ],
      [
        "A",
        "For a thirty-credit module, plan for ten to twelve. If you treat it like a part-time job rather than a hobby, you'll be fine."
      ]
    ]
  },
  {
    "id": "ls6",
    "part": "Part 4",
    "title": "Research into Learner Persistence",
    "roles": {
      "A": "Dr Patel"
    },
    "origin": "sim",
    "lines": [
      [
        "A",
        "Good afternoon. In today's lecture I want to talk about a topic that has occupied educational researchers for decades: learner persistence. By persistence I mean the ability of a student to continue with a course of study until it's completed."
      ],
      [
        "A",
        "Now, the dropout figures make sobering reading. In many countries, roughly one student in three who begins a degree never finishes it. The financial cost, both to the individual and to the state, is enormous."
      ],
      [
        "A",
        "So what determines whether a student persists? The research points to three main factors. The first is motivation, and specifically what we call intrinsic motivation, the genuine interest in the subject itself. Students who are curious tend to keep going when the work gets hard."
      ],
      [
        "A",
        "The second factor is external support. This means family, employers, and critically, contact with teachers. Studies consistently show that students who feel known by at least one member of staff are far more likely to complete."
      ],
      [
        "A",
        "The third factor is somewhat less obvious. It's time management. Not intelligence, not prior qualifications, but the ability to plan realistically. Students who map out their week in advance drop out at about half the average rate."
      ],
      [
        "A",
        "Our own study followed nine hundred students over four years. We measured their motivation at the start, and then tracked their progress each year. Perhaps unsurprisingly, motivation predicted success reasonably well in the first year. But by the third year, the strongest predictor was not motivation at all. It was the quality of the student's relationship with their tutor."
      ],
      [
        "A",
        "What can institutions do with this? Firstly, build in regular, structured contact, even online. Secondly, teach time management explicitly rather than assuming students will pick it up. And thirdly, identify at-risk students early. In our sample, attendance in the first month predicted final outcome with striking accuracy."
      ],
      [
        "A",
        "Right, let's move on to the methodology behind those findings."
      ]
    ]
  }
],

  readingPassages: [
  {
    "id": "rp0",
    "title": "Staying in Work: The Older Workforce",
    "origin": "sim",
    "paras": [
      "Across most of the developed world, people are working longer than they used to. In 1970, the average retirement age in Western Europe was around 63 for men and 61 for women. Today, those figures have climbed steadily, and in several countries the state pension age will soon reach 67 or beyond. The reasons are not difficult to identify. People are living longer, they are healthier for longer, and the cost of supporting a growing retired population has become a serious burden on public finances.",
      "There is also a strong economic argument for keeping older workers in employment. As birth rates fall, the ratio of workers to pensioners shrinks, and shrinking ratios mean either higher taxes or reduced benefits. Older employees often bring exactly what younger ones lack: deep institutional knowledge, professional networks built over decades, and a steadiness under pressure that comes from experience. Several studies of manufacturing firms in Germany found that productivity in mixed-age teams was higher than in teams composed entirely of workers under 35.",
      "Yet the transition is not without friction. The most persistent problem is skills. A machinist who has spent thirty years mastering a machine that no longer exists has a serious retraining problem, and retraining programmes are often designed for people at the start of their careers. Age discrimination remains a real obstacle too. In one survey, identical job applications were sent to employers, differing only in the date of birth of the applicant. The younger candidate was called to interview roughly forty per cent more often.",
      "Employers who have adapted successfully tend to share certain habits. They offer flexible hours and phased retirement rather than an abrupt stop. They invest in continuous training at every age, not only for new recruits. And they redesign physically demanding roles so that experience is not wasted to a bad back. The Danish logistics company that moved its heaviest manual work to younger staff while shifting its oldest workers into mentoring positions reported both lower injury rates and faster onboarding of new hires.",
      "The conclusion is not that everyone must work until they are 70. It is that age should stop being the organising principle of working life. A 55-year-old who wants to retrain as a nurse and a 62-year-old who wants to paint full-time are both making reasonable choices. What a modern labour market needs is the flexibility to let them do so, and the honesty to admit that the old fixed ladder, climb it or fall off, no longer serves anybody."
    ]
  },
  {
    "id": "rp1",
    "title": "Marie Curie: A Life in Science",
    "origin": "sim",
    "paras": [
      "Marie Curie was born Maria Sklodowska in Warsaw in 1867, the fifth child of two teachers. Poland was then under Russian rule, and women were barred from university. She worked for years as a governess, saving money to help her sister study in Paris, on the understanding that the favour would later be returned. In 1891, at the age of 24, she finally enrolled at the Sorbonne. She lived in an unheated attic and sometimes fainted from hunger, yet finished first in her physics degree within three years.",
      "In Paris she met and married Pierre Curie, a physicist studying crystals. Together they began investigating the strange rays that Henri Becquerel had recently observed coming from uranium ore. Working in a leaking shed, Marie processed tonnes of pitchblende by hand, stirring boiling mixtures with an iron rod almost the size of herself. In 1898 the couple announced two new elements, polonium, named after her homeland, and radium. The word radioactivity, which she coined, would define the rest of her life's work.",
      "In 1903 the Nobel Prize in Physics was awarded to Becquerel, Pierre Curie and Marie. Initially the committee had intended to honour only the two men; Pierre insisted that his wife be included. Three years later, after Pierre was killed by a horse-drawn carriage, Marie took over his chair at the Sorbonne, the first woman to teach there in its 650-year history. In 1911 she won a second Nobel, this time in chemistry, for isolating pure radium and determining its atomic weight. She remains the only person to have received Nobels in two distinct sciences.",
      "The First World War interrupted her research. Convinced that X-rays could locate shrapnel in wounded soldiers, she equipped twenty vehicles as mobile radiography units, learned to drive, and took them to the front herself, along with her seventeen-year-old daughter Irene. She is credited with treating over a million men, though the radiation exposure that eventually killed her was already accumulating.",
      "Curie died in 1934 of aplastic anaemia, almost certainly caused by decades of radiation. Her notebooks are still radioactive and are stored in lead-lined boxes. What she left behind is harder to summarise: two elements, a science, a research institute that still operates, and a standard of determination that has inspired every generation of women in science since. When people call her the most famous female scientist in history, they are not exaggerating. They are only failing to mention that she was one of the greatest scientists, full stop."
    ]
  },
  {
    "id": "rp2",
    "title": "Learner Persistence: Why Students Stay the Course",
    "origin": "sim",
    "paras": [
      "Every year, a substantial minority of students who begin a course of study abandon it before completion. Educational researchers call this phenomenon dropout, and the quality that opposes it is known as persistence. Persistence matters because the costs of abandonment fall on everyone. The student loses time and often money, the institution loses funding, and society loses a trained worker it has already partly paid for. Understanding why some learners persist and others do not has therefore become one of the central questions in the study of education.",
      "One obvious explanation is ability. Students with stronger prior qualifications complete their courses at higher rates, and no serious researcher disputes this. But ability is a poor predictor on its own. Large-scale studies repeatedly find that among students of equivalent academic background, completion rates can differ by a factor of two or more, depending on circumstances that have nothing to do with intelligence. Something else is clearly at work.",
      "The strongest of these something elses is what psychologists call intrinsic motivation, an interest in the subject for its own sake. Students who choose a subject they genuinely want to study are markedly more likely to persist through difficult periods. Motivation, however, is not fixed. It can be supported or destroyed by the way a course is taught. Feedback that is specific and encouraging sustains effort; feedback that is vague or punitive destroys it. The same student, in the hands of two different teachers, can become two different learners.",
      "A second factor is the student's environment outside the classroom. Financial pressure is the most obvious: a student working thirty hours a week in a bar is studying at a severe disadvantage. But emotional support matters just as much. Longitudinal studies following students over four years have found that those who reported having at least one member of staff who knew them by name were roughly half as likely to drop out. The relationship, not the resource, was doing the work.",
      "Perhaps the most practical finding concerns time management. Students who planned their study week in advance, blocking specific hours for specific tasks, dropped out at approximately half the rate of equally motivated students who simply studied when they felt like it. Persistence, it turns out, is less a heroic character trait than a set of ordinary habits. This is encouraging news, because habits can be taught. Courses that explicitly train students in planning, and that check in regularly during the crucial first month, consistently report better completion than courses that leave students to sink or swim."
    ]
  }
],

  mistakeTypes: {
    L: ['单选', '多选', '地图标注', '表格填空', '笔记填空', '句子填空', '简答', '配对'],
    R: ['T/F/NG', 'Y/N/NG', '单选', '匹配段落标题', '匹配信息', '匹配特征', '句子结尾匹配', '摘要填空', '笔记填空', '表格填空', '简答'],
    W: ['Task 1 · 图表描述', 'Task 1 · 流程/地图', 'Task 2 · 同意与否', 'Task 2 · 双边讨论', 'Task 2 · 利弊', 'Task 2 · 问题解决'],
    S: ['Part 1', 'Part 2', 'Part 3']
  },

  skillName: { L: '听力', R: '阅读', W: '写作', S: '口语' }
};
