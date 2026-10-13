// Contribution to core.media-private-storage: chat attachments live in their
// own folder with no media library row, so a visitor's file never turns up in
// the media picker, and core never offers to adopt or delete it.
//
// A bare literal on purpose. Everything contributed to an extension point is
// imported by the generated public map, and this should cost nothing there.
export const chatPrivateStorage: readonly string[] = ['chat']
