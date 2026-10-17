// 直播窗频道表：只列前端实测可嵌的频道端点与频道 ID（见 evidence/youtube-live/CHANNELS.md）。
// CNBC 电视同播无官方可嵌流（仅纪录片轮播），经拍板不进版面；CNA 首测时段无在播流，
// 复测结论出来前留待验灰位、不播出。
import type { BriefScope } from "./LiveBrief";

export interface LiveChannel {
  no: string;
  name: string;
  /** live-brief 作用域；待验席为 null。 */
  slug: Exclude<BriefScope, "all"> | null;
  /** YouTube 频道 ID（live_stream 端点）；待验席为 null。 */
  cid: string | null;
  live: boolean;
  fig: string;
}

export const CHANNELS: LiveChannel[] = [
  {
    no: "01", name: "Bloomberg TV", slug: "bloomberg", cid: "UCIALMKvObZNtJ6AmdCLP7Lg", live: true,
    fig: "全球财经电视直播。官方 live_stream 端点实测可嵌入，720p 起播。",
  },
  {
    no: "02", name: "Yahoo Finance", slug: "yahoo", cid: "UCEAZeUIeJs0IjQiqTCdVSIg", live: true,
    fig: "美股盘中直播与市场解读。实测可嵌入，起播后码率自动升至 720p。",
  },
  {
    no: "03", name: "DW News", slug: "dw", cid: "UCknLrEdhRCp1aegoMqRaCZg", live: true,
    fig: "德国之声英语新闻直播，欧洲视角补位。实测可嵌入，720p。",
  },
  {
    no: "04", name: "CNA", slug: null, cid: null, live: false,
    fig: "新加坡亚洲新闻台。首测时段无在播流，已排亚洲日间复测，结论出来前留位待验。",
  },
];
