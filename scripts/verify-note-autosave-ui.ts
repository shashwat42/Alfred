import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const dom = new Window({ url: 'http://localhost:5173/' });
const names = ['window', 'document', 'navigator', 'localStorage', 'CustomEvent', 'MutationObserver', 'Node', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom[name as keyof Window] });
const server = await createServer({ mode: 'development', cacheDir: 'node_modules/.vite-note-tests', optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { createRoot } = await import('react-dom/client');
document.body.innerHTML = '<div id="root"></div>';
const root = createRoot(document.getElementById('root')!);
const waitForSave = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); });
try {
  const { NotesView } = await server.ssrLoadModule('/src/components/dashboard/NotesView.tsx');
  const { useNotes } = await server.ssrLoadModule('/src/hooks/useNotes.ts');
  const note = { _id: 'note-a', title: 'Note', content: '<div>Original</div>' };
  const calls: Array<{ id?: string; content: string }> = [];
  let complete!: (note: typeof note) => void;
  const onSaveNote = (payload: { id?: string; content: string }) => {
    calls.push(payload);
    return new Promise(resolve => { complete = resolve; });
  };
  const render = (activeNote: typeof note) => root.render(createElement(NotesView, { notes: [], activeNote, onSaveNote, onSelectNote() {}, onDeleteNote: async () => true, onBackToList() {} }));
  const edit = async (html: string) => act(async () => {
    const editor = document.querySelector<HTMLElement>('[contenteditable]')!;
    editor.innerHTML = html;
    editor.dispatchEvent(new dom.Event('input', { bubbles: true }));
  });
  await act(async () => render(note));
  const editor = document.querySelector<HTMLElement>('[contenteditable]')!;
  await edit('<div>First edit</div>');
  await waitForSave();
  assert.equal(calls.length, 1);
  const originalNode = editor.firstChild;
  const range = document.createRange();
  range.selectNodeContents(originalNode!);
  range.collapse(false);
  window.getSelection()!.addRange(range);
  editor.parentElement!.scrollTop = 400;
  await act(async () => complete({ ...note, content: calls[0].content }));
  assert.equal(editor.firstChild, originalNode, 'Save acknowledgment must preserve DOM nodes and cursor');
  assert.equal(window.getSelection()!.anchorNode, range.startContainer);
  assert.equal(editor.parentElement!.scrollTop, 400);
  await edit('<div>Second edit</div>');
  await waitForSave();
  await edit('<div>Typed while saving</div>');
  await waitForSave();
  assert.equal(calls.length, 2, 'Saves cannot overlap');
  await act(async () => complete({ ...note, content: calls[1].content }));
  assert.equal(editor.innerHTML, '<div>Typed while saving</div>');
  await waitForSave();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].content, '<div>Typed while saving</div>');
  const lateCompletion = complete;
  await act(async () => render({ ...note, _id: 'note-b', content: '<p>Other note</p>' }));
  await act(async () => lateCompletion({ ...note, content: calls[2].content }));
  assert.equal(editor.innerHTML, '<p>Other note</p>', 'Late saves cannot replace a different note');
  await act(async () => render({ ...note, _id: '', content: '' }));
  await edit('<p>Draft</p>');
  await waitForSave();
  assert.equal(calls.at(-1)!.id, '');
  await edit('<p>Draft with more typing</p>');
  await act(async () => complete({ ...note, _id: 'created-note', content: '<p>Draft</p>' }));
  await waitForSave();
  assert.equal(calls.at(-1)!.id, 'created-note', 'Further draft edits must update the created ID');
  await act(async () => complete({ ...note, _id: 'created-note', content: calls.at(-1)!.content }));

  // Verify the real hook also leaves the live selection untouched on acknowledgment.
  let notesState: ReturnType<typeof useNotes>;
  function Harness() { notesState = useNotes(undefined); return null; }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ...note, content: 'Saved snapshot' });
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => notesState.setActiveNote(note));
    await act(async () => { await notesState.saveNote({ id: note._id, content: 'Saved snapshot' }); });
    assert.equal(notesState.activeNote, note);
    assert.equal(notesState.notes[0].content, 'Saved snapshot');
  } finally { globalThis.fetch = originalFetch; }
  console.log('PASS: Autosave preserves editor DOM, serializes saves, keeps newer typing, ignores stale completion, and reuses created draft IDs.');
} finally {
  await act(async () => root.unmount());
  await server.close(); await dom.happyDOM.abort();
  for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
