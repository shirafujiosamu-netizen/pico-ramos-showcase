/* Scene toast renderer: label/idx/total arrive in the query string */
(function () {
  'use strict';
  var q = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return;
    var p = kv.split('=');
    q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
  });
  document.getElementById('tNum').textContent = (q.idx || '1') + ' / ' + (q.total || '1');
  document.getElementById('tName').textContent = q.label || '场景';
})();
