const K = require('./kit');
const { C, bg, T, panel, badge, icon } = K;

const A = {
  navy: '081525',
  panel: '071A2C',
  panel2: '0B2035',
  line: '2E5577',
  cyan: '20D6F0',
  cyan2: '65C7EF',
  white: 'F3F7FB',
  sub: 'B7C8D8',
  dim: '7F99AE',
  lime: 'A8D642',
  green: '58C36A',
  amber: 'F6B91E',
  orange: 'F07B2C',
  red: 'F05045',
};

function txt(s, text, x, y, w, h, opts = {}) {
  T(s, text, x, y, w, h, Object.assign({ color: A.white, sz: 12, shrink: true }, opts));
}

function box(s, x, y, w, h, opts = {}) {
  s.rrect(x, y, w, h, {
    fill: opts.fill || A.panel,
    fillTrans: opts.trans == null ? 6 : opts.trans,
    line: opts.line || A.line,
    lineW: opts.lw || 1,
    radius: opts.r == null ? 8 : opts.r,
    shadow: !!opts.shadow,
  });
}

function hline(s, x, y, w, color = A.line, width = 1) {
  s.ln(x, y, w, 0, { color, width });
}

function vline(s, x, y, h, color = A.line, width = 1) {
  s.ln(x, y, 0, h, { color, width });
}

function chip(s, label, value, x, y, w, color = A.cyan) {
  box(s, x, y, w, 38, { fill: '061323', line: color, trans: 18, r: 7 });
  txt(s, label, x + 10, y + 5, w - 20, 12, { sz: 7.4, color: A.dim });
  txt(s, value, x + 10, y + 17, w - 20, 18, { sz: 12, b: true, color, align: 'center' });
}

function metricRow(s, label, value, target, delta, x, y, w, color) {
  txt(s, label, x, y, 120, 18, { sz: 10, color: A.sub });
  txt(s, value, x + 138, y, 70, 18, { sz: 10, color: A.white, align: 'right' });
  txt(s, target, x + 238, y, 58, 18, { sz: 10, color: A.sub, align: 'right' });
  txt(s, delta, x + 325, y, 60, 18, { sz: 10, b: true, color, align: 'right' });
}

function dots(s, x, y, n, active, color) {
  for (let i = 0; i < n; i += 1) {
    s.ell(x + i * 13, y, 9, 9, {
      fill: i < active ? color : '102438',
      line: i < active ? color : A.line,
      lineW: 1,
    });
  }
}

function miniSpark(s, x, y, w, color) {
  const pts = [0.45, 0.62, 0.55, 0.72, 0.60, 0.48, 0.58, 0.32, 0.40, 0.55, 0.46, 0.28, 0.34, 0.50, 0.42];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const x1 = x + (w * i) / (pts.length - 1);
    const x2 = x + (w * (i + 1)) / (pts.length - 1);
    const y1 = y + pts[i] * 30;
    const y2 = y + pts[i + 1] * 30;
    s.ln(x1, y1, x2 - x1, y2 - y1, { color, width: 1.6 });
  }
}

