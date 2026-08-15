# 🤖 WhatsApp AI Bot (Full-Stack Edition)

This is a highly advanced, production-ready WhatsApp bot powered by **Groq AI** (LLaMA 3) and **Whiskeysockets/Baileys**. It features a premium web dashboard for real-time configuration and seamless deployment capabilities.

## ✨ Features

- **Blazing Fast AI**: Uses Groq's LLaMA 3 70B model for near-instant conversational replies.
- **Premium Web Dashboard**: A glassmorphic Express frontend to manage the bot in real-time.
- **Frontend QR Scanning**: No more broken terminal QR codes! The QR code is streamed directly to the web dashboard as a crisp image.
- **Dynamic Whitelisting**: Add/remove allowed phone numbers on the fly from the dashboard without restarting the bot.
- **Custom Triggers**: Change the trigger keyword (e.g., `@Botty`) dynamically, or leave it blank to reply to everything.
- **MongoDB Persistence**: Saves your configuration permanently to MongoDB.

---

## 💻 Local Development Setup

1. **Install Dependencies**

   ```bash
   npm install
   ```
2. **Environment Variables**
   Create a `.env` file in the root directory:

   ```env
   GROQ_API_KEY=your_groq_api_key_here
   MONGODB_URI=your_mongodb_connection_string (Optional for local testing)
   ```
3. **Start the Bot & Dashboard**

   ```bash
   npm run dev
   ```
