// ============================================================
//  slides.template.js  —  WORKED EXAMPLE / starting point
//  Copy this to lib/slides.js and replace the bodies with your
//  own slides, transcribed 1:1 from the source images.
//
//  CONTRACT (what build.js expects):
//    - export one function per slide named s1, s2, ... sN
//    - each receives a "surface" `s` and draws onto it using the
//      kit helpers; every coordinate is in SOURCE PIXELS (the
//      resolution of your source image, default 1672x941).
//    - the SAME function is replayed onto a PPTX surface and an
//      HTML surface — never branch on the backend; just draw.
//
//  For raster crops, place them with s.img + an absolute path:
//      s.img(require('path').join(K.ASSET,'my_crop.png'), x,y,w,h)
//  or, if it is registered in manifest.json, with K.crop(s,'my_crop').
//
//  PARALLEL WORKER CONTRACT:
//    - parallel workers write work/slideXX/sN.fragment.js, not this shared file.
//    - a fragment should define exactly one function sN(s) using these same
//      helpers and source-pixel coordinates.
//    - run ../merge_fragments.js from the deck root to merge fragments into
//      lib/slides.js; use CROP_PLAN_DIR=work python make_crops.py for crops.
// ============================================================
const K = require('./kit');
const { C, bg, head, panel, T, badge, icon, banner, chevronBar, iconRows, detailRows, footer } = K;

// ------------------------------------------------------------ SLIDE 1
function s1(s){
  bg(s);
  // Header parts are optional. Set once via env (DECK_EYEBROW / DECK_TAG /
  // DECK_PREFIX) so every slide inherits them, or pass per-call like this:
  head(s, '예시 제목 — Example Title',
        '한 줄 부제: source-px 좌표로 그리면 PPTX와 HTML이 똑같이 나온다.',
        { eyebrow:'My Course · 2026', tag:'Part I · Basics', prefix:'Module 1' });

  // two bordered info panels with icon + label + bullets
  panel(s, 28, 200, 800, 380);
  T(s, '왼쪽 패널 제목', 28, 212, 800, 28, { sz:15, b:true, color:C.cyan, align:'center' });
  detailRows(s, [
    { ic:'gauge',        label:'측정',   bullets:['정량 지표를 먼저 확인','기준값과 비교'] },
    { ic:'shield',       label:'보호',   bullets:['리스크 차단 우선','다중 방벽 설계'] },
    { ic:'clipboardlist',label:'절차',   bullets:['표준 절차 준수','기록·점검 루틴화'] },
  ], 44, 256, 760, 100, { bx:120, lsz:11, bsz:10 });

  panel(s, 844, 200, 800, 380);
  T(s, '오른쪽 패널 제목', 844, 212, 800, 28, { sz:15, b:true, color:C.cyan, align:'center' });
  iconRows(s, [
    { ic:'atom',   color:'lblue', en:'Concept',  title:'핵심 개념',   sub:'한 줄 설명을 여기에' },
    { ic:'target', color:'lblue', en:'Goal',     title:'달성 목표',   sub:'무엇을 이루려는가' },
    { ic:'gear',   color:'lblue', en:'Method',   title:'실행 방법',   sub:'어떻게 할 것인가' },
  ], 868, 268, 760, 92, { iconD:34, textDx:48, tsz:14, ssz:11 });

  banner(s, '한 문장으로 요약하는 강조 배너', 660, { icon:'warn', icon2:'chartline' });

  chevronBar(s, [
    { label:'단계1', num:'1' }, { label:'단계2', num:'2' }, { label:'단계3', num:'3' },
    { label:'단계4', num:'4' }, { label:'단계5', num:'5' }, { label:'비상', icon:'alertcircle', danger:true },
  ], 2, 786, { l1:'학습', l2:'로드맵', icon:'helm' });

  footer(s, '예시 푸터 · 실제 사용 시 출처/주의문구로 교체');
}

// ------------------------------------------------------------ SLIDE 2
function s2(s){
  bg(s);
  head(s, '두 번째 슬라이드 — 카드 + 골드 단계',
        'chevronBar는 active(시안)·danger(빨강)·gold(금색) 상태를 지원한다.');

  // three mini cards across the top
  const cards = [
    ['flask',  'Card A', '설명 텍스트 A를 여기에 적는다.'],
    ['bolt',   'Card B', '설명 텍스트 B를 여기에 적는다.'],
    ['search', 'Card C', '설명 텍스트 C를 여기에 적는다.'],
  ];
  const cw = 512, gap = 40;
  cards.forEach(([ic, t, body], i)=>{
    const x = 28 + i*(cw+gap);
    panel(s, x, 200, cw, 220);
    icon(s, ic, 'cyan', x+24, 224, 40);
    T(s, t, x+76, 224, cw-90, 28, { sz:16, b:true, color:C.white });
    T(s, body, x+24, 286, cw-48, 110, { sz:12.5, color:C.sub, lh:1.25, valign:'top' });
  });

  // a row of numbered badges + labels
  panel(s, 28, 444, 1616, 150);
  T(s, '하단 강조 행', 28, 456, 1616, 26, { sz:14, b:true, color:C.gold, align:'center' });
  const steps = ['입력 정의', '처리·검증', '결과 산출'];
  const bw = 480;
  steps.forEach((t, i)=>{
    const x = 80 + i*(bw+60);
    badge(s, String(i+1), x, 506, 40, { fill:C.badge, sz:16 });
    T(s, t, x+56, 506, bw-60, 40, { sz:15, b:true, color:C.white, valign:'middle' });
    if(i<steps.length-1) T(s, '→', x+bw, 502, 50, 48, { sz:26, b:true, color:C.cyan, align:'center', valign:'middle' });
  });

  banner(s, '두 번째 강조 배너 — 결론을 한 줄로', 660, { icon:'shieldcheck', icon2:'sparkles' });

  chevronBar(s, [
    { label:'복습', icon:'atom' }, { label:'적용', icon:'user' }, { label:'평가', icon:'gauge' },
    { label:'현재', icon:'clipboardlist' }, { label:'심화', icon:'sparkles', gold:true }, { label:'비상', icon:'alertcircle', danger:true },
  ], 3, 786, { l1:'이번', l2:'로드맵', icon:'helm' });

  footer(s, '예시 푸터 2');
}

module.exports = { s1, s2 };
