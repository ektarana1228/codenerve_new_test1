// The locked-down VS Code configuration baked into every session container.
//
// CLAUDE.md hard rule: "Autocomplete stays off. Do not re-enable any suggestion
// features." Monaco enforced this with construction options; real VS Code ships
// IntelliSense ON, so we must re-assert every suggestion lever here AND keep the
// candidate from changing them. These settings are written as BOTH machine
// (user) settings and workspace settings, and the settings files are made
// read-only inside the container so the candidate cannot flip them back.
//
// NOTE (accepted regression, signed off before build): clipboard copy/cut/paste
// blocking and the >500-char large-paste guard that MonacoEditor.tsx enforced in
// the parent DOM cannot be reproduced from inside a cross-origin VS Code frame
// without patching VS Code itself. They are intentionally NOT enforced here.

export interface ConfigLayerOptions {
  // 'vs-dark' | 'vs' style theme, mapped to a VS Code built-in theme.
  theme: 'dark' | 'light'
  // Post-submission: mount + settings make the whole workspace read-only.
  readOnly: boolean
  // PROJECT (OpenCode) sessions: keep the same lockdown, but the bundled OpenCode
  // sidebar extension is expected - do not treat it as an unwanted recommendation.
  project?: boolean
}

// The suggestion/autocomplete kill-switch - every lever CLAUDE.md's Monaco
// config disabled, plus the language-service equivalents VS Code adds.
const AUTOCOMPLETE_OFF: Record<string, unknown> = {
  'editor.quickSuggestions': { other: false, comments: false, strings: false },
  'editor.suggestOnTriggerCharacters': false,
  'editor.acceptSuggestionOnEnter': 'off',
  'editor.tabCompletion': 'off',
  'editor.wordBasedSuggestions': 'off',
  'editor.parameterHints.enabled': false,
  'editor.inlineSuggest.enabled': false,
  'editor.snippetSuggestions': 'none',
  'editor.suggest.preview': false,
  'editor.suggest.showWords': false,
  'editor.suggest.showSnippets': false,
  'editor.hover.enabled': false,
  // Built-in TS/JS language service suggestions.
  'typescript.suggest.enabled': false,
  'typescript.suggest.autoImports': false,
  'javascript.suggest.enabled': false,
  'javascript.suggest.autoImports': false,
}

const LOCKDOWN: Record<string, unknown> = {
  'telemetry.telemetryLevel': 'off',
  'security.workspace.trust.enabled': false,
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'extensions.ignoreRecommendations': true,
  'workbench.enableExperiments': false,
  'workbench.settings.enableNaturalLanguageSearch': false,
  'update.mode': 'none',
  'npm.fetchOnlinePackageInfo': false,
  // Terminal is an exfiltration/escape surface in an assessment. Best-effort
  // disable from settings; the image also drops shells (see Dockerfile notes).
  'terminal.integrated.showExitAlert': false,
  'terminal.integrated.enablePersistentSessions': false,
  // Fast disk writes so the sync agent sees edits within ~1s.
  'files.autoSave': 'afterDelay',
  'files.autoSaveDelay': 1000,
}

// PROJECT (OpenCode) sessions: point the bundled OpenCode sidebar extension at
// the in-image binary and let it auto-start its embedded server so the panel is
// usable as soon as the candidate opens it. Keys match the extension manifest
// (Pacoaldev.opencode-mcp-vscode). Harmless if a future extension ignores them.
const OPENCODE_SETTINGS: Record<string, unknown> = {
  'opencode.bin': '/usr/local/bin/opencode',
  'opencode.autoStartServer': true,
  // Cleaner delivery-based UI: no Welcome tab / release notes / tips clutter.
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.welcomePage.walkthroughs.openOnInstall': false,
}

