import type { EventView, ItemView, ViewModel } from '../render/viewModel.js';

/**
 * 대시보드 클라이언트(브라우저). (SPEC-UI-001 REQ-004~009)
 *
 * 워크스페이스 런타임 코드를 전혀 import 하지 않는다(타입만 — 번들 시 소거).
 * /api/data(동일 출처 loopback) 를 fetch 해 JSON 만 소비하고 DOM 을 렌더한다.
 * 가격·D-day·법원 링크·강조 여부는 서버가 계산해 JSON 으로 전달하므로,
 * 이 스크립트에는 외부 URL·포맷 로직 중복이 없다. (AC-05, 결정 D3/D4/D5)
 *
 * 필터는 두 계층이다:
 *  - 서버 필터(워치리스트/이벤트/기간): /api/data 재조회 트리거.
 *  - 클라이언트 필터(지역/용도/가격/검색/정렬): 이미 받은 items 를 메모리에서
 *    거르고 정렬(재조회 없음). 읽기 전용 원칙 유지 — 서버 무변경.
 */

/** 서버 필터 상태(쿼리 파라미터). */
export interface FilterState {
  watchlist: string;
  type: string;
  period: string;
}

/** 기본 서버 필터. */
export function defaultFilters(): FilterState {
  return { watchlist: '', type: '', period: '90' };
}

/** 정렬 키. */
export type SortKey = 'sale' | 'price_asc' | 'discount' | 'failed';

/** 클라이언트(메모리) 필터 상태. */
export interface ItemFilter {
  /** 지역 prefix(region 정확 일치, 빈 문자열=전체). */
  region: string;
  /** 표준 용도 카테고리(빈 문자열=전체). */
  usage: string;
  /** 최저매각가 상한(원). null=무제한. */
  priceMax: number | null;
  /** 사건번호·주소 부분 검색(빈 문자열=전체). */
  search: string;
  /** 정렬 기준. */
  sort: SortKey;
}

/** 기본 클라이언트 필터. */
export function defaultItemFilter(): ItemFilter {
  return { region: '', usage: '', priceMax: null, search: '', sort: 'sale' };
}

/** 이벤트 타입 선택지. */
const TYPE_OPTIONS: readonly [string, string][] = [
  ['', '전체 이벤트'],
  ['new', '신건'],
  ['price_drop', '유찰'],
  ['changed', '변경'],
  ['cancelled', '취하'],
  ['d7', 'D-7'],
  ['d1', 'D-1'],
];

/** 기간 선택지(일). */
const PERIOD_OPTIONS: readonly [string, string][] = [
  ['30', '최근 30일'],
  ['90', '최근 90일'],
  ['365', '최근 1년'],
  ['all', '전체 기간'],
];

/** 가격 상한 선택지(원). */
const PRICE_OPTIONS: readonly [string, string][] = [
  ['', '가격 전체'],
  ['100000000', '1억 이하'],
  ['300000000', '3억 이하'],
  ['500000000', '5억 이하'],
  ['1000000000', '10억 이하'],
];

/** 정렬 선택지. */
const SORT_OPTIONS: readonly [SortKey, string][] = [
  ['sale', '기일 임박순'],
  ['price_asc', '최저가 낮은순'],
  ['discount', '할인율 높은순'],
  ['failed', '유찰 많은순'],
];

/** 요소 생성 헬퍼(텍스트는 textContent 로 안전 삽입). */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}

/** D-day 표시 문자열. */
function ddayText(dday: number | null): string {
  if (dday === null) return '';
  if (dday === 0) return 'D-day';
  if (dday > 0) return `D-${dday}`;
  return `지남 ${Math.abs(dday)}일`;
}