function sensorPanel(s) {
  box(s, 14, 106, 408, 304);
  badge(s, '1', 25, 116, 32, { fill: A.cyan, sz: 13 });
  txt(s, 'Sensor Layer', 65, 113, 240, 30, { sz: 17, b: true });
  txt(s, 'Monitor what matters. Calibrate. Trust but verify.', 34, 143, 350, 18, { sz: 9.4, color: A.sub });

  box(s, 34, 167, 160, 225, { fill: '07172A', trans: 0, r: 6 });
  const rows = [
    ['thermo', 'Temperature', 'Inlet / Outlet / dT'],
    ['droplet', 'Pressure', 'Supply / Return'],
    ['wave', 'Flow Rate', 'Per loop / Per rack'],
    ['bolt', 'Power', 'Pumps / Chillers / IT'],
    ['gauge', 'Calibration', 'Critical: 30 days'],
  ];
  rows.forEach((r, i) => {
    const y = 177 + i * 42;
    icon(s, r[0], 'lblue', 46, y + 2, 28);
    txt(s, r[1], 82, y, 98, 16, { sz: 8.2, b: true });
    txt(s, r[2], 82, y + 15, 100, 21, { sz: 7.3, color: A.sub });
  });

  box(s, 204, 167, 210, 136, { fill: '07172A', trans: 0, r: 6 });
  txt(s, 'Health Summary', 216, 177, 160, 18, { sz: 10, b: true, color: A.sub });
  s.ell(220, 206, 74, 74, { fill: A.lime, line: A.lime, lineW: 1 });
  s.ell(234, 220, 46, 46, { fill: A.navy, line: A.navy, lineW: 1 });
  s.rrect(258, 205, 11, 23, { fill: A.amber, fillTrans: 0, line: A.amber, radius: 1 });
  s.rrect(258, 205, 11, 12, { fill: A.red, fillTrans: 0, line: A.red, radius: 1 });
  txt(s, 'Sensors', 298, 202, 80, 14, { sz: 8, color: A.sub });
  txt(s, '1,248', 298, 218, 80, 22, { sz: 16, b: true });
  txt(s, 'Healthy   92.1%', 312, 248, 88, 14, { sz: 7.8, color: A.sub });
  dots(s, 300, 251, 1, 1, A.lime);
  txt(s, 'Warning    6.3%', 312, 267, 88, 14, { sz: 7.8, color: A.sub });
  dots(s, 300, 270, 1, 1, A.amber);
  txt(s, 'Critical   1.6%', 312, 286, 88, 14, { sz: 7.8, color: A.sub });
  dots(s, 300, 289, 1, 1, A.red);

  box(s, 204, 310, 210, 82, { fill: '07172A', trans: 0, r: 6 });
  txt(s, 'Top Drift Risks (30d)', 216, 318, 160, 15, { sz: 9.5, color: A.sub });
  [
    ['dT sensor drift', '0.9 C'],
    ['Pressure offset', '1.3 psi'],
    ['Flow meter bias', '4.1%'],
    ['Ambient probe', '0.6 C'],
  ].forEach((r, i) => {
    txt(s, r[0], 216, 338 + i * 13, 100, 13, { sz: 7.8, color: A.sub });
    txt(s, r[1], 340, 338 + i * 13, 54, 13, { sz: 7.8, color: A.white, align: 'right' });
  });
}

