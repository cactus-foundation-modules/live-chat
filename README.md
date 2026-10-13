<p align="center">
  <img src="module-art.webp" alt="Live Chat" width="640" />
</p>

# Live Chat

A small live chat for Cactus sites that does what it says on the tin and very
little else. No chat server to run, no third-party widget, nothing to provision:
conversations live in your site's own database and attachments in your site's
own media storage (Backblaze on most sites).

## What it does

- **A chat bubble on your site.** Add the *Live Chat* block to your header or
  footer layout and it appears in the bottom corner of every page using it.
- **Bubbles while the chat is shut.** If we reply while the visitor has the
  window closed, the message pops up above the bubble, the way a text does on a
  phone. The same happens for you when a visitor writes in.
- **Browser notifications.** Once a visitor has sent a message, the chat asks
  whether they would like a notification when we reply - including after they
  have closed the tab, in browsers that support it.
- **Attachments.** Pictures, PDFs and office documents up to 4MB each, kept
  privately in your media storage and never shown in the media library.
- **End chat and email a transcript.** Visitors can end the chat whenever they
  like and have a copy emailed to them, attachments linked.
- **Answer from anywhere.** From *Inbox > Live chat* in the admin, from the
  bubble on the site itself while you are signed in, or from the Unified Inbox
  if you have it installed - new chats land there the moment they are sent.
- **Admin alerts.** Waiting chats light the admin bell, and buzz anyone who has
  desktop alerts switched on.
- **Tidies up after itself.** Chats with nothing said in them for longer than
  you choose (12 months by default) are deleted overnight, files and all.

## Settings

*Settings > Live Chat*: switch the bubble on or off, its label, the greeting,
which corner it sits in, whether visitors may email themselves a transcript,
and how long chats are kept.

## Permissions

| Key | Lets somebody |
| --- | --- |
| `chat.view` | read chats, and see the admin bubble on the site |
| `chat.reply` | reply to, end and reopen chats |
| `chat.manage` | change settings and delete chats |

## How it works (for developers)

- Module name `chat`, table prefix `chat_`. Distinct from the Chatwoot-powered
  `live-chat` module, so the two can sit side by side while a site moves over.
- "Live" is polling, which is the honest shape of it on serverless hosting: the
  visitor's widget asks every 3 seconds while open and 12 while shut, the admin
  views every 3-5 seconds, all backing off when the tab is hidden.
- A visitor proves a chat is theirs with a secret their browser was handed when
  the chat began (sent as the `x-chat-visitor` header). Only its hash is stored.
  No cookies, no accounts.
- Attachments are written under `media/chat/<conversation>/` with an
  unguessable key and served only through `/api/m/chat/attachments/<id>`,
  either to an admin with `chat.view` or via a signed link.
- Visitor notifications use Web Push with the site's own signing keys, through
  a service worker served at `/api/m/chat/widget/sw` (scoped to that folder, so
  it takes over no page of the site).
- Publishes `core.conversation-provider` and announces every new message with
  `core.conversation-arrived`, which is how the Unified Inbox gets it at once.
- Needs `ENCRYPTION_KEY`. `CRON_SECRET` runs the nightly retention sweep.