/**
 * 텍스트를 클립보드에 복사한다.
 *
 * 법원경매정보 사이트는 안정적인 딥링크가 없어(courtAuctionUrl 주석 참고)
 * "원문 보기"는 포털 랜딩 페이지로만 이동한다 — 사건번호를 사이트 안의
 * 사건검색에 붙여넣을 수 있도록 복사를 돕는다.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 폴백으로 진행
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** items 에서 지역 선택지(고유·정렬)를 뽑는다. */
export function regionOptions(items: readonly ItemView[]): string[] {
  const set = new Set<string>();
  for (const it of items) if (it.region) set.add(it.region);
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

/** items 에서 용도 카테고리 선택지(고유·정렬)를 뽑는다. */
export function usageOptions(items: readonly ItemView[]): string[] {
  const set = new Set<string>();
  for (const it of items) if (it.usageCategory) set.add(it.usageCategory);
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

/**
 * 클라이언트 필터·정렬을 적용한다(순수).
 *
 * @param items 서버가 보낸 전체 물건.
 * @param f     클라이언트 필터.
 */
export function applyItemFilter(items: readonly ItemView[], f: ItemFilter): ItemView[] {
  const search = f.search.trim().toLowerCase();
  const filtered = items.filter((it) => {
    if (f.region && it.region !== f.region) return false;
    if (f.usage && it.usageCategory !== f.usage) return false;
    if (f.priceMax !== null && (it.minSalePrice === null || it.minSalePrice > f.priceMax)) return false;
    if (search) {
      const hay = `${it.caseNumber} ${it.addressDetail ?? ''} ${it.region ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const sorted = filtered.slice();
  sorted.sort((a, b) => {
    switch (f.sort) {
      case 'price_asc':
        return (a.minSalePrice ?? Infinity) - (b.minSalePrice ?? Infinity);
      case 'discount': {
        // discountPct 는 음수가 클수록(더 할인) 상위. 없으면 뒤로.
        const da = a.enrich ? a.enrich.discountPct : Infinity;
        const db = b.enrich ? b.enrich.discountPct : Infinity;
        return da - db;
      }
      case 'failed':
        return b.failedCount - a.failedCount;
      case 'sale':
      default: {
        // 기일 임박순: dday null 은 뒤로, 지난 것보다 미래 우선(오름차순).
        const va = a.dday ?? Infinity;
        const vb = b.dday ?? Infinity;
        return va - vb;
      }
    }
  });
  return sorted;
}

/** 사건번호 + 복사 버튼을 함께 렌더한다. */
function renderCaseNumber(caseNumber: string): HTMLElement {
  const wrap = el('span', { className: 'case-wrap' });
  wrap.appendChild(el('span', { className: 'case', text: caseNumber }));

  const btn = el('button', { className: 'copy-btn', text: '복사' });
  btn.setAttribute('type', 'button');
  btn.setAttribute('title', '사건번호 복사');
  btn.setAttribute('aria-label', '사건번호 복사');
  btn.addEventListener('click', () => {
    void copyToClipboard(caseNumber).then((ok) => {
      const original = '복사';
      btn.textContent = ok ? '복사됨' : '복사 실패';
      btn.classList.toggle('copied', ok);
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1500);
    });
  });
  wrap.appendChild(btn);
  return wrap;
}

/** 물건 카드 하나를 렌더한다. */
function renderItem(item: ItemView): HTMLElement {
  const card = el('article', { className: 'item' });

  const head = el('div', { className: 'item-head' });
  head.appendChild(renderCaseNumber(item.caseNumber));
  if (item.region) head.appendChild(el('span', { className: 'region-chip', text: item.region }));
  if (item.dday !== null) {
    head.appendChild(el('span', { className: 'dday', text: ddayText(item.dday) }));
  }
  card.appendChild(head);

  const loc = [item.addressDetail, item.usage].filter((v) => !!v).join(' ');
  if (loc) card.appendChild(el('div', { className: 'loc', text: loc }));

  const prices = el('div', { className: 'prices' });
  if (item.appraisedPriceText) {
    prices.appendChild(el('span', { className: 'appraised', text: `감정가 ${item.appraisedPriceText}` }));
  }
  if (item.minSalePriceText) {
    prices.appendChild(el('span', { className: 'minsale', text: `최저가 ${item.minSalePriceText}` }));
  }
  if (item.failedCount > 0) {
    prices.appendChild(el('span', { className: 'failed', text: `유찰 ${item.failedCount}회` }));
  }
  card.appendChild(prices);

  if (item.saleDate) {
    card.appendChild(el('div', { className: 'saledate', text: `매각기일 ${item.saleDate}` }));
  }

  // enrich(할인율) — 존재 시에만. 강조 규칙: emphasize=true 면 굵게(CSS .emph). (REQ-005, 결정 D5)
  if (item.enrich) {
    const line = el('div', { className: 'enrich' });
    line.appendChild(el('span', { text: '실거래 중위값 대비 ' }));
    const disc = el('span', {
      className: item.enrich.emphasize ? 'discount emph' : 'discount',
      text: item.enrich.discountText,
    });
    line.appendChild(disc);
    line.appendChild(
      el('span', {
        text: ` (표본 ${item.enrich.sampleSize}건 · 신뢰도 ${item.enrich.confidence})`,
      }),
    );
    card.appendChild(line);
  }

  // 법원 원문 링크 — 런타임 JSON 에서 주입(빌드 셸에 URL 없음). (REQ-006, 결정 D4)
  const link = el('a', { className: 'court-link', text: '법원 원문 보기' });
  link.setAttribute('href', item.courtUrl);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noreferrer noopener');
  card.appendChild(link);

  return card;
}

/** 이벤트 타임라인 한 줄. */
function renderEvent(ev: EventView): HTMLElement {
  const row = el('li', { className: 'event' });
  row.appendChild(el('span', { className: `badge badge-${ev.type}`, text: ev.label }));
  row.appendChild(el('span', { className: 'ev-case', text: ev.caseNumber }));
  if (ev.region) row.appendChild(el('span', { className: 'ev-region', text: ev.region }));
  row.appendChild(el('time', { className: 'ev-time', text: ev.createdAt }));
  return row;
}

/** select 컨트롤을 만든다. */
function renderSelect(
  labelText: string,
  options: readonly [string, string][],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = el('label', { className: 'filter' });
  wrap.appendChild(el('span', { text: labelText }));
  const select = el('select');
  for (const [val, text] of options) {
    const opt = el('option', { text });
    opt.value = val;
    if (val === value) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  wrap.appendChild(select);
  return wrap;
}

/** 검색 입력 컨트롤을 만든다. */
function renderSearch(value: string, onInput: (v: string) => void): HTMLElement {
  const wrap = el('label', { className: 'filter filter-search' });
  wrap.appendChild(el('span', { text: '검색' }));
  const input = el('input');
  input.setAttribute('type', 'search');
  input.setAttribute('placeholder', '주소·사건번호 (예: 중봉대로)');
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  wrap.appendChild(input);
  return wrap;
}

/**
 * 뷰 모델을 root 에 렌더한다. (모든 화면에 면책 고지 고정 — REQ-006)
 *
 * @param root         마운트 대상.
 * @param data         /api/data 응답.
 * @param filters      서버 필터 상태.
 * @param onFilter     서버 필터 변경 콜백(재조회 트리거).
 * @param itemFilter   클라이언트 필터 상태(기본: 무필터).
 * @param onItemFilter 클라이언트 필터 변경 콜백(재조회 없이 재렌더).
 */
export function renderView(
  root: HTMLElement,
  data: ViewModel,
  filters: FilterState,
  onFilter: (next: FilterState) => void,
  itemFilter: ItemFilter = defaultItemFilter(),
  onItemFilter: (next: ItemFilter) => void = () => {},
): void {
  root.textContent = '';

  // 헤더 + 면책 고지(상단 고정). (REQ-006)
  const header = el('header', { className: 'app-header' });
  header.appendChild(el('h1', { text: 'auction-radar 대시보드' }));
  header.appendChild(el('p', { className: 'disclaimer', text: `⚠️ ${data.disclaimer}` }));
  root.appendChild(header);

  // sync 차단/실패 경고 배너 + 마지막 성공 시각. (REQ-008, AC-08)
  if (data.status.warn) {
    const banner = el('div', { className: 'banner banner-warn' });
    const reason = data.status.blocked ? 'sync 차단됨(blocked)' : 'sync 실패';
    const last = data.status.lastSuccessAt ? `마지막 성공 sync: ${data.status.lastSuccessAt}` : '성공 이력 없음';
    banner.appendChild(el('strong', { text: `⚠️ ${reason}` }));
    banner.appendChild(el('span', { text: ` · ${last}` }));
    if (data.status.errorText) banner.appendChild(el('span', { text: ` · ${data.status.errorText}` }));
    root.appendChild(banner);
  }

  // 서버 필터(워치리스트/이벤트/기간). (REQ-007)
  const watchOptions: [string, string][] = [
    ['', '전체 워치리스트'],
    ...data.watchlists.map((w) => [String(w.id), `${w.name} (${w.matchCount})`] as [string, string]),
  ];
  const filterBar = el('div', { className: 'filters' });
  filterBar.appendChild(
    renderSelect('워치리스트', watchOptions, filters.watchlist, (v) =>
      onFilter({ ...filters, watchlist: v }),
    ),
  );
  filterBar.appendChild(
    renderSelect('이벤트', TYPE_OPTIONS, filters.type, (v) => onFilter({ ...filters, type: v })),
  );
  filterBar.appendChild(
    renderSelect('기간', PERIOD_OPTIONS, filters.period, (v) => onFilter({ ...filters, period: v })),
  );
  root.appendChild(filterBar);

  // 클라이언트 필터(지역/용도/가격/검색/정렬) — 재조회 없이 메모리에서 적용.
  const regionOpts: [string, string][] = [
    ['', '지역 전체'],
    ...regionOptions(data.items).map((r) => [r, r] as [string, string]),
  ];
  const usageOpts: [string, string][] = [
    ['', '용도 전체'],
    ...usageOptions(data.items).map((u) => [u, u] as [string, string]),
  ];
  const clientBar = el('div', { className: 'filters filters-client' });
  clientBar.appendChild(
    renderSelect('지역', regionOpts, itemFilter.region, (v) => onItemFilter({ ...itemFilter, region: v })),
  );
  clientBar.appendChild(
    renderSelect('용도', usageOpts, itemFilter.usage, (v) => onItemFilter({ ...itemFilter, usage: v })),
  );
  clientBar.appendChild(
    renderSelect(
      '가격',
      PRICE_OPTIONS,
      itemFilter.priceMax === null ? '' : String(itemFilter.priceMax),
      (v) => onItemFilter({ ...itemFilter, priceMax: v === '' ? null : Number(v) }),
    ),
  );
  clientBar.appendChild(
    renderSelect(
      '정렬',
      SORT_OPTIONS as readonly [string, string][],
      itemFilter.sort,
      (v) => onItemFilter({ ...itemFilter, sort: v as SortKey }),
    ),
  );
  clientBar.appendChild(renderSearch(itemFilter.search, (v) => onItemFilter({ ...itemFilter, search: v })));
  root.appendChild(clientBar);

  // 빈 상태 안내. (AC-09)
  if (!data.schemaPresent || data.empty) {
    const empty = el('div', { className: 'empty-state' });
    empty.appendChild(
      el('p', { text: '데이터 없음 — auction-radar sync를 먼저 실행하세요' }),
    );
    root.appendChild(empty);
    // 면책 고지 푸터는 항상 표시.
    const footerEmpty = el('footer', { className: 'app-footer' });
    footerEmpty.appendChild(el('span', { className: 'disclaimer', text: `⚠️ ${data.disclaimer}` }));
    root.appendChild(footerEmpty);
    return;
  }

  // 클라이언트 필터·정렬 적용.
  const shown = applyItemFilter(data.items, itemFilter);
  const imminent = shown.filter((it) => it.dday !== null && it.dday >= 0 && it.dday <= 7);

  // D-7 임박 섹션(상단 고정). (REQ-009)
  if (imminent.length > 0) {
    const sec = el('section', { className: 'imminent' });
    sec.appendChild(el('h2', { text: `임박 (D-7 이내) · ${imminent.length}건` }));
    const list = el('div', { className: 'item-list' });
    for (const it of imminent) list.appendChild(renderItem(it));
    sec.appendChild(list);
    root.appendChild(sec);
  }

  // 물건 목록. (REQ-004)
  const itemsSec = el('section', { className: 'items' });
  const totalText =
    shown.length === data.items.length
      ? `물건 (${shown.length})`
      : `물건 (${shown.length} / 전체 ${data.items.length})`;
  itemsSec.appendChild(el('h2', { text: totalText }));
  if (shown.length === 0) {
    itemsSec.appendChild(el('p', { className: 'no-match', text: '조건에 맞는 물건이 없습니다. 필터를 완화해 보세요.' }));
  } else {
    const itemList = el('div', { className: 'item-list' });
    for (const it of shown) itemList.appendChild(renderItem(it));
    itemsSec.appendChild(itemList);
  }
  root.appendChild(itemsSec);

  // 이벤트 타임라인. (REQ-004)
  const evSec = el('section', { className: 'events' });
  evSec.appendChild(el('h2', { text: `이벤트 이력 (${data.events.length})` }));
  const evList = el('ul', { className: 'event-list' });
  for (const ev of data.events) evList.appendChild(renderEvent(ev));
  evSec.appendChild(evList);
  root.appendChild(evSec);

  // 면책 고지 고정 푸터(모든 화면). (REQ-006)
  const footer = el('footer', { className: 'app-footer' });
  footer.appendChild(el('span', { className: 'disclaimer', text: `⚠️ ${data.disclaimer}` }));
  root.appendChild(footer);
}

/** 서버 필터 상태를 쿼리스트링으로 직렬화한다. */
export function toQuery(filters: FilterState): string {
  const p = new URLSearchParams();
  if (filters.watchlist) p.set('watchlist', filters.watchlist);
  if (filters.type) p.set('type', filters.type);
  if (filters.period) p.set('period', filters.period);
  const q = p.toString();
  return q ? `?${q}` : '';
}

/** 앱을 부트스트랩한다(같은 출처 /api/data 조회 → 렌더 → 필터 재조회/재렌더 루프). */
export function bootstrap(root: HTMLElement): void {
  let filters = defaultFilters();
  let itemFilter = defaultItemFilter();
  let lastData: ViewModel | null = null;

  const render = (): void => {
    if (lastData === null) return;
    renderView(
      root,
      lastData,
      filters,
      (next) => {
        filters = next;
        load();
      },
      itemFilter,
      (nextItem) => {
        itemFilter = nextItem;
        render(); // 재조회 없이 메모리에서 재렌더.
      },
    );
  };

  const load = (): void => {
    void fetch(`/api/data${toQuery(filters)}`)
      .then((r) => r.json() as Promise<ViewModel>)
      .then((data) => {
        lastData = data;
        render();
      })
      .catch(() => {
        root.textContent = '';
        root.appendChild(el('p', { text: '데이터를 불러오지 못했습니다.' }));
      });
  };

  load();
}

// 브라우저에서 자동 부트스트랩(테스트 import 시에는 document 조작 없이 함수만 노출).
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const start = (): void => {
    const root = document.getElementById('app');
    if (root) bootstrap(root);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
