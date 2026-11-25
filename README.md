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
  like and, if they tick the box, have a copy emailed to them, attachments
  linked. Once a chat has ended, from either side, it is ended: nobody can add
  to it, and the visitor starts a fresh one if they have more to say.
- **Name, phone and email whenever suits.** An optional contact box is pinned
  to the top of the chat window: name with the phone number beside it, then
  email. Once saved it shrinks to what we hold, each with a pencil to change or
  clear it. Phone numbers can be typed any way (07332 342 234, +44 7332 342 234)
  and are stored with no spaces (07332342234).
- **Keeps itself up to date.** The admin chat window never needs a reload:
  new messages, chats starting and ending, unread counts, who is on the site
  and the Online switch all update on their own, at once when you come back to
  the tab, and anything you do shows straight away in every other tab you have
  it open in. "Typing…" shows both ways, your last reply says Seen once the
  visitor has had it on screen, and each chat says how long it has been waiting.
- **A reply box that keeps up.** Drafts kept per chat, words typed while a
  message is sending kept too, screenshots pasted or files dropped straight in,
  and a New message button instead of being yanked down while you scroll back.
- **Answer from anywhere.** From *Inbox > Live chat* in the admin, from the
  bubble on the site itself while you are signed in, or from the Unified Inbox
  if you have it installed - new chats land there the moment they are sent.
- **See it as a visitor does.** The eye in the bubble's header swaps a
  signed-in colleague's view of the site for the visitor's own chat window,
  so you can check the greeting and away message or send a test message the
  way a visitor would. The people icon in that window takes you back.
- **See who is on the site.** Everybody browsing who said yes to the Live chat
  cookies is listed while they are here, chatting or not: the page they are on,
  the pages they came through and, with the shop, what is in their basket. Say
  hello first and the chat pops up on their screen.
- **Messages we send first.** Optional, off by default, and only while you are
  online and the visitor has no chat going. A welcome message goes to a visitor
  who has been on the site a set number of seconds without writing to us, and a
  basket message goes a set number of seconds (0 = straight away) after their
  first add. Each is sent once per visitor. A chat that is nothing but one
  of these leaves your chat list when the visitor leaves the site without
  answering, and comes back if they return.
- **Your own name.** A cog in the chat header lets each colleague choose the
  name visitors see on their replies; left empty, it is the first name on their
  account.
- **Asks first.** Declares a *Live chat* category for your cookie banner. Once
  the banner carries it, a visitor is asked before they can chat (one button,
  live chat only), and anybody who said no is shown the cookie settings when
  they try to send something.
- **Admin alerts.** Waiting chats light the admin bell, and buzz anyone who has
  desktop alerts switched on.
- **Tidies up after itself.** Chats with nothing said in them for longer than
  you choose (12 months by default) are deleted overnight, files and all.

## Settings

*Settings > Live Chat*: switch the bubble on or off, its label, the greeting,
which corner it sits in, whether visitors may email themselves a transcript,
how long chats are kept, and whether to list who is on the site. It also tells
you if your cookie banner is missing the Live chat switch.

## Permissions

| Key | Lets somebody |
| --- | --- |
| `chat.view` | read chats, see the admin bubble on the site and who is on the site |
| `chat.reply` | reply to and end chats, and message a visitor first |
| `chat.manage` | change settings and delete chats |

## How it works (for developers)

- Module name `chat`, table prefix `chat_`. Distinct from the Chatwoot-powered
  `live-chat` module, so the two can sit side by side while a site moves over.
- "Live" is polling, which is the honest shape of it on serverless hosting: the
  visitor's widget asks every 3 seconds while open and 12 while shut, the admin
  views every 3-5 seconds, all backing off when the tab is hidden. Typing
  rides along on those same polls (`?typing=1`, migration `009_typing.sql`),
  so it costs no extra requests.
- A visitor proves a chat is theirs with a secret their browser was handed when
  the chat began (sent as the `x-chat-visitor` header). Only its hash is stored.
  No accounts. Where the cookie banner carries the `live-chat` category,
  nothing is kept in the browser until the visitor says yes to it.
