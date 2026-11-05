import { checkOutput, writeOutput } from './output.mjs';
import { noteLink, rememberLinks } from './note-links.mjs';
import ExcelJS from '@excel.js/exceljs';
import { failure } from './browser.mjs';
import { searchBrowser } from './search-browser.mjs';

function count(value) {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(numeric) ? numeric : value ?? null;
}

function sheet(workbook, name, columns) {
  const result = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  result.columns = columns.map(([header, width]) => ({ header, width }));
  result.getRow(1).font = { bold: true };
  return result;
}

export async function search(options) {
  const { output, keyword } = options;
  await checkOutput(output);
  const { results, requestWaitsMs, requestIntervalsMs } = await searchBrowser(options);
  if (!results.length) throw failure('START_PAGE_UNAVAILABLE', 'Search ended before the requested start page.');
  const workbook = new ExcelJS.Workbook();
  const notes = sheet(workbook, '笔记', [
    ['搜索词', 20], ['页码', 10], ['页内笔记序号', 16], ['笔记 ID', 28], ['标题', 46], ['类型', 12],
    ['作者昵称', 22], ['作者 ID', 28], ['作者头像 URL', 42], ['点赞', 12], ['收藏', 12],
    ['评论', 12], ['分享', 12], ['封面 URL', 48], ['封面宽', 12], ['封面高', 12], ['图片列表', 48], ['笔记链接', 60]
  ]);
  const summary = sheet(workbook, '搜索记录', [['字段', 22], ['值', 60]]);
  summary.addRow(['搜索词', keyword]);
  summary.addRow(['采集时间 UTC', new Date().toISOString()]);
  summary.addRow(['请求页码', options.startPage + '–' + (options.startPage + (options.pages - 1))]);
  summary.addRow(['实际页码', results.map(result => result.page).join(', ')]);
  summary.addRow(['每页请求条数', 20]);
  summary.addRow(['排序依据', options.selections.find(item => item.type === 'sort_type')?.label ?? '综合']);
  for (const selection of options.selections.filter(item => item.type !== 'sort_type')) {
    summary.addRow([selection.group, selection.label]);
  }
  summary.addRow(['还有后续结果', results.at(-1).has_more ? '是' : '否']);
  let otherItems = 0;
  for (const { page, items } of results) {
    let rank = 0;
    for (const item of items) {
      if (item.model_type !== 'note' || !item.note_card) {
        otherItems++;
        continue;
      }
      const { display_title, type, user, interact_info, cover, image_list } = item.note_card;
      notes.addRow([
        keyword, page, ++rank, item.id, display_title, type, user?.nickname || user?.nick_name,
        user?.user_id, user?.avatar, count(interact_info?.liked_count), count(interact_info?.collected_count),
        count(interact_info?.comment_count), count(interact_info?.shared_count), cover?.url_default || cover?.url_pre,
        cover?.width, cover?.height, image_list?.length ? JSON.stringify(image_list).slice(0, 32767) : null,
        { text: noteLink(item.id, item.xsec_token), hyperlink: noteLink(item.id, item.xsec_token) }
      ]);
    }
  }
  notes.autoFilter = { from: 'A1', to: 'R' + notes.rowCount };
  summary.addRow(['笔记条数', notes.rowCount - 1]);
  summary.addRow(['非笔记卡片数', otherItems]);
  await writeOutput(output, Buffer.from(await workbook.xlsx.writeBuffer()));
  const warnings = [];
  try {
    await rememberLinks(results.flatMap(result => result.items));
  } catch {
    warnings.push('NOTE_LINK_CACHE_FAILED');
  }
  return {
    keyword, output, warnings, noteCount: notes.rowCount - 1, otherItems,
    pages: results.map(result => result.page), hasMore: results.at(-1).has_more, requestWaitsMs, requestIntervalsMs
  };
}
