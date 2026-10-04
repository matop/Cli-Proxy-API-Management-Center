/**
 * 额度水位条（原 QuotaProgressBar 的类型化后继）。
 *
 * dataviz 语法：细轨道退居背景，填充色按 quotaLevel.ts 的共享分档（与仪表盘一致）：
 * healthy → High，medium → Medium，low → Low（琥珀）。exhausted 宽度为 0，填充不可见。
 * percent === null 渲染空轨道 —— 未知不着色（Medium 类在 width 0 下不可见，行为与旧版一致）。
 * `index` 写入 `--meter-index`，供全页外衣做逐行入场级差；紧凑外衣不消费该变量。
 */

import type { CSSProperties } from 'react';
import { quotaLevel, type QuotaLevel } from '../quotaLevel';
import type { QuotaClassMap } from '../types';

const FILL_CLASS: Record<QuotaLevel, keyof QuotaClassMap> = {
  unknown: 'quotaBarFillMedium',
  exhausted: 'quotaBarFillLow',
  low: 'quotaBarFillLow',
  medium: 'quotaBarFillMedium',
  healthy: 'quotaBarFillHigh',
};

export interface QuotaMeterProps {
  percent: number | null;
  classes: QuotaClassMap;
  index?: number;
}

export function QuotaMeter({ percent, classes, index }: QuotaMeterProps) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const normalized = percent === null ? null : clamp(percent, 0, 100);
  const fillClass = classes[FILL_CLASS[quotaLevel(normalized)]];
  const widthPercent = Math.round((normalized ?? 0) * 100) / 100;
  const style: CSSProperties & { '--meter-index'?: number } = { width: `${widthPercent}%` };
  if (index !== undefined) {
    style['--meter-index'] = index;
  }

  return (
    <div className={classes.quotaBar}>
      <div className={`${classes.quotaBarFill} ${fillClass}`} style={style} />
    </div>
  );
}