function coolingLoop(s) {
  box(s, 428, 106, 900, 304);
  txt(s, 'Cooling Loop Overview (Primary Loop)', 640, 116, 480, 22, { sz: 13, b: true, color: A.cyan, align: 'center' });

  box(s, 448, 185, 132, 168, { fill: '07172A', trans: 0, r: 8 });
  txt(s, 'Chiller Plant', 466, 162, 100, 20, { sz: 9.6, color: A.sub, align: 'center' });
  for (let i = 0; i < 3; i += 1) {
    s.ell(460 + i * 31, 198, 24, 24, { fill: '0A2A43', line: A.cyan2, lineW: 1 });
    txt(s, '*', 460 + i * 31, 198, 24, 24, { sz: 13, color: A.cyan2, align: 'center' });
  }
  [['Chiller 1', 'COP 5.6', 'Load 78%'], ['Chiller 2', 'COP 5.1', 'Load 62%']].forEach((r, i) => {
    box(s, 456, 238 + i * 56, 92, 48, { fill: '061323', trans: 0, r: 4 });
    txt(s, r[0], 466, 244 + i * 56, 70, 13, { sz: 7.5, b: true });
    txt(s, r[1] + '\n' + r[2], 466, 260 + i * 56, 70, 24, { sz: 7.4, color: A.sub, lh: 1.05 });
  });

  s.ln(580, 234, 46, 0, { color: A.cyan2, width: 3 });
  s.chev(620, 225, 30, 20, { fill: A.cyan2, line: A.cyan2, fillTrans: 0 });
  box(s, 636, 196, 72, 126, { fill: '102D4E', line: A.cyan2, trans: 0, r: 14 });
  txt(s, 'Supply', 649, 226, 50, 20, { sz: 10, b: true, align: 'center' });
  txt(s, '7.2 C\n2.1 bar', 649, 252, 50, 40, { sz: 9.4, color: A.sub, align: 'center', lh: 1.1 });
  txt(s, 'Supply Header', 632, 176, 95, 16, { sz: 8, color: A.cyan2, align: 'center' });

  s.ln(708, 230, 40, 0, { color: A.cyan2, width: 3 });
  s.chev(742, 221, 30, 20, { fill: A.cyan2, line: A.cyan2, fillTrans: 0 });
  box(s, 742, 153, 88, 58, { fill: '061323', trans: 0, r: 5 });
  txt(s, 'Pump A', 742, 160, 88, 12, { sz: 7.5, b: true, align: 'center' });
  txt(s, 'Speed 78%\nFlow 245 L/s', 752, 176, 68, 24, { sz: 7.3, color: A.sub, align: 'center', lh: 1.0 });
  s.ell(764, 220, 40, 40, { fill: '07172A', line: A.cyan2, lineW: 2 });
  s.ell(776, 232, 16, 16, { fill: A.navy, line: A.line, lineW: 1 });
  box(s, 742, 286, 88, 58, { fill: '061323', trans: 0, r: 5 });
  txt(s, 'Pump B', 742, 293, 88, 12, { sz: 7.5, b: true, align: 'center' });
  txt(s, 'Speed 62%\nFlow 198 L/s', 752, 309, 68, 24, { sz: 7.3, color: A.sub, align: 'center', lh: 1.0 });
  s.ell(764, 350, 40, 40, { fill: '07172A', line: A.cyan2, lineW: 2 });
  s.ell(776, 362, 16, 16, { fill: A.navy, line: A.line, lineW: 1 });
  s.ln(804, 240, 54, 0, { color: A.cyan2, width: 3 });
  s.ln(804, 370, 54, -130, { color: A.cyan2, width: 3 });
  s.chev(850, 230, 30, 20, { fill: A.cyan2, line: A.cyan2, fillTrans: 0 });

  box(s, 890, 142, 180, 198, { fill: '061323', trans: 36, line: A.dim, lw: 1, r: 6 });
  txt(s, 'Rack Rows', 942, 154, 80, 16, { sz: 10, b: true, align: 'center' });
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const x = 906 + c * 40;
      const y = 180 + r * 82;
      box(s, x, y, 28, 58, { fill: '0B2238', line: A.line, trans: 0, r: 2 });
      for (let j = 0; j < 5; j += 1) {
        const col = j % 3 === 0 ? A.amber : j % 3 === 1 ? A.cyan2 : A.lime;
        s.rrect(x + 6, y + 8 + j * 9, 16, 3, { fill: col, fillTrans: 0, line: col, radius: 1 });
      }
    }
  }

  s.ln(1070, 240, 46, 0, { color: A.cyan2, width: 3 });
  s.chev(1108, 230, 30, 20, { fill: A.cyan2, line: A.cyan2, fillTrans: 0 });
  box(s, 1116, 196, 72, 126, { fill: '46350F', line: A.amber, trans: 0, r: 14 });
  txt(s, 'Return', 1130, 226, 48, 20, { sz: 10, b: true, align: 'center' });
  txt(s, '16.4 C\n1.8 bar', 1130, 252, 48, 40, { sz: 9.4, color: A.white, align: 'center', lh: 1.1 });
  txt(s, 'Return Header', 1105, 176, 95, 16, { sz: 8, color: A.amber, align: 'center' });
  s.ln(1188, 250, 42, 0, { color: A.cyan2, width: 3 });
  s.chev(1224, 240, 28, 20, { fill: A.cyan2, line: A.cyan2, fillTrans: 0 });
  box(s, 1228, 193, 82, 90, { fill: '102D4E', line: A.cyan2, trans: 0, r: 6 });
  txt(s, 'Expansion Tank', 1218, 164, 110, 16, { sz: 8, color: A.sub, align: 'center' });
  s.ln(1242, 217, 44, 0, { color: A.cyan2, width: 2 });
  s.ln(1242, 229, 32, 0, { color: A.cyan2, width: 2 });
  txt(s, 'Level 68%\nN2 1.0 bar', 1242, 246, 52, 28, { sz: 7.4, color: A.sub, align: 'center', lh: 1.0 });

  s.ln(498, 370, 778, 0, { color: A.lime, width: 1.6, dash: 'dash' });
  s.ln(1270, 370, 0, -88, { color: A.lime, width: 1.6, dash: 'dash' });
  s.ln(1152, 370, 0, -47, { color: A.lime, width: 1.6, dash: 'dash' });
  s.ln(982, 370, 0, -30, { color: A.lime, width: 1.6, dash: 'dash' });
  s.ln(670, 370, 0, -48, { color: A.lime, width: 1.6, dash: 'dash' });
  box(s, 785, 377, 118, 26, { fill: '10340E', line: A.lime, trans: 0, r: 4 });
  txt(s, 'BMS / DCIM', 795, 381, 98, 18, { sz: 10, b: true, color: A.lime, align: 'center' });
  txt(s, 'Closed-loop Control & Alerts', 916, 382, 220, 18, { sz: 8.6, color: A.sub });
}