4. **Connect WhatsApp**

   - Open your browser and go to **[http://localhost:3000](http://localhost:3000)**.
   - Scan the high-quality QR code displayed on the dashboard using your WhatsApp app.
   - The UI will instantly update to `✅ Connected`!

---

## 🚀 Production Deployment (Railway)

Deploying to Railway is incredibly easy, but you **MUST** configure a Volume to ensure your bot doesn't log you out every time you push an update!

### Step 1: Deploy to Railway

1. Push this repository to GitHub.
2. Go to [Railway.app](https://railway.app), click **New Project** -> **Deploy from GitHub repo**.
3. Select this repository. Railway will automatically detect the `npm run build` and `npm start` scripts in your `package.json`.

### Step 2: Set Environment Variables

In your Railway project, click on your service, go to the **Variables** tab, and add:

- `GROQ_API_KEY`
- `MONGODB_URI` (Use MongoDB Atlas to get a free database URI)

### Step 3: CRITICAL - Add Persistent Storage (Volume)

If you skip this step, Railway will delete your WhatsApp session every time you deploy, forcing you to scan the QR code daily.

1. In your Railway service, go to the **Settings** tab.
2. Scroll down to the **Volumes** section.
3. Click **New Volume** (or Add Volume).
4. Set the **Mount Path** exactly to: `/app/whatsapp-auth`
5. Click **Add**. Railway will automatically trigger a redeploy.

### Step 4: Expose the Frontend Dashboard

1. Still in the **Settings** tab, scroll down to **Public Networking**.
2. Click **Generate Domain**.
3. Railway will give you a public URL (e.g., `https://your-bot-production.up.railway.app`).

### Step 5: Final Login

1. Click your newly generated Railway URL.
2. You will see your beautiful web dashboard and a QR code.
3. Scan the QR code with your phone.
4. Because you added the Volume in Step 3, **you will never have to scan this QR code again!**

Enjoy your production-ready WhatsApp AI! 🚀

---

# WhatsApp + AI Integration Guide

This document is a comprehensive, project-independent technical blueprint for implementing a WhatsApp-to-AI integration using Node.js and the `@whiskeysockets/baileys` library.

The architecture described here is based on a reference implementation (an "Expense Bot" that processes financial statements via AI), but the core transport, authentication, and message-handling layers are highly reusable for any text- or audio-based WhatsApp AI application.

---

## 1. Executive Overview

This integration provides a seamless bridge between a WhatsApp Group and an AI Large Language Model (LLM). It enables a Node.js backend to act as a WhatsApp user (or bot), read messages from specific groups, process them using natural language AI, and respond contextually.

* **Technology Used:** Node.js, `@whiskeysockets/baileys` (WhatsApp Web API client), OpenAI API (or compatible proxies like Groq), and MongoDB.
* **Why Baileys?** Baileys communicates directly with WhatsApp's WebSocket servers using the WhatsApp Web protocol. Unlike `whatsapp-web.js`, which runs a full headless Chromium browser via Puppeteer, Baileys is extremely lightweight, uses far less RAM, and is highly suitable for deployment on resource-constrained VPS instances.
* **Communication Flow:** WhatsApp pushes events (messages, connections) to the Baileys WebSocket. The backend listens to the `messages.upsert` event, filters messages to ensure they belong to authorized groups, extracts the text/media, and forwards it to the AI.
* **AI Integration:** The AI interprets the unstructured text (or transcribes audio) and returns structured JSON (for business logic) or conversational text. The backend then uses Baileys to send the response back to the original WhatsApp group.
* **Targeting:** The bot does not respond to every message on the account. It caches group metadata and actively filters incoming messages to process only those originating from authorized groups linked in the database.
* **Confirmation Mechanism:** Instead of native WhatsApp Polls (which are complex to track via Baileys), the bot implements a quoting/reply-based confirmation system. Users reply with "yes" or "no" to the bot's messages, and the bot matches the reply to the original database entity.

### High-Level Architecture Diagram

```text
WhatsApp User
      ↓
WhatsApp Group
      ↓
Baileys WebSocket Connection
      ↓
WhatsApp Event Handler
      ↓
Message Filtering
      ↓
Business Logic
      ↓
AI / LLM
      ↓
AI Response
      ↓
Baileys
      ↓
WhatsApp Group
```

---

## 2. Technology Stack

### Core Dependencies

* **Node.js** (v18+ recommended)
* **TypeScript**
* **`@whiskeysockets/baileys`** (`^7.0.0-rc14`): The core WebSocket-based WhatsApp client. Required.
* **`qrcode-terminal`** (`^0.12.0`): Renders the WhatsApp login QR code in the terminal. Required for initial setup.
* **`pino`** (`^10.3.1`): A low-overhead logging library. Baileys strictly requires a Pino logger instance. Required.
* **`openai`** (`^7.4.0`): The official OpenAI SDK used to communicate with OpenAI or compatible APIs (like Groq, LocalAI). Required if using OpenAI-compatible APIs.
* **`zod`** (`^4.4.3`): Used for strict schema validation of the AI's JSON outputs. Highly recommended to prevent AI hallucinations from breaking backend logic.
* **Database (e.g., `mongoose`)**: Used to store group authorization, user mappings, and business data. Can be swapped for PostgreSQL/Prisma.

### Reference `package.json` Snippet

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "^7.0.0-rc14",
    "openai": "^7.4.0",
    "pino": "^10.3.1",
    "qrcode-terminal": "^0.12.0",
    "zod": "^4.4.3"
  }
}
```

---

## 3. Project Architecture

To maintain a clean separation of concerns, the project should isolate WhatsApp transport logic from AI and business logic.

### Recommended Folder Structure

```text
src/
├── index.ts                 # App entry point, initializes services
├── services/
│   ├── WhatsAppService.ts   # [REUSABLE] Handles Baileys socket, events, QR, Auth
│   ├── AIService.ts         # [REUSABLE] Handles OpenAI API calls, transcription, schema validation
│   └── BusinessService.ts   # [PROJECT-SPECIFIC] App logic (e.g. ExpenseService)
├── models/                  # [PROJECT-SPECIFIC] Database schemas
├── controllers/             # [PROJECT-SPECIFIC] HTTP endpoints (if any)
└── config/                  # Environment and constants
```

### Component Breakdown

1. **`WhatsAppService.ts` (Reusable):**
   * **Purpose:** Manages the Baileys connection lifecycle.
   * **Responsibility:** Load auth state, generate QR, handle reconnects, intercept incoming messages, filter by group, extract text/media, and expose methods to send messages out.
2. **`AIService.ts` (Reusable):**
   * **Purpose:** Interfaces with the LLM.
   * **Responsibility:** Constructs prompts, sends data to the LLM, parses the response via `zod`, and handles audio transcription using Whisper.
3. **`ExpenseService.ts` (Project-Specific):**
   * **Purpose:** Core app logic.
   * **Responsibility:** Takes extracted AI data and interacts with the database (e.g., creating expenses, updating ledgers).

---

## 4. Baileys Architecture

Baileys operates by maintaining a persistent WebSocket connection mimicking WhatsApp Web.

### Key Concepts

* **`makeWASocket`**: The main factory function that establishes the WebSocket connection.
* **`useMultiFileAuthState`**: A utility that manages WhatsApp authentication keys. It saves credentials to a local directory (e.g., `./whatsapp-auth`) so the bot doesn't need to scan a QR code every time it starts.
* **`sock.ev`**: The event emitter for all WhatsApp events.
* **`connection.update`**: Fired when the connection state changes (connecting, open, close, QR code available).
* **`messages.upsert`**: Fired when new messages arrive or messages are updated. This is the primary event for building bots.
* **JID (Jabber ID)**: WhatsApp's internal identifier format.
  * Direct Messages: `[phonenumber]@s.whatsapp.net`
  * Groups: `[group-id]@g.us`
* **Message Object (`m.messages[0]`)**: Contains `key` (id, remoteJid, fromMe) and `message` (conversation, extendedTextMessage, imageMessage, etc.).

### Relevant Code Snippet

```typescript
const { state, saveCreds } = await useMultiFileAuthState('./whatsapp-auth');
const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' })
});