// Build the settings.json contents for a given theme / lock state.
export function buildSettings(opts: ConfigLayerOptions): Record<string, unknown> {
  const dark = opts.theme === 'dark'
  const settings: Record<string, unknown> = {
    ...AUTOCOMPLETE_OFF,
    ...LOCKDOWN,
    ...(opts.project ? OPENCODE_SETTINGS : {}),
    'workbench.colorTheme': dark ? 'Default Dark Modern' : 'Default Light Modern',
    'workbench.preferredDarkColorTheme': 'Default Dark Modern',
    'workbench.preferredLightColorTheme': 'Default Light Modern',
    'window.autoDetectColorScheme': false,
    // Keep browser-hosted/native chrome aligned with the chosen workbench theme.
    'window.systemColorTheme': dark ? 'dark' : 'light',
    // Match the apexcoder description panel (~15px) so both sides read the same size.
    'editor.fontSize': 15,
    'markdown.preview.fontSize': 15,
    'editor.minimap.enabled': false,
    'editor.lineNumbers': 'on',
    'editor.wordWrap': 'on',
    'editor.scrollBeyondLastLine': false,
    // Use VS Code's full notebook layout: individual bordered cards rather
    // than compact, full-width focus rules between cells.
    'notebook.compactView': false,
    'notebook.cellFocusIndicator': 'border',
    // Single-clicking files should open real tabs instead of replacing one preview tab.
    'workbench.editor.enablePreview': false,
    'workbench.editor.enablePreviewFromQuickOpen': false,
    'workbench.colorCustomizations': dark
      ? {
          'titleBar.activeBackground': '#181818',
          'titleBar.inactiveBackground': '#181818',
          'editorGroupHeader.tabsBackground': '#181818',
          'editorGroupHeader.tabsBorder': '#303030',
          'editorGroupHeader.noTabsBackground': '#181818',
          'editorGroup.border': '#303030',
          'editorGroup.emptyBackground': '#101010',
          'tab.activeBackground': '#181818',
          'tab.inactiveBackground': '#181818',
          'tab.border': '#303030',
          'tab.activeBorder': '#303030',
          'tab.activeBorderTop': '#303030',
          'tab.unfocusedActiveBorder': '#303030',
          'tab.unfocusedActiveBorderTop': '#303030',
          'breadcrumb.background': '#181818',
          'breadcrumb.foreground': '#cccccc',
          'breadcrumb.focusForeground': '#ffffff',
          'breadcrumb.activeSelectionForeground': '#ffffff',
          'sideBar.background': '#181818',
          'sideBar.foreground': '#cccccc',
          'sideBar.border': '#303030',
          'sideBarSectionHeader.background': '#181818',
          'sideBarSectionHeader.border': '#303030',
          'activityBar.background': '#181818',
          'activityBar.border': '#303030',
          'list.background': '#181818',
          'list.foreground': '#cccccc',
          'list.activeSelectionBackground': '#04395e',
          'list.activeSelectionForeground': '#ffffff',
          'list.inactiveSelectionBackground': '#37373d',
          'list.hoverBackground': '#2a2d2e',
          'list.focusOutline': '#2f81f7',
          // Explorer indentation guides are separate tree tokens. Without
          // explicitly setting them, a fresh VS Code profile can retain the
          // built-in light stroke even while the rest of the workbench is dark.
          'tree.indentGuidesStroke': '#303030',
          'tree.inactiveIndentGuidesStroke': '#2a2a2a',
          'tree.tableColumnsBorder': '#303030',
          'contrastBorder': '#303030',
          'contrastActiveBorder': '#303030',
          'focusBorder': '#2f81f7',
          'editor.background': '#101010',
          'editor.foreground': '#cccccc',
          'editorGutter.background': '#101010',
          'editorLineNumber.foreground': '#858585',
          'editorLineNumber.activeForeground': '#cccccc',
          'notebook.editorBackground': '#101010',
          // Match VS Code's native notebook cards: a slightly raised fill and
          // a neutral one-pixel outline around both Markdown and code cells.
          'notebook.cellEditorBackground': '#181818',
          'notebook.focusedCellBackground': '#181818',
          'notebook.selectedCellBackground': '#181818',
          'notebook.cellBorderColor': '#303030',
          'notebook.focusedCellBorder': '#303030',
          'notebook.inactiveFocusedCellBorder': '#303030',
          'notebook.selectedCellBorder': '#303030',
          'notebook.focusedCellShadow': 'transparent',
          'notebook.cellToolbarSeparator': '#303030',
          'notebook.cellInsertionIndicator': '#2f81f7',
          'notebook.focusedEditorBorder': '#2f81f7',
          'notebook.outputContainerBackgroundColor': '#181818',
          'notebook.outputContainerBorderColor': '#303030',
          'statusBar.background': '#181818',
          'panel.background': '#181818',
        }
      : {
          'titleBar.activeBackground': '#f1f2f5',
          'titleBar.inactiveBackground': '#f1f2f5',
          'editorGroupHeader.tabsBackground': '#f1f2f5',
          'editorGroupHeader.tabsBorder': '#d7dce5',
          'editorGroupHeader.noTabsBackground': '#f1f2f5',
          'editorGroup.border': '#d7dce5',
          'editorGroup.emptyBackground': '#ffffff',
          'tab.activeBackground': '#ffffff',
          'tab.inactiveBackground': '#f1f2f5',
          'tab.border': '#d7dce5',
          'tab.activeBorder': '#d7dce5',
          'tab.activeBorderTop': '#d7dce5',
          'tab.unfocusedActiveBorder': '#d7dce5',
          'tab.unfocusedActiveBorderTop': '#d7dce5',
          'breadcrumb.background': '#ffffff',
          'breadcrumb.foreground': '#1f2328',
          'breadcrumb.focusForeground': '#0f141a',
          'breadcrumb.activeSelectionForeground': '#0f141a',
          'sideBar.background': '#f7f8fb',
          'sideBar.foreground': '#1f2328',
          'sideBar.border': '#d7dce5',
          'sideBarSectionHeader.background': '#eef1f6',
          'sideBarSectionHeader.border': '#d7dce5',
          'activityBar.background': '#eef1f6',
          'activityBar.border': '#d7dce5',
          'list.background': '#f7f8fb',
          'list.foreground': '#1f2328',
          'list.activeSelectionBackground': '#cfe8ff',
          'list.activeSelectionForeground': '#0f141a',
          'list.inactiveSelectionBackground': '#e6ebf2',
          'list.hoverBackground': '#e9edf4',
          'list.focusOutline': '#0969da',
          'tree.indentGuidesStroke': '#d7dce5',
          'tree.inactiveIndentGuidesStroke': '#e6ebf2',
          'tree.tableColumnsBorder': '#d7dce5',
          'contrastBorder': '#d7dce5',
          'contrastActiveBorder': '#d7dce5',
          'focusBorder': '#0969da',
          'editor.background': '#ffffff',
          'editor.foreground': '#1f2328',
          'editorGutter.background': '#ffffff',
          'editorLineNumber.foreground': '#656d76',
          'editorLineNumber.activeForeground': '#1f2328',
          'notebook.editorBackground': '#ffffff',
          'notebook.cellEditorBackground': '#ffffff',
          'notebook.focusedCellBackground': '#ffffff',
          'notebook.selectedCellBackground': '#f1f2f5',
          'notebook.cellBorderColor': '#d7dce5',
          'notebook.focusedCellBorder': '#d7dce5',
          'notebook.inactiveFocusedCellBorder': '#d7dce5',
          'notebook.selectedCellBorder': '#d7dce5',
          'notebook.focusedCellShadow': 'transparent',
          'notebook.cellToolbarSeparator': '#d7dce5',
          'notebook.cellInsertionIndicator': '#0969da',
          'notebook.focusedEditorBorder': '#0969da',
          'notebook.outputContainerBackgroundColor': '#ffffff',
          'notebook.outputContainerBorderColor': '#d7dce5',
          'statusBar.background': '#f1f2f5',
          'panel.background': '#f1f2f5',
        },
  }
  if (opts.readOnly) {
    // Post-submission: every file in the workspace becomes read-only.
    settings['files.readonlyInclude'] = { '**': true }
  }
  return settings
}

// openvscode-server CLI arguments. Two things worth calling out:
//  - We disable the server's own connection token and instead gate access at our
//    reverse proxy with a session-scoped token, so we never scrape logs.
//  - --server-base-path makes VS Code emit asset URLs under /vscode/<id>/, so the
//    reverse proxy forwards verbatim with no path rewriting and absolute asset
//    references (/static/…) resolve correctly through the proxy.
// The user-data-dir openvscode-server reads USER settings from
// (<dir>/User/settings.json). Pinned so the orchestrator can seed
// workbench.colorTheme there - that setting is application-scoped and a value in
// the workspace .vscode/settings.json is ignored, so the theme MUST live here
// for dark/light to follow the platform. Pre-created (server-owned) in
// project.Dockerfile so the server can write its own state into it at boot.
export const USER_DATA_DIR = '/home/workspace/.openvscode-server/data'

export function serverArgs(folder: string, basePath: string): string[] {
  return [
    '--host', '0.0.0.0',
    '--port', '3000',
    '--without-connection-token',
    '--disable-telemetry',
    '--disable-workspace-trust',
    '--server-base-path', basePath,
    '--default-folder', folder,
    '--user-data-dir', USER_DATA_DIR,
  ]
}