- Visitors who said yes check in to `/api/m/chat/widget/presence` as they move
  around (and every 30 seconds while the tab is in front), claimed with their
  own `x-chat-presence` secret. The basket is read from the shop's own
  `localStorage` copy (ids and quantities) and named from `shp_products` on the
  server, when that table exists. A closing tab says goodbye to
  `/api/m/chat/widget/leave`, so the visitor leaves the list at once rather
  than 90 seconds later. Trails are deleted 7 days after the visitor
  was last seen, or at once if they withdraw consent.
- Attachments are written under `media/chat/<conversation>/` with an
  unguessable key and served only through `/api/m/chat/attachments/<id>`,
  either to an admin with `chat.view` or via a signed link.
- Visitor notifications use Web Push with the site's own signing keys, through
  a service worker served at `/api/m/chat/widget/sw` (scoped to that folder, so
  it takes over no page of the site).
- Publishes `core.conversation-provider` and announces every new message with
  `core.conversation-arrived`, which is how the Unified Inbox gets it at once.
- Needs `ENCRYPTION_KEY`. `CRON_SECRET` runs the nightly retention sweep.

## Letting another module answer chats (for developers)

Nothing here changes a site that runs Live Chat on its own: with no module
plugged in, every screen and every message is exactly as described above. These
are seams for a module that answers chats in its own way (an out-of-hours
service, a queue, an assistant). None of them needs a table or column of ours.

**`chat.responder`** (server, `serverOnly: true`). Publish one object; the
contract is `ResponderContract` in `lib/responder.ts`:

- `authorId` - a `module:<name>` string stored as the author of every message
  the responder writes, so it can never be taken for a colleague.
- `offerVisitorMessage({ conversationId, messageId, visitorId, online, newConversation })`
  - offered each visitor message as it is saved. Return `true` to take the
  reply (then do the slow work yourself, in `after()`): the chat is not counted
  as waiting for a colleague and no offline reply goes. Anything else is a no,
  and Live Chat carries on as normal.
- `answeringAs({ online, visitorId })` - `{ authorName }` while you are
  answering, else `null`. Asked only while the Online switch is off, and then
  often (page renders, check-ins, open chat windows), so keep it cheap. A yes
  shows visitors we are online and lets the welcome and basket messages go
  under your name and `authorId`.
- `colleagueReplied({ conversationId, userId })` - a person replied, from the
  admin, the bubble on the site, the visitor list or the Unified Inbox.
- `onlineChanged({ online, openConversationIds })` - return `{ covered: true }`
  to stop Live Chat sending its "we have had to step away" message to visitors
  left waiting when the switch goes off.
- `messageLabel()` - a short badge for your messages (or `null`).

Every call has two seconds. A throw, a timeout or an answer that does not parse
counts as a no, so a responder having a bad day costs nobody their reply.

**`lib/responder-api.ts`** is the one file a responder module imports (declare
`requiresModules: chat`): `postResponderMessage`, `setResponderTyping`,
`askForColleague` (counts the chat as waiting, lights the bell, chimes the
admin list; it stays waiting until a colleague reads it), `endConversationAsAgent`,
`getConversationForResponder` (the chat, every message, and the visitor's trail
and basket when they are listed) and `readResponderAttachment`. Posting refuses
an ended chat with `ChatEndedError`.

**Client slots.** Publish a component from a `'use client'` file, outside
`components/admin/` so it reaches the bubble on the site too. The first one
registered at each point is drawn; one that throws is quietly left out. Prop
types are in `lib/slots.ts`:

| Point | Where | Props |
| --- | --- | --- |
| `chat.admin-toolbar` | beside the Online switch, admin chat window and site bubble | `{ surface: 'inbox' \| 'bubble' }` |
| `chat.conversation-actions` | the header of the chat on screen, both places | `{ conversationId, status }` |
| `chat.product-actions` | under a message with product cards, visitor's window only | `{ products: ChatProduct[] }` |

Each `ChatProduct` carries `basket: { productId, listingId, needsChoice }`, the
shop's own ids for adding exactly that product or variation, when the shop
could say. Where the address names a delivery service the shop still offers for
it (`delivery-service=<key>`), it also carries `delivery: { key, label, price }`:
the shop's own key for that service, its name and today's price.