// Save credentials whenever they change
sock.ev.on('creds.update', saveCreds);
```

---

## 5. WhatsApp Authentication

Authentication mimics linking a new device via WhatsApp Web.

### The Process

1. **Initialization:** The app calls `useMultiFileAuthState(WHATSAPP_AUTH_PATH)`.
2. **Missing/Invalid Auth:** If the folder is empty or invalid, Baileys requests a QR code from WhatsApp.
3. **QR Generation:** The `connection.update` event fires with a `qr` string. The app uses `qrcode-terminal` to print it.
4. **Scanning:** The user scans the QR code using the "Linked Devices" feature in their WhatsApp app.
5. **Key Exchange:** WhatsApp sends session keys. `useMultiFileAuthState` saves them as JSON files in the auth directory.
6. **Subsequent Restarts:** The app reads the auth directory, skips the QR code, and connects immediately.

### Authentication Directory Structure

```text
whatsapp-auth/
├── creds.json
├── app-state-sync-key-*.json
├── pre-key-*.json
└── session-*.json
```

> [!CAUTION]
> **NEVER commit the `whatsapp-auth/` directory to Git.** It contains sensitive session keys. If compromised, an attacker can fully hijack the WhatsApp account. Add `whatsapp-auth` to your `.gitignore`.

### Resetting Authentication
To completely reset authentication (e.g., to log in with a different number), delete the entire `whatsapp-auth` directory and restart the application.

---

## 6. Connection Lifecycle

Handling network instability is critical for a WhatsApp bot. Baileys provides the `connection.update` event to manage this.

### Lifecycle Flow

```text
Application starts
      ↓
Load auth state
      ↓
Create Baileys socket
      ↓
connection.update
      ↓
QR available?
 ┌────┴────┐
Yes       No
 ↓         ↓
Show QR   Connect
 ↓
Scan QR
 ↓