function heatPanel(s) {
  box(s, 428, 414, 900, 240);
  badge(s, '3', 438, 426, 32, { fill: A.cyan, sz: 13 });
  txt(s, 'Rack Heat Load', 478, 424, 180, 28, { sz: 17, b: true });
  txt(s, 'Understand heat where it is generated.', 634, 432, 260, 18, { sz: 8.6, color: A.sub });
  hline(s, 438, 462, 126);
  txt(s, 'Heat Map (Top View)', 573, 454, 250, 18, { sz: 8.8, color: A.cyan2 });

  const gx = 458, gy = 492, cell = 26;
  for (let c = 0; c < 12; c += 1) txt(s, String(c + 1), gx + 24 + c * cell, 475, 20, 12, { sz: 6.8, color: A.sub, align: 'center' });
  for (let r = 0; r < 5; r += 1) {
    txt(s, 'R' + (r + 1), gx - 22, gy + r * 21, 18, 16, { sz: 7.2, color: A.sub, align: 'center' });
    for (let c = 0; c < 12; c += 1) {
      const val = (r * 17 + c * 11 + (r === 1 && c > 2 && c < 7 ? 30 : 0)) % 72;
      const col = val > 54 ? A.red : val > 38 ? A.orange : val > 22 ? A.amber : A.lime;
      s.rrect(gx + c * cell, gy + r * 21, 24, 18, { fill: col, fillTrans: 0, line: '183044', radius: 1 });
    }
  }
  txt(s, 'kW / rack', 802, 494, 56, 12, { sz: 6.5, color: A.sub });
  ['>30', '24', '18', '12', '6', '<3'].forEach((t, i) => {
    const col = [A.red, A.orange, A.amber, A.lime, A.green, '1E8B55'][i];
    s.rrect(820, 508 + i * 15, 10, 10, { fill: col, fillTrans: 0, line: col, radius: 1 });
    txt(s, t, 834, 506 + i * 15, 22, 12, { sz: 6.4, color: A.sub });
  });

  box(s, 856, 454, 220, 158, { fill: '07172A', trans: 0, r: 6 });
  txt(s, 'Load Distribution', 876, 468, 120, 14, { sz: 8, b: true, color: A.sub });
  [
    ['High (> 20 kW)', '21%', A.red],
    ['Med (10-20 kW)', '47%', A.amber],
    ['Low (< 10 kW)', '32%', A.lime],
  ].forEach((r, i) => {
    s.rrect(872, 494 + i * 26, 14, 14, { fill: r[2], fillTrans: 0, line: r[2], radius: 1 });
    txt(s, r[0], 894, 491 + i * 26, 100, 18, { sz: 8, color: A.sub });
    txt(s, r[1], 1012, 491 + i * 26, 42, 18, { sz: 8, b: true, align: 'right' });
  });

  box(s, 1087, 454, 230, 90, { fill: '07172A', trans: 0, r: 6 });
  s.ell(1110, 469, 70, 70, { fill: A.amber, line: A.amber, lineW: 1 });
  s.ell(1123, 482, 44, 44, { fill: A.navy, line: A.navy, lineW: 1 });
  s.rrect(1140, 470, 12, 24, { fill: A.red, fillTrans: 0, line: A.red, radius: 1 });
  txt(s, 'Load', 1188, 478, 80, 14, { sz: 8.3, color: A.sub });
  txt(s, 'Heat distribution', 1188, 499, 100, 18, { sz: 8.3, color: A.sub });

  box(s, 1087, 550, 230, 94, { fill: '07172A', trans: 0, r: 6 });
  txt(s, 'Thermal Headroom', 1102, 566, 130, 16, { sz: 9.2, b: true, color: A.sub });
  chip(s, 'Min', '4.1 C', 1104, 596, 58, A.red);
  chip(s, 'Avg', '8.6 C', 1172, 596, 58, A.amber);
  chip(s, 'Max', '13.2 C', 1240, 596, 58, A.lime);

  box(s, 438, 610, 580, 36, { fill: '061323', trans: 0, r: 5 });
  txt(s, 'Total IT Load', 452, 620, 110, 16, { sz: 9, color: A.sub });
  txt(s, '2,846 kW', 562, 620, 90, 16, { sz: 12, b: true });
  txt(s, 'Peak Rack', 718, 620, 90, 16, { sz: 9, color: A.sub });
  box(s, 786, 617, 70, 22, { fill: '180A10', line: A.red, trans: 0, r: 4 });
  txt(s, 'R3-06', 792, 620, 58, 14, { sz: 9, color: A.sub, align: 'center' });
  txt(s, '28.7 kW', 858, 620, 90, 16, { sz: 10.5, b: true, color: A.red });
  txt(s, 'Hotspots', 970, 620, 68, 16, { sz: 9, color: A.sub });
  box(s, 1038, 617, 28, 22, { fill: '180A10', line: A.red, trans: 0, r: 4 });
  txt(s, '7', 1038, 620, 28, 14, { sz: 10, b: true, color: A.red, align: 'center' });
}

