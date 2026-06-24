// Render Tabler line-icons -> transparent PNGs in palette colors.
// React.createElement + renderToStaticMarkup + sharp (per pptxgenjs icon recipe).
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const tb = require('react-icons/tb');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT = process.env.DECK_ASSETS
  ? path.join(process.env.DECK_ASSETS, 'icons')
  : path.join(__dirname, 'assets', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// concept -> tabler component name
const MAP = {
  search:'TbSearch', zoom:'TbZoomScan', atom:'TbAtom2', bolt:'TbBolt',
  shield:'TbShield', shieldcheck:'TbShieldCheck', shieldhalf:'TbShieldHalf',
  clipboard:'TbClipboardCheck', clipboardlist:'TbClipboardList',
  target:'TbTargetArrow', droplet:'TbDroplet', flask:'TbFlask2',
  gear:'TbSettings', helmet:'TbHelmet', user:'TbUser', wrench:'TbTool',
  tools:'TbTools', coins:'TbCoins', money:'TbReportMoney',
  thermo:'TbTemperature', clock:'TbClock', cloud:'TbCloud', ship:'TbShip',
  helm:'TbSteeringWheel', anchor:'TbAnchor', file:'TbFileText', eye:'TbEye',
  ruler:'TbRuler2', octagon:'TbOctagon', stophand:'TbHandStop',
  warn:'TbAlertTriangle', warnfill:'TbAlertTriangleFilled', skull:'TbSkull',
  checkcircle:'TbCircleCheck', xcircle:'TbCircleX', spray:'TbSpray',
  layers:'TbStack2', gauge:'TbGauge', pin:'TbMapPin', brain:'TbBrain',
  recycle:'TbRecycle', refresh:'TbRefresh', alertcircle:'TbAlertCircle',
  sparkles:'TbSparkles', molecule:'TbHexagons', weight:'TbWeight',
  wind:'TbWind', snow:'TbSnowflake', droplets:'TbDroplets', wave:'TbWaveSine',
  ripple:'TbRipple', factory:'TbBuildingFactory2', box:'TbBox',
  layersx:'TbLayersIntersect', circledot:'TbCircleDot', flame:'TbFlame',
  hexagon:'TbHexagon', chartline:'TbChartLine', paint:'TbPaint',
  brush:'TbBrush', wall:'TbWall', adjust:'TbAdjustments',
};

// fallback for any missing name
function comp(name){
  const c = tb[MAP[name]];
  if(c) return c;
  console.log('  [fallback] missing', name, MAP[name]);
  return tb['TbCircleDot'];
}

// Icon recolor palette. Keys (white/lblue/cyan/red/green/gold/blue) are the names
// kit.icon(s, concept, color, ...) asks for, so they stay fixed; the VALUES follow
// the active profile when DECK_PROFILE is set, else the original colors.
const { loadProfile, paletteC } = require('./lib/profile');
const _P = loadProfile();
const _C = paletteC(_P);
const COLORS = _P ? {
  white:'#'+_C.white, lblue:'#'+_C.steel, cyan:'#'+_C.cyan,
  red:'#'+_C.red, green:'#'+_C.green, gold:'#'+_C.gold, blue:'#'+_C.badge,
} : {
  white:'#E6EEF7', lblue:'#7FB6E6', cyan:'#3BC4ED',
  red:'#D8453B', green:'#3FB950', gold:'#E9B84A', blue:'#2E86D8',
};

async function render(concept, colorName, size=256){
  const C = comp(concept);
  // stroke 2 default; render to static markup, force size + color
  let svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(C, { size: size, color: COLORS[colorName], strokeWidth: 2 })
  );
  // librsvg: resolve currentColor explicitly
  svg = svg.replace(/currentColor/g, COLORS[colorName]);
  // ensure xmlns
  if(!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const file = path.join(OUT, `${concept}_${colorName}.png`);
  await sharp(Buffer.from(svg)).resize(size, size, {fit:'contain', background:{r:0,g:0,b:0,alpha:0}}).png().toFile(file);
}

(async () => {
  const concepts = Object.keys(MAP);
  const colors = Object.keys(COLORS);
  let n=0;
  for(const c of concepts){
    for(const col of colors){ await render(c, col); n++; }
  }
  console.log('rendered', n, 'icon PNGs to', OUT);
})();