Connected
```

### Reference Implementation for Reconnection

```typescript
this.sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
        qrcode.generate(qr, { small: true });
    }
    
    if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
            console.log('Connection closed, reconnecting in 3s...');
            setTimeout(() => this.initialize(), 3000);
        } else {
            console.log('Logged out from WhatsApp. Please delete auth folder.');
        }
    } else if (connection === 'open') {
        console.log('WhatsApp Client is READY!');
    }
});
```

---

## 7. Group Detection

To prevent the bot from replying to personal messages or unauthorized groups, you must implement strict JID filtering.

### Group JID Format
Group JIDs look like this: `120363041234567890@g.us`

### Extraction and Caching
When the bot connects, it should fetch all groups it belongs to and cache their JIDs and names. This allows the bot to map a raw JID back to a human-readable group name.

```typescript
// On connection open:
const groups = await this.sock.groupFetchAllParticipating();
for (const id in groups) {
    this.cachedGroupJidMap.set(id, groups[id].subject);
}
```

### Message Filtering
When a message arrives, check if it's from a group, and verify if that group is authorized in your database.

```typescript
const isGroup = msg.key.remoteJid?.endsWith('@g.us');
if (!isGroup) return; // Ignore direct messages

const groupJid = msg.key.remoteJid;
const groupName = this.cachedGroupJidMap.get(groupJid);

// Check against your database
const isAuthorized = await Database.isGroupRegistered(groupName);
if (!isAuthorized) return; 
```

---

## 8. Incoming Message Processing

The `messages.upsert` event handles all incoming messages.

### Message Pipeline

```text
WhatsApp message arrives
        ↓
messages.upsert
        ↓
Extract message
        ↓
Check message type
        ↓
Check group
        ↓
Ignore bot's own message if necessary
        ↓
Extract sender
        ↓
Extract text
        ↓
Business logic
        ↓
AI
```

### Supported Types in Reference
* **Standard Text:** Mapped directly to AI.
* **Images:** Media is downloaded using `downloadContentFromMessage`, converted to base64, and sent to AI with the caption.
* **Audio/Voice Notes:** Media is downloaded, saved to disk, transcribed via OpenAI Whisper, and the resulting text is passed to the AI.

---

## 9. Message Filtering

Before hitting the business logic or AI, implement strict guardrails to save compute and API costs.

1. **Valid Message Check:** `if (!msg.message) return;`
2. **Group Check:** `if (!isGroup) return;`
3. **Self Check:** 
   ```typescript
   // Prevent infinite loops if the bot replies to itself
   if (msg.key.fromMe && text.startsWith('🤖')) return;
   ```
4. **Empty Text Check:** `if (!text && !hasMedia) return;`

---

## 10. AI Integration

The AI acts as the "brain" translating messy WhatsApp chat into structured JSON logic.

### Environment setup
* `AI_API_KEY`: API key for OpenAI, Groq, etc.
* `AI_TEXT_MODEL`: e.g., `gpt-4o`, `llama-3.3-70b-versatile`
* `AI_AUDIO_MODEL`: e.g., `whisper-large-v3`

### Flow
```text
WhatsApp text
      ↓
Application logic (add members, chat history)
      ↓
Prompt construction
      ↓
AI API
      ↓
AI response (JSON)
      ↓
Text extraction / Parsing
      ↓
WhatsApp reply / DB save
```

### Generic AI Reusable Snippet

```typescript
import { z } from 'zod';
import OpenAI from 'openai';

const schema = z.object({
    intent: z.enum(['ACTION', 'CHAT']),
    data: z.any().optional(),
    chatResponse: z.string().optional()
});