function pumpPanel(s) {
  box(s, 14, 414, 408, 240);
  badge(s, '2', 25, 426, 32, { fill: A.cyan, sz: 13 });
  txt(s, 'Pump & Chiller Loop', 65, 424, 245, 28, { sz: 17, b: true });
  txt(s, 'Keep the loop stable and efficient.', 65, 454, 250, 16, { sz: 8.8, color: A.sub });
  txt(s, 'Loop KPIs', 34, 478, 90, 14, { sz: 9, b: true });
  txt(s, 'Target', 270, 478, 50, 14, { sz: 8, color: A.sub, align: 'center' });
  txt(s, 'Delta', 342, 478, 50, 14, { sz: 8, color: A.sub, align: 'center' });
  hline(s, 34, 495, 360);
  [
    ['Supply Temp', '7.2 C', '7.0', '+0.2', A.red],
    ['Return Temp', '16.4 C', '17.0', '-0.6', A.lime],
    ['Delta T', '9.2 C', '10.0', '-0.8', A.lime],
    ['Flow Rate', '443 L/s', '450', '-7', A.amber],
    ['Pressure', '2.1 bar', '2.2', '-0.1', A.lime],
  ].forEach((r, i) => metricRow(s, r[0], r[1], r[2], r[3], 34, 502 + i * 21, 350, r[4]));
  hline(s, 34, 600, 360);
  txt(s, 'Chiller Efficiency', 34, 610, 120, 18, { sz: 10, b: true });
  txt(s, 'COP (Avg)', 34, 630, 90, 15, { sz: 8, color: A.sub });
  txt(s, '6.0\n4.5\n3.0', 152, 606, 22, 40, { sz: 6.5, color: A.sub, align: 'right', lh: 1.6 });
  miniSpark(s, 182, 612, 200, A.cyan);
  txt(s, '00:00        06:00        12:00        18:00        24:00', 176, 637, 220, 10, { sz: 5.7, color: A.sub });
}

