# Client API recon — read/write the composer draft from `conversation.composer.dock`

Scope: can a Web Client plugin registered into `conversation.composer.dock` (a) read the draft,
(b) replace the draft, (c) learn the current session id? Answer for the **installed** DSH NEXT
Desktop 2.0.21-next / Harness 0.2.1-rc.4. Every non-obvious claim cites installed code.
Where an expected API does **not** exist it is marked **NOT FOUND**.

## 0. Sources actually read

| What | Path (workspace-relative) |
|---|---|
| Conversation package (owns composer shell, input state, slot declarations) | `_asar/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js` (783 900 B) + `README.md` |
| Chat package (a **real** dock occupant: `activity`, `usage` pills) | `_asar/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js` (595 495 B) + `README.md` |
| Slot registry (registration options, duplicate-id rules) | `_asar/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js` |
| Slot renderer (where component props are assembled) | `_asar/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js`, `README.md` |
| Session scope provider (`sessionId`, `useSession`, `useProjection`) | `_asar/node_modules/@deepseek-ai/dsh-client-ui-session/lib/client.js`, `README.md` |
| Theme tokens | `_asar/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js`, `README.md` |
| Working third-party plugin in this same version | `purge-review/plugin/client.js` (uses `props.inputActions`, `props.sessionId`, `locale`, `inject`) |
| Plugin spec | `...\dsh-agent-preset\skills\cordis-plugin-development\SKILL.md`, `references\ui-plugin.md`, `references\practices.md`, `templates\decoration\client.js` |

Note: `dsh-client-ui-*` packages are **not** under `…\resources\app.asar.unpacked\node_modules` (only
`dsh-agent-preset`, `dsh-session-log-export`, `dsh-skill-badge`, `libreoffice-kit*` are unpacked). The
client packages live only inside `resources\app.asar`; the copies under `_asar\` are byte-identical
extractions used for line-numbered evidence. `dsh-client-ui-theme` was additionally verified in place
inside the asar.

## 1. TL;DR — the confirmed surface

```
component props in conversation.composer.dock (scope "session", list slot):
  sessionId          string                      // standard session prop
  inputActions       InputActions                // standard session prop  <-- write API lives here
  useInput           (sel?, eq?) => InputState   // standard session hook <-- read API lives here
  useSession         (sel?, eq?) => SessionSnapshot
  useProjection      (key) => unknown
  useConversation    (sel?, eq?) => ConversationSnapshot
  useSessions / useSessionStatus / useSessionRetainInfo / useSessionAccess   // root kit
  renderFactorySlot  fn
  t                  fn                          // ONLY if the registration passes `locale: NS`
  ...yourInject                                  // business share from your own registration `inject`
  ...ownerProps                                  // the renderSlot() second argument — here `{}`
