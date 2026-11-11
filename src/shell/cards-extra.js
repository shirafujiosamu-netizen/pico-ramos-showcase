/* Data-driven cards: clock, pomodoro, sys, weather, schedule, vpn.
 * Kept in a separate file so the shell bootstrap stays readable; os.html loads
 * this before os.js and os.js calls window.PicoCards.build(kind, card). */
(function () {
  'use strict';

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* --- shared ring gauge: 88px svg, two circles, set via style --- */
  function ring(label) {
    const box = el('div', 'pc-ring');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 88 88');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bg.setAttribute('cx', '44'); bg.setAttribute('cy', '44'); bg.setAttribute('r', '36');
    bg.setAttribute('class', 'pc-ring-bg');
    const fg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fg.setAttribute('cx', '44'); fg.setAttribute('cy', '44'); fg.setAttribute('r', '36');
    fg.setAttribute('class', 'pc-ring-fg');
    fg.setAttribute('transform', 'rotate(-90 44 44)');
    const C = 2 * Math.PI * 36;
    fg.setAttribute('stroke-dasharray', String(C));
    fg.setAttribute('stroke-dashoffset', String(C));
    svg.appendChild(bg); svg.appendChild(fg);
    const val = el('div', 'pc-ring-val', '--');
    const cap = el('div', 'pc-ring-cap', label);
    box.appendChild(svg); box.appendChild(val); box.appendChild(cap);
    box._set = function (pct, text) {
      const p = Math.max(0, Math.min(100, pct || 0));
      fg.setAttribute('stroke-dashoffset', String(C * (1 - p / 100)));
      val.textContent = text != null ? text : Math.round(p) + '%';
    };
    return box;
  }

  /* ---------------------------- clock ---------------------------- */
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const ZONE_CN = {
    'Asia/Shanghai': '中国标准时间', 'Asia/Hong_Kong': '香港时间',
    'Asia/Taipei': '台北时间', 'Asia/Tokyo': '日本标准时间',
    'Asia/Seoul': '韩国标准时间', 'Europe/London': '英国时间',
    'Europe/Paris': '欧洲中部时间', 'America/New_York': '美东时间',
    'America/Los_Angeles': '美西时间', 'UTC': '协调世界时',
  };

  /* Split a Date into the requested IANA zone. No zone = plain local time. */
  function clockParts(d, zone) {
    if (!zone) {
      return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds(),
               mo: d.getMonth() + 1, day: d.getDate(), wd: d.getDay() };
    }
    try {
      const f = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, hour12: false, hour: '2-digit', minute: '2-digit',
        second: '2-digit', month: '2-digit', day: '2-digit', weekday: 'short',
      });
      const p = {};
      f.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return { h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second),
               mo: Number(p.month), day: Number(p.day), wd: WD[p.weekday] || 0 };
    } catch (e) { return clockParts(d, ''); }
  }

  /* GMT+8 / GMT-4 / GMT+5:30 -> hours, DST-aware via shortOffset. */
  function zoneOffset(d, zone) {
    if (!zone) return -d.getTimezoneOffset() / 60;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, timeZoneName: 'shortOffset',
      }).formatToParts(d);
      const hit = parts.filter(function (x) { return x.type === 'timeZoneName'; })[0];
      const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(hit ? hit.value : '');
      if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] || 0) / 60);
    } catch (e) { /* fall through to local */ }
    return -d.getTimezoneOffset() / 60;
  }

  function zoneName(card) {
    let auto = '';
    try { auto = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    return card.timezone || auto || '本地时间';
  }

  function buildClock(card) {
    const n = el('div', 'pc-card pc-clock');
    const time = el('div', 'pc-clock-time', '--:--');
    const date = el('div', 'pc-clock-date', '');
    const sec = el('div', 'pc-clock-sec', '');
    /* clock and weather are one card: a time with no sky next to it feels naked */
    const wx = el('div', 'pc-clock-wx', '');
    const tz = el('div', 'pc-clock-tz', '');
    /* seconds belong next to the big digits, not on their own lonely line */
    const line = el('div', 'pc-clock-line');
    line.appendChild(time); line.appendChild(sec);
    n.appendChild(line); n.appendChild(date);
    n.appendChild(tz); n.appendChild(wx);

    function paintZone() {
      const d = new Date();
      const zone = zoneName(card);
      const off = zoneOffset(d, card.timezone ? zone : '');
      const whole = Math.abs(off);
      const offTxt = 'UTC' + (off < 0 ? '-' : '+') +
        (Number.isInteger(whole) ? whole : whole.toFixed(1).replace(/\.0$/, ''));
      tz.textContent = zone.replace(/_/g, ' ') + ' · ' + offTxt;
      tz.title = (ZONE_CN[zone] || zone) + ' ' + offTxt;
    }

    function pullWeather() {
      paintZone();
      if (!window.os || !window.os.weather) return;
      window.os.weather(card.city || '上海').then(function (r) {
        if (!r || !r.ok) { wx.textContent = ''; return; }
        const d = r.data;
        wx.textContent = (d.icon || '') + ' ' + Math.round(d.temp) + '°  ' +
          (d.text || '') + '  ·  最高 ' + Math.round(d.hi) + '° 最低 ' +
          Math.round(d.lo) + '°  ·  湿度 ' + d.humidity + '%';
      }).catch(function () { wx.textContent = ''; });
    }
    pullWeather();
    /* 30s ticker also refreshes the zone label, so a DST switch or a system
       timezone change shows up without a restart. */
    n._pull = pullWeather;

    function tick() {
      const d = new Date();
      const p = clockParts(d, card.timezone || '');
      time.textContent = pad(p.h) + ':' + pad(p.m);
      sec.textContent = pad(p.s);
      date.textContent = p.mo + '月' + p.day + '日 · ' + WEEK[p.wd];
    }
    tick();
    n._tick = tick;
    n._dispose = function () { /* interval owned by os.js ticker */ };
    return n;
  }

  /* --------------------------- pomodoro --------------------------- */
  function buildPomodoro(card) {
    const n = el('div', 'pc-card pc-pomo');
    const FOCUS = 25 * 60, BREAK = 5 * 60;
    let left = FOCUS, running = false, phase = 'focus', rounds = 0;

    const time = el('div', 'pc-pomo-time', '25:00');
    const phaseEl = el('div', 'pc-pomo-phase', '专注');
    const ringBox = el('div', 'pc-pomo-bar');
    const fill = el('i', '');
    ringBox.appendChild(fill);

    const row = el('div', 'pc-pomo-row');
    const btnStart = el('button', 'pc-btn pc-btn-main', '开始');
    const btnReset = el('button', 'pc-btn', '重置');
    row.appendChild(btnStart); row.appendChild(btnReset);

    const foot = el('div', 'pc-pomo-foot', '已完成 0 个番茄');
    n.appendChild(phaseEl); n.appendChild(time); n.appendChild(ringBox);
    n.appendChild(row); n.appendChild(foot);

    function paint() {
      time.textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60);
      phaseEl.textContent = phase === 'focus' ? '专注' : '休息';
      const total = phase === 'focus' ? FOCUS : BREAK;
      fill.style.width = (100 - (left / total) * 100).toFixed(2) + '%';
      btnStart.textContent = running ? '暂停' : '开始';
      foot.textContent = '已完成 ' + rounds + ' 个番茄';
      n.classList.toggle('is-break', phase === 'break');
    }

    function step() {
      if (!running) return;
      left -= 1;
      if (left <= 0) {
        if (phase === 'focus') { rounds += 1; phase = 'break'; left = BREAK; }
        else { phase = 'focus'; left = FOCUS; }
        running = false;
      }
      paint();
    }

    btnStart.addEventListener('click', function (e) {
      e.stopPropagation();
      running = !running;
      paint();
    });
    btnReset.addEventListener('click', function (e) {
      e.stopPropagation();
      running = false; phase = 'focus'; left = FOCUS;
      paint();
    });

    paint();
    n._tick = step;
    return n;
  }

  /* ----------------------------- sys ----------------------------- */
  function buildSys(card) {
    const n = el('div', 'pc-card pc-sys');
    const row = el('div', 'pc-sys-row');
    const cCpu = ring('CPU'), cMem = ring('内存'), cDisk = ring('磁盘');
    row.appendChild(cCpu); row.appendChild(cMem); row.appendChild(cDisk);
    const foot = el('div', 'pc-sys-foot', '已开机 --');
    n.appendChild(row); n.appendChild(foot);

    let busy = false;
    function pull() {
      if (busy || !window.os || !window.os.sysinfo) return;
      busy = true;
      window.os.sysinfo().then(function (d) {
        busy = false;
        if (!d) return;
        cCpu._set(d.cpu, Math.round(d.cpu) + '%');
        const mp = d.memTotal ? (d.memUsed / d.memTotal) * 100 : 0;
        cMem._set(mp, Math.round(mp) + '%');
        const dp = d.disk && d.disk.total ? ((d.disk.total - d.disk.free) / d.disk.total) * 100 : 0;
        cDisk._set(dp, Math.round(dp) + '%');
        const h = Math.floor((d.uptime || 0) / 3600);
        foot.textContent = '已开机 ' + h + ' 小时 · 内存 ' +
          (d.memUsed / 1024 / 1024 / 1024).toFixed(1) + ' / ' +
          (d.memTotal / 1024 / 1024 / 1024).toFixed(1) + 'G';
      }).catch(function () { busy = false; });
    }
    pull();
    /* _pull only fires every 30s. The monitor must visibly move, so hook the
       1s tick queue instead. sysinfo() is a cheap local read. */
    n._tick = pull;
    return n;
  }

  /* --------------------------- weather --------------------------- */
  function buildWeather(card) {
    const n = el('div', 'pc-card pc-wx');
    const top = el('div', 'pc-wx-top');
    const icon = el('div', 'pc-wx-icon', '--');
    const temp = el('div', 'pc-wx-temp', '--°');
    top.appendChild(icon); top.appendChild(temp);

    const city = el('div', 'pc-wx-city', card.city || '上海');
    const desc = el('div', 'pc-wx-desc', '正在获取…');
    const meta = el('div', 'pc-wx-meta', '');
    n.appendChild(top); n.appendChild(city); n.appendChild(desc); n.appendChild(meta);

    function pull() {
      if (!window.os || !window.os.weather) return;
      window.os.weather(card.city || '上海').then(function (r) {
        if (!r || !r.ok) { desc.textContent = '取不到天气'; return; }
        const d = r.data;
        icon.textContent = d.icon || '--';
        temp.textContent = Math.round(d.temp) + '°';
        city.textContent = d.city || card.city || '上海';
        desc.textContent = d.text || '';
        meta.textContent = '最高 ' + Math.round(d.hi) + '° / 最低 ' + Math.round(d.lo) +
          '° · 湿度 ' + d.humidity + '% · 风 ' + d.wind + 'km/h';
      }).catch(function () { desc.textContent = '取不到天气'; });
    }
    pull();
    n._pull = pull;
    return n;
  }

  /* -------------------------- schedule --------------------------- */
  function buildSchedule(card) {
    const n = el('div', 'pc-card pc-sch');
    const head = el('div', 'pc-sch-head');
    const count = el('div', 'pc-sch-count', '');
    head.appendChild(count);

    const list = el('div', 'pc-sch-list');
    const add = el('input', 'pc-sch-add');
    add.type = 'text';
    add.placeholder = '加一条，回车保存';

    n.appendChild(head); n.appendChild(list); n.appendChild(add);

    function todayKey() {
      const d = new Date();
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    let items = [];
    function paint() {
      list.textContent = '';
      if (!items.length) {
        list.appendChild(el('div', 'pc-sch-empty', '暂无安排'));
      }
      items.forEach(function (it, i) {
        const row = el('label', 'pc-sch-item' + (it.done ? ' done' : ''));
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!it.done;
        cb.addEventListener('change', function (e) {
          e.stopPropagation();
          items[i].done = cb.checked;
          save();
          paint();
        });
        const txt = el('span', '', it.text);
        row.appendChild(cb); row.appendChild(txt);
        list.appendChild(row);
      });
      const left = items.filter(function (x) { return !x.done; }).length;
      count.textContent = left ? left + ' 项待办' : (items.length ? '全部完成' : '');
    }

    function save() {
      if (!window.os || !window.os.scheduleSet) return;
      window.os.scheduleSet({ date: todayKey(), items: items }).catch(function () {});
    }

    add.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const v = add.value.trim();
      if (!v) return;
      items.push({ text: v, done: false });
      add.value = '';
      save();
      paint();
    });

    function load() {
      if (!window.os || !window.os.scheduleGet) { paint(); return; }
      window.os.scheduleGet(todayKey()).then(function (r) {
        items = (r && r.items) || [];
        paint();
      }).catch(function () { paint(); });
    }
    load();
    n._load = load;
    return n;
  }


  /* ------------------------------ vpn ------------------------------ */
  function buildVpn(card) {
    const n = el('div', 'pc-card pc-vpn');

    const head = el('div', 'pc-vpn-top');
    const dot = el('i', 'pc-vpn-dot', '');
    const state = el('div', 'pc-vpn-state', '检测中…');
    head.appendChild(dot); head.appendChild(state);

    const mode = el('div', 'pc-vpn-mode', '—');
    const rows = el('div', 'pc-vpn-rows');
    function row(label) {
      const r = el('div', 'pc-vpn-row');
      const v = el('span', 'pc-vpn-val', '—');
      r.appendChild(el('span', 'pc-vpn-key', label));
      r.appendChild(v);
      rows.appendChild(r);
      return v;
    }
    const vIp = row('出口 IP');
    const vRegion = row('地区');
    const vProxy = row('代理');
    const vClient = row('客户端');

    const actions = el('div', 'pc-vpn-actions');
    const btnRefresh = el('button', 'pc-btn', '刷新');
    const btnOpen = el('button', 'pc-btn pc-btn-main', '打开客户端');
    actions.appendChild(btnRefresh); actions.appendChild(btnOpen);

    const foot = el('div', 'pc-vpn-foot', '每 30 秒自动检测');
    n.appendChild(head); n.appendChild(mode); n.appendChild(rows);
    n.appendChild(actions); n.appendChild(foot);

    let busy = false;
    function paint(r) {
      if (!r || !r.ok) {
        n.dataset.state = 'off';
        state.textContent = '检测失败';
        mode.textContent = (r && r.error) ? r.error : '无法读取状态';
        foot.textContent = '点「刷新」重试';
        return;
      }
      n.dataset.state = r.state || 'off';
      state.textContent = r.state === 'connected' ? '已连接'
        : r.state === 'standby' ? '待连接' : '未连接';
      mode.textContent = r.mode || '直连';

      vIp.textContent = r.ip || '检测不到';
      vRegion.textContent = [r.country, r.city].filter(Boolean).join(' · ') ||
        (r.isp || '—');
      vProxy.textContent = r.proxyEnabled
        ? (r.proxyServer || '系统代理已开')
        : (r.tun ? (r.tunName || 'TUN') : '直连');
      vClient.textContent = r.client || '—';

      const t = new Date(r.checkedAt || Date.now());
      foot.textContent = '自动检测 · ' + pad(t.getHours()) + ':' +
        pad(t.getMinutes()) + ':' + pad(t.getSeconds()) +
        (r.ipStale ? ' · 出口 IP 暂不可用' : '');
      vIp.title = '点击复制 IP';
    }

    function pull(force) {
      if (busy || !window.os || !window.os.vpn) return;
      busy = true;
      window.os.vpn({ force: !!force }).then(function (r) {
        busy = false;
        paint(r);
      }).catch(function () {
        busy = false;
        paint({ ok: false, error: '读取失败' });
      });
    }

    btnRefresh.addEventListener('click', function (e) {
      e.stopPropagation();
      pull(true);
    });
    btnOpen.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!window.os || !window.os.vpnLaunch) return;
      window.os.vpnLaunch().then(function (r) {
        foot.textContent = r && r.ok ? '客户端已启动' : ((r && r.error) || '启动失败');
        setTimeout(function () { pull(false); }, 1800);
      }).catch(function () { foot.textContent = '启动失败'; });
    });
    vIp.addEventListener('click', function (e) {
      e.stopPropagation();
      const txt = vIp.textContent || '';
      if (!txt || txt === '检测不到') return;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(function () {});
      foot.textContent = '已复制 ' + txt;
    });

    pull(false);
    n._pull = function () { pull(false); };
    return n;
  }

  window.PicoCards = {
    build: function (kind, card) {
      if (kind === 'clock') return buildClock(card);
      if (kind === 'pomodoro') return buildPomodoro(card);
      if (kind === 'sys') return buildSys(card);
      if (kind === 'vpn') return buildVpn(card);
      if (kind === 'weather') return buildClock(card);  /* merged into the clock */
      if (kind === 'schedule') return buildSchedule(card);
      return null;
    },
  };
})();