async function processWithAI(text: string, context: string[]) {
    const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
    
    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: 'You are a bot. Output JSON matching the schema.' },
            ...context.map(c => ({ role: 'user', content: c })),
            { role: 'user', content: text }
        ]
    });
    
    return schema.parse(JSON.parse(response.choices[0].message.content!));
}
```

---

## 11. Sending AI Responses Back to WhatsApp

To send messages back, use `sock.sendMessage`.

### Replying to the group
```typescript
await this.sock.sendMessage(groupJid, { text: `🤖 *BOTTY*\n${aiResponse.chatResponse}` });
```

### Replying to a specific message (Quoting)
```typescript
await this.sock.sendMessage(groupJid, { text: 'Confirmed.' }, { quoted: msg });
```

### Important considerations
* Ensure messages are formatted nicely. WhatsApp supports bold (`*text*`), italic (`_text_`), and strikethrough (`~text~`).
* Always prepend a bot identifier (e.g., `🤖`) so users know it's an automated response, and so your own filters can easily ignore bot messages.

---

## 12. Polls & Confirmations (Text-Based)

While WhatsApp has native polls, tracking them via Baileys is highly complex (requiring decryption of `messages.update` events). **The reference implementation uses a much simpler text-reply pattern.**

### How it works:
1. **Creation:** The bot generates a pending record in the database.
2. **Prompt:** The bot sends a message: `*Reply* to this message with "yes" or "no".`
3. **Tracking:** The ID of the bot's sent message (`confirmMsg?.key?.id`) is saved in the database alongside the pending record.
4. **Resolution:** 
   * When a user replies to the bot's message, `msg.message.extendedTextMessage?.contextInfo?.stanzaId` contains the ID of the quoted message.
   * The backend searches the database for a pending record with that `whatsappPollMessageId`.
   * If found, it checks if the reply text is "yes", "y", "no", or "n", and processes the confirmation accordingly.

```text
Backend
   ↓
Create pending action
   ↓
WhatsApp group (Bot says "Reply yes to confirm")
   ↓
User replies "yes" (quoting the bot)
   ↓
messages.upsert
   ↓
Extract quoted stanzaId
   ↓
Match with pending action in DB
   ↓
Business logic execution
```

---

## 13. Project-Specific Business Logic (Expense Bot)

> [!NOTE]
> **PROJECT-SPECIFIC BUSINESS LOGIC** - This section explains the logic unique to the reference app. When rebuilding for a new project, you will replace this with your own domain logic (e.g., scheduling, CRM integration, ticketing).

In the reference implementation:
1. AI identifies the `CREATE_EXPENSE` intent and extracts `totalAmount`, `paidBy`, `sharedExpense`, and `personalExpenses`.
2. Math is validated (`totalAmount == sharedAmount + personalAmount`).
3. An `Expense` MongoDB document is created with status `PENDING_CONFIRMATION`.
4. A summary message is sent to WhatsApp requesting confirmation.
5. Once the payer replies "yes", the expense status is set to `CONFIRMED`.
6. `LedgerService` calculates who owes whom and optionally broadcasts a receipt to a secondary logging channel (e.g., Telegram).

---

## 14. Data Flow Diagrams

### Complete Incoming Text Flow

```text
WhatsApp
 ↓
Baileys
 ↓
messages.upsert
 ↓
Group filtering
 ↓
Message extraction
 ↓
Business logic
 ↓
AI
 ↓
Response
 ↓
Baileys
 ↓
WhatsApp
```

### Application startup

```text
Node.js starts
 ↓
Initialize backend
 ↓
Load authentication
 ↓
Create socket
 ↓
Register event handlers
 ↓
Connect to WhatsApp
 ↓
Ready
```

---

## 15. Environment Variables

| Variable | Required? | Purpose | Example |
| -------- | --------- | ------- | ------- |
| `WHATSAPP_AUTH_PATH` | No | Directory to store session keys | `./whatsapp-auth` |
| `AI_API_KEY` | Yes | Key for OpenAI or Groq | `your_api_key_here` |
| `AI_BASE_URL` | No | Override for custom AI providers | `https://api.groq.com/openai/v1` |
| `AI_TEXT_MODEL` | No | LLM model name | `llama-3.3-70b-versatile` |
| `AI_AUDIO_MODEL` | No | Whisper model name | `whisper-large-v3` |
| `MONGO_URI` | Yes* | Connection string for database | `mongodb://localhost:27017/db` |

*(If using a database)*

---

## 16. Installation Instructions

Commands to bootstrap a brand new project using this architecture:

