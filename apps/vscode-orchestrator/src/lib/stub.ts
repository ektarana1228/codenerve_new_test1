import type { Workspace } from './workspace'

// DEV-ONLY fallback rendered when VSCODE_MODE=stub or Docker is unavailable.
// It is NOT VS Code - it is a minimal same-origin editor page that preserves the
// rest of the architecture (iframe embedding, workspace file model, autosave ->
// orchestrator -> DB) so the full flow is demonstrable without Docker. The real
// path is openvscode-server in a container (VSCODE_MODE=docker).

const escapeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')

export function renderStubPage(opts: {
  sessionId: string
  token: string
  theme: 'dark' | 'light'
  readOnly: boolean
  workspace: Workspace
}): string {
  const dark = opts.theme !== 'light'
  const bg = dark ? '#1e1e1e' : '#ffffff'
  const fg = dark ? '#d4d4d4' : '#1f1f1f'
  const bar = dark ? '#252526' : '#f3f3f3'
  const border = dark ? '#333' : '#e0e0e0'
  const accent = '#0e639c'

  return `<!doctype html>
<html data-vscode-stub="1">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Editor</title>
<style>
  html,body{margin:0;height:100%;background:${bg};color:${fg};font-family:Menlo,Consolas,monospace;}
  #app{display:flex;flex-direction:column;height:100%;}
  #tabs{display:flex;background:${bar};border-bottom:1px solid ${border};overflow-x:auto;}
  .tab{padding:6px 14px;font-size:12px;cursor:pointer;border-right:1px solid ${border};white-space:nowrap;}
  .tab.active{background:${bg};color:${fg};}
  .tab:not(.active){color:${dark ? '#969696' : '#616161'};}
  #editor{flex:1;width:100%;box-sizing:border-box;border:0;outline:0;resize:none;
    background:${bg};color:${fg};font-family:inherit;font-size:14px;line-height:1.5;padding:12px;tab-size:4;}
  #status{padding:3px 12px;background:${accent};color:#fff;font-size:11px;}
</style>
</head>
<body>
<div id="app">
  <div id="tabs"></div>
  <textarea id="editor" spellcheck="false" ${opts.readOnly ? 'readonly' : ''}></textarea>
  <div id="status">${opts.readOnly ? 'Read-only (submitted)' : 'Ready'}</div>
</div>
<script>
(function(){
  var SESSION = ${escapeJson(opts.sessionId)};
  var TOKEN = ${escapeJson(opts.token)};
  var READONLY = ${opts.readOnly ? 'true' : 'false'};
  var ws = ${escapeJson(opts.workspace)};
  var active = ws.main;
  var tabsEl = document.getElementById('tabs');
  var editor = document.getElementById('editor');
  var statusEl = document.getElementById('status');
  var saveTimer = null;

  function renderTabs(){
    tabsEl.innerHTML = '';
    Object.keys(ws.files).forEach(function(name){
      var el = document.createElement('div');
      el.className = 'tab' + (name === active ? ' active' : '');
      el.textContent = name;
      el.onclick = function(){ active = name; editor.value = ws.files[name]; renderTabs(); };
      tabsEl.appendChild(el);
    });
  }
  function save(){
    fetch('/vscode/' + SESSION + '/_stub/files?tkn=' + encodeURIComponent(TOKEN), {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(ws)
    }).then(function(){ statusEl.textContent = 'Saved'; })
      .catch(function(){ statusEl.textContent = 'Save failed'; });
  }
  editor.addEventListener('input', function(){
    if (READONLY) return;
    ws.files[active] = editor.value;
    statusEl.textContent = 'Editing…';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 800);
  });
  editor.value = ws.files[active] || '';
  renderTabs();
})();
</script>
</body>
</html>`
}
