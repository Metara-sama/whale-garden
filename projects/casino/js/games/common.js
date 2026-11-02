/* 游戏通用小件 */
import { el } from '../core/util.js';

export const resignAction = { k: 'resign', label: '认输', resign: true };

/** 棋盘按钮 */
export function resignBtn(act) {
  return el('button.btn.sm.ghost', { onClick: () => act(resignAction) }, '认输');
}

/** 把一维下标转 "H8" 这类坐标（国际象棋用） */
export const files = 'abcdefgh';
export const sq = (i) => files[i % 8] + (8 - Math.floor(i / 8));

/** 中国象棋坐标 "炮二平五" 太难生成，这里用「H2→E2」的直白写法 */
export const xqName = (i) => {
  const cols = 'abcdefghi';
  return cols[i % 9] + (10 - Math.floor(i / 9));
};

export const other = (i) => (i === 0 ? 1 : 0);

/** 简易计分板 */
export function scoreRow(seat, text) { return { seat, text }; }