function riskTable(s) {
  box(s, 14, 665, 1005, 190);
  txt(s, 'Risk Register (Top 5)', 394, 670, 240, 18, { sz: 11, b: true, color: A.cyan, align: 'center' });
  const x = 24, y = 686;
  const cols = [32, 130, 88, 88, 88, 74, 178, 178, 78, 70];
  const heads = ['#', 'Risk', 'Category', 'Likelihood', 'Impact', 'Risk', 'Leading Indicators', 'Mitigation', 'Owner', 'Status'];
  let cx = x;
  heads.forEach((h, i) => {
    box(s, cx, y, cols[i], 24, { fill: '102438', trans: 0, r: 0 });
    txt(s, h, cx + 4, y + 4, cols[i] - 8, 14, { sz: 7.2, b: true, color: A.sub, align: i === 0 ? 'center' : 'left' });
    cx += cols[i];
  });
  const data = [
    ['1', 'Sensor Drift', 'Monitoring', 4, 4, '15', 'dT variance up, calibration due', 'Calibrate sensors, enforce cadence', 'NOC', 'Warning', A.amber],
    ['2', 'Pump Degradation', 'Mechanical', 3, 4, '12', 'Flow margin down, vibration up', 'Service pump, monitor vibration', 'DC Ops', 'Warning', A.amber],
    ['3', 'High Return Temp', 'Thermal', 5, 5, '16', 'Return temp up, headroom down', 'Increase flow, check load balance', 'DC Ops', 'Critical', A.red],
    ['4', 'Low Flow Filter Clog', 'Maintenance', 2, 3, '8', 'dP across filter up, flow down', 'Clean/replace filters', 'Facilities', 'Warning', A.amber],
    ['5', 'Chiller Efficiency Drop', 'Efficiency', 2, 2, '8', 'COP down, kW/ton up', 'Condenser clean, setpoint check', 'Facilities', 'Warning', A.amber],
  ];
  data.forEach((r, ri) => {
    let tx = x;
    const yy = y + 24 + ri * 28;
    cols.forEach((cw, ci) => {
      s.rrect(tx, yy, cw, 28, { fill: ri % 2 ? '07192B' : '061323', fillTrans: 0, line: A.line, lineW: 0.7, radius: 0 });
      tx += cw;
    });
    txt(s, r[0], x, yy + 5, cols[0], 14, { sz: 7.8, align: 'center' });
    txt(s, r[1], x + 42, yy + 5, 118, 14, { sz: 7.4, color: A.sub });
    txt(s, r[2], x + 170, yy + 5, 78, 14, { sz: 7.4, color: A.sub });
    dots(s, x + 270, yy + 9, 5, r[3], A.amber);
    dots(s, x + 358, yy + 9, 5, r[4], r[4] > 4 ? A.red : A.amber);
    box(s, x + 454, yy + 4, 32, 20, { fill: '110F13', line: r[10], trans: 0, r: 3 });
    txt(s, r[5], x + 454, yy + 7, 32, 12, { sz: 8.2, b: true, color: r[10], align: 'center' });
    txt(s, r[6], x + 522, yy + 5, 164, 14, { sz: 6.9, color: A.sub });
    txt(s, r[7], x + 700, yy + 5, 166, 14, { sz: 6.9, color: A.sub });
    txt(s, r[8], x + 888, yy + 5, 56, 14, { sz: 7.1, color: A.sub, align: 'center' });
    box(s, x + 930, yy + 5, 56, 18, { fill: r[10] === A.red ? '6B1C1B' : '5B4100', line: r[10], trans: 0, r: 3 });
    txt(s, r[9], x + 932, yy + 8, 52, 10, { sz: 6.6, b: true, color: 'FFFFFF', align: 'center' });
  });
}

function kpiPanel(s) {
  box(s, 1028, 665, 300, 190);
  txt(s, 'System KPIs (Real-time)', 1060, 672, 230, 18, { sz: 10.5, b: true, color: A.cyan, align: 'center' });
  const rows = [
    ['PUE', '1.28', A.amber],
    ['WUE', '0.18 L/kWh', A.cyan],
    ['DCiE', '0.78', A.green],
    ['IT Load', '2,846 kW', A.amber],
  ];
  rows.forEach((r, i) => {
    const y = 700 + i * 38;
    txt(s, r[0], 1045, y, 68, 20, { sz: 10, b: true, color: A.sub });
    txt(s, r[1], 1110, y, 78, 20, { sz: 14, b: true, color: r[2], align: 'right' });
    miniSpark(s, 1205, y + 2, 90, r[2]);
    if (i < rows.length - 1) hline(s, 1044, y + 30, 252, '1E3A54');
  });
}