```bash
mkdir my-whatsapp-ai-bot
cd my-whatsapp-ai-bot
npm init -y

# Install dependencies
npm install @whiskeysockets/baileys pino qrcode-terminal openai zod dotenv

# Install TypeScript dependencies
npm install -D typescript tsx @types/node

# Initialize TS config
npx tsc --init
```

Create `.env`:
```env
AI_API_KEY=your_key_here
```

Ensure you update `.gitignore`:
```text
node_modules/
.env
whatsapp-auth/
```

---

## 17. Minimal Reusable Reference Implementation

Below is the absolute minimum code required to connect Baileys, filter a group, ask an AI, and reply.

**`index.ts`**
```typescript
import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const TARGET_GROUP = 'My Test Group';
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('./whatsapp-auth');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    let groupJid = '';

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        
        if (connection === 'open') {
            console.log('Connected!');
            // Find target group JID
            const groups = await sock.groupFetchAllParticipating();
            const group = Object.values(groups).find(g => g.subject === TARGET_GROUP);
            if (group) groupJid = group.id;
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        
        // Filters
        if (!msg.message || msg.key.fromMe) return;
        if (msg.key.remoteJid !== groupJid) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        // AI Request
        const aiResponse = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: `Reply nicely to: ${text}` }]
        });

        const reply = aiResponse.choices[0].message.content;

        // Send back
        await sock.sendMessage(groupJid, { text: `🤖 ${reply}` });
    });
}

start();
```

---

## 18. Full Current Implementation

*For the full reference implementation, review `backend/src/services/WhatsAppService.ts` and `backend/src/services/AIService.ts` in the source repository.*

**Key highlights of the full implementation:**
* Implements robust error handling and reconnection loops on `connection.update`.
* Handles media downloads by converting Streams to Buffers and formatting as base64 for vision models.
* Caches a rolling window of chat history per `groupJid`.
* Uses a MongoDB backing store to lookup users and map their WhatsApp JID to their Telegram ID.
* Features a Reply-To confirmation mechanism targeting `extendedTextMessage?.contextInfo?.stanzaId`.

---

## 19. Error Handling

| Scenario | Cause | Recommended Handling |
| :--- | :--- | :--- |
| **QR Timeout** | User takes too long to scan. | `connection.update` throws an error. Catch it and call the initialization function again. |
| **Connection Closed** | Network drop or WhatsApp server resets connection. | Check `lastDisconnect.error.output.statusCode`. If it is **not** `DisconnectReason.loggedOut`, automatically wait 3s and reconnect. |
| **Logged Out** | User revoked access via their phone. | **Critical:** Delete the `whatsapp-auth` folder entirely and restart the app to generate a new QR code. |
| **AI Timeout/Rate Limit** | OpenAI/Groq is down or rate limited. | Wrap AI calls in `try/catch`. Send a fallback message to WhatsApp: `"❌ AI is currently unavailable."` |
| **Auth File Corruption** | Server crashed mid-write to `whatsapp-auth`. | Try deleting `session-*.json` files. If it persists, nuke the `whatsapp-auth` folder and re-login. |

---

## 20. Security

> [!WARNING]
> **Session Security:** The `whatsapp-auth` folder is the equivalent of an unlocked physical phone. If leaked, an attacker can read messages and impersonate the number. 

* **Persistence:** Ensure `whatsapp-auth` is strictly excluded from Git.
* **Database Credentials:** Keep MongoDB URIs and AI API keys in `.env` only.
* **Group Whitelisting:** The bot MUST verify that `remoteJid` is explicitly authorized in the database. Without this, anyone could add the bot's phone number to a random group and consume your AI API credits (Prompt Injection / Wallet Draining).
* **Bot Identification:** Always prefix bot messages (e.g. `🤖`) and ignore messages with that prefix to prevent AI-to-AI infinite chat loops.

---

## 21. Deployment

When deploying to a VPS (e.g., using PM2) or Docker, special care must be taken regarding the authentication state.

### Docker Considerations
If using Docker, **you must mount a volume** for the `whatsapp-auth` directory. If you do not, the container will lose its WhatsApp login session every time it restarts, requiring a new QR scan.

