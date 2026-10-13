// ChatBubble Puck block, editor half. The block is only a placement marker: put
// it in the header or footer layout and the chat appears on every page using
// it. Who sees what (the visitor's widget or a colleague's bubble) is decided in
// ChatBlock.rsc.tsx, which reads the session and so cannot live in the editor.

function EditorPreview() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.6rem 1rem', borderRadius: '999px', margin: '0.5rem',
      background: 'var(--color-primary)', color: 'var(--color-on-primary)',
      fontSize: '0.875rem', fontWeight: 600,
    }}>
      💬 Live chat bubble (sits in the bottom corner on the real site)
    </div>
  )
}

export const chatBlockComponent = {
  label: 'Live Chat',
  fields: {},
  defaultProps: {},
  render: EditorPreview,
}