```

Read the draft exactly:

```js
const draft = useInput((s) => s.draft);   // string, reactive; the only public read path
// one-shot read inside a click handler: mirror `draft` into a ref (see §3)
```

Write exactly two verbs:

```js
inputActions.setDraft(text)        // replace the WHOLE draft; no revision needed; NOT an undo step
inputActions.insertText(text, span) // splice at a captured span; needs span.draftRev; one undoable edit
```

There is **no** `props.draft`, **no** `props.setText`, **no** `ctx.composer`, **no** draft API on
`ctx.uiConversation` (see §8).

## 2. The slot: declaration, render site, and the exact props

### 2.1 Declaration (kind + scope)

`conversation.composer.dock` is declared as a **child of the `conversation.composer.bar`
registration** (the InputBar), as a `list` slot in strict `session` scope:

```
dsh-client-ui-conversation/lib/client.js:20097  const registerComposerBar = () => slots.register({
dsh-client-ui-conversation/lib/client.js:20098      name: "conversation.composer.bar",
dsh-client-ui-conversation/lib/client.js:20099      locale: NS,
dsh-client-ui-conversation/lib/client.js:20133      "conversation.composer.dock": {
dsh-client-ui-conversation/lib/client.js:20134          kind: "list",
dsh-client-ui-conversation/lib/client.js:20135          scope: "session"
dsh-client-ui-conversation/lib/client.js:20136      }
```

Consequences of `kind: "list"`: **`id` is mandatory**, entries sort by `priority` then `order`, and a
duplicate `id` at the same `priority` **throws at registration time**:

```
dsh-client-ui-slots/lib/index.js:181   case "list": {
dsh-client-ui-slots/lib/index.js:182       if (options.id === void 0) throw new Error(`list slot "${options.name}" requires options.id`);
dsh-client-ui-slots/lib/index.js:183       const occupant = rec.entries.find((e) => e.options.id === options.id && (e.options.priority ?? 0) === priority);
dsh-client-ui-slots/lib/index.js:184       if (occupant) throw new Error(`list slot "${options.name}" already has an entry with id "${options.id}" ${occupantHint(occupant)}`);
dsh-client-ui-slots/lib/index.js:221   next.sort(spec.kind === "list" ? (a, b) => (a.priority) - (b.priority) || (a.order) - (b.order) : …)
```

Valid registration options are enumerated in the entry record:
`key | id | order | label | priority | select | inject | children | store | locale | registrant`
(`dsh-client-ui-slots/lib/index.js:204-219`).

### 2.2 Render site — the dock rows sit below the input card

```
dsh-client-ui-conversation/lib/client.js:19364  (jsx)("div", {
dsh-client-ui-conversation/lib/client.js:19365      className: InputBar_module_css_default.dock,
dsh-client-ui-conversation/lib/client.js:19366      "data-composer-dock": true,
dsh-client-ui-conversation/lib/client.js:19367      children: [variant === "composer" && input !== void 0 && sessionId !== void 0
                                                        ? renderSlot("conversation.composer.dock", {})
                                                        : null,
dsh-client-ui-conversation/lib/client.js:19368      activity ? null : (jsx)(ContextMeter, { useProjection, t })]
```

Three consequences:

1. the owner props are literally `{}` — the parent passes **no** draft/input to the slot;
2. your entry renders **only** when the session binding exists (`input !== undefined && sessionId !== undefined`) and the bar variant is `composer` — so inside the dock `sessionId` is always defined;
3. your button is a **sibling of the context meter** in a centred flex row
   (`.CHtLlW_dock{justify-content:center;align-items:center;gap:12px;max-width:100%;padding-top:4px;display:flex}`,
   `InputBar.module.css` CSS string embedded at `dsh-client-ui-conversation/lib/client.js:18905`).

### 2.3 Where props come from (authoritative)

Props are assembled by the renderer as **kit → injected → slotInjected → ownerProps**:

```
dsh-client-ui-renderer/lib/client.js:773  function ContextualEntry({ slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, … }) {
dsh-client-ui-renderer/lib/client.js:784      return (jsx)(Comp, { ...kit, ...injected, ...slotInjected.props, ...contextual, ...ownerProps });
dsh-client-ui-renderer/lib/client.js:792  function renderEntry(slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext) {
dsh-client-ui-renderer/lib/client.js:793      if (slotInjected.slotHookFactories === void 0) return (jsx)(Comp, { ...kit, ...injected, ...slotInjected.props, ...ownerProps });
dsh-client-ui-renderer/lib/client.js:811  function SessionEntry({ entry, ownerProps, binding, slotKey, slotInjected, hookContext, hasHookContext }) {
dsh-client-ui-renderer/lib/client.js:815      const { kit, standard, actions } = standardKit(host, entry, "session", rootBinding, binding);
dsh-client-ui-renderer/lib/client.js:816      return renderEntry(slotKey, Comp, kit, standard, cachedSessionInject(entry, binding, actions), slotInjected, ownerProps, …);
```

`kit` is `standard` plus a few conditional seats:

```
dsh-client-ui-renderer/lib/client.js:736  function standardKit(host, entry, scope, rootBinding, scopeBinding) {
dsh-client-ui-renderer/lib/client.js:738      const kit = { ...standard, renderFactorySlot: boundRenderFactorySlot(entry) };
dsh-client-ui-renderer/lib/client.js:742      if (entry.locale !== void 0) {
dsh-client-ui-renderer/lib/client.js:745          kit["t"] = localeSeat(face, entry.locale);
dsh-client-ui-renderer/lib/client.js:748      const store = host.storeOf(entry, scopedStoreBinding);
dsh-client-ui-renderer/lib/client.js:750      if (store !== void 0) { kit["useStore"] = observableHook(store); kit["actions"] = store.actions; }
dsh-client-ui-renderer/lib/client.js:753      if (entry.children !== void 0) {
dsh-client-ui-renderer/lib/client.js:754          kit["renderSlot"] = boundRenderSlot(host, entry);
```

and `standard` = root sources + session-scope sources, with every `hooks` name turned into a
`use<Name>` prop and every `props` name spread verbatim:

```
dsh-client-ui-renderer/lib/client.js:667  function materializeStandardBinding(binding, optional, defaultKey) {
dsh-client-ui-renderer/lib/client.js:668      const standard = { ...binding.props };
dsh-client-ui-renderer/lib/client.js:671          standard[standardHookPropName(name)] = optional ? maybeObservableHook(source) : observableHook(source);
dsh-client-ui-renderer/lib/client.js:680  function standardProps(scope, rootBinding, scopeBinding) { … root + scopeBinding … }
dsh-client-ui-slots/lib/index.js:7        function standardHookPropName(name) { return `use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`; }
```

The two contribute sites that matter:

```
// session scope, always present: sessionId, useSession, useProjection
dsh-client-ui-session/lib/client.js:755  const BUILTIN_SOURCE = {
dsh-client-ui-session/lib/client.js:756      hooks: ["session"],
dsh-client-ui-session/lib/client.js:757      keyedHooks: ["projection"],
dsh-client-ui-session/lib/client.js:758      props: ["sessionId"],
dsh-client-ui-session/lib/client.js:759      resolve: (binding) => ({ hooks: { session: binding.session }, keyedHooks: { projection: (key) => … }, props: { sessionId: binding.sessionId } })

// ui-conversation contributes the input faces — THIS is where inputActions comes from
dsh-client-ui-conversation/lib/client.js:19917  ctx.uiSession.provide({
dsh-client-ui-conversation/lib/client.js:19918      hooks: ["conversation", "input"],
dsh-client-ui-conversation/lib/client.js:19919      props: ["inputActions"],
dsh-client-ui-conversation/lib/client.js:19920      resolve: (binding) => { … return {
dsh-client-ui-conversation/lib/client.js:19926              hooks: { conversation: conversation.snapshot, input: shell.state },
dsh-client-ui-conversation/lib/client.js:19930              props: { inputActions: shell.actions }
dsh-client-ui-conversation/lib/client.js:19932      }; }
```

Root seats (available in every scope, hence in the dock):
`useSessions`, `useSessionStatus`, `useSessionRetainInfo`, `useSessionAccess`
(`dsh-client-ui-session/lib/client.js:1104-1113`).

Cross-check in a **real dock occupant** (chat's stat pills, same slot):

```
dsh-client-ui-chat/lib/client.js:13314  ctx.slots.inject("conversation.composer.dock", function* () {
dsh-client-ui-chat/lib/client.js:13315      yield ctx.slots.register({ name: "conversation.composer.dock", id: "activity", order: 0, locale: NS, inject: statPillInject }, ActivityPill);
dsh-client-ui-chat/lib/client.js:13322      yield ctx.slots.register({ name: "conversation.composer.dock", id: "usage",    order: 1, locale: NS, inject: statPillInject }, UsagePill);
dsh-client-ui-chat/lib/client.js:7565   const ActivityPill = react.memo(function ActivityPill({ useChat, useProjection, usePerformanceUsage, t }) {
dsh-client-ui-chat/lib/client.js:7603   const UsagePill    = react.memo(function UsagePill({ useProjection, usePerformanceUsage, t }) {
```

Cross-check in a **third-party** plugin (`conversation.input.right`, same `list`/`session` shape):

```
purge-review/plugin/client.js:8684  ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
purge-review/plugin/client.js:8685      name: "conversation.input.right", id: "dsh-purge-rewind", order: 20,
purge-review/plugin/client.js:8688      inject: (sessionId) => ({ sessionId, t: ctx.locale.bind(NS) }),
purge-review/plugin/client.js:8692  }, RewindSafe);
purge-review/plugin/client.js:3348  const inputActions = props.inputActions;   // read straight off the slot props
purge-review/plugin/client.js:3009  if (inputActions && typeof inputActions.setDraft === "function") { … inputActions.setDraft(text || ""); }
```

**Answers to “is `sessionId` / `useInput` / `inputActions` / `t` / `renderSlot` present?”**

| prop | present in the dock? | evidence |
|---|---|---|
| `sessionId` | **yes** — standard session prop | `ui-session/lib/client.js:758,762`; `ui-renderer/lib/client.js:696-699,815` |
| `useSession` | **yes** | `ui-session/lib/client.js:756,760` + `standardHookPropName` (`ui-slots/lib/index.js:7-8`) |
| `useProjection` | **yes** (keyed hook `useProjection(key)`) | `ui-session/lib/client.js:757`; used by `UsagePill` `chat/lib/client.js:7605` |
| `useInput` | **yes** | `ui-conversation/lib/client.js:19918` (`hooks: ["conversation","input"]`) → `useInput` |
| `useConversation` | **yes** | same line (`conversation`) |
| `inputActions` | **yes** | `ui-conversation/lib/client.js:19919,19930` |
| `t` | **only if your registration passes `locale: "<ns>"`** | `ui-renderer/lib/client.js:742-746` |
| `renderSlot` | **no** — dock entries declare no `children` | `ui-renderer/lib/client.js:753-754` |
| `useStore` / `actions` | **no** — no `store` in your registration | `ui-renderer/lib/client.js:748-752` |
| `renderFactorySlot` | yes (stable fn, useless without a factory) | `ui-renderer/lib/client.js:740` |
| `props.draft`, `props.setText`, `props.setDraft` | **NOT FOUND** — `ownerProps` is `{}` (`client.js:19367`) | see §8 |

## 3. Reading the draft

`useInput` is a **store selector hook**: every `hooks` source is bound with
`useSyncExternalStoreWithSelector` (default `Object.is` equality), not a raw subscription.

```
dsh-client-ui-renderer/lib/client.js:159   return useSyncExternalStoreWithSelector(subscribe, getSnapshot, void 0, sel, eq);
dsh-client-ui-renderer/lib/client.js:671   standard[use<Name>] = optional ? maybeObservableHook(source) : observableHook(source);
```

The published state shape (this is the `useInput` snapshot):

```
dsh-client-ui-conversation/lib/client.js:15719  compose() {
dsh-client-ui-conversation/lib/client.js:15720      const core = this.core.state;
dsh-client-ui-conversation/lib/client.js:15721      return {
dsh-client-ui-conversation/lib/client.js:15722          draft: this.projection.clipboardText,   // <-- plain text of the draft
dsh-client-ui-conversation/lib/client.js:15723          attachmentIds: this.attachmentIds,     // string[]
dsh-client-ui-conversation/lib/client.js:15724          draftRev: this.rev,                    // monotonically increasing content revision
dsh-client-ui-conversation/lib/client.js:15725          phase: core.phase,                     // "plain" | "claimed" | "adjudicating" | "submitting"
dsh-client-ui-conversation/lib/client.js:15726          ...core.claim !== void 0 ? { claim: core.claim } : {},
dsh-client-ui-conversation/lib/client.js:15727          occurrences: this.projection.occurrences,
dsh-client-ui-conversation/lib/client.js:15728          queue: this.deps.inbox?.getSnapshot()?.["next-turn"] ?? EMPTY_QUEUE$1
dsh-client-ui-conversation/lib/client.js:15729      };
```

Same field is used internally, e.g. `this.snapshot.draft === ""` (`client.js:15123`) and
`snapshot.draft.slice(0, selection.start)` (`client.js:20218`).

Minimal read (guaranteed by the code above):

```js
const draft = useInput((s) => s.draft);        // string, re-renders only when the text changes
const rev   = useInput((s) => s.draftRev);     // optional
```

For a one-shot read inside a click handler, keep the latest value in a ref (React rules forbid
calling the hook conditionally, but reading a ref is fine):

```js
const draft = useInput((s) => s.draft);
const draftRef = useRef(draft);
useEffect(() => { draftRef.current = draft; }, [draft]);
// onClick: const original = draftRef.current;
```

## 4. Writing the draft — the complete, exact API

`inputActions` is `SessionInputShell.actions`, described in code as “the public provide-channel
action face (one stable identity per session)”:

```
dsh-client-ui-conversation/lib/client.js:14945  /** The public provide-channel action face (one stable identity per session). */
dsh-client-ui-conversation/lib/client.js:14946  actions = {
dsh-client-ui-conversation/lib/client.js:14947      captureInsertion: () => ({ ...this.caretSpan(), draftRev: this.rev }),
dsh-client-ui-conversation/lib/client.js:14951      insertText: (text, span) => {
dsh-client-ui-conversation/lib/client.js:14952          if (this.snapshot.phase === "adjudicating" || this.snapshot.phase === "submitting" || this.disposed) return false;
dsh-client-ui-conversation/lib/client.js:14953          if (span.draftRev !== this.rev) return false;
dsh-client-ui-conversation/lib/client.js:14954          return this.draftEditor.insertAsyncText(span, text);
dsh-client-ui-conversation/lib/client.js:14956      setDraft: (text) => { this.setDraft(text); },
dsh-client-ui-conversation/lib/client.js:14959      persistDraft: () => { this.persistCurrentDraft(); },
dsh-client-ui-conversation/lib/client.js:14962      addAttachments, removeAttachment, pruneAttachments,
dsh-client-ui-conversation/lib/client.js:14969      submit: () => { this.submit("queue"); }
dsh-client-ui-conversation/lib/client.js:14972  };
```

### 4.1 Replace the whole draft (recommended for 「增强」)

```js
inputActions.setDraft(enhancedText);          // void; returns nothing
```

* No revision/span argument, **no phase guard** (`client.js:14956-14958` only forwards).
* Internally: `SessionInputShell.setDraft` → `DraftEditorRuntime.setDraft` clears the editor root and
  appends the new paragraphs; caret lands at the **end**; **merged into history**, i.e. *not an
  undoable step of its own*:

```
dsh-client-ui-conversation/lib/client.js:14686  * Replace the whole draft (persisted-draft seed and programmatic writes).
dsh-client-ui-conversation/lib/client.js:14688  * end. Merged into history so a seed is not an undoable step of its own.
dsh-client-ui-conversation/lib/client.js:14691  setDraft(text) {
dsh-client-ui-conversation/lib/client.js:14694      this.editor.update(() => { nl().clear(); $appendParagraphs(clean); }, { discrete: true, tag: xo });
dsh-client-ui-conversation/lib/client.js:15042  setDraft(text) {                       // SessionInputShell.setDraft: also
dsh-client-ui-conversation/lib/client.js:15043      const draft = resolveDraftInput(text);   // resolves structured drafts / command chips,
dsh-client-ui-conversation/lib/client.js:15045      if (draft.references.length === 0) this.draftEditor.setDraft(draft.text);
dsh-client-ui-conversation/lib/client.js:15046      else this.draftEditor.restoreDraft(draft.text, draft.references);
dsh-client-ui-conversation/lib/client.js:7500   const mo = "history-push", xo = "history-merge", Co = "paste", …
```

`setDraft` takes a plain string (or a full semantic draft; plain string is enough for us). It is
sanitised and normalised: it strips reference placeholders and splits on newlines.

The write is **visible immediately and synchronously published**: the editor update listener runs
`onEditorUpdate` → `dispatchRun` → `run()` → `publish()` → `state.set(next)`, and `publish()` also
persists:

```
dsh-client-ui-conversation/lib/client.js:15021  onEditorUpdate() {
dsh-client-ui-conversation/lib/client.js:15022      if (projectionContentChanged(this.draftEditor.refreshProjection(), this.projection)) {
dsh-client-ui-conversation/lib/client.js:15023          this.rev += 1;
dsh-client-ui-conversation/lib/client.js:15028          this.dispatchRun({ type: "draft-changed", command: this.projection.command });
dsh-client-ui-conversation/lib/client.js:15483  run(effects) { for (const fx of effects) this.execute(fx); this.publish(); }
dsh-client-ui-conversation/lib/client.js:15731  publish() { this.state.set(this.compose()); … this.persistDraft?.(draft); }
dsh-client-ui-conversation/lib/client.js:18030  const unbindDraftPersistence = bindDraftPersistence(actions.setDraft);   // store writer already bound
```

So **you do not need to call `persistDraft()`** after `setDraft`; the shell persists on publish.
`persistDraft()` exists if you must force a store write without an editor change.

### 4.2 Insert at the caret (alternative, only if we keep the user's text)

```js
const span = inputActions.captureInsertion();   // { start, end, draftRev }
const ok = inputActions.insertText(insert, span);  // false if draftRev stale / phase blocked / disposed
```

* `captureInsertion()` captures the **live selection** in detect coordinates, or a collapsed span at
  the document end when there is no selection (`client.js:14947-14950`, `caretSpan()` at `14750-14757`).
* `insertText` is CAS-guarded on `span.draftRev !== this.rev` and refuses during
  `adjudicating`/`submitting`; it applies `insertAsyncText` with tag `Co = "paste"`
  (`client.js:14777-14784`).
* The package README states the undo contract explicitly: “`InputActions.captureInsertion()` captures
  the draft selection and revision; `insertText(text, span)` inserts **one undoable plain-text edit**
  only while that revision is current and the editor permits editing.”
  — `dsh-client-ui-conversation/README.md:168`.

### 4.3 What does **not** exist for writing

* No `setDraft(text, {undo:true})`, no `replaceAll`, no `updateDraft`, no `applyEdit` on the props —
  **NOT FOUND**; the action face has exactly the eight members above.
* No phase guard on `setDraft`: writing while a send is in flight is *possible* but would fight the
  composer's own clear/restore logic. Disable the button when `phase !== "plain"` and `phase !== "claimed"`
  (i.e. `useInput((s) => s.phase)`).

## 5. Undo / 「恢复原文」

* `setDraft` is tagged `history-merge` (`xo`, `client.js:7500`, used at `14699`): the replacement is
  folded into history, so **Ctrl+Z will not undo it** as its own step. The doc comment says exactly
  that (`client.js:14688`).
* `insertText` is tagged `paste` (`Co`) and is documented as **one undoable edit**
  (`README.md:168`).
* The shell can cut history after a committed clear/restore:
  `clearHistory() { this.editor.dispatchCommand(Nn$1, void 0); }` (`client.js:14902-14905`).
* There is **no** public “restore previous draft” or “undo last programmatic write” action
  (**NOT FOUND** in the action face, confirmed by `client.js:14946-14972`).

**Safest 「恢复原文」 design:** keep the pre-enhancement text in your own component state and write it
back with the same verb:

```js
const [original, setOriginal] = useState(null);   // null = nothing to restore

function enhance() {
  const text = draftRef.current;
  if (text.trim() === "") return;
  setOriginal(text);
  inputActions.setDraft(buildEnhanced(text));
}

function restore() {
  if (original === null) return;
  const now = draftRef.current;
  // only restore if the draft still holds our output; otherwise the user has typed — keep it
  if (now !== enhancedRef.current) { setOriginal(null); return; }
  inputActions.setDraft(original);
  setOriginal(null);
}
```

Two caveats worth telling the Lead:

1. Because `setDraft` is not undoable, the restore path **must** be an explicit button (that is a
   design requirement, not a limitation we can avoid).
2. Between 「增强」 and 「恢复原文」 the user may type; a blind restore clobbers it. Compare the current
   draft with the text we wrote (as above) before restoring.

## 6. Session identity

* `sessionId` is a **standard prop in `session` scope** (`ui-session/lib/client.js:758,762`,
  assembled by `ui-renderer/lib/client.js:696-701,815`).
* The dock is only rendered when a session exists (`client.js:19367`), so `sessionId` is always a
  non-empty string inside your dock component — no `undefined` branch needed.
* `inject: (sessionId) => …` is *also* available as a registration option (`ui-slots/lib/index.js:214`;
  renderer passes `binding.key` as the first inject argument, `ui-renderer/lib/client.js:435-441`;
  purge-review does exactly this at `purge-review/plugin/client.js:8688`). Using the inject argument is
  the most version-stable way to get the id, because it needs no assumption about the standard kit.
* `useSession((s) => …)` gives the session snapshot if you need `running`, `openState`, etc.
  (`chat/lib/client.js:2770-2817`).

Per-session state: key your React state by `sessionId` (or reset it in an effect on `[sessionId]`),
because the same dock component instance is reused when the user switches sessions — entries are
rendered once per slot key with a stable React key (`e${id}`, `ui-renderer/lib/client.js:1221`).

## 7. Constraints and pitfalls

1. **Must be a pure React component**; a throwing component blanks the entry (the renderer wraps each
   session entry and abdicates it on error: `ui-renderer/lib/client.js:1136-1150`). `references\practices.md:35`
   warns the console shows `slot entry crashed in '<slot>'`.
2. **Props are stable; wrap in `React.memo`.** Chat's dock pills are memoised
   (`chat/lib/client.js:7565,7603`). The kit objects are cached per binding
   (`ui-renderer/lib/client.js:663-702`), `inject` results are cached (`431-441`), and `t` is cached per
   namespace (`541-546`) precisely so memoised entries do not churn.
3. **Your entry does re-render on every keystroke unless you subscribe narrowly.** The `SlotOutlet`
   itself only re-renders on slot-version changes (`ui-renderer/lib/client.js:1117-1127`), but the
   InputBar above it re-renders on every draft change (it calls `useInput((s) => s)` at
   `client.js:18961`), which re-renders the outlet and re-invokes each entry component. Use
   `React.memo` + selector hooks and you are insulated; do not subscribe to `useInput((s) => s)`.
4. **Do not `require` a Harness client package** — write your own button and borrow the markup/CSS
   (`references\practices.md:35`). Only `dsh.client.inject` ordering is allowed.
5. **Locale**: pass `locale: "<your-ns>"` to the registration to receive `t`
   (`ui-renderer/lib/client.js:742-746`; `InputBar` does exactly this at `client.js:20099` and receives
   `t` at `18960`). Register the dictionary with `ctx.locale.register(ns, { zh, en })` and/or use
   `ctx.locale.bind(ns)` yourself (`purge-review/plugin/client.js:8706-8707`).
6. **Register through `ctx.slots.inject`** so the registration dies with the declaration:
   `ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({...}, Comp))`
   (`templates/decoration/client.js:16-18`, `ui-plugin.md:11`). Registering into an undeclared slot
   throws (`ui-slots/lib/index.js:165`).
7. **`id` must be unique within the dock** or registration throws (`ui-slots/lib/index.js:182-185`).
   Use e.g. `id: "enhanced-prompt"`, `order: 2` (chat owns `0`/`1`).
8. **Hooks must be called unconditionally** — `useInput` is a normal hook; a conditional call breaks
   `StrictSessionEntry`.

## 8. Explicit NOT FOUND list (searched, absent)

Searched tokens across the four client bundles, the extracted asar tree, and `purge-review/plugin/client.js`:
`composer.dock`, `ComposerDock`, `composerDock`, `PropsRuntime`, `draft`, `setDraft`, `updateDraft`,
`setText`, `insertText`, `captureInsertion`, `inputActions`, `InputActions`, `InputState`, `slot`,
`composer`, `uiConversation`.

| Expected thing | Verdict |
|---|---|
| `props.draft` / `props.value` / `props.text` on a dock component | **NOT FOUND** — `renderSlot("conversation.composer.dock", {})`, `client.js:19367` |
| `props.onChange` / `props.setText` / `props.setDraft` | **NOT FOUND** |
| `PropsRuntime` as a runtime symbol | **NOT FOUND** — it is only a *type* name mentioned in `README.md:166`; no `.d.ts` ships with the built packages, so the only authoritative shape is the prop-assembly code in §2.3 |
| `ctx.composer` service | **NOT FOUND** (no such service string in any bundle) |
| Draft read/write on `ctx.uiConversation` | **NOT FOUND** — the service’s whole method list is `binding`, `imageUrl`, `peekImageUrl`, `seedImageUrl`, `inspectSystemPrompt` (`client.js:4024-4137`, `super(ctx, "uiConversation")` at `4041`) |
| `ctx.uiSession.inputActions` / `ctx.uiSession.shell(sessionId)` | **NOT FOUND** on the service; the shell is private to `InputHub`, reachable only through slot props |
| `renderSlot` prop inside a dock entry | **NOT FOUND** — only handed out when the registration declares `children` (`ui-renderer/lib/client.js:753`) |
| `useStore` / `actions` in a dock entry | **NOT FOUND** — only when the registration declares `store` (`748-752`) |
| A dedicated “set draft with undo” / “restore draft” API | **NOT FOUND** |

Also, `conversation.composer.dock` is **not documented in the conversation package README** as a slot
with props — the only README documentation is chat’s `README.md:72` (ids `activity`/`usage`, `order`,
`priority`, `data-composer-stat`). The dock’s prop contract therefore has to be reconstructed from the
renderer, which is what §2.3 does.

## 9. Theme tokens for a small secondary button

The host’s own secondary control in the composer row and the dock pill are the right models. Chat’s
dock pill (`StatsPills.module.css`, CSS string at `dsh-client-ui-chat/lib/client.js:7373`):

```css
.riMk1q_anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}
.riMk1q_pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);
  font:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;background:0 0;border:none;
  align-items:center;gap:6px;padding:1px 8px;display:inline-flex}
.riMk1q_pill svg{flex:none;width:14px;height:14px}
button.riMk1q_pill{cursor:pointer}
button.riMk1q_pill:hover,button.riMk1q_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.riMk1q_label{text-overflow:ellipsis;min-width:0;overflow:hidden}
```

The composer’s icon and select buttons (`InputBar.module.css`, CSS string at `…conversation/lib/client.js:18905`,
abridged — the `select` rule’s inline chevron `background-image` is omitted, as are `appearance:none` and the
`corner-shape` details):

```css
.CHtLlW_add{corner-shape:round;background:var(--dsw-specific-selector);width:28px;height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;display:grid}
.CHtLlW_add:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.CHtLlW_select{color:var(--dsw-alias-label-secondary);background-color:#0000;border:none;outline:none;border-radius:var(--dsw-radius-sm);font-size:13px;font-weight:500;line-height:20px}
.CHtLlW_select:hover:not(:disabled){background-color:var(--dsw-alias-interactive-bg-hover)}
.CHtLlW_primary{background:var(--dsw-alias-button-info-fill);color:#fff;border-radius:999px;width:34px;height:34px}
```

Recommended token set (all observed in host stylesheets):

| purpose | token | where it is vouched for |
|---|---|---|
| label text | `--dsw-alias-label-secondary` (idle) / `--dsw-alias-label-primary` (emphasis) | theme token registry `ui-theme/lib/client.js:1582,1589` |
| disabled/tertiary text | `--dsw-alias-label-tertiary` | used in theme CSS `ui-theme/lib/client.js:1133`; chat pill |
| hover background | `--dsw-alias-interactive-bg-hover` | `ui-theme/lib/client.js:27`; chat pill hover; `CHtLlW_select:hover` |
| strong hover (filled control) | `--dsw-alias-interactive-bg-hover-solid` | `CHtLlW_add:hover` |
| border / stroke | `--dsw-alias-border-l1`, `--dsw-alias-border-l2` | theme token registry `ui-theme/lib/client.js:1561,1568` |
| radius | `--dsw-radius-sm` (pill/control), `--dsw-radius-md`, `--dsw-radius-panel` | `ui-theme/lib/client.js:1407` (base CSS), host rules above |
| accent fill (only for the primary action) | `--dsw-alias-button-info-fill` / `--dsw-alias-button-info-hover` | `ui-theme/lib/client.js:1413`; `CHtLlW_primary` |
| panel fill for a popover | `--dsw-specific-input-major` + `--dsw-elevation-soft` + `--dsw-elevation-stroke-color: var(--dsw-alias-border-l2)` | `CHtLlW_card` at `client.js:18905` |

`--dsw-alias-separator-primary` (used by chat’s pill separator) was **not** found in the theme
bundle — do not rely on it.

Rule from the spec: only `--dsw-alias-*` tokens (plus the `--dsw-radius-*`/`--dsw-elevation-*` used by
host rules) may be referenced; literal colors are for artwork only (`references\practices.md:34`).

## 10. Recommended minimal design

1. `client.js` registers **one** dock entry:
   `ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({ name: "conversation.composer.dock", id: "enhanced-prompt", order: 2, locale: NS }, EnhanceButton))`.
2. `EnhanceButton` is `React.memo`-wrapped and reads only what it needs:
   `const { inputActions, sessionId, t } = props;` plus `const text = useInput((s) => s.draft);`
   and `const phase = useInput((s) => s.phase);`
3. Visibility: render `null` when `text.trim() === ""` (the dock row collapses to nothing), and disable
   while `phase !== "plain" && phase !== "claimed"`.
4. Keep a ref of `text` (and of the text we last wrote) so click handlers never read stale state.
5. On click: `const original = textRef.current; setOriginal({ sessionId, text: original, wrote: enhanced });`
   `inputActions.setDraft(enhanced)`. The Host/enhance engine is reached through your existing
   Host-only path (this recon covers only the client side).
6. While `original !== null` render a second, quieter control 「恢复原文」 in the same dock row
   (dock rows are a centred flex with `gap:12px`, so two pills sit side by side).
7. On restore: if `useInput` draft no longer equals what we wrote, the user edited it — clear the
   stored original and do nothing; otherwise `inputActions.setDraft(original.text)` and clear.
8. Reset stored state on session change: `useEffect(() => { setOriginal(null); }, [sessionId])`.
9. Style with the pill recipe of §9 (`--dsw-radius-sm`, `--dsw-alias-label-secondary`,
   `--dsw-alias-interactive-bg-hover`, 13px/20px, `padding: 1px 8px`, no border) so it matches the
   neighbouring context meter and stat pills.
10. Do **not** call `persistDraft()`; do **not** touch the DOM or `document.body`; do not import any
    Harness client package.