function playbook(s) {
  box(s, 1338, 106, 320, 750);
  badge(s, '4', 1352, 116, 32, { fill: A.lime, sz: 13 });
  txt(s, 'Response Playbook', 1394, 113, 220, 30, { sz: 17, b: true });
  txt(s, 'Detect -> Diagnose -> Decide -> Act -> Verify', 1358, 147, 260, 18, { sz: 9, color: A.sub });
  const steps = [
    ['search', 'Detect', 'Alarm / Anomaly / Trend\nValidate sensor health'],
    ['chartline', 'Diagnose', 'Isolate loop / zone\nCheck recent changes'],
    ['shield', 'Decide', 'Impact vs. urgency\nChoose mitigation path'],
    ['wrench', 'Act', 'Execute runbook\nCommunicate & log'],
    ['checkcircle', 'Verify', 'Confirm recovery\nPost-incident review'],
  ];
  steps.forEach((r, i) => {
    const y = 176 + i * 78;
    box(s, 1366, y, 266, 68, { fill: '07172A', line: '415B2A', trans: 0, r: 8 });
    badge(s, String(i + 1), 1354, y + 12, 32, { fill: A.lime, sz: 12 });
    icon(s, r[0], i === 4 ? 'white' : 'lblue', 1400, y + 16, 36);
    txt(s, r[1], 1450, y + 12, 130, 16, { sz: 10.5, b: true, color: A.lime });
    txt(s, r[2], 1450, y + 32, 156, 28, { sz: 8.2, color: A.sub, lh: 1.1 });
  });
  box(s, 1348, 580, 300, 260, { fill: '061323', line: '415B2A', trans: 0, r: 8 });
  txt(s, 'Runbook Shortcuts', 1362, 592, 200, 20, { sz: 10.5, b: true, color: A.lime });
  const shorts = [
    ['High Return Temp', 'Increase flow / Capacity'],
    ['Low dT', 'Check flow / Bypass'],
    ['Low Flow', 'Pump / Valve / Filter'],
    ['High Pressure', 'Leak / Blockage'],
    ['Temp Throttling', 'Load shed / Policy'],
    ['Escalation', 'NOC -> DC Ops -> Vendor'],
  ];
  shorts.forEach((r, i) => {
    const y = 626 + i * 34;
    s.ell(1360, y + 4, 19, 19, { fill: '07172A', line: A.sub, lineW: 1 });
    txt(s, '+', 1360, y + 3, 19, 19, { sz: 11, color: A.sub, align: 'center' });
    txt(s, r[0], 1392, y, 110, 22, { sz: 8.1, color: A.sub });
    txt(s, r[1], 1510, y, 120, 22, { sz: 8.1, color: A.white });
  });
}

function footerBar(s) {
  box(s, 14, 864, 1644, 64, { fill: '061323', trans: 0, r: 6 });
  const groups = [
    ['warn', 'red', 'Active Alerts', '3 Critical     8 Warning', A.red],
    ['wrench', 'lblue', 'Next Maintenance', 'Filters: 2 days     Pumps: 12 days', A.lime],
    ['cloud', 'lblue', 'Weather Impact', 'High ambient     Risk up', A.red],
    ['gauge', 'lblue', 'Capacity Headroom', 'Chiller: 22%     Power: 18%', A.lime],
  ];
  groups.forEach((g, i) => {
    const x = 32 + i * 240;
    icon(s, g[0], g[1], x, 882, 32);
    txt(s, g[2], x + 46, 880, 138, 18, { sz: 8.8, b: true, color: A.sub });
    txt(s, g[3], x + 46, 900, 170, 18, { sz: 8.8, b: true, color: g[4] });
    if (i < 3) vline(s, x + 214, 878, 38, A.line);
  });
  txt(s, 'Synthetic validation slide  -  Editable PPTX reconstruction example  -', 990, 889, 500, 28, { sz: 13, color: A.sub, align: 'right' });
  txt(s, 'Slide 001', 1498, 889, 130, 28, { sz: 15, b: true, color: A.cyan });
}

function s1(s) {
  bg(s);
  txt(s, 'AI Data Center Cooling Loop Risk Map', 22, 14, 920, 52, { sz: 33, b: true });
  txt(s, 'From sensor drift to thermal throttling: where operations teams lose margin', 22, 72, 760, 24, { sz: 15, color: A.cyan, b: true });
  sensorPanel(s);
  coolingLoop(s);
  pumpPanel(s);
  heatPanel(s);
  riskTable(s);
  kpiPanel(s);
  playbook(s);
  footerBar(s);
}

module.exports = { s1 };
