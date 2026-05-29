import { firstParagraph } from "./markdown.js";

export function normalizedTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[#>*\-\d.、\s]+/, "")
    .trim();
}

const actionWords = [
  "修复",
  "处理",
  "解决",
  "实现",
  "新增",
  "接入",
  "支持",
  "调整",
  "优化",
  "重构",
  "排查",
  "定位",
  "验证",
  "提交",
  "推送",
  "删除",
  "生成",
  "恢复",
  "限制",
  "禁止",
  "拦截",
  "迁移",
  "保存",
  "同步"
];

const problemWords = [
  "问题",
  "异常",
  "错误",
  "失败",
  "超时",
  "只读",
  "改约",
  "预约",
  "引导",
  "越界",
  "边界",
  "状态",
  "标题",
  "提交",
  "推送"
];

function hasAny(text, values) {
  return values.some((value) => text.includes(value));
}

function stripNoise(value) {
  return normalizedTitle(value)
    .replace(/^用户反馈截图[:：]\s*/, "")
    .replace(/^用户反馈[:：]\s*/, "")
    .replace(/^截图[:：]\s*/, "")
    .replace(/^问题[:：]\s*/, "")
    .trim();
}

function firstTechTerm(text) {
  const matches = normalizedTitle(text).match(/\b[A-Za-z][A-Za-z0-9_./-]{2,}\b/g) || [];
  return matches.find((item) => ![
    "agent",
    "main",
    "PROMPT",
    "AGENT",
    "SOP",
    "Git",
    "GitLab",
    "Handoff",
    "Capsule"
  ].includes(item)) || "";
}

function domainTitle(text) {
  const source = normalizedTitle(text);
  const term = firstTechTerm(source);
  if (!term) return "";

  if (source.includes("只读") && /改约|重新约|预约/.test(source) && /修复|处理|解决|定位|禁止|禁改约|边界/.test(source)) {
    return trimTitle(`${term} 只读边界与改约引导修复`, 32);
  }

  if (source.includes("只读") && /修复|处理|解决|定位|边界/.test(source)) {
    return trimTitle(`${term} 只读边界修复`, 32);
  }

  if (/标题/.test(source) && /生成|提炼|摘要|上下文/.test(source)) {
    return trimTitle(`${term} 上下文标题生成`, 32);
  }

  return "";
}

function actionTitle(text) {
  const source = normalizedTitle(text);
  const actionMatch = source.match(/^针对(.+?)(?:\s*[（(][^（）()]{0,80}[）)]\s*)?(?:做了|进行了|完成了|处理了)(.+?)(?:[。.!；;]|$)/);
  if (actionMatch) {
    return trimTitle(`${actionMatch[1]}${actionMatch[2]}`, 32);
  }

  const fixMatch = source.match(/(?:修复|解决|处理|排查|定位)(.+?)(?:[。.!；;]|$)/);
  if (fixMatch) {
    const term = firstTechTerm(source);
    return trimTitle(`${term ? `${term} ` : ""}${fixMatch[0]}`, 32);
  }

  return "";
}

export function isGenericTitle(value) {
  const text = normalizedTitle(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  return !text || [
    "handoff",
    "capsule",
    "handoff capsule",
    "chat",
    "conversation",
    "会话",
    "会话资产"
  ].includes(text);
}

export function trimTitle(value, max = 32) {
  const text = stripNoise(value)
    .replace(/^[:：,，.。;；\s]+|[:：,，.。;；\s]+$/g, "")
    .replace(/\s*[（(][^（）()]{0,80}[）)]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max) : text;
}

export function titleFromSummary(summary) {
  const text = normalizedTitle(summary);
  if (!text) return "";

  const domain = domainTitle(text);
  if (domain) return domain;

  const action = actionTitle(text);
  if (action) return action;

  const sentence = text.split(/[。.!？?；;]/)[0];
  const clause = stripNoise(sentence).split(/[，,、]/)[0];
  const term = firstTechTerm(text);
  if (term && hasAny(text, problemWords)) {
    const keyword = problemWords.find((word) => text.includes(word));
    return trimTitle(`${term} ${keyword}处理`, 32);
  }
  return trimTitle(clause || sentence || text, 32);
}

function titleScore(title, contextText) {
  const text = normalizedTitle(title);
  if (!text || isGenericTitle(text)) return 0;
  let score = 2;
  if (text.length >= 8 && text.length <= 36) score += 2;
  if (hasAny(text, actionWords)) score += 4;
  if (hasAny(text, problemWords)) score += 2;
  if (firstTechTerm(text)) score += 2;
  if (/^(用户反馈截图|用户反馈|截图|问题)[:：]/.test(text)) score -= 5;
  if (contextText && normalizedTitle(contextText).startsWith(text)) score -= 2;
  return score;
}

export function deriveTitle({ optionTitle, context = {}, input = "", fallback = "未命名会话资产" }) {
  const contextText = [
    context.summary,
    context.currentStep,
    context.nextStep,
    ...(context.decisions || []),
    ...(context.nextActions || []),
    firstParagraph(input)
  ].filter(Boolean).join(" ");

  const generatedCandidates = [
    context.title,
    titleFromSummary(context.summary),
    context.currentStep,
    context.nextStep,
    titleFromSummary(firstParagraph(input))
  ];

  const generated = generatedCandidates
    .map((candidate) => trimTitle(candidate))
    .filter((candidate) => candidate && !isGenericTitle(candidate))
    .sort((a, b) => titleScore(b, contextText) - titleScore(a, contextText))[0] || "";

  const option = trimTitle(optionTitle);
  if (option && !isGenericTitle(option)) {
    const optionScore = titleScore(option, contextText);
    const generatedScore = titleScore(generated, contextText);
    if (!generated || optionScore >= generatedScore - 1) return option;
  }

  for (const candidate of [generated, fallback]) {
    if (isGenericTitle(candidate)) continue;
    const title = trimTitle(candidate);
    if (title) return title;
  }
  return fallback;
}