**Docker Run command:**
```bash
docker run -v /absolute/path/on/host/whatsapp-auth:/app/whatsapp-auth my-bot
```

### Process Managers (PM2)
If using PM2, the bot will automatically restart if it crashes. Ensure the `whatsapp-auth` directory is in the root of the project so PM2 doesn't trigger continuous restarts when Baileys updates the session files.

---

## 22. Development vs Production

### Development
* Run via `npm run dev` (using `tsx` or `ts-node`).
* The QR code will print in the terminal for easy scanning.
* Keep Pino logger at `level: 'debug'` to see Baileys XML traffic if debugging is needed.

### Production
* Compile to JS using `npm run build` and run via `node dist/index.js`.
* Disable Baileys logging (`level: 'silent'`) as it generates massive amounts of stdout which will bloat PM2/Docker logs.
* Expose a secure HTTP endpoint (e.g., `/api/whatsapp-qr`) that returns `qrcode.generate()` output as an image or raw string so you can scan the QR code from a web dashboard rather than SSH-ing into the production server.

---

## 23. Troubleshooting Guide

**Q: The QR code is not appearing in the terminal.**
* Fix: Ensure `whatsapp-auth` is completely deleted. If Baileys finds corrupted auth files, it might hang instead of generating a QR.

**Q: The bot receives messages but does not reply.**
* Fix: Check your JID filters. Add a `console.log(msg.key.remoteJid)` to ensure the group JID exactly matches what you have authorized.

**Q: The bot replies to every single message in my personal DMs.**
* Fix: You forgot to implement `if (!msg.key.remoteJid?.endsWith('@g.us')) return;`

**Q: Error: `QR refs attempts ended`**
* Fix: This happens when the QR code is displayed but not scanned for ~60 seconds. Implement the reconnection loop as shown in section 6 to automatically regenerate the QR.

---

## 24. Migration Guide for Another Project

To add this WhatsApp + AI integration to an existing Node.js project:

1. **Install:** `npm install @whiskeysockets/baileys pino`
2. **Copy as-is:** Create `WhatsAppService.ts` and copy the Baileys initialization, QR generation, and `connection.update` reconnection logic.
3. **Modify:** Adjust the `whatsapp-auth` path to align with your project's volume mounts.
4. **Modify:** Update the `messages.upsert` event to filter by your project's specific group logic (e.g., querying your existing PostgreSQL DB instead of MongoDB).
5. **Replace:** Completely replace the `ExpenseService` references. Inside `messages.upsert`, extract the text and send it directly to your own `AIService` or controller.
6. **Project-specific:** Write your own Zod schema and system prompt tailored to your application's use case.

---

## 25. Implementation Contract

If delegating the rebuild of this architecture to an AI agent or developer, provide them with this contract:

> **The WhatsApp Integration Implementation MUST:**
> 1. Use `@whiskeysockets/baileys`.
> 2. NOT use Puppeteer or `whatsapp-web.js`.
> 3. Save and persist WhatsApp authentication state to a local directory.
> 4. Gracefully handle and automatically reconnect on network drops (`connection === 'close'`).
> 5. Generate and expose a QR code on initial login.
> 6. Listen to `messages.upsert` for incoming traffic.
> 7. Ignore messages where `msg.key.fromMe === true`.
> 8. Ignore direct messages (only process messages ending in `@g.us`).
> 9. Actively verify that the incoming group JID is authorized before processing.
> 10. Abstract AI interactions into a separate service, utilizing structured JSON output validation (e.g. Zod).
> 11. Implement confirmation flows using "Reply-To" message matching (`stanzaId`), NOT native WhatsApp polls.
> 12. Ensure authentication directories are `.gitignore`d and volume-mounted in production.

---

## 26. Exact Commands

**Quick Setup for a new project:**

