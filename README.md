# 📚 RAGBooks

![Active Development](https://img.shields.io/badge/status-active-success)
![SillyTavern Extension](https://img.shields.io/badge/SillyTavern-extension-blue)

> _Universal RAG system for vectorizing and intelligently injecting any text content—lorebooks, character cards, chat history, or custom documents._

---

## What It Does

**Complete and total vectorization/databank overhaul.** RAGBooks uses semantic search to find and inject **only the relevant chunks** based on your conversation. Vectorize anything. Lorebooks, character cards, past conversations, web pages, wikis. Let RAG handle smart context injection.

Save **80-90% of your context** while keeping full access to your lore.

---

## 🎯 Core Features

### 📦 **Vectorize Everything**
- **Lorebooks**: Per entry, paragraph, semantic, or fixed-size chunking
- **Character Cards**: Per field, paragraph, or smart merge
- **Chat History**: By scene, by speaker, or natural chunking
- **Web Pages**: Fetch URLs with Readability integration
- **Wikis**: Scrape Fandom/MediaWiki (requires [Fandom-Scraper plugin](https://github.com/SillyTavern/SillyTavern-Fandom-Scraper))
- **YouTube**: Grab transcripts with language selection
- **GitHub**: Download repos with glob patterns
- **Files**: Upload .txt, .md, .json, .yaml, .html

### 🔍 **Smart Retrieval**
- **Dual-Vector Search**: Summaries + full text, merged with RRF
- **Importance Weighting**: 0-200% per chunk, with priority tiers
- **Conditional Activation**: 10 condition types (keyword, speaker, emotion, time, location, etc.)
- **Chunk Groups**: Shared keywords boost entire groups
- **Temporal Decay**: Old chat chunks fade over time (exponential/linear)

### 🎬 **Scene Management** (Chat Only)
- Mark scenes with green/red flags in chat
- Titles, summaries, keywords per scene
- Scene-aware temporal decay
- Dual-vector for scene summaries

### 🖥️ **3-Tab Chunk Viewer**
- **Chunks**: Edit text, keywords, summaries, importance, conditions, groups
- **Scenes**: Manage scene metadata, jump to chat
- **Groups**: View all groups and members

---

## ⚙️ Setup

### 1️⃣ **Install Extension**

Use this link: https://github.com/Coneja-Chibi/RAGbooks_Rabbit-Augmented-Generation In the extensions section of ST.

Refresh.

### 2️⃣ **Configure Vectors Extension**

RAGBooks uses SillyTavern's built-in Vectors extension:

1. Go to **Extensions** > **Vector Storage**
2. Select embedding provider (OpenAI, transformers, Ollama, etc.)
3. Add API key if needed
4. Test connection

**Supported Providers:** transformers (local), OpenAI, Mistral, Cohere, Nomic, Together, Ollama, llama.cpp, KoboldCpp, vLLM, and more.

### 3️⃣ **Enable RAGBooks**

1. Open **Extensions** > **RAGBooks**
2. Toggle **Enable RAGBooks** ON
3. Configure settings:
   - **Top-K**: How many chunks to inject (default: 3)
   - **Threshold**: Minimum similarity score (default: 0.5)
   - **Injection Depth**: Where in context (default: 4)

### 4️⃣ **Add Content**

1. **Add New Source** dropdown → choose content type
2. Configure chunking strategy
3. Click **Vectorize**
4. Open **Chunk Viewer** to inspect/edit

### 5️⃣ **Chat Normally**

RAGBooks runs in the background—no manual triggers needed.

---

## 🧩 Advanced Features

### Dual-Vector Search

Create summaries for long chunks. Both summary and full text are vectorized separately. When the summary matches your query, the full chunk is injected.

**Example:** 800-word backstory → 50-word summary. Query "dragon trauma" matches summary → full backstory injected.

**Settings:** Summary Search Mode → "Both" (recommended)

### Importance Weighting

Boost or reduce chunk priority (0-200%).

- **Critical** (175-200%): Always first
- **High** (125-174%): Boosted
- **Normal** (75-124%): Neutral
- **Low** (0-74%): Reduced

**Display Modes:** Continuous (by score) or Priority Tiers (grouped)

### Conditional Activation

Chunks only activate when conditions are met.

**10 Condition Types:**
- `keyword`: Keyword in recent messages
- `speaker`: Last speaker matches
- `messageCount`: Message count ≥ threshold
- `chunkActive`: Another chunk is active
- `timeOfDay`: Real-world time range (HH:MM-HH:MM)
- `emotion`: Detected emotion (happy, sad, angry, etc.)
- `location`: Location keyword (supports `{{location}}` macro)
- `characterPresent`: Character appears as speaker
- `storyBeat`: Story phase (supports `{{storyphase}}` macro)
- `randomChance`: % chance (0-100)

**Logic:** AND (all match) or OR (any match). Each condition can be negated.

**Example:** Dragon weakness entry → only activates when "dragon" mentioned AND speaker is "DragonSlayer" AND NOT fearful.

### Chunk Groups

Group related chunks. When ANY group keyword matches, ALL chunks in group get boosted.

**Example:**
- 10 combat abilities → group "Combat Moves"
- Keywords: ["fight", "attack", "combat"]
- User says "I attack" → all 10 abilities get 30% boost

**Required Groups:** Force at least 1 chunk from group into results.

### Temporal Decay (Chat Only)

Old chat chunks fade over time. Recent messages stay strong.

**Modes:**
- **Exponential**: Natural decay curve (half-life: 50 messages)
- **Linear**: Steady decline (1% per message)

**Scene-Aware:** Reset decay at scene boundaries.

**Example:** 500-message RP → recent 50 messages at 100%, old messages decay to 30% but still retrievable.

---

## 🎬 Scene Management

### Creating Scenes

**In Chat:**
- Green flag button = scene start
- Red flag button = scene end

**In Viewer:**
- Scenes tab → manage metadata

### Scene Metadata

Each scene stores:
- **Title**: Custom name (syncs with chunk name)
- **Summary**: Short description
- **Keywords**: Scene tags
- **Summary Vector**: Toggle separate vectorization

### Scene Features

- **Chunking**: "By Scene" strategy uses scene boundaries
- **Dual-Vector**: Scene summaries are vectorized separately
- **Decay Reset**: Scene-aware decay resets at scene starts

---

## 🛠️ Settings

### Global Settings
- **Enable RAGBooks**: Master toggle
- **Orange Accent Mode**: Orange UI vs theme colors
- **Top-K**: Chunks per message (1-10, default: 3)
- **Threshold**: Min similarity (0-1, default: 0.5)
- **Injection Depth**: Context position (1-10, default: 4)

### Advanced Features
- **Summary Search Mode**: Both / Summary only / Full text only
- **Importance Weighting**: Enable + display mode (continuous/tiers)
- **Conditional Activation**: Enable/disable
- **Chunk Groups**: Enable + boost multiplier (1.0-3.0x)
- **Context Window**: Messages for conditions (5-50, default: 10)
- **Temporal Decay**: Enable + mode + half-life/rate + min relevance + scene-aware

### Per-Source
- **Chunking Strategy**: Varies by content type
- **Chunk Size**: 200-1000 chars (for fixed/natural)
- **Chunk Overlap**: 0-200 chars
- **Summarize**: AI summary generation (Yes/No)
- **Summary Style**: Concise / Detailed / Keywords / Extractive
- **Extract Metadata**: Auto-extract keywords

---

## 💡 Use Cases

### Combat Lorebook
20 abilities → group as "Combat Moves" → keywords ["fight", "attack"] → mark required → when combat mentioned, at least 1 ability always injected, all get 30% boost.

### Character Trauma
800-word trauma backstory → 150% importance → conditions: `keyword="trauma"` OR `keyword="past"` OR `emotion="sad"` → only injects when relevant.

### Long RP Scenes
500+ messages → mark scenes every 20-30 messages → enable scene-aware decay → recent scene stays fresh, old scenes decay but summaries help retrieval.

### Wiki Documentation
Scrape BG3 wiki → natural chunking → AI summaries → dual-vector search → long articles chunked semantically, summaries match queries, full text injected.

---

## 🔌 Dependencies

### Required
- SillyTavern (latest)
- Vectors extension (built-in)

### Optional
- [SillyTavern-Fandom-Scraper](https://github.com/SillyTavern/SillyTavern-Fandom-Scraper) (for wiki scraping)

### Embedding Providers
Works with 14+ providers: transformers (local), OpenAI, Mistral, Cohere, Nomic, Together, Ollama, llama.cpp, KoboldCpp, vLLM, WebLLM, PaLM, Vertex AI, Extras.

---

## 🐰 Credits

**Made by Coneja Chibi**

Other extensions: [BunnyMo](https://github.com/Coneja-Chibi/BunnyMo) • [CarrotKernel](https://github.com/Coneja-Chibi/CarrotKernel) • [Rabbit Response Team](https://github.com/Coneja-Chibi/Rabbit-Response-Team)

---

**Questions?** Open an issue or ask in [AI Preset Discord](https://discord.gg/sillytavern)
