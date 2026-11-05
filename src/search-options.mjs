import { parseArgs } from 'node:util';
import { resolve, extname } from 'node:path';
import { failure } from './browser.mjs';

export const filters = {
  sort: ['排序依据', 'sort_type', {
    general: ['综合', 'general'], latest: ['最新', 'time_descending'],
    likes: ['最多点赞', 'popularity_descending'], comments: ['最多评论', 'comment_descending'],
    saves: ['最多收藏', 'collect_descending']
  }],
  'note-type': ['笔记类型', 'filter_note_type', {
    all: ['不限', '不限'], video: ['视频', '视频笔记'], image: ['图文', '普通笔记']
  }],
  'published-within': ['发布时间', 'filter_note_time', {
    all: ['不限', '不限'], day: ['一天内', '一天内'], week: ['一周内', '一周内'],
    'half-year': ['半年内', '半年内']
  }],
  scope: ['搜索范围', 'filter_note_range', {
    all: ['不限', '不限'], viewed: ['已看过', '已看过'], unviewed: ['未看过', '未看过'],
    following: ['已关注', '已关注']
  }],
  distance: ['位置距离', 'filter_pos_distance', {
    all: ['不限', '不限'], city: ['同城', '同城'], nearby: ['附近', '附近']
  }]
};

export function parseSearch(args) {
  const names = ['keyword', 'pages', 'start-page', 'page-size', 'output', ...Object.keys(filters)];
  let values;
  try {
    const parsed = parseArgs({
      args, options: {
        ...Object.fromEntries(names.map(name => [name, { type: 'string' }])),
        json: { type: 'boolean' }
      }, tokens: true
    });
    if (new Set(parsed.tokens.map(t => t.name)).size !== parsed.tokens.length) {
      throw new Error('Duplicate option');
    }
    values = parsed.values;
  } catch (error) {
    throw failure('INVALID_ARGUMENT', error.message);
  }
  const keyword = values.keyword?.trim();
  if (!keyword || !values.output?.trim() || extname(values.output).toLowerCase() !== '.xlsx') {
    throw failure('INVALID_ARGUMENT', 'Provide --keyword and --output FILE.xlsx.');
  }
  const number = (key, fallback) => {
    const raw = values[key] ?? fallback;
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      throw failure('INVALID_ARGUMENT', '--' + key + ' must be a positive integer.');
    }
    return Number(raw);
  };
  const startPage = number('start-page', '1');
  const pages = number('pages', '1');
  if (!Number.isSafeInteger(startPage + (pages - 1))) {
    throw failure('INVALID_ARGUMENT', 'The requested page range is too large.');
  }
  if (number('page-size', '20') !== 20) {
    throw failure('UNSUPPORTED_PAGE_SIZE', 'The web search currently uses 20 notes per page.');
  }
  const selections = [];
  for (const [key, [group, type, choices]] of Object.entries(filters)) {
    const value = values[key] ?? Object.keys(choices)[0];
    if (!Object.hasOwn(choices, value)) {
      throw failure('INVALID_ARGUMENT', '--' + key + ' accepts ' + Object.keys(choices).join(', '));
    }
    if (value !== Object.keys(choices)[0]) {
      selections.push({ group, type, label: choices[value][0], tag: choices[value][1] });
    }
  }
  return { keyword, output: resolve(values.output), startPage, pages, selections };
}