```bash
mkdir new-wa-bot && cd new-wa-bot
npm init -y
npm install @whiskeysockets/baileys pino qrcode-terminal openai zod dotenv
npm install -D typescript tsx @types/node
npx tsc --init

# Create auth directory
mkdir whatsapp-auth
echo "whatsapp-auth/" >> .gitignore
echo ".env" >> .gitignore

# Run dev
npx tsx src/index.ts
```

**Reset Authentication:**
```bash
rm -rf whatsapp-auth/
# Restart application to get a new QR code
```

---

## 27. Glossary

* **Baileys:** The WebSocket-based library used to interface with WhatsApp.
* **WebSocket:** A persistent, real-time TCP connection used by Baileys to communicate with WhatsApp servers.
* **JID (Jabber ID):** WhatsApp's internal user ID format (e.g., `1234567890@s.whatsapp.net` for users, `1234567890-987654@g.us` for groups).
* **`makeWASocket`:** The core Baileys function that instantiates the connection.
* **`useMultiFileAuthState`:** Baileys utility that saves session keys locally to bypass the QR code on restart.
* **`messages.upsert`:** The Baileys event fired when a new message is received.
* **`stanzaId`:** The unique identifier for a specific message (used to track replies/quotes).

---

## 28. Final Architecture Summary

```text
                ┌─────────────────┐
                │  WhatsApp Group │
                └────────┬────────┘
                         │ (WebSocket Push)
                         ▼
                ┌─────────────────┐
                │     Baileys     │
                │  (makeWASocket) │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ messages.upsert │
                └────────┬────────┘
                         │
             (Check JID / Reject if unauthorized)
                         │
                         ▼
                ┌─────────────────┐
                │  Business Logic │
                │ (ExpenseService)│
                └────────┬────────┘
                         │ (Context + Prompt)
                         ▼
                ┌─────────────────┐
                │    AIService    │
                │ (OpenAI / Zod)  │
                └────────┬────────┘
                         │ (Structured JSON)
                         ▼
                ┌─────────────────┐
                │  Baileys Send   │
                │ (sock.sendMessage)
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │  WhatsApp Group │
                └─────────────────┘
```

---

## 29. ExpenseBot Advanced AI Configuration

This project implements an advanced AI routing configuration to maximize speed and reduce costs by connecting to Groq instead of standard OpenAI servers.

### What We Use
* **Provider API:** Groq (accessed via the standard `openai` npm package, pointing the `baseURL` to `https://api.groq.com/openai/v1`).
* **Text Model (`AI_TEXT_MODEL`):** `llama-3.3-70b-versatile` (Meta's Llama 3.3). Used for natural language chat, identifying intent, and extracting JSON data.
* **Audio Model (`AI_AUDIO_MODEL`):** `whisper-large-v3` (OpenAI's Whisper). Used to transcribe voice notes into text before passing them to the text model.

### How We Use It (The Code)

In `src/services/AIService.ts`, the OpenAI client is configured as follows:

```typescript
import OpenAI from 'openai';
import fs from 'fs';

export class AIService {
    private openai: OpenAI;

    constructor() {
        // Point the baseURL to Groq's servers using the OpenAI SDK
        this.openai = new OpenAI({ 
            apiKey: process.env.GROQ_API_KEY,
            baseURL: 'https://api.groq.com/openai/v1'
        });
    }

    // 1. TEXT GENERATION (Using Llama 3.3)
    async generateResponse(text: string): Promise<string> {
        const response = await this.openai.chat.completions.create({
            model: process.env.AI_TEXT_MODEL || 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: 'You are an expense bot assistant.' },
                { role: 'user', content: text }
            ]
        });
        return response.choices[0].message.content || '';
    }

    // 2. AUDIO TRANSCRIPTION (Using Whisper v3)
    async transcribeAudio(audioFilePath: string): Promise<string> {
        const transcription = await this.openai.audio.transcriptions.create({
            file: fs.createReadStream(audioFilePath),
            model: process.env.AI_AUDIO_MODEL || 'whisper-large-v3',
            response_format: 'text'
        });
        return transcription as unknown as string;
    }
}
```
