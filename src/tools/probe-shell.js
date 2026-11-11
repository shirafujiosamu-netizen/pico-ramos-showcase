const WebSocket = require('F:/job/the-regolith-jar/node_modules/ws');
const http = require('http');
http.get('http://127.0.0.1:9223/json/list', (res) => {
  let b = '';
  res.on('data', (d) => (b += d));
  res.on('end', async () => {
    const list = JSON.parse(b).filter((x) => x.type === 'page' && x.url.includes('shell.html'));
    for (const t of list) {
      await new Promise((done) => {
        const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
        const expr = [
          '(function(){',
          'var c=document.getElementById("card");',
          'var txt=String(document.body.innerText||"").slice(0,44);',
          'return {txt:txt, bg:c?getComputedStyle(c).backgroundColor:null, cls:document.body.className, w:innerWidth, h:innerHeight};',
          '})()',
        ].join('');
        ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: expr } })));
        ws.on('message', (m) => { console.log(m.toString().slice(0, 320)); ws.close(); done(); });
      });
    }
  });
});
